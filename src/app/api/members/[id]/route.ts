import { MemberRole } from "@prisma/client";
import { z } from "zod";
import { assertRole, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

async function loadTarget(id: string) {
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN"]);
  const target = await prisma.workspaceMember.findFirst({ where: { id, workspaceId: member.workspaceId } });
  if (!target) throw new HttpError(404, "Member not found.");
  if (target.role === "OWNER" && member.role !== "OWNER") {
    throw new HttpError(403, "Only an owner can change another owner.");
  }
  return { member, target };
}

async function keepOwner(workspaceId: string, targetRole: MemberRole, nextRole?: MemberRole) {
  if (targetRole !== "OWNER") return;
  if (nextRole === undefined || nextRole === "OWNER") return;
  const owners = await prisma.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
  if (owners <= 1) throw new HttpError(400, "The workspace needs an owner.");
}

const patchSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const { member, target } = await loadTarget(id);
  const body = await readJson(req, patchSchema);
  if (body.role === "OWNER" && member.role !== "OWNER") {
    throw new HttpError(403, "Only an owner can grant ownership.");
  }
  await keepOwner(member.workspaceId, target.role, body.role as MemberRole);
  await prisma.workspaceMember.update({ where: { id: target.id }, data: { role: body.role } });
  return json({ ok: true });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { member, target } = await loadTarget(id);
  await keepOwner(member.workspaceId, target.role, "MEMBER");
  await prisma.workspaceMember.delete({ where: { id: target.id } });
  return json({ ok: true });
});
