import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "cutdesk_session";

const isApp = createRouteMatcher(["/app", "/app/(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isApp(request)) return;
  const { userId } = await auth();
  if (!userId) {
    const url = new URL("/sign-in", request.url);
    const next = new URL("/auth/continue", request.url);
    next.searchParams.set("next", request.nextUrl.pathname);
    url.searchParams.set("redirect_url", `${next.pathname}${next.search}`);
    return NextResponse.redirect(url);
  }
  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = new URL("/auth/continue", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/", "/(api|trpc)(.*)"],
};
