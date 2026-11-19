"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { apiSend } from "@/lib/client";
import { STATUS_LABEL } from "@/lib/types";

type Hit = {
  id: string;
  name: string;
  status: string;
  assigneeName: string | null;
  projectId: string;
  projectName: string;
  mediaKind: string | null;
  versionNumber: number | null;
};

const SUGGESTIONS = ["Needs Review", "Approved", "In Progress"];

function SearchBody() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [hits, setHits] = useState<Hit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(Boolean(initial));
  const [loading, setLoading] = useState(Boolean(initial));

  useEffect(() => {
    if (!initial) {
      setHits([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setQuery(initial);
    setSearched(true);
    setLoading(true);
    setError(null);
    apiSend<{ results: Hit[] }>(`/api/search?q=${encodeURIComponent(initial)}`)
      .then((data) => setHits(data.results))
      .catch((err) => setError(err instanceof Error ? err.message : "Search failed."))
      .finally(() => setLoading(false));
  }, [initial]);

  function go(next: string) {
    const trimmed = next.trim();
    router.push(trimmed ? `/app/search?q=${encodeURIComponent(trimmed)}` : "/app/search");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    go(query);
  }

  return (
    <main className="page search-page">
      <form onSubmit={onSubmit} className="search-form wide">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search status, assignee, keywords"
          aria-label="Search files"
        />
      </form>
      {!searched ? (
        <div className="empty-stage">
          <div className="empty-glyph" aria-hidden="true" />
          <strong>Search for status, assignee, keywords, and more</strong>
          <p>Start typing or tap a suggestion to begin.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            {SUGGESTIONS.map((item) => (
              <button key={item} className="btn-ghost" type="button" onClick={() => go(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Searching…</p> : null}
      {searched && !loading && !error && hits.length === 0 ? <p className="muted">Nothing matches that search.</p> : null}
      {hits.length ? (
        <div className="panel stack" style={{ padding: 8 }}>
          {hits.map((hit) => (
            <Link key={hit.id} href={`/app/review/${hit.id}`} className="hit">
              <strong>{hit.name}</strong>
              <span className="fine">
                {hit.projectName}
                {hit.versionNumber ? ` · v${hit.versionNumber}` : ""}
                {hit.mediaKind ? ` · ${hit.mediaKind.toLowerCase()}` : ""}
                {hit.assigneeName ? ` · ${hit.assigneeName}` : ""}
              </span>
              <span className={`pill ${hit.status === "APPROVED" ? "approved" : hit.status === "IN_PROGRESS" ? "progress" : "review"}`}>
                {STATUS_LABEL[hit.status] ?? hit.status}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<main className="page"><p className="muted">Search</p></main>}>
      <SearchBody />
    </Suspense>
  );
}
