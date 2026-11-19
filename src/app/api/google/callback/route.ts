import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureWorkspaceFolder, exchangeCode } from "@/lib/drive";
import { encrypt } from "@/lib/crypto";
import { appUrl, HttpError } from "@/lib/http";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (query: string) => NextResponse.redirect(`${appUrl()}/app/settings?${query}`);
  try {
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return back(`drive=error&message=${encodeURIComponent("Google did not grant access.")}`);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const jar = await cookies();
    const session = await readSession(jar.get(SESSION_COOKIE)?.value);
    const claimed = await readSession(state);
    if (!code || !session || !claimed || claimed.uid !== session.uid || claimed.wid !== session.wid) {
      return back(`drive=error&message=${encodeURIComponent("The Google sign-in expired. Connect Drive again.")}`);
    }
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: session.wid, userId: session.uid } },
      include: { workspace: true },
    });
    if (!member || (member.role !== "OWNER" && member.role !== "ADMIN")) {
      return back(`drive=error&message=${encodeURIComponent("Only an owner or admin can connect Drive.")}`);
    }
    const tokens = await exchangeCode(code);
    const workspace = await prisma.workspace.update({
      where: { id: member.workspaceId },
      data: {
        googleRefreshToken: encrypt(tokens.refreshToken),
        googleAccessToken: tokens.accessToken ? encrypt(tokens.accessToken) : null,
        googleAccessExpiry: tokens.expiry,
        googleEmail: tokens.email,
        driveFolderId: null,
      },
    });
    await prisma.project.updateMany({ where: { workspaceId: workspace.id }, data: { driveFolderId: null } });
    try {
      await ensureWorkspaceFolder(workspace);
    } catch (error) {
      console.error(error);
    }
    return back("drive=connected");
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Could not connect Google Drive.";
    return back(`drive=error&message=${encodeURIComponent(message)}`);
  }
}
