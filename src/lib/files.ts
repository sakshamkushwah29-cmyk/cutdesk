import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { HttpError } from "./http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LOCAL_UPLOAD = "local";

export function storageRoot() {
  const configured = process.env.STORAGE_DIR?.trim();
  return path.resolve(configured ? configured : path.join(process.cwd(), "storage"));
}

export function storageKeyFor(workspaceId: string, versionId: string) {
  if (!UUID.test(workspaceId) || !UUID.test(versionId)) {
    throw new HttpError(400, "Storage key is not valid.");
  }
  return `${workspaceId}/${versionId}`;
}

export function resolveStorageKey(key: string) {
  const [workspaceId, versionId, extra] = key.split("/");
  if (extra !== undefined || !workspaceId || !versionId) {
    throw new HttpError(400, "Storage key is not valid.");
  }
  const root = storageRoot();
  const full = path.resolve(root, storageKeyFor(workspaceId, versionId));
  if (full !== path.join(root, workspaceId, versionId)) {
    throw new HttpError(400, "Storage key is not valid.");
  }
  return full;
}

export function usesCloudStorage() {
  return process.env.VERCEL === "1" && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function isNoSpace(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOSPC";
}

function isReadOnlyDisk(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EROFS" || code === "EPERM" || code === "EACCES" || code === "ENOENT";
}

export async function diskFreeBytes() {
  const root = storageRoot();
  try {
    await mkdir(root, { recursive: true });
  } catch (error) {
    if (isReadOnlyDisk(error)) {
      throw new HttpError(507, "This host cannot store uploaded files on its own disk.", "DISK_FULL");
    }
    throw error;
  }
  const stats = await statfs(root);
  return BigInt(stats.bavail) * BigInt(stats.bsize);
}

export async function assertDiskFits(byteSize: bigint) {
  const free = await diskFreeBytes();
  if (byteSize > free) {
    throw new HttpError(507, "This server does not have enough free disk for that file.", "DISK_FULL");
  }
}

export async function allocateLocalFile(key: string) {
  const full = resolveStorageKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  const handle = await open(full, "w");
  await handle.close();
}

export async function localFileSize(key: string) {
  const info = await stat(resolveStorageKey(key));
  return BigInt(info.size);
}

export async function writeLocalChunk(key: string, start: number, chunk: Buffer) {
  const current = await localFileSize(key);
  if (current !== BigInt(start)) {
    throw new HttpError(400, "Send upload chunks in order from the start of the file.");
  }
  const handle = await open(resolveStorageKey(key), "r+");
  try {
    const { bytesWritten } = await handle.write(chunk, 0, chunk.length, start);
    if (bytesWritten !== chunk.length) {
      throw new HttpError(507, "This server ran out of disk while saving that file.", "DISK_FULL");
    }
  } catch (error) {
    if (isNoSpace(error)) {
      throw new HttpError(507, "This server ran out of disk while saving that file.", "DISK_FULL");
    }
    throw error;
  } finally {
    await handle.close();
  }
}

export async function removeLocalFile(key: string | null | undefined) {
  if (!key) return;
  if (key.startsWith("https://") || usesCloudStorage()) {
    try {
      const { del } = await import("@vercel/blob");
      await del(key);
    } catch (error) {
      console.error("Could not remove a stored file", error);
    }
    return;
  }
  try {
    await rm(resolveStorageKey(key), { force: true });
  } catch (error) {
    console.error("Could not remove a stored file", error);
  }
}

export async function removeStoredCopies(versions: { storageKey: string | null }[]) {
  for (const version of versions) {
    await removeLocalFile(version.storageKey);
  }
}

export function bytesHeld(
  versions: { state: string; byteSize: bigint; storageKey: string | null; driveFileId: string | null }[],
) {
  return versions.reduce((sum, version) => {
    if (version.state !== "READY") return sum;
    if (!version.storageKey && !version.driveFileId) return sum;
    return sum + version.byteSize;
  }, 0n);
}

type ByteRange = { kind: "all" } | { kind: "part"; start: number; end: number } | { kind: "invalid" };

function parseRange(header: string | null, size: number): ByteRange {
  if (!header) return { kind: "all" };
  const value = header.trim();
  if (!value.toLowerCase().startsWith("bytes=") || value.includes(",")) return { kind: "invalid" };
  const match = /^(\d*)-(\d*)$/.exec(value.slice("bytes=".length).trim());
  if (!match || size <= 0) return { kind: "invalid" };
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") return { kind: "invalid" };
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return { kind: "invalid" };
    const start = Math.max(0, size - suffix);
    return { kind: "part", start, end: size - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return { kind: "invalid" };
  }
  return { kind: "part", start, end: Math.min(end, size - 1) };
}

export async function streamLocalFile(key: string, rangeHeader: string | null, mimeType: string) {
  const full = resolveStorageKey(key);
  const info = await stat(full).catch(() => null);
  if (!info || !info.isFile()) throw new HttpError(404, "This file is not on the server.");
  const size = Number(info.size);
  const range = parseRange(rangeHeader, size);
  if (range.kind === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${size}` },
    });
  }
  const start = range.kind === "part" ? range.start : 0;
  const end = range.kind === "part" ? range.end : Math.max(0, size - 1);
  const nodeStream = createReadStream(full, size === 0 ? {} : { start, end });
  const body = Readable.toWeb(nodeStream) as ReadableStream;
  const headers = new Headers({
    "content-type": mimeType || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-length": String(size === 0 ? 0 : end - start + 1),
  });
  if (range.kind === "part") {
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    return new Response(body, { status: 206, headers });
  }
  return new Response(body, { status: 200, headers });
}

export function blobPathname(key: string) {
  let pathname = key;
  if (key.startsWith("https://")) {
    pathname = new URL(key).pathname;
  }
  pathname = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!pathname || pathname.includes("..")) throw new HttpError(400, "Storage key is not valid.");
  return pathname;
}

export async function streamStoredFile(key: string, rangeHeader: string | null, mimeType: string, download = false) {
  if (!key.startsWith("https://")) return streamLocalFile(key, rangeHeader, mimeType);
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const pathname = blobPathname(key);
  const validUntil = Date.now() + 60 * 60 * 1000;
  let presignedUrl: string;
  try {
    const signed = await issueSignedToken({
      pathname,
      operations: ["get", "head"],
      validUntil,
    });
    const signedUrl = await presignUrl(signed, {
      access: "private",
      operation: "get",
      pathname,
      validUntil,
    });
    presignedUrl = signedUrl.presignedUrl;
  } catch (error) {
    console.error("Could not open a stored file", error instanceof Error ? error.message : "unknown");
    throw new HttpError(502, "Could not open the stored file.");
  }
  const target = new URL(presignedUrl);
  if (download) target.searchParams.set("download", "1");
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      "cache-control": "private, no-store",
    },
  });
}
