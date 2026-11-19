import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const envPath = new URL("../.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = /^([^#=\s]+)=(.*)$/.exec(line);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let cookie = "";

function storeCookies(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const jar = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), part.slice(index + 1)];
      }),
  );
  for (const line of list) {
    const pair = line.split(";")[0];
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
  cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function send(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(`${base}${path}`, { ...options, headers });
  storeCookies(res);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

async function raw(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(`${base}${path}`, { ...options, headers });
  storeCookies(res);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const stamp = Date.now();
const email = `smoke-${stamp}@cutdesk.test`;
const password = "smoke-pass-1";

const registered = await send("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({
    name: "Smoke",
    email,
    password,
    workspaceName: `Smoke ${stamp}`,
  }),
});
assert(registered.status === 200, `register ${registered.status} ${JSON.stringify(registered.data)}`);
assert(cookie.includes("cutdesk_session"), "session cookie missing");

const me = await send("/api/auth/me");
assert(me.status === 200 && me.data.workspace.plan.code === "FREE", "me failed");
assert(typeof me.data.workspace.diskFreeBytes === "string", "disk free missing");
assert(typeof me.data.workspace.storageDir === "string" && me.data.workspace.storageDir.length > 0, "storage dir missing");

const first = await send("/api/projects", { method: "POST", body: JSON.stringify({ name: "Reel A" }) });
assert(first.status === 201, `project A ${first.status}`);
const projectId = first.data.project.id;
const tree = await send(`/api/projects/${projectId}`);
assert(tree.status === 200 && tree.data.project.rootFolderId, "project tree missing root");
const folder = await send(`/api/projects/${projectId}/folders`, {
  method: "POST",
  body: JSON.stringify({ name: "Selects", parentId: tree.data.project.rootFolderId }),
});
assert(folder.status === 201, `folder ${folder.status} ${JSON.stringify(folder.data)}`);

const second = await send("/api/projects", { method: "POST", body: JSON.stringify({ name: "Reel B" }) });
assert(second.status === 201, "project B failed");
const third = await send("/api/projects", { method: "POST", body: JSON.stringify({ name: "Reel C" }) });
assert(third.status === 403 && third.data.code === "PLAN_LIMIT", `expected free project cap, got ${third.status}`);

const CHUNK = 256 * 1024;
const head = Buffer.alloc(CHUNK, 0x11);
const tail = Buffer.alloc(100, 0x22);
const file = Buffer.concat([head, tail]);
const upload = await send("/api/uploads", {
  method: "POST",
  body: JSON.stringify({
    folderId: tree.data.project.rootFolderId,
    filename: "cut.mp4",
    byteSize: file.length,
    contentType: "video/mp4",
  }),
});
assert(upload.status === 201, `upload start ${upload.status} ${JSON.stringify(upload.data)}`);

