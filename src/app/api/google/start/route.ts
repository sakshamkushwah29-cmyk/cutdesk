import { assertRole, requireMember } from "@/lib/authz";
import { driveAuthUrl } from "@/lib/drive";
import { api, json } from "@/lib/http";
import { signState } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const member = await requireMember();
  assertRole(member, ["OWNER", "ADMIN"]);
  const state = await signState({ uid: member.userId, wid: member.workspaceId });
  return json({ url: driveAuthUrl(state) });
});
