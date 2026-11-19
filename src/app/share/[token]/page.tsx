"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Player } from "@/components/player";
import { apiSend } from "@/lib/client";
import { Comment, Mark, Version } from "@/lib/types";

type SharePayload = {
  share: {
    name: string;
    kind: string;
    allowComment: boolean;
    allowDownload: boolean;
    watermarkText: string | null;
    studio: string | null;
    guestName: string | null;
  };
  assets: { id: string; name: string; currentVersionId: string | null; versions: Version[] }[];
  comments: Comment[];
};

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<SharePayload | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const payload = await apiSend<SharePayload>(`/api/s/${token}`);
      setData({
        ...payload,
        comments: payload.comments.map((comment) => ({ ...comment, markup: (comment.markup ?? []) as Mark[] })),
      });
      setLocked(null);
      setGuestName(payload.share.guestName ?? "");
      setAssetId((current) => current ?? payload.assets[0]?.id ?? null);
    } catch (err) {
      const coded = err as Error & { code?: string };
      if (coded.code === "PASSPHRASE") setLocked("This link needs a passphrase.");
      else setError(err instanceof Error ? err.message : "This link is not available.");
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      await apiSend(`/api/s/${token}/unlock`, {
        method: "POST",
        body: JSON.stringify({ passphrase: form.get("passphrase"), guestName: form.get("guestName") || undefined }),
      });
      if (typeof form.get("guestName") === "string") setGuestName(String(form.get("guestName")));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the link.");
    }
  }

  if (locked) {
    return (
      <main className="auth-wrap">
        <form className="auth-card" onSubmit={unlock}>
          <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
            Cutdesk
          </Link>
          <h1>Review link</h1>
          <p className="muted">{locked}</p>
          <label>
            Passphrase
            <input name="passphrase" type="password" required />
          </label>
          <label>
            Your name
            <input name="guestName" required />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="btn" type="submit">
            Open
          </button>
        </form>
      </main>
    );
  }

  if (!data) {
    return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Opening the link…</p>}</main>;
  }

  const asset = data.assets.find((item) => item.id === assetId) ?? data.assets[0];
  if (!asset) return <main className="page">This link has no files.</main>;

  return (
    <div>
      <header className="shell-bar">
        <div className="brand">
          <span className="wordmark" style={{ fontSize: 26 }}>
            {data.share.studio || "Cutdesk"}
          </span>
          <small>{data.share.name}</small>
        </div>
        <div className="row">
          {data.assets.map((item) => (
            <button key={item.id} className={item.id === asset.id ? "btn" : "btn-ghost"} type="button" onClick={() => setAssetId(item.id)}>
              {item.name}
            </button>
          ))}
        </div>
      </header>
      {error ? <p className="error" style={{ margin: 16 }}>{error}</p> : null}
      <Player
        title={asset.name}
        versions={asset.versions}
        comments={data.comments.filter((comment) => comment.assetId === asset.id)}
        initialVersionId={asset.currentVersionId}
        mediaUrl={(versionId) => `/api/s/${token}/media/${versionId}`}
        allowComment={data.share.allowComment}
        allowDownload={data.share.allowDownload}
        watermark={data.share.watermarkText}
        guestName={guestName}
        onGuestName={setGuestName}
        onComment={async (input) => {
          await apiSend(`/api/s/${token}/comments`, {
            method: "POST",
            body: JSON.stringify({ ...input, guestName: guestName || input.guestName, visibility: "CLIENT" }),
          });
          await load();
        }}
      />
    </div>
  );
}