async function putChunk(start, chunk) {
  const end = start + chunk.length - 1;
  const res = await raw(`/api/uploads/${upload.data.uploadId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "content-range": `bytes ${start}-${end}/${file.length}`,
    },
    body: chunk,
  });
  let data = null;
  try {
    data = JSON.parse(res.buf.toString("utf8"));
  } catch {
    data = res.buf.toString("utf8");
  }
  return { status: res.status, data };
}

const firstChunk = await putChunk(0, head);
assert(firstChunk.status === 200 && firstChunk.data.done === false, `first chunk ${firstChunk.status} ${JSON.stringify(firstChunk.data)}`);
const secondChunk = await putChunk(CHUNK, tail);
assert(secondChunk.status === 200 && secondChunk.data.done === true, `last chunk ${secondChunk.status} ${JSON.stringify(secondChunk.data)}`);

const media = await raw(`/api/media/${upload.data.versionId}`);
assert(media.status === 200 && media.buf.equals(file), `media ${media.status} length ${media.buf.length}`);
const partial = await raw(`/api/media/${upload.data.versionId}`, { headers: { range: "bytes=4-7" } });
assert(partial.status === 206 && partial.buf.equals(file.subarray(4, 8)), `range ${partial.status} ${partial.buf.toString("hex")}`);

const playback = await send("/api/shares", {
  method: "POST",
  body: JSON.stringify({ projectId, name: "Playback", assetIds: [upload.data.assetId] }),
});
assert(playback.status === 201 && playback.data.share.url, `playback share ${playback.status} ${JSON.stringify(playback.data)}`);
const playbackToken = playback.data.share.url.split("/share/")[1];
const shared = await raw(`/api/s/${playbackToken}/media/${upload.data.versionId}`);
assert(shared.status === 200 && shared.buf.equals(file), `share media ${shared.status} length ${shared.buf.length}`);

const located = await prisma.assetVersion.findUnique({ where: { id: upload.data.versionId } });
assert(located && located.state === "READY" && located.storageKey && !located.driveFileId, "version should be stored locally");
assert(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(located.storageKey), `unexpected storage key ${located.storageKey}`);
const storageRoot = resolve(process.env.STORAGE_DIR?.trim() || join(process.cwd(), "storage"));
const storedPath = join(storageRoot, located.storageKey);
assert(existsSync(storedPath), `file missing at ${storedPath}`);
const held = await send("/api/auth/me");
assert(held.data.workspace.storageBytes === String(file.length), `storage bytes ${held.data.workspace.storageBytes}`);

const orphan = await send("/api/uploads", {
  method: "POST",
  body: JSON.stringify({
    folderId: tree.data.project.rootFolderId,
    filename: "orphan.mp4",
    byteSize: 32,
    contentType: "video/mp4",
  }),
});
assert(orphan.status === 201, `orphan start ${orphan.status} ${JSON.stringify(orphan.data)}`);
const orphanRow = await prisma.assetVersion.findUnique({ where: { id: orphan.data.versionId } });
const orphanPath = join(storageRoot, orphanRow.storageKey);
assert(existsSync(orphanPath), "orphan file was not created");
const abandoned = await send(`/api/uploads/${orphan.data.uploadId}`, { method: "DELETE" });
assert(abandoned.status === 200, `abandon ${abandoned.status}`);
assert(!existsSync(orphanPath), "abandoned file is still on disk");

const dropped = await send(`/api/assets/${upload.data.assetId}`, { method: "DELETE" });
assert(dropped.status === 200, `delete uploaded asset ${dropped.status}`);
assert(!existsSync(storedPath), "deleted asset file is still on disk");
const cleared = await send("/api/auth/me");
assert(cleared.data.workspace.storageBytes === "0", `bytes after delete ${cleared.data.workspace.storageBytes}`);

const empty = await send("/api/uploads", {
  method: "POST",
  body: JSON.stringify({
    folderId: tree.data.project.rootFolderId,
    filename: "empty.mp4",
    byteSize: 0,
    contentType: "video/mp4",
  }),
});
assert(empty.status === 400, `empty upload should be rejected, got ${empty.status}`);

const stranger = await send("/api/members", {
  method: "POST",
  body: JSON.stringify({ email: `missing-${stamp}@cutdesk.test` }),
});
assert(stranger.status === 404, `unknown member ${stranger.status}`);

const lockedShare = await send("/api/shares", {
  method: "POST",
  body: JSON.stringify({
    projectId,
    name: "Locked",
    assetIds: ["00000000-0000-4000-8000-000000000000"],
    passphrase: "secret-pass",
  }),
});
assert(lockedShare.status === 403 && lockedShare.data.code === "PLAN_LIMIT", `passphrase should be blocked on free, got ${lockedShare.status}`);

const user = await prisma.user.findUnique({ where: { email } });
const asset = await prisma.asset.create({
  data: {
    projectId,
    folderId: tree.data.project.rootFolderId,
    name: `Smoke cut ${stamp}`,
    createdById: user.id,
  },
});
const version = await prisma.assetVersion.create({
  data: {
    assetId: asset.id,
    versionNumber: 1,
    state: "READY",
    mediaKind: "VIDEO",
    mimeType: "video/mp4",
    byteSize: 2048,
    createdById: user.id,
  },
});
await prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });

const share = await send("/api/shares", {
  method: "POST",
  body: JSON.stringify({ projectId, name: "Client look", assetIds: [asset.id] }),
});
assert(share.status === 201 && share.data.share.url, `share ${share.status} ${JSON.stringify(share.data)}`);
const token = share.data.share.url.split("/share/")[1];
const publicShare = await send(`/api/s/${token}`);
assert(publicShare.status === 200 && publicShare.data.assets.length === 1, "public share failed");

const comment = await send(`/api/assets/${asset.id}/comments`, {
  method: "POST",
  body: JSON.stringify({
    versionId: version.id,
    body: "Hold the wide shot.",
    startMs: 1500,
    endMs: 2200,
    markup: [{ type: "rect", color: "#d6ff4a", x: 0.1, y: 0.2, w: 0.3, h: 0.2 }],
  }),
});
assert(comment.status === 201, `comment ${comment.status} ${JSON.stringify(comment.data)}`);
const point = await send(`/api/assets/${asset.id}/comments`, {
  method: "POST",
  body: JSON.stringify({
    versionId: version.id,
    body: "Mark this frame.",
    startMs: 800,
    markup: [{ type: "point", color: "#ff6a45", x: 0.4, y: 0.6 }],
  }),
});
assert(point.status === 201 && point.data.comment.markup[0].type === "point", `point ${point.status}`);
assert(point.data.comment.startMs === 800, "point timestamp missing");
const waiting = await send(`/api/assets/${asset.id}`);
assert(waiting.status === 200 && waiting.data.asset.status === "NEEDS_REVIEW", `upload should stay in needs review, got ${waiting.data?.asset?.status}`);
const uploads = await send("/api/uploads");
assert(uploads.status === 200 && Array.isArray(uploads.data.uploads), "uploads list");
const resolved = await send(`/api/comments/${comment.data.comment.id}`, { method: "POST" });
assert(resolved.status === 200 && resolved.data.resolvedAt, "resolve failed");
const stillOpen = await send(`/api/assets/${asset.id}`);
assert(stillOpen.data.asset.status === "NEEDS_REVIEW", `one open note should stay in needs review, got ${stillOpen.data.asset.status}`);
const resolvedPoint = await send(`/api/comments/${point.data.comment.id}`, { method: "POST" });
assert(resolvedPoint.status === 200 && resolvedPoint.data.status === "APPROVED", `ticking every note should approve, got ${JSON.stringify(resolvedPoint.data)}`);
const approved = await send(`/api/projects/${projectId}`);
const approvedRow = approved.data.assets.find((item) => item.id === asset.id);
assert(approved.status === 200 && approvedRow?.status === "APPROVED", "approved collection data missing");
const reopened = await send(`/api/comments/${point.data.comment.id}`, { method: "POST" });
assert(reopened.status === 200 && reopened.data.status === "NEEDS_REVIEW", `reopening a note should leave approved, got ${JSON.stringify(reopened.data)}`);
const removed = await send(`/api/comments/${comment.data.comment.id}`, { method: "DELETE" });
assert(removed.status === 200, "delete comment failed");

const found = await send(`/api/search?q=${encodeURIComponent("Smoke cut")}`);
assert(found.status === 200 && found.data.results.some((item) => item.id === asset.id), "search missed the asset");

const fourth = await send("/api/projects", { method: "POST", body: JSON.stringify({ name: "Reel D", restricted: true }) });
assert(fourth.status === 403 && fourth.data.code === "PLAN_LIMIT", `paid plans are gone, got ${fourth.status}`);
const planChange = await send("/api/workspaces/plan", { method: "POST", body: JSON.stringify({ plan: "TEAM" }) });
assert(planChange.status === 404, `plan upgrade should be gone, got ${planChange.status}`);

console.log("smoke ok");
await prisma.$disconnect();
