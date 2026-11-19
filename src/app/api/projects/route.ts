import { z } from "zod";
import { requireMember, assertRole } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, json, readJson } from "@/lib/http";
import { assertPlan, BENCH } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const member = await requireMember();
  const projects = await prisma.project.findMany({
    where: {
      workspaceId: member.workspaceId,
      ...(member.role === "MEMBER"
        ? { OR: [{ restricted: false }, { members: { some: { memberId: member.id } } }] }
        : {}),
    },
    include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
    orderBy: { createdAt: "desc" },
  });
  return json({
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      restricted: project.restricted,
      assetCount: project._count.assets,
      createdAt: project.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the project.").max(120),
  restricted: z.boolean().optional(),
});

export const POST = api(async (req) => {
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN", "MEMBER"]);
  const body = await readJson(req, createSchema);
  if (body.restricted) assertPlan(BENCH.restrictedResources, "Restricted projects are not included.");
  if (BENCH.maxProjects !== null) {
    const count = await prisma.project.count({ where: { workspaceId: member.workspaceId } });
    assertPlan(count < BENCH.maxProjects, `This bench includes ${BENCH.maxProjects} projects.`);
  }
  const project = await prisma.project.create({
    data: {
      workspaceId: member.workspaceId,
      name: body.name,
      restricted: Boolean(body.restricted),
      createdById: member.userId,
    },
  });
  const folder = await prisma.folder.create({
    data: { projectId: project.id, name: body.name },
  });
  const saved = await prisma.project.update({
    where: { id: project.id },
    data: { rootFolderId: folder.id },
  });
  if (saved.restricted) {
    await prisma.projectMember.create({ data: { projectId: saved.id, memberId: member.id } });
  }
  return json({ project: { id: saved.id, name: saved.name, restricted: saved.restricted } }, 201);
});
