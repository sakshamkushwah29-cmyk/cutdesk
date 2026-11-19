import { ShareKind } from "@prisma/client";
import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { encrypt, hashToken, newToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { appUrl, api, HttpError, json, readJson } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { assertPlan, BENCH } from "@/lib/plans";
import { decryptShareToken } from "@/lib/shares";

export const dynamic = "force-dynamic";

const brandingSchema = z.object({
  studio: z.string().trim().max(80).optional(),
});

const createSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "Name the link.").max(120),
  assetIds: z.array(z.string().uuid()).min(1, "Choose at least one file."),
  kind: z.enum(["REVIEW", "PRESENTATION"]).optional(),
  passphrase: z.string().trim().min(4).max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowComment: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  showOlderVersions: z.boolean().optional(),
  branding: brandingSchema.optional(),
  watermarkText: z.string().trim().max(80).nullable().optional(),
});

function shareView(share: {
  id: string;
  name: string;
  kind: ShareKind;
  tokenEnc: string;
  passphraseHash: string | null;
  expiresAt: Date | null;
  allowComment: boolean;
  allowDownload: boolean;
  showOlderVersions: boolean;
  branding: unknown;
  watermarkText: string | null;
  createdAt: Date;
  items: { assetId: string }[];
}) {
  let url: string | null = null;
  try {
    url = `${appUrl()}/share/${decryptShareToken(share.tokenEnc)}`;
  } catch {
    url = null;
  }
  return {
    id: share.id,
    name: share.name,
    kind: share.kind,
    url,
    hasPassphrase: Boolean(share.passphraseHash),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    allowComment: share.allowComment,
    allowDownload: share.allowDownload,
    showOlderVersions: share.showOlderVersions,
    branding: share.branding,
    watermarkText: share.watermarkText,
    assetIds: share.items.map((item) => item.assetId),
    createdAt: share.createdAt.toISOString(),
  };
}

export const GET = api(async (req) => {
  const member = await requireMember();
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) throw new HttpError(400, "Choose a project.");
  await loadProject(member, projectId);
  const shares = await prisma.share.findMany({
    where: { projectId },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });
  return json({ shares: shares.map(shareView) });
});

export const POST = api(async (req) => {
  const member = await requireMember();
  const body = await readJson(req, createSchema);
  await loadProject(member, body.projectId);
  if (body.passphrase) assertPlan(BENCH.sharePassphrase, "Passphrases are not included.");
  if (body.expiresAt) assertPlan(BENCH.shareExpiry, "Expiring links are not included.");
  if (body.branding?.studio) assertPlan(BENCH.customBranding, "Branded links are not included.");
  if (body.watermarkText) assertPlan(BENCH.staticWatermark, "Watermarks are not included.");
  const tightened =
    body.allowComment === false || body.allowDownload === false || body.showOlderVersions === false;
  if (tightened) assertPlan(BENCH.sharePermissions, "Changing share permissions is not included.");

  const uniqueIds = [...new Set(body.assetIds)];
  const assets = await prisma.asset.findMany({
    where: { id: { in: uniqueIds }, projectId: body.projectId, deletedAt: null },
  });
  if (assets.length !== uniqueIds.length) throw new HttpError(400, "Choose files from this project.");

  const token = newToken();
  const share = await prisma.share.create({
    data: {
      workspaceId: member.workspaceId,
      projectId: body.projectId,
      kind: body.kind ?? "REVIEW",
      name: body.name,
      tokenHash: hashToken(token),
      tokenEnc: encrypt(token),
      passphraseHash: body.passphrase ? await hashPassword(body.passphrase) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      allowComment: body.allowComment ?? true,
      allowDownload: body.allowDownload ?? true,
      showOlderVersions: body.showOlderVersions ?? true,
      branding: body.branding?.studio ? { studio: body.branding.studio } : {},
      watermarkText: body.watermarkText || null,
      createdById: member.userId,
      items: { create: uniqueIds.map((assetId, position) => ({ assetId, position })) },
    },
    include: { items: true },
  });
  return json({ share: shareView(share) }, 201);
});
