import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { OutreachReviewActions } from '@/components/outreach-review-actions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { loadOutreach } from '@/lib/outreach-data';
import type { OutreachStatus } from '@/types/job';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Outreach' };

const COLUMNS: { key: OutreachStatus; label: string; dot: string }[] = [
  { key: 'drafted', label: 'Drafted', dot: 'bg-slate-400' },
  { key: 'approved', label: 'Approved', dot: 'bg-indigo-500' },
  { key: 'sent', label: 'Sent', dot: 'bg-emerald-500' },
  { key: 'skipped', label: 'Skipped', dot: 'bg-amber-500' },
];

export default async function OutreachPage() {
  const { items, source } = await loadOutreach();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Outreach</h1>
        <p className="text-muted-foreground text-sm">Review and approve every draft before it goes out.</p>
      </div>

      <Card className="bg-accent/40 flex-row items-center gap-2 p-3">
        <ShieldCheck className="text-primary size-5 shrink-0" />
        <p className="text-sm">
          <span className="font-medium">Drafts only.</span>{' '}
          <span className="text-muted-foreground">Nothing sends without your approval.</span>
        </p>
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="No outreach drafts yet"
          description="Generate a draft from a job detail page and it will appear here for review."
          actionLabel="Open jobs"
          actionHref="/jobs"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const columnItems = items.filter((item) => item.draft.status === column.key);
            return (
              <div key={column.key} className="bg-muted/40 flex flex-col gap-3 rounded-xl p-3">
                <div className="flex items-center gap-2 px-1">
                  <span className={`size-2 rounded-full ${column.dot}`} />
                  <span className="text-sm font-semibold">{column.label}</span>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {columnItems.length}
                  </span>
                </div>

                {columnItems.map((item) => (
                  <Card key={item.draft.id} className="gap-2.5 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.draft.contactName || item.company}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {item.draft.contactRole || item.title}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[0.65rem] capitalize">
                        {item.draft.messageType.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground line-clamp-3 text-sm">
                      {item.draft.draftText}
                    </p>
                    <div className="flex items-center justify-between gap-2 border-t pt-2">
                      <OutreachReviewActions
                        outreachId={item.draft.id}
                        currentStatus={item.draft.status}
                        disabled={source === 'seed'}
                      />
                      <Link
                        href={`/jobs/${item.jobId}`}
                        className="text-muted-foreground hover:text-foreground text-xs whitespace-nowrap"
                      >
                        Open job →
                      </Link>
                    </div>
                  </Card>
                ))}

                {columnItems.length === 0 ? (
                  <p className="text-muted-foreground px-1 py-4 text-center text-xs">Empty</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
