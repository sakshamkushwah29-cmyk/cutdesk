"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { apiSend } from "@/lib/client";
import { Me } from "@/lib/types";

type Project = { id: string; name: string; restricted: boolean; assetCount: number; createdAt: string };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
}

function coverStyle(name: string): CSSProperties {
  let hash = 0;
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(155deg, hsl(${hue} 38% 46%), hsl(${(hue + 36) % 360} 28% 16%))`,
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    const [account, list] = await Promise.all([apiSend<Me>("/api/auth/me"), apiSend<{ projects: Project[] }>("/api/projects")]);
    setMe(account);
    setProjects(list.projects);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load projects."));
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      const created = await apiSend<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: data.get("name") }),
      });
      router.push(`/app/projects/${created.project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the project.");
      setPending(false);
    }
  }

  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
  const accountName = me?.workspace.name ?? "Your account";

  return (
    <main className="page">
      <div className="account-head">
        <span className="avatar lg">{initials(accountName)}</span>
        <div>
          <h1>{accountName}</h1>
          <p className="fine">{me ? "Files stored on this server" : "Loading"}</p>
        </div>
        <button className="btn" type="button" onClick={() => setCreating(true)}>
          + New project
        </button>
      </div>
      <div className="row fine">
        <span>Active projects</span>
        <span>Sorted by name</span>
      </div>
      {error && !creating ? <p className="error">{error}</p> : null}
      <section className="project-cards">
        {sorted.map((project) => (
          <Link key={project.id} href={`/app/projects/${project.id}`} className="cover-card">
            <div className="cover" style={coverStyle(project.name)} />
            <div className="meta">
              <strong>{project.name}</strong>
              <span className="fine">
                {project.assetCount} file{project.assetCount === 1 ? "" : "s"}
                {project.restricted ? " · Restricted" : ""}
                {" · "}
                {new Date(project.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </Link>
        ))}
        <button className="new-card" type="button" onClick={() => setCreating(true)}>
          <span className="plus">+</span>
          <strong>New project</strong>
        </button>
      </section>
      {creating ? (
        <div className="modal" role="dialog" aria-label="Create new project">
          <form className="create-dialog" onSubmit={onCreate}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Create new project</strong>
              <button className="btn-ghost" type="button" onClick={() => setCreating(false)}>
                Close
              </button>
            </div>
            <label>
              Project name
              <input name="name" required maxLength={120} placeholder="Project name" autoFocus />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button className="btn" disabled={pending} type="submit">
              {pending ? "Creating…" : "Create project"}
            </button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
