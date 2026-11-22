import { head } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { blobPathname } from "@/lib/files";
import { HttpError } from "@/lib/http";

function blobHostOk(url: string) {
  try {
    return new URL(url).hostname.endsWith("blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function finishBlobUpload(uploadId: string, url: string) {
  if (!blobHostOk(url)) throw new HttpError(400, "That file is not in cloud storage.");
  const upload = await prisma.uploadSession.findUnique({
    where: { id: uploadId },
    include: { version: { include: { asset: { include: { project: true } } } } },
  });
  if (!upload) {
    const ready = await prisma.assetVersion.findFirst({
      where: { storageKey: url, state: "READY" },
      select: { assetId: true },
    });
    if (!ready) throw new HttpError(404, "Upload not found.");
    return { assetId: ready.assetId };
  }
  if (upload.sessionUri !== "blob") throw new HttpError(400, "This upload is stored on disk.");
  const info = await head(url);
  if (blobPathname(info.pathname) !== blobPathname(upload.version.storageKey ?? "")) {
    throw new HttpError(400, "Uploaded file does not match this session.");
  }
  if (BigInt(info.size) !== upload.byteSize) {
    throw new HttpError(400, "The stored file does not match the upload size.");
  }

  let assetId = upload.version.assetId;
  await prisma.$transaction(async (tx) => {
    const removed = await tx.uploadSession.deleteMany({ where: { id: upload.id } });
    if (removed.count !== 1) return;
    await tx.assetVersion.update({
      where: { id: upload.versionId },
      data: { state: "READY", storageKey: url },
    });
    await tx.asset.update({
      where: { id: upload.version.assetId },
      data: { currentVersionId: upload.versionId, updatedAt: new Date() },
    });
    await tx.workspace.update({
      where: { id: upload.version.asset.project.workspaceId },
      data: { storageBytes: { increment: upload.byteSize } },
    });
    assetId = upload.version.assetId;
  });
  return { assetId };
}
