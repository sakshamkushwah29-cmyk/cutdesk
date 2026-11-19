export const FRAME_STEP = 1 / 24;

export function formatTimecode(ms: number) {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const frames = Math.min(23, Math.floor((clamped % 1000) / (1000 / 24)));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export function kindFromMime(mime: string) {
  if (mime.startsWith("video/")) return "VIDEO" as const;
  if (mime.startsWith("audio/")) return "AUDIO" as const;
  if (mime.startsWith("image/")) return "IMAGE" as const;
  if (mime === "application/pdf" || mime.startsWith("text/")) return "DOCUMENT" as const;
  return "OTHER" as const;
}
