import { loadProject, requireMember } from "@/lib/authz";
import { commentSchema, createComment, planAllowsInternal } from "@/lib/comments";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const asset = await prisma.asset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) throw new HttpError(404, "Asset not found.");
  await loadProject(member, asset.projectId);
  const body = await readJson(req, commentSchema);
  const comment = await createComment({
    assetId: asset.id,
    versionId: body.versionId,
    parentId: body.parentId,
    body: body.body,
    visibility: body.visibility ?? "CLIENT",
    startMs: body.startMs,
    endMs: body.endMs,
    markup: body.markup,
    authorUserId: member.userId,
    planAllowsInternal: planAllowsInternal(),
  });
  return json({
    comment: {
      id: comment.id,
      versionId: comment.versionId,
      parentId: comment.parentId,
      body: comment.body,
      visibility: comment.visibility,
      startMs: comment.startMs,
      endMs: comment.endMs,
      markup: comment.markup,
      resolvedAt: null,
      createdAt: comment.createdAt.toISOString(),
      authorName: comment.author?.name ?? "Someone",
    },
  }, 201);
});
