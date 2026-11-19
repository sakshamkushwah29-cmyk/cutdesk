import { HttpError } from "./http";

export type PlanSpec = {
  label: string;
  maxMembers: number | null;
  maxProjects: number | null;
  storageBytes: bigint | null;
  customBranding: boolean;
  sharePassphrase: boolean;
  shareExpiry: boolean;
  sharePermissions: boolean;
  staticWatermark: boolean;
  restrictedResources: boolean;
  internalComments: boolean;
};

const GB = 1_000_000_000n;

// One included bench. Paid plans are not offered.
export const BENCH: PlanSpec = {
  label: "Included",
  maxMembers: 2,
  maxProjects: 2,
  storageBytes: 2n * GB,
  customBranding: false,
  sharePassphrase: false,
  shareExpiry: false,
  sharePermissions: false,
  staticWatermark: false,
  restrictedResources: false,
  internalComments: false,
};

export function storageAllowance() {
  return BENCH.storageBytes;
}

export function publicPlan() {
  return {
    code: "FREE" as const,
    label: BENCH.label,
    maxMembers: BENCH.maxMembers,
    maxProjects: BENCH.maxProjects,
    storageBytes: BENCH.storageBytes === null ? null : BENCH.storageBytes.toString(),
    features: {
      customBranding: BENCH.customBranding,
      sharePassphrase: BENCH.sharePassphrase,
      shareExpiry: BENCH.shareExpiry,
      sharePermissions: BENCH.sharePermissions,
      staticWatermark: BENCH.staticWatermark,
      restrictedResources: BENCH.restrictedResources,
      internalComments: BENCH.internalComments,
    },
  };
}

export function assertPlan(ok: boolean, message: string) {
  if (!ok) throw new HttpError(403, message, "PLAN_LIMIT");
}
