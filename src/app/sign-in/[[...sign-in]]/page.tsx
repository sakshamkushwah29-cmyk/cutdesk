import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>Sign in</h1>
        <p className="muted">Continue with Google or Apple.</p>
        <ClerkLoading>
          <p className="muted">Loading Google and Apple…</p>
        </ClerkLoading>
        <ClerkLoaded>
          <SignIn
            forceRedirectUrl="/auth/continue"
            fallbackRedirectUrl="/auth/continue"
            signUpUrl="/sign-up"
          />
        </ClerkLoaded>
      </div>
    </main>
  );
}
