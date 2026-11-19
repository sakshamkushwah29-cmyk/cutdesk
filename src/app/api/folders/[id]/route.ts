import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const folder = await prisma.folder.findUnique({ where: { id } });
  if (!folder) throw new HttpError(404, "Folder not found.");
  const project = await loadProject(member, folder.projectId);
  if (folder.id === project.rootFolderId) throw new HttpError(400, "The project folder stays put.");
  const body = await readJson(req, z.object({ name: z.string().trim().min(1).max(120) }));
  const saved = await prisma.folder.update({ where: { id: folder.id }, data: { name: body.name } });
  return json({ folder: { id: saved.id, name: saved.name } });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const folder = await prisma.folder.findUnique({ where: { id } });
  if (!folder) throw new HttpError(404, "Folder not found.");
  const project = await loadProject(member, folder.projectId);
  if (folder.id === project.rootFolderId) throw new HttpError(400, "The project folder stays put.");
  await prisma.folder.delete({ where: { id: folder.id } });
  return json({ ok: true });
});
