import * as appInsights from 'applicationinsights';

/**
 * Starts Application Insights when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 * No-op (returns false) in local dev / tests where the var is absent.
 * Separate from lib/telemetry.ts, which is the CRM activity time-series feature.
 * Telemetry must never crash the service it observes, so init errors are swallowed.
 */
export function startAppInsights(): boolean {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) {
    return false;
  }

  try {
    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, false)
      .setSendLiveMetrics(false)
      .setInternalLogging(false, false)
      .start();
    return true;
  } catch (error) {
    console.warn('Application Insights failed to start; continuing without telemetry.', error);
    return false;
  }
}
