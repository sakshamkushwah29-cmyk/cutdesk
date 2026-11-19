import { z } from "zod";
import { CommentVisibility } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./http";
import { assertPlan, BENCH } from "./plans";

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const mark = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pen"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    points: z.array(point).min(1).max(400),
  }),
  z.object({
    type: z.literal("rect"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("point"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
]);

export const commentSchema = z.object({
  versionId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  body: z.string().trim().min(1, "Write a comment.").max(4000),
  visibility: z.enum(["CLIENT", "INTERNAL"]).optional(),
  startMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  endMs: z.number().int().min(0).max(86_400_000).nullable().optional(),
  markup: z.array(mark).max(20).optional(),
  guestName: z.string().trim().min(1).max(80).optional(),
});

export async function createComment(input: {
  assetId: string;
  versionId: string;
  parentId?: string;
  body: string;
  visibility: CommentVisibility;
  startMs?: number | null;
  endMs?: number | null;
  markup?: unknown;
  authorUserId?: string;
  guestName?: string;
  planAllowsInternal: boolean;
}) {
  if (input.visibility === "INTERNAL") {
    assertPlan(input.planAllowsInternal, "Internal comments are not included.");
  }
  if (input.endMs != null && input.startMs != null && input.endMs < input.startMs) {
    throw new HttpError(400, "The range ends before it starts.");
  }
  const version = await prisma.assetVersion.findFirst({
    where: { id: input.versionId, assetId: input.assetId },
  });
  if (!version) throw new HttpError(404, "Version not found.");
  if (input.parentId) {
    const parent = await prisma.comment.findFirst({ where: { id: input.parentId, assetId: input.assetId } });
    if (!parent) throw new HttpError(404, "Comment not found.");
  }
  const comment = await prisma.comment.create({
    data: {
      assetId: input.assetId,
      versionId: input.versionId,
      parentId: input.parentId,
      body: input.body,
      visibility: input.visibility,
      startMs: input.startMs ?? null,
      endMs: input.endMs ?? null,
      markup: (input.markup ?? []) as object[],
      authorUserId: input.authorUserId,
      guestName: input.guestName,
    },
    include: { author: { select: { name: true } } },
  });
  await syncReviewStatus(input.assetId);
  return comment;
}

export async function syncReviewStatus(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.deletedAt) return asset?.status ?? null;
  const notes = await prisma.comment.findMany({
    where: { assetId, parentId: null },
    select: { resolvedAt: true },
  });
  await prisma.asset.update({ where: { id: assetId }, data: { updatedAt: new Date() } });
  if (notes.length === 0) return asset.status;
  const allDone = notes.every((note) => note.resolvedAt);
  const next = allDone ? "APPROVED" : asset.status === "APPROVED" ? "NEEDS_REVIEW" : asset.status;
  if (next !== asset.status) {
    await prisma.asset.update({ where: { id: assetId }, data: { status: next } });
  }
  return next;
}

export function planAllowsInternal() {
  return BENCH.internalComments;
}
