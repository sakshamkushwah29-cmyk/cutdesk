import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>Open a bench</h1>
        <p className="muted">Create your account with Google.</p>
        <Suspense>
          <SignUp
            forceRedirectUrl="/api/auth/clerk"
            fallbackRedirectUrl="/api/auth/clerk"
            signInUrl="/sign-in"
          />
        </Suspense>
      </div>
    </main>
  );
}
