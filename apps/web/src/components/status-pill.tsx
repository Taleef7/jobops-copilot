import { cn } from '@/lib/utils';

type Tone = 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'teal' | 'violet';

const statusMeta: Record<string, { label: string; tone: Tone }> = {
  discovered: { label: 'Discovered', tone: 'slate' },
  shortlisted: { label: 'Shortlisted', tone: 'blue' },
  applied: { label: 'Applied', tone: 'green' },
  outreach_drafted: { label: 'Outreach drafted', tone: 'amber' },
  outreach_sent: { label: 'Outreach sent', tone: 'teal' },
  referral_requested: { label: 'Referral requested', tone: 'violet' },
  follow_up_due: { label: 'Follow-up due', tone: 'rose' },
  interview: { label: 'Interview', tone: 'amber' },
  rejected: { label: 'Rejected', tone: 'rose' },
  offer: { label: 'Offer', tone: 'green' },
  archived: { label: 'Archived', tone: 'slate' },
  drafted: { label: 'Drafted', tone: 'slate' },
  approved: { label: 'Approved', tone: 'blue' },
  sent: { label: 'Sent', tone: 'green' },
  skipped: { label: 'Skipped', tone: 'amber' },
};

const toneClasses: Record<Tone, string> = {
  slate: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
  blue: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  teal: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

const dotClasses: Record<Tone, string> = {
  slate: 'bg-slate-500',
  blue: 'bg-indigo-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
};

function humanizeStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta[status] ?? { label: humanizeStatus(status), tone: 'slate' as const };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClasses[meta.tone],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClasses[meta.tone])} aria-hidden />
      {meta.label}
    </span>
  );
}
