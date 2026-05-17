const statusMeta: Record<
  string,
  { label: string; tone: 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'teal' | 'violet' }
> = {
  discovered: { label: 'Discovered', tone: 'slate' },
  shortlisted: { label: 'Shortlisted', tone: 'blue' },
  applied: { label: 'Applied', tone: 'green' },
  outreach_drafted: { label: 'Outreach drafted', tone: 'amber' },
  outreach_sent: { label: 'Outreach sent', tone: 'teal' },
  referral_requested: { label: 'Referral requested', tone: 'violet' },
  follow_up_due: { label: 'Follow-up due', tone: 'rose' },
  interview: { label: 'Interview', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'rose' },
  offer: { label: 'Offer', tone: 'green' },
  archived: { label: 'Archived', tone: 'slate' },
  drafted: { label: 'Drafted', tone: 'amber' },
  approved: { label: 'Approved', tone: 'blue' },
  sent: { label: 'Sent', tone: 'green' },
  skipped: { label: 'Skipped', tone: 'slate' },
};

function humanizeStatus(status: string) {
  return status
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function StatusPill({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { label: humanizeStatus(status), tone: 'slate' as const };

  return <span className={`status-pill status-pill--${meta.tone}`}>{meta.label}</span>;
}
