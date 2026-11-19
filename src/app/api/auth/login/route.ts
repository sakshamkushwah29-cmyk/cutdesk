import { cookies } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { api, json, readJson, HttpError } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export const dynamic = "force-dynamic";

export const POST = api(async (req) => {
  const body = await readJson(req, bodySchema);
  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new HttpError(401, "Email or password is incorrect.");
  }
  const membership = user.memberships[0];
  if (!membership) throw new HttpError(403, "This account is not in a workspace.");
  const token = await signSession({ uid: user.id, wid: membership.workspaceId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14));
  return json({ ok: true });
});
