import { Card } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="gap-1 p-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <strong className="font-heading text-2xl font-bold tabular-nums">{value}</strong>
      <span className="text-muted-foreground text-xs">{detail}</span>
    </Card>
  );
}
