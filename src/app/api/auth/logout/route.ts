import { cookies } from "next/headers";
import { api, json } from "@/lib/http";
import { cookieOptions, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api(async () => {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
  return json({ ok: true });
});
