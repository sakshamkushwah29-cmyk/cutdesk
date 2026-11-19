import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing">
      <header className="topbar">
        <Link href="/" className="wordmark" style={{ fontSize: 28 }}>
          Cutdesk
        </Link>
        <nav className="nav-links">
          <Link href="/login">Sign in</Link>
          <Link href="/register" className="btn">
            Open a bench
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div>
          <p className="kicker">Review room</p>
          <h1>Notes on the frame. Files on this server.</h1>
          <p className="lede">
            Cutdesk is a review bench for cuts, stills, and audio. Versions stack on the same asset, comments pin to a
            timecode, and the original is stored on this server for the review link to play.
          </p>
          <div className="row" style={{ marginTop: 22 }}>
            <Link href="/register" className="btn">
              Open a bench
            </Link>
            <Link href="/login" className="btn-ghost">
              I already have a bench
            </Link>
          </div>
        </div>
        <div className="hero-card">
          <div className="filmstrip">
            <div className="sprocket" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
            <div className="frame-preview">
              <span className="pin">01:12:08:14</span>
              <strong>Hold this look.</strong>
            </div>
          </div>
          <p className="fine" style={{ marginBottom: 0 }}>
            Playback is a ranged read from Drive. Nothing is published to the open web.
          </p>
        </div>
      </section>
    </main>
  );
}
