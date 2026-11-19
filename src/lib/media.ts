import { AssetVersion, Workspace } from "@prisma/client";
import { accessTokenFor, openDriveFile } from "./drive";
import { streamLocalFile } from "./files";
import { HttpError } from "./http";

export async function streamVersion(workspace: Workspace, version: AssetVersion, range: string | null) {
  if (version.state !== "READY") {
    throw new HttpError(404, "This file is not ready to play.");
  }
  if (version.storageKey) {
    return streamLocalFile(version.storageKey, range, version.mimeType);
  }
  if (!version.driveFileId) {
    throw new HttpError(404, "This file is not ready to play.");
  }
  const token = await accessTokenFor(workspace);
  const upstream = await openDriveFile(token, version.driveFileId, range);
  if (!upstream.ok && upstream.status !== 206) {
    const detail = await upstream.text();
    console.error("Drive media failed", upstream.status, detail.slice(0, 300));
    throw new HttpError(502, "Could not read the file from Google Drive.", "DRIVE_FAILED");
  }
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", version.mimeType || "application/octet-stream");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export function versionView(version: {
  id: string;
  versionNumber: number;
  state: string;
  mediaKind: string;
  mimeType: string;
  byteSize: bigint;
  createdAt: Date;
}) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    mediaKind: version.mediaKind,
    mimeType: version.mimeType,
    byteSize: version.byteSize.toString(),
    createdAt: version.createdAt.toISOString(),
  };
}
