import { ClerkLoaded, ClerkLoading, SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card stack">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <h1>Open a bench</h1>
        <p className="muted">Create your account with Google or Apple.</p>
        <ClerkLoading>
          <p className="muted">Loading Google and Apple…</p>
        </ClerkLoading>
        <ClerkLoaded>
          <SignUp
            forceRedirectUrl="/auth/continue"
            fallbackRedirectUrl="/auth/continue"
            signInUrl="/sign-in"
          />
        </ClerkLoaded>
      </div>
    </main>
  );
}
