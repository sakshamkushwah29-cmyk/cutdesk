import { cookies } from "next/headers";
import { prisma } from "./db";
import { decrypt, hashToken } from "./crypto";
import { HttpError } from "./http";
import { readShare, SHARE_COOKIE } from "./session";

export async function loadShare(token: string) {
  const share = await prisma.share.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      workspace: true,
      items: {
        orderBy: { position: "asc" },
        include: {
          asset: {
            include: {
              versions: { orderBy: { versionNumber: "desc" } },
              currentVersion: true,
            },
          },
        },
      },
    },
  });
  if (!share) throw new HttpError(404, "This link is not available.");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    throw new HttpError(410, "This link has expired.");
  }
  return share;
}

export async function shareUnlocked(share: { id: string; tokenHash: string; passphraseHash: string | null }) {
  if (!share.passphraseHash) return true;
  const jar = await cookies();
  const payload = await readShare(jar.get(SHARE_COOKIE)?.value);
  return Boolean(payload && payload.sid === share.id && payload.tokenHash === share.tokenHash);
}

export function shareUrl(token: string) {
  return token;
}

export function decryptShareToken(tokenEnc: string) {
  return decrypt(tokenEnc);
}
