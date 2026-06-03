'use client';

import { Activity, BatteryCharging, CircleCheck, TrendingUp, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Sparkline } from '@/components/sparkline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ApiRequestError,
  fetchEvTelemetryDemo,
  fetchTelemetryInsights,
  type TelemetryInsightsResponse,
} from '@/lib/api';

type Mode = 'pipeline' | 'ev';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-heading mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function TelemetryInsightsPanel() {
  const [running, setRunning] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<TelemetryInsightsResponse | null>(null);

  async function run(mode: Mode) {
    setError(null);
    setRunning(mode);
    try {
      setInsights(await (mode === 'pipeline' ? fetchTelemetryInsights() : fetchEvTelemetryDemo()));
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(
          requestError instanceof Error ? requestError.message : 'Telemetry analysis failed.',
        );
      }
    } finally {
      setRunning(null);
    }
  }

  const busy = running !== null;
  const firstAnomaly = insights?.anomaly_dates[0];
  const anomalyIndex =
    insights && firstAnomaly ? insights.series_labels.indexOf(firstAnomaly) : null;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Trend, anomaly detection, and a short forecast — computed with pandas and narrated by an
        LLM. The EV demo applies the same analysis to synthetic battery-health sensor data.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('pipeline')} disabled={busy} className="gap-1.5">
          <Activity className="size-4" />
          {running === 'pipeline' ? 'Analyzing…' : 'Analyze pipeline'}
        </Button>
        <Button onClick={() => run('ev')} disabled={busy} variant="outline" className="gap-1.5">
          <BatteryCharging className="size-4" />
          {running === 'ev' ? 'Analyzing…' : 'EV battery demo'}
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5 text-destructive gap-1 p-3">
          <p className="text-sm font-medium">Telemetry unavailable</p>
          <p className="text-sm opacity-90">{error}</p>
        </Card>
      ) : null}

      {insights ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Trend" value={insights.trend} />
            <Metric label="7-pt avg" value={insights.moving_average_7d.toFixed(1)} />
            <Metric label="Forecast" value={insights.forecast_next.toFixed(1)} />
            <Metric label="Anomalies" value={String(insights.anomaly_dates.length)} />
          </div>

          <Card className="gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{insights.metric}</p>
              <Badge variant="secondary" className="gap-1">
                <TrendingUp className="size-3" />
                {insights.llm_used ? 'LLM narrated' : 'computed'}
              </Badge>
            </div>
            <Sparkline
              values={insights.series_values}
              variant="area"
              fluid
              width={640}
              height={96}
              anomalyIndex={anomalyIndex}
              className="h-24 w-full"
            />
          </Card>

          {insights.narrative ? (
            <Card className="bg-accent/40 gap-0 p-4">
              <p className="text-sm leading-relaxed">{insights.narrative}</p>
            </Card>
          ) : null}

          {insights.anomaly_dates.length ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <TriangleAlert className="size-3.5 text-amber-500" />
              Anomaly at {insights.anomaly_dates.join(', ')}
            </p>
          ) : null}

          {insights.recommendations.length ? (
            <ul className="space-y-2">
              {insights.recommendations.map((rec, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" />
                  {rec}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
