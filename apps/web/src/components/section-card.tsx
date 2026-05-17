import type { ReactNode } from 'react';

export function SectionCard({
  id,
  title,
  description,
  children,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <div className="panel__header">
        <div>
          <h2 className="panel__title">{title}</h2>
          {description ? <p className="panel__subtitle">{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="panel__body">{children}</div>
    </section>
  );
}
