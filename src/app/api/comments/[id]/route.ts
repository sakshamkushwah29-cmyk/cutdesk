import { loadProject, requireMember } from "@/lib/authz";
import { syncReviewStatus } from "@/lib/comments";
import { prisma } from "@/lib/db";
import { api, HttpError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

async function loadComment(id: string) {
  const member = await requireMember();
  const comment = await prisma.comment.findUnique({ where: { id }, include: { asset: true } });
  if (!comment || comment.asset.deletedAt) throw new HttpError(404, "Comment not found.");
  await loadProject(member, comment.asset.projectId);
  return { member, comment };
}

export const POST = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { comment } = await loadComment(id);
  const resolvedAt = comment.resolvedAt ? null : new Date();
  const saved = await prisma.comment.update({ where: { id: comment.id }, data: { resolvedAt } });
  const status = await syncReviewStatus(comment.assetId);
  return json({ resolvedAt: saved.resolvedAt?.toISOString() ?? null, status });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { member, comment } = await loadComment(id);
  const canDelete = comment.authorUserId === member.userId || member.role !== "MEMBER";
  if (!canDelete) throw new HttpError(403, "You can delete your own comments.");
  await prisma.comment.delete({ where: { id: comment.id } });
  await syncReviewStatus(comment.assetId);
  return json({ ok: true });
});
