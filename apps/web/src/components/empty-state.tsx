import Link from 'next/link';

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel && actionHref ? (
        <Link className="button button--ghost" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
