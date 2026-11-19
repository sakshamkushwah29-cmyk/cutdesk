import { loadProject, requireMember } from "@/lib/authz";
import { safeName } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { api, HttpError } from "@/lib/http";
import { streamVersion } from "@/lib/media";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const { versionId } = await ctx.params;
  const member = await requireMember();
  const version = await prisma.assetVersion.findUnique({ where: { id: versionId }, include: { asset: true } });
  if (!version || version.asset.deletedAt) throw new HttpError(404, "File not found.");
  await loadProject(member, version.asset.projectId);
  const upstream = await streamVersion(member.workspace, version, req.headers.get("range"));
  if (new URL(req.url).searchParams.get("download") !== "1") return upstream;
  const headers = new Headers(upstream.headers);
  headers.set("content-disposition", `attachment; filename="${safeName(version.asset.name)}"`);
  return new Response(upstream.body, { status: upstream.status, headers });
});
