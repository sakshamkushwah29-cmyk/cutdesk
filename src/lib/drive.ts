import { Workspace } from "@prisma/client";
import { google } from "googleapis";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { appUrl, HttpError } from "./http";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export function oauthClient() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new HttpError(
      400,
      "Google Drive is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      "DRIVE_NOT_CONFIGURED",
    );
  }
  const redirect = process.env.GOOGLE_REDIRECT_URI || `${appUrl()}/api/google/callback`;
  return new google.auth.OAuth2(id, secret, redirect);
}

export function driveAuthUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    state,
  });
}

export async function exchangeCode(code: string) {
  const oauth = oauthClient();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new HttpError(400, "Google did not return a refresh token. Remove Cutdesk access in your Google account and connect again.");
  }
  oauth.setCredentials(tokens);
  const profile = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? "",
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 45 * 60 * 1000),
    email: profile.data.email ?? null,
  };
}

async function googleError(res: Response, fallback: string) {
  const detail = await res.text();
  console.error("Google Drive request failed", res.status, detail.slice(0, 500));
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(409, "Google Drive refused the request. Reconnect Drive in Settings.", "DRIVE_REQUIRED");
  }
  throw new HttpError(502, fallback, "DRIVE_FAILED");
}

export async function accessTokenFor(workspace: Workspace) {
  if (!workspace.googleRefreshToken) {
    throw new HttpError(409, "Connect Google Drive in Settings before uploading.", "DRIVE_REQUIRED");
  }
  if (
    workspace.googleAccessToken &&
    workspace.googleAccessExpiry &&
    workspace.googleAccessExpiry.getTime() > Date.now() + 60_000
  ) {
    return decrypt(workspace.googleAccessToken);
  }
  const oauth = oauthClient();
  oauth.setCredentials({ refresh_token: decrypt(workspace.googleRefreshToken) });
  try {
    const { token } = await oauth.getAccessToken();
    if (!token) throw new Error("empty token");
    const expiry = oauth.credentials.expiry_date
      ? new Date(oauth.credentials.expiry_date)
      : new Date(Date.now() + 45 * 60 * 1000);
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { googleAccessToken: encrypt(token), googleAccessExpiry: expiry },
    });
    return token;
  } catch (error) {
    console.error(error);
    throw new HttpError(409, "Google Drive session expired. Reconnect Drive in Settings.", "DRIVE_REQUIRED");
  }
}

export async function createDriveFolder(token: string, name: string, parentId?: string) {
  const res = await fetch(`${DRIVE_FILES}?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!res.ok) await googleError(res, "Could not create a folder in Google Drive.");
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function ensureWorkspaceFolder(workspace: Workspace) {
  const token = await accessTokenFor(workspace);
  if (workspace.driveFolderId) return { token, folderId: workspace.driveFolderId };
  const folderId = await createDriveFolder(token, "Cutdesk");
  await prisma.workspace.update({ where: { id: workspace.id }, data: { driveFolderId: folderId } });
  return { token, folderId };
}

export async function ensureProjectFolder(workspace: Workspace, project: { id: string; name: string; driveFolderId: string | null }) {
  const { token, folderId: rootId } = await ensureWorkspaceFolder(workspace);
  if (project.driveFolderId) return { token, folderId: project.driveFolderId };
  const folderId = await createDriveFolder(token, project.name, rootId);
  await prisma.project.update({ where: { id: project.id }, data: { driveFolderId: folderId } });
  return { token, folderId };
}

export async function startResumableUpload(token: string, input: { name: string; parentId: string; mimeType: string; byteSize: bigint }) {
  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": input.byteSize.toString(),
    },
    body: JSON.stringify({ name: input.name, parents: [input.parentId] }),
  });
  if (!res.ok) await googleError(res, "Could not start the Google Drive upload.");
  const sessionUri = res.headers.get("location");
  if (!sessionUri) throw new HttpError(502, "Google Drive did not return an upload session.", "DRIVE_FAILED");
  return sessionUri;
}

export async function putDriveChunk(sessionUri: string, chunk: Buffer, range: string) {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: {
      "Content-Length": String(chunk.length),
      "Content-Range": range,
    },
    body: new Uint8Array(chunk),
  });
  if (res.status === 308) {
    const received = res.headers.get("range");
    const end = received?.split("-")[1];
    return { done: false as const, received: end ? Number(end) + 1 : chunk.length };
  }
  if (res.status === 200 || res.status === 201) {
    const body = (await res.json()) as { id: string };
    return { done: true as const, fileId: body.id };
  }
  await googleError(res, "Google Drive rejected an upload chunk.");
  return { done: false as const, received: 0 };
}

export async function deleteDriveFile(token: string, fileId: string) {
  const res = await fetch(`${DRIVE_FILES}/${fileId}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204 || res.status === 404) return;
  await googleError(res, "Could not delete the file from Google Drive.");
}

export async function openDriveFile(token: string, fileId: string, range: string | null) {
  return fetch(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(range ? { Range: range } : {}),
    },
  });
}
