import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "cutdesk_session";
export const SHARE_COOKIE = "cutdesk_share";

export type SessionPayload = { uid: string; wid: string };
export type SharePayload = { sid: string; tokenHash: string; guestName?: string };

function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("APP_SECRET must be at least 16 characters.");
  }
  return new TextEncoder().encode(secret);
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

async function sign(payload: SessionPayload | SharePayload, expires: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expires).sign(key());
}

export function signSession(payload: SessionPayload) {
  return sign(payload, "14d");
}

export function signShare(payload: SharePayload) {
  return sign(payload, "24h");
}

export function signState(payload: SessionPayload) {
  return sign(payload, "10m");
}

async function read<T>(token: string | undefined | null, pick: (payload: Record<string, unknown>) => T | null) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return pick(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function readSession(token: string | undefined | null) {
  return read<SessionPayload>(token, (payload) => {
    if (typeof payload.uid !== "string" || typeof payload.wid !== "string") return null;
    return { uid: payload.uid, wid: payload.wid };
  });
}

export function readShare(token: string | undefined | null) {
  return read<SharePayload>(token, (payload) => {
    if (typeof payload.sid !== "string" || typeof payload.tokenHash !== "string") return null;
    return {
      sid: payload.sid,
      tokenHash: payload.tokenHash,
      guestName: typeof payload.guestName === "string" ? payload.guestName : undefined,
    };
  });
}
