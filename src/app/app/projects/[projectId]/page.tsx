"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useUploads } from "@/components/uploads";
import { apiSend } from "@/lib/client";
import { STATUS_LABEL, Version, formatBytes } from "@/lib/types";

type Folder = { id: string; parentId: string | null; name: string };
type Asset = {
  id: string;
  folderId: string;
  name: string;
  status: string;
  assigneeId: string | null;
  dueAt: string | null;
  currentVersion: Version | null;
};
type Member = { id: string; role: string; name: string; email: string };
type TrashItem = { id: string; name: string; deletedAt: string | null };
type Desk = {
  project: { id: string; name: string; restricted: boolean; rootFolderId: string | null; createdAt: string; memberIds: string[] };
  folders: Folder[];
  assets: Asset[];
  trash: TrashItem[];
  members: Member[];
};
type Share = {
  id: string;
  name: string;
  url: string | null;
  hasPassphrase: boolean;
  expiresAt: string | null;
  allowComment: boolean;
  allowDownload: boolean;
};

const COLLECTIONS: { id: string; name: string; hint: string; test: (asset: Asset) => boolean }[] = [
  { id: "videos", name: "Videos", hint: "Video files", test: (asset) => asset.currentVersion?.mediaKind === "VIDEO" },
  { id: "images", name: "Images", hint: "Stills", test: (asset) => asset.currentVersion?.mediaKind === "IMAGE" },
  { id: "audio", name: "Audio", hint: "Sound files", test: (asset) => asset.currentVersion?.mediaKind === "AUDIO" },
  { id: "needs-review", name: "Needs Review", hint: "New uploads wait here", test: (asset) => asset.status === "NEEDS_REVIEW" },
  { id: "approved", name: "Approved", hint: "Every note is ticked", test: (asset) => asset.status === "APPROVED" },
];

type Pane = "assets" | "collections" | "shares" | "trash" | `collection:${string}`;

