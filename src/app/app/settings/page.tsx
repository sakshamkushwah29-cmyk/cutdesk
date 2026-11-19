"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { apiSend } from "@/lib/client";
import { Me, formatBytes } from "@/lib/types";

type Member = { id: string; role: string; name: string; email: string; you?: boolean };

function SettingsBody() {
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [account, list] = await Promise.all([
      apiSend<Me>("/api/auth/me"),
      apiSend<{ members: Member[] }>("/api/members"),
    ]);
    setMe(account);
    setMembers(list.members);
  }

  useEffect(() => {
    if (params.get("drive") === "connected") setNotice("Google Drive is connected.");
    if (params.get("drive") === "error") setNotice(params.get("message") || "Drive did not connect.");
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load settings."));
  }, [params]);

  async function connect() {
    setError(null);
    try {
      const data = await apiSend<{ url: string }>("/api/google/start");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
    }
  }

  async function disconnect() {
    await apiSend("/api/google/disconnect", { method: "POST" });
    await load();
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(null);
    try {
      await apiSend("/api/members", {
        method: "POST",
        body: JSON.stringify({ email: data.get("email"), role: data.get("role") }),
      });
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that person.");
    }
  }

  if (!me) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading settings…</p>}</main>;

  const cap = me.workspace.plan.storageBytes;
  const used = Number(me.workspace.storageBytes);
  const ratio = cap ? Math.min(100, (used / Number(cap)) * 100) : 8;
  const canManage = me.role === "OWNER" || me.role === "ADMIN";

  return (
    <main className="page" style={{ maxWidth: 860 }}>
      <p className="kicker">Settings</p>
      <h1 className="wordmark" style={{ fontSize: 48, marginTop: 0 }}>
        {me.workspace.name}
      </h1>
      {notice ? <p className="banner">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <section className="panel stack" style={{ padding: 16 }}>
        <strong>Server storage</strong>
        <p className="muted">
          New uploads are saved on this machine. Review links play those files from this server. Docker runs the database
          and does not hold the video files.
        </p>
        <p className="fine">Folder: {me.workspace.storageDir}</p>
        <p className="fine">
          Free disk on this machine: {me.workspace.diskFreeBytes ? formatBytes(me.workspace.diskFreeBytes) : "unavailable"}
        </p>
        <div className="meter">
          <span style={{ width: `${ratio}%` }} />
        </div>
        <p className="fine">
          {formatBytes(me.workspace.storageBytes)} used
          {cap ? ` of ${formatBytes(cap)}` : ""}
        </p>
      </section>
      <section className="panel stack" style={{ padding: 16 }}>
        <strong>Google Drive</strong>
        <p className="muted">
          Optional. Files already uploaded to Google Drive still play from that account. New uploads are not sent there,
          and connecting Drive does not add disk space.
        </p>
        {me.workspace.driveConnected ? (
          <div className="row">
            <span>Connected as {me.workspace.googleEmail || "a Google account"}</span>
            {canManage ? (
              <button className="btn-hot" type="button" onClick={() => void disconnect()}>
                Disconnect
              </button>
            ) : null}
          </div>
        ) : (
          <button className="btn" type="button" disabled={!canManage} onClick={() => void connect()}>
            Connect Google Drive
          </button>
        )}
        <p className="fine">
          Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in `.env`, then restart the app. The redirect URI is
          http://localhost:3010/api/google/callback.
        </p>
      </section>
      <section className="panel stack" style={{ padding: 16 }}>
        <strong>Members</strong>
        {members.map((member) => (
          <div key={member.id} className="row" style={{ justifyContent: "space-between" }}>
            <span>
              {member.name} <span className="fine">{member.email}</span>
            </span>
            <span className="row">
              <span className="pill">{member.role}</span>
              {canManage && !member.you ? (
                <button className="btn-hot" type="button" onClick={() => void apiSend(`/api/members/${member.id}`, { method: "DELETE" }).then(load)}>
                  Remove
                </button>
              ) : null}
            </span>
          </div>
        ))}
        {canManage ? (
          <form className="row" onSubmit={addMember}>
            <input name="email" type="email" placeholder="Existing account email" required />
            <select name="role" defaultValue="MEMBER" aria-label="Role">
              <option value="MEMBER">Member</option>
              {me.role === "OWNER" ? <option value="ADMIN">Admin</option> : null}
            </select>
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsBody />
    </Suspense>
  );
}
