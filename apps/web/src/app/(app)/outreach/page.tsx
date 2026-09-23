import type { Metadata } from 'next';
import { Archive, CheckCircle2, FileEdit, Send, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { OutreachReviewActions } from '@/components/outreach-review-actions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { OutreachDraftCard } from '@/components/outreach-draft-card';
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

const COLUMN_EMPTY_HINTS: Record<OutreachStatus, { icon: typeof FileEdit; title: string; desc: string }> = {
  drafted: { icon: FileEdit, title: 'No pending drafts', desc: 'Generate drafts from any job detail page.' },
  approved: { icon: CheckCircle2, title: 'No approved drafts', desc: 'Approved messages waiting to send appear here.' },
  sent: { icon: Send, title: 'No sent messages', desc: 'Outreach you mark as sent will be logged here.' },
  skipped: { icon: Archive, title: 'No skipped drafts', desc: 'Archived drafts appear here for reference.' },
};

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
                  <Card
                    key={item.draft.id}
                    className="gap-2.5 p-3.5 transition-all duration-150 hover:border-foreground/20 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm font-medium"
                          title={item.draft.contactName || item.company}
                        >
                          {item.draft.contactName || item.company}
                        </p>
                        <p
                          className="text-muted-foreground truncate text-xs"
                          title={item.draft.contactRole || item.title}
                        >
                          {item.draft.contactRole || item.title}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[0.65rem] capitalize">
                        {item.draft.messageType.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <OutreachDraftCard draftText={item.draft.draftText} />
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
                  (() => {
                    const hint = COLUMN_EMPTY_HINTS[column.key];
                    const HintIcon = hint.icon;
                    return (
                      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 p-6 text-center">
                        <HintIcon className="text-muted-foreground/50 mb-2 size-5" />
                        <p className="text-xs font-medium text-foreground/80">{hint.title}</p>
                        <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">{hint.desc}</p>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
