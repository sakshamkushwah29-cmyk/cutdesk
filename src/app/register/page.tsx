"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiSend } from "@/lib/client";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiSend("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          workspaceName: form.get("workspaceName"),
        }),
      });
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the workspace.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>Open a bench</h1>
        <label>
          Your name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          Workspace
          <input name="workspaceName" required maxLength={80} placeholder="North Room" />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Creating…" : "Create workspace"}
        </button>
        <p className="muted">
          Already cutting? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
