import { cookies } from "next/headers";
import { z } from "zod";
import { api, HttpError, json, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { loadShare } from "@/lib/shares";
import { cookieOptions, SHARE_COOKIE, signShare } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  passphrase: z.string().min(1, "Enter the passphrase.").max(200),
  guestName: z.string().trim().min(1).max(80).optional(),
});

export const POST = api(async (req, ctx) => {
  const { token } = await ctx.params;
  const share = await loadShare(token);
  const body = await readJson(req, bodySchema);
  if (share.passphraseHash) {
    const ok = await verifyPassword(body.passphrase, share.passphraseHash);
    if (!ok) throw new HttpError(401, "That passphrase is not right.");
  }
  const signed = await signShare({
    sid: share.id,
    tokenHash: share.tokenHash,
    guestName: body.guestName,
  });
  const jar = await cookies();
  jar.set(SHARE_COOKIE, signed, cookieOptions(60 * 60 * 24));
  return json({ ok: true });
});
