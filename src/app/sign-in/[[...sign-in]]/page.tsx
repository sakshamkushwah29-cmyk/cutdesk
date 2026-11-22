import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

export default function SignInPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>Sign in</h1>
        <p className="muted">Use Google to open your bench.</p>
        <Suspense>
          <SignIn
            forceRedirectUrl="/api/auth/clerk"
            fallbackRedirectUrl="/api/auth/clerk"
            signUpUrl="/sign-up"
          />
        </Suspense>
      </div>
    </main>
  );
}
