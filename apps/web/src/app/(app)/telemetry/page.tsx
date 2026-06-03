import { SectionCard } from '@/components/section-card';
import { TelemetryInsightsPanel } from '@/components/telemetry-insights';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Telemetry' };

export default function TelemetryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Telemetry intelligence</h2>
        <p className="text-muted-foreground text-sm">
          Treat the job pipeline as telemetry — trend, anomaly detection, and forecasting that
          transfer directly to vehicle sensor data.
        </p>
      </div>

      <SectionCard
        title="Time-series analysis"
        description="Pandas-powered analytics narrated by an LLM, with a synthetic EV battery demo."
      >
        <TelemetryInsightsPanel />
      </SectionCard>
    </div>
  );
}
