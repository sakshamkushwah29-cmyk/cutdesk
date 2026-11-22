"use client";

import { useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { apiSend } from "@/lib/client";
import { Me, formatBytes } from "@/lib/types";
import { UploadsProvider, useUploads } from "@/components/uploads";

type PastUpload = {
  id: string;
  assetId: string;
  name: string;
  projectName: string;
  state: string;
  byteSize: string;
  createdAt: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
}

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconCloud() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.6A3.5 3.5 0 0 0 7 18Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11v6M9.5 14.5 12 12l2.5 2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AppFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const clerk = useClerk();
  const uploads = useUploads();
  const [me, setMe] = useState<Me | null>(null);
  const [query, setQuery] = useState("");
  const [past, setPast] = useState<PastUpload[]>([]);
  const [pastLoaded, setPastLoaded] = useState(false);

  useEffect(() => {
    apiSend<Me>("/api/auth/me").then(setMe).catch(() => router.push("/sign-in"));
  }, [router]);

  useEffect(() => {
    if (!uploads.open) return;
    setPastLoaded(false);
    apiSend<{ uploads: PastUpload[] }>("/api/uploads")
      .then((data) => setPast(data.uploads))
      .catch(() => setPast([]))
      .finally(() => setPastLoaded(true));
  }, [uploads.open, uploads.jobs]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const next = query.trim();
    router.push(next ? `/app/search?q=${encodeURIComponent(next)}` : "/app/search");
  }

  async function logout() {
    try {
      await apiSend("/api/auth/logout", { method: "POST" });
    } finally {
      await clerk.signOut({ redirectUrl: "/" });
    }
  }

  const homeOn = pathname === "/app";
  const searchOn = pathname.startsWith("/app/search");

  return (
    <div className="app-frame">
      <nav className="rail" aria-label="Workspace">
        <Link href="/app" className="rail-mark" aria-label="Cutdesk home">
          C
        </Link>
        <Link href="/app" className={homeOn ? "on" : ""} aria-label="Projects" title="Projects">
          <IconHome />
        </Link>
        <Link href="/app/search" className={searchOn ? "on" : ""} aria-label="Search" title="Search">
          <IconSearch />
        </Link>
        <button
          type="button"
          className={uploads.open ? "on" : ""}
          aria-label="Uploads"
          title="Uploads"
          onClick={() => uploads.setOpen(!uploads.open)}
        >
          <IconCloud />
        </button>
        <div className="rail-gap" />
        <button className="rail-text" type="button" onClick={logout}>
          Out
        </button>
        <Link href="/app/settings" className="avatar" title={me?.user.name ?? "Account"} aria-label="Account settings">
          {initials(me?.user.name || me?.workspace.name || "C")}
        </Link>
      </nav>
      <div className="app-column">
        <header className="desk-top">
          <div>
            <Link href="/app" className="wordmark" style={{ fontSize: 28 }}>
              Cutdesk
            </Link>
            <div className="fine">{me ? me.workspace.name : "Loading account"}</div>
          </div>
          <form onSubmit={onSearch} className="search-form">
            <input
              className="search"
              placeholder="Search status, assignee, keywords"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search"
            />
          </form>
        </header>
        {children}
      </div>
      {uploads.open ? (
        <aside className="uploads-pop" aria-label="Uploads">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Uploads</strong>
            <button className="btn-ghost" type="button" onClick={() => uploads.setOpen(false)}>
              Close
            </button>
          </div>
          {pastLoaded && uploads.jobs.length === 0 && past.length === 0 ? (
            <div className="empty-copy">
              <strong>No uploads</strong>
              <p>In-progress and past uploads show up here. Files are stored on this server.</p>
            </div>
          ) : null}
          {uploads.jobs.map((job) => (
            <div key={job.localId} className="upload-row">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{job.name}</strong>
                <span className="fine">
                  {job.status === "error" ? "Failed" : job.status === "done" ? "Ready" : `${Math.round(job.progress * 100)}%`}
                </span>
              </div>
              <div className="meter" aria-label={`${job.name} progress`}>
                <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
              {job.message ? <p className="fine">{job.message}</p> : null}
              {job.assetId && job.status === "done" ? (
                <Link href={`/app/review/${job.assetId}`} className="fine">
                  Open review
                </Link>
              ) : null}
            </div>
          ))}
          {past
            .filter((item) => !uploads.jobs.some((job) => job.name === item.name && job.status === "uploading"))
            .slice(0, 12)
            .map((item) => (
              <Link key={item.id} href={`/app/review/${item.assetId}`} className="upload-row">
                <strong>{item.name}</strong>
                <span className="fine">
                  {item.projectName} · {item.state === "READY" ? formatBytes(item.byteSize) : item.state.toLowerCase()}
                </span>
              </Link>
            ))}
        </aside>
      ) : null}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <UploadsProvider>
      <AppFrame>{children}</AppFrame>
    </UploadsProvider>
  );
}
