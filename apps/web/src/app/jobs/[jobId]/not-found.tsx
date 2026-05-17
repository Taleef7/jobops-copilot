import Link from 'next/link';

export default function JobNotFound() {
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Not found</p>
        <h2 className="hero__title">That job record does not exist.</h2>
        <p className="hero__lead">
          The record may have been removed, archived, or the URL may be stale.
        </p>
        <div className="hero__actions">
          <Link className="button button--primary" href="/jobs">
            Back to jobs
          </Link>
          <Link className="button button--ghost" href="/jobs/new">
            Add a job
          </Link>
        </div>
      </section>
    </div>
  );
}
