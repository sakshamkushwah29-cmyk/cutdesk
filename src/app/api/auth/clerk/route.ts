import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { slugify } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const withMembership = { memberships: { orderBy: { createdAt: "asc" as const }, take: 1 } };

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/app") || value.startsWith("//")) return "/app";
  return value;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const asJson = url.searchParams.get("json") === "1";
  const { userId } = await auth();
  if (!userId) {
    const signIn = "/sign-in?redirect_url=/auth/continue";
    if (asJson) return NextResponse.json({ redirect: signIn }, { status: 401 });
    return NextResponse.redirect(new URL(signIn, req.url));
  }

  let user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: withMembership,
  });

  if (!user) {
    const clerkUser = await currentUser();
    const emailAddress =
      clerkUser?.emailAddresses.find((item) => item.id === clerkUser.primaryEmailAddressId)?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress;
    if (!emailAddress) {
      const signIn = "/sign-in?redirect_url=/auth/continue";
      if (asJson) return NextResponse.json({ redirect: signIn }, { status: 401 });
      return NextResponse.redirect(new URL(signIn, req.url));
    }
    const email = emailAddress.toLowerCase();
    const name =
      [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || email.split("@")[0] || "Member";

    const existing = await prisma.user.findUnique({
      where: { email },
      include: withMembership,
    });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { clerkUserId: userId, name: existing.name || name },
        include: withMembership,
      });
    } else {
      const workspaceName = `${name}'s bench`;
      user = await prisma.user.create({
        data: {
          email,
          name,
          clerkUserId: userId,
          passwordHash: "clerk",
          memberships: {
            create: {
              role: "OWNER",
              workspace: { create: { name: workspaceName, slug: slugify(workspaceName) } },
            },
          },
        },
        include: withMembership,
      });
    }
  }

  let membership = user.memberships[0];
  if (!membership) {
    const workspaceName = `${user.name}'s bench`;
    membership = await prisma.workspaceMember.create({
      data: {
        role: "OWNER",
        user: { connect: { id: user.id } },
        workspace: { create: { name: workspaceName, slug: slugify(workspaceName) } },
      },
    });
  }

  const token = await signSession({ uid: user.id, wid: membership.workspaceId });
  if (asJson) {
    const response = NextResponse.json({ next });
    response.cookies.set(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14));
    return response;
  }
  const response = NextResponse.redirect(new URL(next, req.url));
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(60 * 60 * 24 * 14));
  return response;
}
