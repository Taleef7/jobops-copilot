import 'dotenv/config';
import { startAppInsights } from '@/lib/app-insights';
import { registerProcessSafetyNet } from '@/lib/process-safety';

startAppInsights();
// Keep the process alive on a stray unhandled rejection instead of crashing every in-flight request.
registerProcessSafetyNet();

import { createApp } from '@/app';
import { assertProductionAuthConfigured } from '@/lib/auth';
import { migrateOnBoot } from '@/lib/migrate-on-boot';
import { registerGracefulShutdown } from '@/lib/shutdown';

// Fail closed: refuse to boot a production deploy whose authentication would be disabled.
assertProductionAuthConfigured();

const port = Number(process.env.PORT ?? 4000);

async function start() {
  // Before the first request, not after: an API serving a schema its code does
  // not match is exactly how five missing tables went unnoticed — the reads
  // failed open with empty results. Throwing here fails the deploy's readiness
  // gate instead. Set RUN_MIGRATIONS_ON_BOOT=false to boot without migrating.
  await migrateOnBoot();

  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`JobOps Copilot API listening on http://localhost:${port}`);
  });

  // Drain in-flight requests + close the DB pool on SIGTERM/SIGINT (Azure deploy/restart).
  registerGracefulShutdown(server);
}

start().catch((error: unknown) => {
  console.error('JobOps Copilot API failed to start.');
  console.error(error);
  process.exit(1);
});
