import { MemberRole, Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { HttpError } from "./http";
import { diskFreeBytes, storageRoot } from "./files";
import { publicPlan } from "./plans";
import { readSession, SESSION_COOKIE } from "./session";

const memberInclude = {
  workspace: true,
  user: true,
} satisfies Prisma.WorkspaceMemberInclude;

export type MemberContext = Prisma.WorkspaceMemberGetPayload<{ include: typeof memberInclude }>;

export async function requireMember() {
  const jar = await cookies();
  const session = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) throw new HttpError(401, "Sign in required.");
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: session.wid, userId: session.uid } },
    include: memberInclude,
  });
  if (!member) throw new HttpError(401, "Sign in required.");
  return member;
}

export function assertRole(member: MemberContext, roles: MemberRole[]) {
  if (!roles.includes(member.role)) {
    throw new HttpError(403, "You do not have permission to do that.");
  }
}

export async function loadProject(member: MemberContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: member.workspaceId },
  });
  if (!project) throw new HttpError(404, "Project not found.");
  if (project.restricted && member.role === "MEMBER") {
    const allowed = await prisma.projectMember.findUnique({
      where: { projectId_memberId: { projectId, memberId: member.id } },
    });
    if (!allowed) throw new HttpError(404, "Project not found.");
  }
  return project;
}

export async function accountView(member: MemberContext) {
  let free: string | null = null;
  try {
    free = (await diskFreeBytes()).toString();
  } catch (error) {
    console.error(error);
  }
  return {
    user: { id: member.user.id, name: member.user.name, email: member.user.email },
    role: member.role,
    memberId: member.id,
    workspace: {
      id: member.workspace.id,
      name: member.workspace.name,
      slug: member.workspace.slug,
      plan: publicPlan(),
      storageBytes: member.workspace.storageBytes.toString(),
      diskFreeBytes: free,
      storageDir: storageRoot(),
      driveConnected: Boolean(member.workspace.googleRefreshToken),
      googleEmail: member.workspace.googleEmail,
    },
  };
}
