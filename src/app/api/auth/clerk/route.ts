import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { slugify } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/app") || value.startsWith("//")) return "/app";
  return value;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  if (!userId) {
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("redirect_url", "/api/auth/clerk");
    return NextResponse.redirect(signIn);
  }

  const clerkUser = await currentUser();
  const emailAddress =
    clerkUser?.emailAddresses.find((item) => item.id === clerkUser.primaryEmailAddressId)?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress;
  if (!emailAddress) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }
  const email = emailAddress.toLowerCase();
  const name =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || email.split("@")[0] || "Member";

  let user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { memberships: { orderBy: { createdAt: "asc" } } },
  });
  if (!user) {
    const existing = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { orderBy: { createdAt: "asc" } } },
    });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { clerkUserId: userId, name: existing.name || name },
        include: { memberships: { orderBy: { createdAt: "asc" } } },
      });
    } else {
      const workspaceName = `${name}'s bench`;
      user = await prisma.user.create({
        data: {
          email,
          name,
          clerkUserId: userId,
          passwordHash: await hashPassword(crypto.randomUUID()),
          memberships: {
            create: {
              role: "OWNER",
              workspace: { create: { name: workspaceName, slug: slugify(workspaceName) } },
            },
          },
        },
        include: { memberships: { orderBy: { createdAt: "asc" } } },
      });
    }
  }

  let membership = user.memberships[0];
  if (!membership) {
    const workspaceName = `${name}'s bench`;
    membership = await prisma.workspaceMember.create({
      data: {
        role: "OWNER",
        user: { connect: { id: user.id } },
        workspace: { create: { name: workspaceName, slug: slugify(workspaceName) } },
      },
    });
  }

  const token = await signSession({ uid: user.id, wid: membership.workspaceId });
  const response = NextResponse.redirect(new URL(next, req.url));
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14));
  return response;
}
