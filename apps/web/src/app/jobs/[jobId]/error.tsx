'use client';

import Link from 'next/link';

export default function JobDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Job detail error</p>
        <h2 className="hero__title">We could not load that job.</h2>
        <p className="hero__lead">{error.message}</p>
        <div className="hero__actions">
          <button className="button button--primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="button button--ghost" href="/jobs">
            Back to jobs
          </Link>
        </div>
      </section>
    </div>
  );
}
