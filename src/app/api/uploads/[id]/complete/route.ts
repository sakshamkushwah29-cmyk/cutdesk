import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { finishBlobUpload } from "@/lib/blob-upload";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ url: z.string().url() });

export const POST = api(async (req, ctx) => {
  const member = await requireMember();
  const { id } = await ctx.params;
  const body = await readJson(req, bodySchema);
  const upload = await prisma.uploadSession.findUnique({
    where: { id },
    include: { version: { include: { asset: true } } },
  });
  if (!upload) {
    const ready = await prisma.assetVersion.findFirst({
      where: {
        storageKey: body.url,
        state: "READY",
        asset: { project: { workspaceId: member.workspaceId }, deletedAt: null },
      },
      select: { assetId: true },
    });
    if (!ready) throw new HttpError(404, "Upload not found.");
    return json({ done: true, assetId: ready.assetId });
  }
  await loadProject(member, upload.version.asset.projectId);
  const finished = await finishBlobUpload(id, body.url);
  return json({ done: true, assetId: finished.assetId });
});
