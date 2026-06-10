import 'dotenv/config';
import { startTelemetry } from '@/lib/telemetry';

startTelemetry();

import { createApp } from '@/app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`JobOps Copilot API listening on http://localhost:${port}`);
});
