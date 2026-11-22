"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function Opening() {
  const params = useSearchParams();
  const next = params.get("next");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const url = new URL("/api/auth/clerk", window.location.origin);
    url.searchParams.set("json", "1");
    if (next?.startsWith("/app")) url.searchParams.set("next", next);
    let cancelled = false;
    fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { next?: string; redirect?: string } | null;
        if (cancelled) return;
        if (res.ok && body?.next) {
          window.location.assign(body.next);
          return;
        }
        if (body?.redirect) {
          window.location.assign(body.redirect);
          return;
        }
        setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [next]);

  return (
    <main className="auth-wrap">
      <div className="auth-card stack">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>{failed ? "Sign-in didn’t finish" : "Opening your bench…"}</h1>
        <p className="muted">
          {failed
            ? "Google or Apple signed you in, but the bench didn’t open."
            : "Google and Apple return here, then Cutdesk opens your bench."}
        </p>
        {failed ? (
          <Link href="/sign-in" className="btn">
            Try again
          </Link>
        ) : null}
      </div>
    </main>
  );
}

export default function ContinuePage() {
  return (
    <Suspense>
      <Opening />
    </Suspense>
  );
}
