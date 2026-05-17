'use client';

import Link from 'next/link';

export default function JobsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Jobs error</p>
        <h2 className="hero__title">We could not load the job list.</h2>
        <p className="hero__lead">{error.message}</p>
        <div className="hero__actions">
          <button className="button button--primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="button button--ghost" href="/">
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
