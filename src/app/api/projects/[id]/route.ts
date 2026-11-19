import { z } from "zod";
import { assertRole, loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { accessTokenFor, deleteDriveFile } from "@/lib/drive";
import { bytesHeld, removeStoredCopies } from "@/lib/files";
import { api, json, readJson } from "@/lib/http";
import { versionView } from "@/lib/media";
import { assertPlan, BENCH } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const project = await loadProject(member, id);
  const [folders, assets, trash, members, access] = await Promise.all([
    prisma.folder.findMany({ where: { projectId: project.id }, orderBy: { name: "asc" } }),
    prisma.asset.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: { currentVersion: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.asset.findMany({
      where: { projectId: project.id, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 50,
      select: { id: true, name: true, deletedAt: true },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: member.workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.projectMember.findMany({ where: { projectId: project.id }, select: { memberId: true } }),
  ]);
  return json({
    project: {
      id: project.id,
      name: project.name,
      restricted: project.restricted,
      rootFolderId: project.rootFolderId,
      createdAt: project.createdAt.toISOString(),
      memberIds: access.map((row) => row.memberId),
    },
    trash: trash.map((item) => ({
      id: item.id,
      name: item.name,
      deletedAt: item.deletedAt?.toISOString() ?? null,
    })),
    folders: folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      folderId: asset.folderId,
      name: asset.name,
      status: asset.status,
      assigneeId: asset.assigneeId,
      dueAt: asset.dueAt?.toISOString() ?? null,
      currentVersion: asset.currentVersion ? versionView(asset.currentVersion) : null,
    })),
    members: members.map((item) => ({
      id: item.id,
      role: item.role,
      name: item.user.name,
      email: item.user.email,
    })),
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  restricted: z.boolean().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN"]);
  const project = await loadProject(member, id);
  const body = await readJson(req, patchSchema);
  if (body.restricted) assertPlan(BENCH.restrictedResources, "Restricted projects are not included.");
  await prisma.project.update({
    where: { id: project.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.restricted !== undefined ? { restricted: body.restricted } : {}),
    },
  });
  if (body.memberIds) {
    const valid = await prisma.workspaceMember.findMany({
      where: { workspaceId: member.workspaceId, id: { in: body.memberIds } },
      select: { id: true },
    });
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    if (valid.length) {
      await prisma.projectMember.createMany({
        data: valid.map((item) => ({ projectId: project.id, memberId: item.id })),
      });
    }
  }
  return json({ ok: true });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN"]);
  const project = await loadProject(member, id);
  const versions = await prisma.assetVersion.findMany({
    where: { asset: { projectId: project.id } },
  });
  await removeStoredCopies(versions);
  const driveVersions = versions.filter((version) => version.state === "READY" && version.driveFileId);
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
  const freed = bytesHeld(versions);
  if (freed > 0n) {
    const next = member.workspace.storageBytes > freed ? member.workspace.storageBytes - freed : 0n;
    await prisma.workspace.update({ where: { id: member.workspaceId }, data: { storageBytes: next } });
  }
  await prisma.project.delete({ where: { id: project.id } });
  return json({ ok: true });
});
