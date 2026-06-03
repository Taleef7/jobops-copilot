'use client';

import { useState } from 'react';
import {
  ApiRequestError,
  fetchEvTelemetryDemo,
  fetchTelemetryInsights,
  type TelemetryInsightsResponse,
} from '@/lib/api';

type Mode = 'pipeline' | 'ev';

function SparkBars({ values }: { values: number[] }) {
  if (!values.length) {
    return null;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return (
    <div className="report-bars">
      {values.map((value, index) => (
        <div className="report-bar" key={index}>
          <div className="report-bar__track">
            <div
              className="report-bar__fill"
              style={{ width: `${Math.max(6, ((value - min) / span) * 100)}%` }}
            />
          </div>
        </div>
      ))}
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
        setError(requestError instanceof Error ? requestError.message : 'Telemetry analysis failed.');
      }
    } finally {
      setRunning(null);
    }
  }

  const busy = running !== null;

  return (
    <div className="stack">
      <p className="callout__text">
        Time-series intelligence: trend, anomaly detection, and a short forecast — computed with
        pandas and narrated by an LLM in the agent service. The EV demo applies the same analysis to
        synthetic battery-health sensor data.
      </p>

      <div className="hero__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => run('pipeline')}
        >
          {running === 'pipeline' ? 'Analyzing…' : 'Analyze pipeline telemetry'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => run('ev')}
        >
          {running === 'ev' ? 'Analyzing…' : 'EV battery telemetry demo'}
        </button>
      </div>

      {error ? (
        <div className="callout callout--accent">
          <p className="callout__title">Telemetry unavailable</p>
          <p className="callout__text">{error}</p>
        </div>
      ) : null}

      {insights ? (
        <div className="stack">
          <div className="inline-metrics">
            <div className="inline-metric">
              <strong>{insights.trend}</strong>
              <span>Trend</span>
            </div>
            <div className="inline-metric">
              <strong>{insights.moving_average_7d.toFixed(1)}</strong>
              <span>7-pt avg</span>
            </div>
            <div className="inline-metric">
              <strong>{insights.forecast_next.toFixed(1)}</strong>
              <span>Forecast</span>
            </div>
            <div className="inline-metric">
              <strong>{insights.anomaly_dates.length}</strong>
              <span>Anomalies</span>
            </div>
          </div>

          <div className="callout">
            <p className="callout__title">
              {insights.metric}
              {insights.llm_used ? ' · LLM narrated' : ''}
            </p>
            <p className="callout__text">{insights.narrative}</p>
          </div>

          <SparkBars values={insights.series_values} />

          {insights.anomaly_dates.length ? (
            <div className="detail-card">
              <p className="detail-card__title">Anomaly points</p>
              <p className="detail-card__value">{insights.anomaly_dates.join(', ')}</p>
            </div>
          ) : null}

          {insights.recommendations.length ? (
            <div className="detail-card">
              <p className="detail-card__title">Recommendations</p>
              <ul className="list">
                {insights.recommendations.map((rec, index) => (
                  <li key={index}>{rec}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
