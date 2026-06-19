import 'dotenv/config';
import { startAppInsights } from '@/lib/app-insights';

startAppInsights();

import { createApp } from '@/app';
import { registerGracefulShutdown } from '@/lib/shutdown';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`JobOps Copilot API listening on http://localhost:${port}`);
});

// Drain in-flight requests + close the DB pool on SIGTERM/SIGINT (Azure deploy/restart).
registerGracefulShutdown(server);
