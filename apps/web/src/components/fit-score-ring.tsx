import { cn } from '@/lib/utils';

export function FitScoreRing({
  score,
  size = 56,
  strokeWidth = 6,
  className,
}: {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  const tone =
    score == null
      ? 'text-muted-foreground/40'
      : value >= 80
        ? 'text-emerald-500'
        : value >= 65
          ? 'text-amber-500'
          : 'text-rose-500';

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={score == null ? 'Not scored yet' : `Fit score ${value} of 100`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={score == null ? circumference : offset}
          className={cn('fill-none transition-[stroke-dashoffset] duration-700 ease-out', tone)}
        />
      </svg>
      <span className="absolute font-semibold tabular-nums" style={{ fontSize: size * 0.28 }}>
        {score == null ? '—' : value}
      </span>
    </div>
  );
}
