import { cn } from '@/lib/utils';

export function Sparkline({
  values,
  width = 120,
  height = 36,
  anomalyIndex,
  variant = 'area',
  fluid = false,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  anomalyIndex?: number | null;
  variant?: 'area' | 'line' | 'bars';
  fluid?: boolean;
  className?: string;
}) {
  if (!values.length) return null;
  const svgSize = fluid
    ? ({ width: '100%', height, viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' } as const)
    : ({ width, height } as const);

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;

  if (variant === 'bars') {
    const gap = width / values.length;
    return (
      <svg {...svgSize} className={cn('overflow-visible', className)} aria-hidden>
        {values.map((v, i) => {
          const h = ((v - min) / span) * (height - pad) + 2;
          return (
            <rect
              key={i}
              x={i * gap + gap * 0.15}
              y={height - h}
              width={gap * 0.7}
              height={h}
              rx={1.5}
              className="fill-primary/70"
            />
          );
        })}
      </svg>
    );
  }

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = height - ((v - min) / span) * (height - pad * 2) - pad;
    return [x, y] as const;
  });
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const anomaly = anomalyIndex != null ? points[anomalyIndex] : undefined;

  return (
    <svg {...svgSize} className={cn('overflow-visible', className)} aria-hidden>
      {variant === 'area' ? <path d={area} className="fill-primary/10" /> : null}
      <path
        d={line}
        className="fill-none stroke-primary"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {anomaly ? (
        <circle
          cx={anomaly[0]}
          cy={anomaly[1]}
          r={3.5}
          className="fill-amber-500 stroke-background"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}
