export async function apiSend<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const error = new Error(data.error || "Request failed") as Error & { code?: string; status: number };
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return data as T;
}

const CHUNK = 256 * 1024;

export async function uploadFile(
  file: File,
  target: { folderId?: string; assetId?: string },
  onProgress?: (ratio: number) => void,
) {
  const started = await apiSend<{ uploadId: string; assetId: string; versionId: string; versionNumber: number }>(
    "/api/uploads",
    {
      method: "POST",
      body: JSON.stringify({
        folderId: target.folderId,
        assetId: target.assetId,
        filename: file.name,
        byteSize: file.size,
        contentType: file.type || "application/octet-stream",
      }),
    },
  );
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    const res = await fetch(`/api/uploads/${started.uploadId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-range": `bytes ${offset}-${end - 1}/${file.size}`,
      },
      body: file.slice(offset, end),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "Upload failed.");
    offset = end;
    onProgress?.(file.size === 0 ? 1 : offset / file.size);
  }
  return started;
}
