import { accountView, requireMember } from "@/lib/authz";
import { api, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const member = await requireMember();
  return json(await accountView(member));
});
