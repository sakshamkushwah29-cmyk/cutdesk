"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { uploadFile } from "@/lib/client";

export type UploadJob = {
  localId: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  message?: string;
  assetId?: string;
};

type UploadsValue = {
  jobs: UploadJob[];
  open: boolean;
  setOpen: (open: boolean) => void;
  run: (file: File, target: { folderId?: string; assetId?: string }) => Promise<{ assetId: string; versionId: string }>;
};

const UploadsContext = createContext<UploadsValue | null>(null);

export function UploadsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [open, setOpen] = useState(false);

  const value = useMemo<UploadsValue>(
    () => ({
      jobs,
      open,
      setOpen,
      async run(file, target) {
        const localId = crypto.randomUUID();
        setOpen(true);
        const fresh: UploadJob = { localId, name: file.name, progress: 0, status: "uploading" };
        setJobs((current) => [fresh, ...current].slice(0, 20));
        try {
          const started = await uploadFile(file, target, (ratio) => {
            setJobs((current) => current.map((job) => (job.localId === localId ? { ...job, progress: ratio } : job)));
          });
          setJobs((current) =>
            current.map((job) =>
              job.localId === localId ? { ...job, progress: 1, status: "done", assetId: started.assetId } : job,
            ),
          );
          return started;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed.";
          setJobs((current) => current.map((job) => (job.localId === localId ? { ...job, status: "error", message } : job)));
          throw error;
        }
      },
    }),
    [jobs, open],
  );

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads() {
  const value = useContext(UploadsContext);
  if (!value) throw new Error("Uploads are only available inside the app.");
  return value;
}
