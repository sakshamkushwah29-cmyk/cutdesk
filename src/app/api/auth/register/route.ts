import { z } from "zod";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/crypto";
import { api, json, readJson } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";
import { cookies } from "next/headers";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email.").max(160),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  workspaceName: z.string().trim().min(1, "Name the workspace.").max(80),
});

export const dynamic = "force-dynamic";

export const POST = api(async (req) => {
  const body = await readJson(req, bodySchema);
  const email = body.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return json({ error: "An account with that email already exists." }, 409);
  }
  const passwordHash = await hashPassword(body.password);
  const created = await prisma.user.create({
    data: {
      email,
      name: body.name,
      passwordHash,
      memberships: {
        create: {
          role: "OWNER",
          workspace: { create: { name: body.workspaceName, slug: slugify(body.workspaceName) } },
        },
      },
    },
    include: { memberships: true },
  });
  const membership = created.memberships[0];
  const token = await signSession({ uid: created.id, wid: membership.workspaceId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14));
  return json({ ok: true });
});
