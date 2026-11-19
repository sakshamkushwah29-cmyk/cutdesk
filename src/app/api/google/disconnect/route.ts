import { assertRole, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = api(async () => {
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN"]);
  await prisma.workspace.update({
    where: { id: member.workspaceId },
    data: {
      googleRefreshToken: null,
      googleAccessToken: null,
      googleAccessExpiry: null,
      googleEmail: null,
      driveFolderId: null,
    },
  });
  await prisma.project.updateMany({
    where: { workspaceId: member.workspaceId },
    data: { driveFolderId: null },
  });
  return json({ ok: true });
});