function Thumb({ asset }: { asset: Asset }) {
  const version = asset.currentVersion;
  if (!version || version.state !== "READY") return <div className="thumb-fallback">Uploading</div>;
  const src = `/api/media/${version.id}`;
  if (version.mediaKind === "IMAGE") return <img className="thumb" src={src} alt="" />;
  if (version.mediaKind === "VIDEO") return <video className="thumb" src={`${src}#t=0.1`} muted preload="metadata" playsInline />;
  if (version.mediaKind === "AUDIO") return <div className="thumb-fallback">Audio</div>;
  return <div className="thumb-fallback">{version.mediaKind.toLowerCase()}</div>;
}

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const uploads = useUploads();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pane, setPane] = useState<Pane>("assets");
  const [error, setError] = useState<string | null>(null);
  const [hot, setHot] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const data = await apiSend<Desk>(`/api/projects/${projectId}`);
    setDesk(data);
    setFolderId((current) => current ?? data.project.rootFolderId);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not open the project."));
  }, [projectId]);

  useEffect(() => {
    if (pane !== "shares") return;
    apiSend<{ shares: Share[] }>(`/api/shares?projectId=${projectId}`)
      .then((data) => setShares(data.shares))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load review links."));
  }, [pane, projectId]);

  const assetsHere = useMemo(() => {
    if (!desk) return [];
    if (pane.startsWith("collection:")) {
      const id = pane.slice("collection:".length);
      const collection = COLLECTIONS.find((item) => item.id === id);
      return collection ? desk.assets.filter(collection.test) : [];
    }
    return desk.assets.filter((asset) => asset.folderId === folderId);
  }, [desk, folderId, pane]);

  const childFolders = (desk?.folders ?? []).filter((folder) => folder.parentId === folderId);
  const live = uploads.jobs.find((job) => job.status === "uploading");

  async function addFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    await apiSend(`/api/projects/${projectId}/folders`, {
      method: "POST",
      body: JSON.stringify({ name, parentId: folderId }),
    });
    form.reset();
    await load();
  }

  async function takeFiles(files: FileList | File[]) {
    if (!folderId) return;
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await uploads.run(file, { folderId });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setHot(false);
    if (event.dataTransfer.files.length) void takeFiles(event.dataTransfer.files);
  }

  async function saveStatus(id: string, status: string) {
    setError(null);
    try {
      await apiSend(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the status.");
    }
  }

  async function removeAsset(id: string) {
    await apiSend(`/api/assets/${id}`, { method: "DELETE" });
    setPicked((current) => current.filter((item) => item !== id));
    await load();
  }

  function togglePick(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function sendReview() {
    if (!desk) return;
    if (!picked.length) {
      setError("Select a video, then click Send.");
      return;
    }
    const chosen = desk.assets.filter((item) => picked.includes(item.id));
    setError(null);
    try {
      const created = await apiSend<{ share: Share }>("/api/shares", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          name: chosen.length === 1 ? chosen[0].name : desk.project.name,
          assetIds: chosen.map((item) => item.id),
        }),
      });
      setShares((current) => [created.share, ...current]);
      setReadyUrl(created.share.url);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.");
    }
  }

  if (!desk) {
    return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Opening project…</p>}</main>;
  }

  const collection = pane.startsWith("collection:") ? COLLECTIONS.find((item) => item.id === pane.slice("collection:".length)) : null;
  const showFiles = pane === "assets" || Boolean(collection);

  return (
    <main className="room">
      <aside className="room-nav">
        <p className="fine">
          <Link href="/app">All projects</Link>
          {" / "}
          {desk.project.name}
        </p>
        <button className={pane === "assets" ? "on" : ""} type="button" onClick={() => setPane("assets")}>
          Assets
        </button>
        <button className={pane === "collections" ? "on" : ""} type="button" onClick={() => setPane("collections")}>
          Collections
        </button>
        {COLLECTIONS.map((item) => (
          <button
            key={item.id}
            className={`sub${pane === `collection:${item.id}` ? " on" : ""}`}
            type="button"
            onClick={() => setPane(`collection:${item.id}`)}
          >
            <span>{item.name}</span>
            <span className="fine">{desk.assets.filter(item.test).length}</span>
          </button>
        ))}
        <button className={pane === "shares" ? "on" : ""} type="button" onClick={() => setPane("shares")}>
          Share links
        </button>
        <button className={pane === "trash" ? "on" : ""} type="button" onClick={() => setPane("trash")}>
          Recently deleted
        </button>
        {pane === "assets" ? (
          <>
            <p className="fine" style={{ marginTop: 12 }}>
              Folders
            </p>
            {desk.folders.map((folder) => (
              <button
                key={folder.id}
                className={folder.id === folderId ? "on" : ""}
                type="button"
                onClick={() => {
                  setFolderId(folder.id);
                  setPane("assets");
                }}
              >
                {folder.parentId && folder.id !== desk.project.rootFolderId ? `· ${folder.name}` : folder.name}
              </button>
            ))}
            <form onSubmit={addFolder} className="stack">
              <input name="name" placeholder="New folder" required maxLength={80} />
            </form>
          </>
        ) : null}
      </aside>
      <section className="room-main">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="wordmark" style={{ margin: 0, fontSize: 36 }}>
              {collection ? collection.name : pane === "shares" ? "Share links" : pane === "trash" ? "Recently deleted" : pane === "collections" ? "Collections" : desk.project.name}
            </h1>
            <p className="fine">
              {collection
                ? collection.hint
                : "Upload a video, send a review link, and let someone pin, draw, and mark a timestamp."}
            </p>
          </div>
          <div className="row">
            {desk.project.restricted ? <span className="pill">Restricted</span> : null}
            <button className="btn" type="button" onClick={() => void sendReview()} disabled={!desk.assets.length}>
              Send
            </button>
          </div>
        </div>
        {readyUrl ? (
          <div className="banner">
            <span>Review link ready.</span>
            <a href={readyUrl}>{readyUrl}</a>
            <button
              className="btn"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(readyUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
        {pane === "collections" ? (
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <table className="collection-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>What it shows</th>
                  <th>Files</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {COLLECTIONS.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button className="linkish" type="button" onClick={() => setPane(`collection:${item.id}`)}>
                        {item.name}
                      </button>
                    </td>
                    <td className="muted">{item.hint}</td>
                    <td>{desk.assets.filter(item.test).length}</td>
                    <td className="fine">
                      {new Date(desk.project.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine" style={{ padding: "10px 14px" }}>
              {COLLECTIONS.length} collections. These update as files and statuses change.
            </p>
          </div>
        ) : null}
        {pane === "shares" ? (
          <div className="stack">
            {shares.length === 0 ? <p className="muted">No review links yet. Pick a file and send one.</p> : null}
            {shares.map((share) => (
              <article key={share.id} className="panel" style={{ padding: 14 }}>
                <strong>{share.name}</strong>
                <p className="fine">
                  {share.allowComment ? "Comments on" : "View only"}
                  {share.allowDownload ? " · Download on" : " · Download off"}
                  {share.hasPassphrase ? " · Passphrase" : ""}
                </p>
                {share.url ? (
                  <a href={share.url} className="fine">
                    {share.url}
                  </a>
                ) : null}
                <div>
                  <button
                    className="btn-hot"
                    type="button"
                    onClick={() =>
                      void apiSend(`/api/shares/${share.id}`, { method: "DELETE" }).then(() =>
                        setShares((current) => current.filter((item) => item.id !== share.id)),
                      )
                    }
                  >
                    Revoke
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {pane === "trash" ? (
          <div className="stack">
            <p className="muted">Removed files stay listed here. The copies stored on this server were deleted with them.</p>
            {desk.trash.length === 0 ? <p className="fine">Nothing in recently deleted.</p> : null}
            {desk.trash.map((item) => (
              <div key={item.id} className="panel" style={{ padding: 12 }}>
                <strong>{item.name}</strong>
                <div className="fine">{item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ""}</div>
              </div>
            ))}
          </div>
        ) : null}
        {showFiles ? (
          <div
            className={pane === "assets" ? `drop${hot ? " hot" : ""}` : "stack"}
            onDragOver={(event) => {
              if (pane !== "assets") return;
              event.preventDefault();
              setHot(true);
            }}
            onDragLeave={() => setHot(false)}
            onDrop={pane === "assets" ? onDrop : undefined}
          >
            {assetsHere.length === 0 ? (
              <div className="empty-stage">
                <strong>
                  {collection?.id === "approved"
                    ? "Nothing is approved yet."
                    : collection?.id === "needs-review"
                      ? "Nothing is waiting for review."
                      : collection
                        ? `No ${collection.name.toLowerCase()} yet.`
                        : "Upload a video."}
                </strong>
                <p>
                  {collection?.id === "approved"
                    ? "Tick every note on a review, and the file moves here."
                    : collection
                      ? collection.hint
                      : "The picture and the name show up here. Select it, then click Send."}
                </p>
                {pane === "assets" ? (
                  <label className="btn">
                    Upload
                    <input type="file" multiple hidden onChange={(event) => event.target.files && void takeFiles(event.target.files)} />
                  </label>
                ) : null}
              </div>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {assetsHere.length} file{assetsHere.length === 1 ? "" : "s"}
                    {picked.length ? ` · ${picked.length} selected` : ""}
                  </strong>
                  {pane === "assets" ? (
                    <label className="btn">
                      Upload
                      <input type="file" multiple hidden onChange={(event) => event.target.files && void takeFiles(event.target.files)} />
                    </label>
                  ) : null}
                </div>
                {live ? (
                  <div className="meter" aria-label="Upload progress">
                    <span style={{ width: `${Math.round(live.progress * 100)}%` }} />
                  </div>
                ) : null}
                {pane === "assets" && childFolders.length ? (
                  <div className="row">
                    {childFolders.map((folder) => (
                      <button key={folder.id} className="btn-ghost" type="button" onClick={() => setFolderId(folder.id)}>
                        {folder.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="asset-grid">
                  {assetsHere.map((item) => (
                    <article key={item.id} className={`asset${picked.includes(item.id) ? " picked" : ""}`}>
                      <button className="thumb-btn" type="button" onClick={() => togglePick(item.id)}>
                        <Thumb asset={item} />
                        <strong>{item.name}</strong>
                      </button>
                      <span className="fine">
                        {item.currentVersion
                          ? `${item.currentVersion.mediaKind.toLowerCase()} · ${formatBytes(item.currentVersion.byteSize)}`
                          : "No file yet"}
                      </span>
                      <select aria-label={`Status for ${item.name}`} value={item.status} onChange={(event) => void saveStatus(item.id, event.target.value)}>
                        {Object.entries(STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <div className="row">
                        <Link href={`/app/review/${item.id}`}>Review</Link>
                        <button className="btn-hot" type="button" onClick={() => void removeAsset(item.id)}>
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>
    </main>
  );
}
