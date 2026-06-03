import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/sparkline';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  trend,
  trendLabel,
  spark,
  sparkVariant = 'bars',
  icon: Icon,
}: {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  spark?: number[];
  sparkVariant?: 'area' | 'line' | 'bars';
  icon?: LucideIcon;
}) {
  const up = (trend ?? 0) >= 0;

  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        {Icon ? <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden /> : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-heading text-2xl font-bold tabular-nums">{value}</span>
        {spark?.length ? (
          <Sparkline values={spark} variant={sparkVariant} width={64} height={28} />
        ) : null}
      </div>
      {trend != null ? (
        <p
          className={cn(
            'inline-flex items-center gap-0.5 text-xs font-medium',
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {Math.abs(trend)}%{trendLabel ? <span className="text-muted-foreground ml-1 font-normal">{trendLabel}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}
