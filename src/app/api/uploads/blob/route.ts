import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { loadProject, requireMember } from "@/lib/authz";
import { finishBlobUpload } from "@/lib/blob-upload";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!clientPayload) throw new HttpError(400, "Missing upload.");
        const member = await requireMember();
        const upload = await prisma.uploadSession.findUnique({
          where: { id: clientPayload },
          include: { version: { include: { asset: true } } },
        });
        if (!upload || upload.version.asset.deletedAt) throw new HttpError(404, "Upload not found.");
        if (upload.sessionUri !== "blob") throw new HttpError(400, "This upload is stored on disk.");
        if (upload.expiresAt.getTime() < Date.now()) throw new HttpError(410, "This upload session expired. Start again.");
        if (!upload.version.storageKey || pathname.replace(/^\//, "") !== upload.version.storageKey) {
          throw new HttpError(400, "Upload path does not match.");
        }
        await loadProject(member, upload.version.asset.projectId);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: Number(upload.byteSize),
          tokenPayload: upload.id,
          callbackUrl: appUrl?.startsWith("https://") ? `${appUrl}/api/uploads/blob` : undefined,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return;
        await finishBlobUpload(tokenPayload, blob.url);
      },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    const message = error instanceof Error ? error.message : "Upload failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
