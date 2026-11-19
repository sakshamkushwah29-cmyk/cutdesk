import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { api, HttpError, json, readJson } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { assertPlan, BENCH } from "@/lib/plans";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  passphrase: z.string().trim().min(4).max(200).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowComment: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  showOlderVersions: z.boolean().optional(),
  branding: z.object({ studio: z.string().trim().max(80).optional() }).optional(),
  watermarkText: z.string().trim().max(80).nullable().optional(),
});

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const share = await prisma.share.findFirst({ where: { id, workspaceId: member.workspaceId } });
  if (!share) throw new HttpError(404, "Link not found.");
  await loadProject(member, share.projectId);
  const body = await readJson(req, patchSchema);
  if (body.passphrase) assertPlan(BENCH.sharePassphrase, "Passphrases are not included.");
  if (body.expiresAt) assertPlan(BENCH.shareExpiry, "Expiring links are not included.");
  if (body.branding?.studio) assertPlan(BENCH.customBranding, "Branded links are not included.");
  if (body.watermarkText) assertPlan(BENCH.staticWatermark, "Watermarks are not included.");
  const tightened =
    body.allowComment === false || body.allowDownload === false || body.showOlderVersions === false;
  if (tightened) assertPlan(BENCH.sharePermissions, "Changing share permissions is not included.");
  await prisma.share.update({
    where: { id: share.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.passphrase !== undefined
        ? { passphraseHash: body.passphrase ? await hashPassword(body.passphrase) : null }
        : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null } : {}),
      ...(body.allowComment !== undefined ? { allowComment: body.allowComment } : {}),
      ...(body.allowDownload !== undefined ? { allowDownload: body.allowDownload } : {}),
      ...(body.showOlderVersions !== undefined ? { showOlderVersions: body.showOlderVersions } : {}),
      ...(body.branding ? { branding: body.branding.studio ? { studio: body.branding.studio } : {} } : {}),
      ...(body.watermarkText !== undefined ? { watermarkText: body.watermarkText || null } : {}),
    },
  });
  return json({ ok: true });
});

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const member = await requireMember();
  const share = await prisma.share.findFirst({ where: { id, workspaceId: member.workspaceId } });
  if (!share) throw new HttpError(404, "Link not found.");
  await loadProject(member, share.projectId);
  await prisma.share.delete({ where: { id: share.id } });
  return json({ ok: true });
});
