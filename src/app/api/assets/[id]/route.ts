import { AssetStatus } from "@prisma/client";
import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { accessTokenFor, deleteDriveFile } from "@/lib/drive";
import { bytesHeld, removeStoredCopies } from "@/lib/files";
import { api, HttpError, json, readJson } from "@/lib/http";
import { versionView } from "@/lib/media";

export const dynamic = "force-dynamic";

async function loadAsset(id: string) {
  const member = await requireMember();
  const asset = await prisma.asset.findFirst({
    where: { id, deletedAt: null },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!asset) throw new HttpError(404, "Asset not found.");
  await loadProject(member, asset.projectId);
  return { member, asset };
}

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { member, asset } = await loadAsset(id);
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: member.workspaceId },
    include: { user: { select: { name: true } } },
  });
  return json({
    asset: {
      id: asset.id,
      projectId: asset.projectId,
      folderId: asset.folderId,
      name: asset.name,
      status: asset.status,
      assigneeId: asset.assigneeId,
      dueAt: asset.dueAt?.toISOString() ?? null,
      currentVersionId: asset.currentVersionId,
    },
    versions: asset.versions.map(versionView),
    comments: asset.comments.map((comment) => ({
      id: comment.id,
      versionId: comment.versionId,
      parentId: comment.parentId,
      body: comment.body,
      visibility: comment.visibility,
      startMs: comment.startMs,
      endMs: comment.endMs,
      markup: comment.markup,
      resolvedAt: comment.resolvedAt?.toISOString() ?? null,
      createdAt: comment.createdAt.toISOString(),
      authorName: comment.author?.name ?? comment.guestName ?? "Someone",
    })),
    members: members.map((item) => ({ id: item.id, name: item.user.name })),
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  status: z.enum(["NEEDS_REVIEW", "IN_PROGRESS", "APPROVED"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  folderId: z.string().uuid().optional(),
});

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const { member, asset } = await loadAsset(id);
  const body = await readJson(req, patchSchema);
  if (body.folderId) {
    const folder = await prisma.folder.findFirst({ where: { id: body.folderId, projectId: asset.projectId } });
    if (!folder) throw new HttpError(404, "Folder not found.");
  }
  if (body.assigneeId) {
    const assignee = await prisma.workspaceMember.findFirst({
      where: { id: body.assigneeId, workspaceId: member.workspaceId },
    });
    if (!assignee) throw new HttpError(400, "Assignee is not in this workspace.");
  }
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.status ? { status: body.status as AssetStatus } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
      ...(body.folderId ? { folderId: body.folderId } : {}),
    },
  });
  return json({ ok: true });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { member, asset } = await loadAsset(id);
  await removeStoredCopies(asset.versions);
  const driveVersions = asset.versions.filter((version) => version.state === "READY" && version.driveFileId);
  if (member.workspace.googleRefreshToken && driveVersions.length) {
    try {
      const token = await accessTokenFor(member.workspace);
      for (const version of driveVersions) {
        if (version.driveFileId) await deleteDriveFile(token, version.driveFileId);
      }
    } catch (error) {
      console.error(error);
    }
  }
  const freed = bytesHeld(asset.versions);
  const next = member.workspace.storageBytes > freed ? member.workspace.storageBytes - freed : 0n;
  await prisma.$transaction([
    prisma.workspace.update({ where: { id: member.workspaceId }, data: { storageBytes: next } }),
    prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date(), currentVersionId: null } }),
  ]);
  return json({ ok: true });
});
