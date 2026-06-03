import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function SectionCard({
  id,
  title,
  description,
  children,
  action,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card id={id} className={cn('scroll-mt-20 gap-4 p-5 sm:p-6', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div>{children}</div>
    </Card>
  );
}
