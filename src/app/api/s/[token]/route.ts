import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { api, json } from "@/lib/http";
import { versionView } from "@/lib/media";
import { loadShare, shareUnlocked } from "@/lib/shares";
import { readShare, SHARE_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export const GET = api(async (_req, ctx) => {
  const { token } = await ctx.params;
  const share = await loadShare(token);
  if (!(await shareUnlocked(share))) {
    return json(
      { error: "Enter the passphrase.", code: "PASSPHRASE", needsPassphrase: true, name: share.name },
      401,
    );
  }
  const jar = await cookies();
  const guest = await readShare(jar.get(SHARE_COOKIE)?.value);
  const assets = share.items
    .map((item) => item.asset)
    .filter((asset) => !asset.deletedAt);
  const visible = assets.map((asset) => {
    const ready = asset.versions.filter((version) => version.state === "READY");
    const versions =
      share.showOlderVersions || !asset.currentVersionId
        ? ready
        : ready.filter((version) => version.id === asset.currentVersionId);
    return { asset, versions };
  });
  const versionIds = visible.flatMap((item) => item.versions.map((version) => version.id));
  const comments = versionIds.length
    ? await prisma.comment.findMany({
        where: { versionId: { in: versionIds }, visibility: "CLIENT" },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const branding = (share.branding ?? {}) as { studio?: string };
  return json({
    share: {
      name: share.name,
      kind: share.kind,
      allowComment: share.allowComment,
      allowDownload: share.allowDownload,
      watermarkText: share.watermarkText,
      studio: branding.studio ?? null,
      guestName: guest?.sid === share.id ? guest.guestName ?? null : null,
    },
    assets: visible.map(({ asset, versions }) => ({
      id: asset.id,
      name: asset.name,
      currentVersionId: versions.some((version) => version.id === asset.currentVersionId)
        ? asset.currentVersionId
        : versions[0]?.id ?? null,
      versions: versions.map(versionView),
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      assetId: comment.assetId,
      versionId: comment.versionId,
      parentId: comment.parentId,
      body: comment.body,
      visibility: comment.visibility,
      startMs: comment.startMs,
      endMs: comment.endMs,
      markup: comment.markup,
      resolvedAt: comment.resolvedAt?.toISOString() ?? null,
      createdAt: comment.createdAt.toISOString(),
      authorName: comment.author?.name ?? comment.guestName ?? "Someone",
    })),
  });
});
