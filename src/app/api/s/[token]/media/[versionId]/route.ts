import { safeName } from "@/lib/crypto";
import { api, HttpError } from "@/lib/http";
import { streamVersion } from "@/lib/media";
import { loadShare, shareUnlocked } from "@/lib/shares";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const { token, versionId } = await ctx.params;
  const share = await loadShare(token);
  if (!(await shareUnlocked(share))) throw new HttpError(401, "Enter the passphrase.", "PASSPHRASE");
  const item = share.items.find((entry) => entry.asset.versions.some((version) => version.id === versionId));
  const version = item?.asset.versions.find((entry) => entry.id === versionId);
  if (!item || !version || item.asset.deletedAt || version.state !== "READY") {
    throw new HttpError(404, "This file is not on the link.");
  }
  if (!share.showOlderVersions && item.asset.currentVersionId && version.id !== item.asset.currentVersionId) {
    throw new HttpError(404, "This version is not on the link.");
  }
  const download = new URL(req.url).searchParams.get("download") === "1";
  if (download && !share.allowDownload) throw new HttpError(403, "Downloads are turned off for this link.");
  const upstream = await streamVersion(share.workspace, version, req.headers.get("range"));
  if (!download) return upstream;
  const headers = new Headers(upstream.headers);
  headers.set("content-disposition", `attachment; filename="${safeName(item.asset.name)}"`);
  return new Response(upstream.body, { status: upstream.status, headers });
});
