import { AssetStatus } from "@prisma/client";
import { requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const STATUS_QUERY: Record<string, AssetStatus> = {
  "needs review": "NEEDS_REVIEW",
  review: "NEEDS_REVIEW",
  "in progress": "IN_PROGRESS",
  progress: "IN_PROGRESS",
  approved: "APPROVED",
};

export const GET = api(async (req) => {
  const member = await requireMember();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return json({ results: [] });
  const status = STATUS_QUERY[q.toLowerCase()];
  const assets = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { assignee: { user: { name: { contains: q, mode: "insensitive" } } } },
        ...(status ? [{ status }] : []),
      ],
      project: {
        workspaceId: member.workspaceId,
        ...(member.role === "MEMBER"
          ? { OR: [{ restricted: false }, { members: { some: { memberId: member.id } } }] }
          : {}),
      },
    },
    include: {
      project: { select: { id: true, name: true } },
      currentVersion: true,
      assignee: { include: { user: { select: { name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return json({
    results: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      status: asset.status,
      assigneeName: asset.assignee?.user.name ?? null,
      projectId: asset.project.id,
      projectName: asset.project.name,
      mediaKind: asset.currentVersion?.mediaKind ?? null,
      versionNumber: asset.currentVersion?.versionNumber ?? null,
    })),
  });
});
