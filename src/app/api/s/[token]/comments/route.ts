import { cookies } from "next/headers";
import { commentSchema, createComment } from "@/lib/comments";
import { api, HttpError, json, readJson } from "@/lib/http";
import { loadShare, shareUnlocked } from "@/lib/shares";
import { cookieOptions, SHARE_COOKIE, signShare } from "@/lib/session";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const { token } = await ctx.params;
  const share = await loadShare(token);
  if (!(await shareUnlocked(share))) throw new HttpError(401, "Enter the passphrase.", "PASSPHRASE");
  if (!share.allowComment) throw new HttpError(403, "Comments are turned off for this link.");
  const body = await readJson(req, commentSchema);
  if (!body.guestName) throw new HttpError(400, "Add your name.");
  const item = share.items.find((entry) => entry.asset.versions.some((version) => version.id === body.versionId));
  if (!item || item.asset.deletedAt) throw new HttpError(404, "That file is not on this link.");
  if (!share.showOlderVersions && item.asset.currentVersionId && body.versionId !== item.asset.currentVersionId) {
    throw new HttpError(404, "That version is not on this link.");
  }
  const comment = await createComment({
    assetId: item.asset.id,
    versionId: body.versionId,
    parentId: body.parentId,
    body: body.body,
    visibility: "CLIENT",
    startMs: body.startMs,
    endMs: body.endMs,
    markup: body.markup,
    guestName: body.guestName,
    planAllowsInternal: false,
  });
  const signed = await signShare({ sid: share.id, tokenHash: share.tokenHash, guestName: body.guestName });
  const jar = await cookies();
  jar.set(SHARE_COOKIE, signed, cookieOptions(60 * 60 * 24));
  return json({
    comment: {
      id: comment.id,
      assetId: comment.assetId,
      versionId: comment.versionId,
      parentId: comment.parentId,
      body: comment.body,
      visibility: "CLIENT",
      startMs: comment.startMs,
      endMs: comment.endMs,
      markup: comment.markup,
      resolvedAt: null,
      createdAt: comment.createdAt.toISOString(),
      authorName: body.guestName,
    },
  }, 201);
});
