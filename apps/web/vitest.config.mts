import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// The browser's time zone in tests (#412): from 8 pm there it's already tomorrow in UTC, the
// server's zone on Azure. `src/test/time-zones.ts` renders "on the server" in UTC.
process.env.TZ = 'America/New_York';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Unit/component tests only; Playwright e2e lives in ./e2e and runs separately.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
