import { z } from "zod";
import { loadProject, requireMember } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { allocateLocalFile, assertDiskFits, isNoSpace, LOCAL_UPLOAD, removeLocalFile, storageKeyFor } from "@/lib/files";
import { api, HttpError, json, readJson } from "@/lib/http";
import { safeName } from "@/lib/crypto";
import { kindFromMime } from "@/lib/time";
import { assertPlan, storageAllowance } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const member = await requireMember();
  const versions = await prisma.assetVersion.findMany({
    where: {
      asset: {
        project: {
          workspaceId: member.workspaceId,
          ...(member.role === "MEMBER"
            ? { OR: [{ restricted: false }, { members: { some: { memberId: member.id } } }] }
            : {}),
        },
      },
    },
    include: {
      asset: { select: { id: true, name: true, deletedAt: true, project: { select: { name: true } } } },
      upload: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  return json({
    uploads: versions
      .filter((version) => version.state === "UPLOADING" || version.state === "FAILED" || !version.asset.deletedAt)
      .map((version) => ({
        id: version.upload?.id ?? version.id,
        assetId: version.asset.id,
        name: version.asset.name,
        projectName: version.asset.project.name,
        state: version.state,
        byteSize: version.byteSize.toString(),
        createdAt: version.createdAt.toISOString(),
      })),
  });
});

const bodySchema = z.object({
  folderId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(180),
  byteSize: z.number().int().positive().max(5_000_000_000_000),
  contentType: z.string().trim().min(1).max(200).optional(),
});

export const POST = api(async (req) => {
  const member = await requireMember();
  const body = await readJson(req, bodySchema);
  const byteSize = BigInt(body.byteSize);
  const mimeType = body.contentType || "application/octet-stream";
  const allowance = storageAllowance();
  if (allowance !== null && member.workspace.storageBytes + byteSize > allowance) {
    assertPlan(false, "This file would pass the 2 GB stored on this bench.");
  }

  let assetId = body.assetId;
  let folderId = body.folderId;
  let projectId: string;
  if (assetId) {
    const asset = await prisma.asset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!asset) throw new HttpError(404, "Asset not found.");
    await loadProject(member, asset.projectId);
    projectId = asset.projectId;
    folderId = asset.folderId;
  } else {
    if (!folderId) throw new HttpError(400, "Choose a folder.");
    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder) throw new HttpError(404, "Folder not found.");
    await loadProject(member, folder.projectId);
    projectId = folder.projectId;
  }

  await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  await assertDiskFits(byteSize);
  const filename = safeName(body.filename);
  const versionId = crypto.randomUUID();
  const key = storageKeyFor(member.workspaceId, versionId);

  const created = await prisma.$transaction(async (tx) => {
    const isNewAsset = !assetId;
    const asset = assetId
      ? await tx.asset.findUniqueOrThrow({ where: { id: assetId } })
      : await tx.asset.create({
          data: {
            projectId,
            folderId: folderId!,
            name: filename,
            createdById: member.userId,
          },
        });
    const latest = await tx.assetVersion.findFirst({
      where: { assetId: asset.id },
      orderBy: { versionNumber: "desc" },
    });
    const version = await tx.assetVersion.create({
      data: {
        id: versionId,
        assetId: asset.id,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        mimeType,
        byteSize,
        mediaKind: kindFromMime(mimeType),
        storageKey: key,
        createdById: member.userId,
      },
    });
    const upload = await tx.uploadSession.create({
      data: {
        versionId: version.id,
        sessionUri: LOCAL_UPLOAD,
        byteSize,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return { asset, version, upload, isNewAsset };
  });

  try {
    await allocateLocalFile(key);
  } catch (error) {
    await prisma.assetVersion.delete({ where: { id: created.version.id } }).catch(() => undefined);
    if (created.isNewAsset) await prisma.asset.delete({ where: { id: created.asset.id } }).catch(() => undefined);
    await removeLocalFile(key);
    if (isNoSpace(error)) {
      throw new HttpError(507, "This server does not have enough free disk for that file.", "DISK_FULL");
    }
    throw error;
  }

  return json({
    uploadId: created.upload.id,
    assetId: created.asset.id,
    versionId: created.version.id,
    versionNumber: created.version.versionNumber,
  }, 201);
});
