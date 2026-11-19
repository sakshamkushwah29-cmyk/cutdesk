import { MemberRole } from "@prisma/client";
import { z } from "zod";
import { assertRole, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";
import { assertPlan, BENCH } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const member = await requireMember();
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: member.workspaceId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return json({
    members: members.map((item) => ({
      id: item.id,
      role: item.role,
      name: item.user.name,
      email: item.user.email,
      you: item.id === member.id,
    })),
  });
});

const addSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
});

export const POST = api(async (req) => {
  const member = await requireMember();
  const body = await readJson(req, addSchema);
  const role = (body.role ?? "MEMBER") as MemberRole;
  if (role === "ADMIN") assertRole(member, ["OWNER"]);
  else assertRole(member, ["OWNER", "ADMIN"]);
  if (BENCH.maxMembers !== null) {
    const count = await prisma.workspaceMember.count({ where: { workspaceId: member.workspaceId } });
    assertPlan(count < BENCH.maxMembers, `This bench includes ${BENCH.maxMembers} members.`);
  }
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user) {
    throw new HttpError(404, "No Cutdesk account uses that email. Ask them to register, then add them.");
  }
  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: member.workspaceId, userId: user.id } },
  });
  if (existing) throw new HttpError(409, "That person is already in the workspace.");
  const created = await prisma.workspaceMember.create({
    data: { workspaceId: member.workspaceId, userId: user.id, role },
    include: { user: { select: { name: true, email: true } } },
  });
  return json({ member: { id: created.id, role: created.role, name: created.user.name, email: created.user.email } }, 201);
});
