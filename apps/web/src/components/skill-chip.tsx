import { Check, Plus, Tag } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Variant = 'matched' | 'missing' | 'neutral';

/** A chip's short label, and the text shown on hover and focus (#354). */
export type ChipItem = string | { label: string; detail?: string };

const styles: Record<Variant, string> = {
  matched: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  missing: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
  neutral: 'bg-muted text-muted-foreground',
};

const icons = { matched: Check, missing: Plus, neutral: Tag } as const;

const chipClass = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium';

export function SkillChip({
  label,
  detail,
  variant = 'neutral',
}: {
  label: string;
  detail?: string;
  variant?: Variant;
}) {
  const Icon = icons[variant];
  const content = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </>
  );
  if (!detail) {
    return <span className={cn(chipClass, styles[variant])}>{content}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          chipClass,
          'cursor-help outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          styles[variant],
        )}
      >
        {content}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

export function SkillChipList({
  items,
  variant = 'neutral',
  empty = 'None yet.',
}: {
  items: ChipItem[];
  variant?: Variant;
  empty?: string;
}) {
  if (!items.length) {
    return <p className="text-muted-foreground text-sm">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => {
        const { label, detail } = typeof item === 'string' ? { label: item, detail: undefined } : item;
        // Two items can share a label ("Other"), so the index keeps the keys apart.
        return <SkillChip key={`${label}-${index}`} label={label} detail={detail} variant={variant} />;
      })}
    </div>
  );
}
