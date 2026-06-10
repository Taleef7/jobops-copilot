// Next.js calls register() once per server process at startup.
// Guard to the Node runtime so the App Insights SDK never loads on the edge.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  ) {
    const appInsights = await import('applicationinsights');
    appInsights
      .setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
      .setAutoCollectConsole(false)
      .setSendLiveMetrics(false)
      .setInternalLogging(false, false)
      .start();
  }
}
