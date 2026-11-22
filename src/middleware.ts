import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "cutdesk_session";

const isApp = createRouteMatcher(["/app", "/app/(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isApp(request)) return;
  const { userId } = await auth();
  if (!userId) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect_url", "/api/auth/clerk");
    return NextResponse.redirect(url);
  }
  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = new URL("/api/auth/clerk", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/", "/(api|trpc)(.*)"],
};
