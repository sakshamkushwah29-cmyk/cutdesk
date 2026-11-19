import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name the folder.").max(120),
  parentId: z.string().uuid().optional(),
});

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const project = await loadProject(member, id);
  const body = await readJson(req, bodySchema);
  const parentId = body.parentId ?? project.rootFolderId;
  if (!parentId) throw new HttpError(400, "This project has no root folder.");
  const parent = await prisma.folder.findFirst({ where: { id: parentId, projectId: project.id } });
  if (!parent) throw new HttpError(404, "Folder not found.");
  const duplicate = await prisma.folder.findFirst({ where: { projectId: project.id, parentId, name: body.name } });
  if (duplicate) throw new HttpError(409, "A folder with that name is already here.");
  const folder = await prisma.folder.create({
    data: { projectId: project.id, parentId, name: body.name },
  });
  return json({ folder: { id: folder.id, parentId: folder.parentId, name: folder.name } }, 201);
});
