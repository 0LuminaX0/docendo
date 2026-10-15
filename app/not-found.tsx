import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="center-box">
        <h1>This page doesn&apos;t exist</h1>
        <p className="lede">The link may be mistyped. Your session, if you started one, is still saved in this browser.</p>
        <Link className="btn primary" href="/">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
