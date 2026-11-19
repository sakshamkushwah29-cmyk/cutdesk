export type PlanFeatures = {
  customBranding: boolean;
  sharePassphrase: boolean;
  shareExpiry: boolean;
  sharePermissions: boolean;
  staticWatermark: boolean;
  restrictedResources: boolean;
  internalComments: boolean;
};

export type Me = {
  user: { id: string; name: string; email: string };
  role: "OWNER" | "ADMIN" | "MEMBER";
  memberId: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: {
      code: string;
      label: string;
      maxMembers: number | null;
      maxProjects: number | null;
      storageBytes: string | null;
      features: PlanFeatures;
    };
    storageBytes: string;
    diskFreeBytes: string | null;
    storageDir: string;
    driveConnected: boolean;
    googleEmail: string | null;
  };
};

export type Version = {
  id: string;
  versionNumber: number;
  state: string;
  mediaKind: string;
  mimeType: string;
  byteSize: string;
  createdAt: string;
};

export type Mark =
  | { type: "pen"; color: string; points: { x: number; y: number }[] }
  | { type: "rect"; color: string; x: number; y: number; w: number; h: number }
  | { type: "point"; color: string; x: number; y: number };

export type Comment = {
  id: string;
  assetId?: string;
  versionId: string;
  parentId: string | null;
  body: string;
  visibility: string;
  startMs: number | null;
  endMs: number | null;
  markup: Mark[];
  resolvedAt: string | null;
  createdAt: string;
  authorName: string;
};

export function formatBytes(value: string | number) {
  const bytes = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1000 && unit < units.length - 1) {
    amount /= 1000;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function formatTimecode(ms: number) {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const frames = Math.min(23, Math.floor((clamped % 1000) / (1000 / 24)));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export const STATUS_LABEL: Record<string, string> = {
  NEEDS_REVIEW: "Needs Review",
  IN_PROGRESS: "In Progress",
  APPROVED: "Approved",
};
