import { Check, Plus, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'matched' | 'missing' | 'neutral';

const styles: Record<Variant, string> = {
  matched: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  missing: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
  neutral: 'bg-muted text-muted-foreground',
};

const icons = { matched: Check, missing: Plus, neutral: Tag } as const;

export function SkillChip({ label, variant = 'neutral' }: { label: string; variant?: Variant }) {
  const Icon = icons[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
        styles[variant],
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

export function SkillChipList({
  items,
  variant = 'neutral',
  empty = 'None yet.',
}: {
  items: string[];
  variant?: Variant;
  empty?: string;
}) {
  if (!items.length) {
    return <p className="text-muted-foreground text-sm">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <SkillChip key={item} label={item} variant={variant} />
      ))}
    </div>
  );
}
