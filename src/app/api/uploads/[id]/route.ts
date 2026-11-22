import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { putDriveChunk } from "@/lib/drive";
import { isNoSpace, LOCAL_UPLOAD, localFileSize, removeLocalFile, writeLocalChunk } from "@/lib/files";
import { api, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const CHUNK = 256 * 1024;

async function loadUpload(id: string) {
  const member = await requireMember();
  const upload = await prisma.uploadSession.findUnique({
    where: { id },
    include: { version: { include: { asset: true } } },
  });
  if (!upload || upload.version.asset.deletedAt) throw new HttpError(404, "Upload not found.");
  await loadProject(member, upload.version.asset.projectId);
  if (upload.expiresAt.getTime() < Date.now()) throw new HttpError(410, "This upload session expired. Start again.");
  return { member, upload };
}

export const PUT = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const { member, upload } = await loadUpload(id);
  const range = req.headers.get("content-range");
  const match = range ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range) : null;
  if (!match) throw new HttpError(400, "Send a Content-Range header.");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (BigInt(total) !== upload.byteSize) throw new HttpError(400, "Upload size does not match the file.");
  if (start % CHUNK !== 0) throw new HttpError(400, "Chunks must start on a 256 KB boundary.");
  const length = end - start + 1;
  const last = end === total - 1;
  if (!last && length % CHUNK !== 0) throw new HttpError(400, "Chunks must be multiples of 256 KB until the last one.");
  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length !== length) throw new HttpError(400, "Chunk length does not match Content-Range.");

  if (upload.sessionUri === "blob") {
    throw new HttpError(400, "This upload is sent directly to cloud storage.");
  }
  let driveFileId: string | undefined;
  if (upload.sessionUri === LOCAL_UPLOAD) {
    if (!upload.version.storageKey) throw new HttpError(500, "This upload has no file on disk.");
    try {
      await writeLocalChunk(upload.version.storageKey, start, chunk);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (isNoSpace(error)) throw new HttpError(507, "This server ran out of disk while saving that file.", "DISK_FULL");
      throw error;
    }
    if (!last) return json({ received: end + 1, done: false });
    const size = await localFileSize(upload.version.storageKey);
    if (size !== upload.byteSize) throw new HttpError(400, "The stored file does not match the upload size.");
  } else {
    const result = await putDriveChunk(upload.sessionUri, chunk, range!);
    if (!result.done) return json({ received: result.received, done: false });
    driveFileId = result.fileId;
  }

  await prisma.$transaction([
    prisma.assetVersion.update({
      where: { id: upload.versionId },
      data: { state: "READY", ...(driveFileId ? { driveFileId } : {}) },
    }),
    prisma.asset.update({
      where: { id: upload.version.assetId },
      data: { currentVersionId: upload.versionId, updatedAt: new Date() },
    }),
    prisma.workspace.update({
      where: { id: member.workspaceId },
      data: { storageBytes: { increment: upload.byteSize } },
    }),
    prisma.uploadSession.delete({ where: { id: upload.id } }),
  ]);
  return json({ received: total, done: true, assetId: upload.version.assetId });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { upload } = await loadUpload(id);
  await removeLocalFile(upload.version.storageKey);
  await prisma.uploadSession.delete({ where: { id: upload.id } });
  await prisma.assetVersion.delete({ where: { id: upload.versionId } });
  const remaining = await prisma.assetVersion.count({ where: { assetId: upload.version.assetId } });
  if (remaining === 0) await prisma.asset.delete({ where: { id: upload.version.assetId } });
  return json({ ok: true });
});
