import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { resetWeeklyReportStoreForTests } from '@/data/report-store';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('persists generated weekly reports and exposes them through the reports API', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-weekly-report-api-'));

  try {
    process.chdir(tempDir);
    resetWeeklyReportStoreForTests();

    await withServer(async (baseUrl) => {
      const generateResponse = await fetch(`${baseUrl}/api/ai/generate-weekly-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          week_start: '2026-05-18',
          week_end: '2026-05-24',
        }),
      });

      assert.equal(generateResponse.status, 200);
      const generatedPayload = (await generateResponse.json()) as {
        report_id: string;
        created_at: string;
        report_url: string | null;
        summary: string;
      };
      assert.ok(generatedPayload.report_id);
      assert.ok(generatedPayload.created_at);
      assert.ok(generatedPayload.report_url);
      assert.ok(generatedPayload.report_url.startsWith(baseUrl));
      assert.match(generatedPayload.summary, /2026-05-18 through 2026-05-24/);

      const latestResponse = await fetch(`${baseUrl}/api/reports/latest`);
      assert.equal(latestResponse.status, 200);
      const latestPayload = (await latestResponse.json()) as {
        report: { id: string; weekStart: string; weekEnd: string; reportUrl?: string };
      };
      assert.equal(latestPayload.report.id, generatedPayload.report_id);
      assert.equal(latestPayload.report.weekStart, '2026-05-18');
      assert.equal(latestPayload.report.weekEnd, '2026-05-24');
      assert.equal(latestPayload.report.reportUrl, generatedPayload.report_url ?? undefined);

      const listResponse = await fetch(`${baseUrl}/api/reports`);
      assert.equal(listResponse.status, 200);
      const listPayload = (await listResponse.json()) as {
        reports: Array<{ id: string }>;
      };
      assert.equal(listPayload.reports[0]?.id, generatedPayload.report_id);
      // New accounts start empty, so only the just-generated report exists.
      assert.equal(listPayload.reports.length, 1);

      const exportResponse = await fetch(generatedPayload.report_url);
      assert.equal(exportResponse.status, 200);
      assert.match(exportResponse.headers.get('content-type') ?? '', /text\/markdown/);
      assert.match(await exportResponse.text(), /Weekly report/);
    });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('reports list paginates via ?limit and reports the unpaginated total header', async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-weekly-report-page-'));

  try {
    process.chdir(tempDir);
    resetWeeklyReportStoreForTests();

    await withServer(async (baseUrl) => {
      // Generate two reports in distinct weeks.
      for (const [start, end] of [
        ['2026-05-11', '2026-05-17'],
        ['2026-05-18', '2026-05-24'],
      ]) {
        const res = await fetch(`${baseUrl}/api/ai/generate-weekly-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week_start: start, week_end: end }),
        });
        assert.equal(res.status, 200);
      }

      // Full list: both, and the total header reflects the unpaginated count.
      const full = await fetch(`${baseUrl}/api/reports`);
      assert.equal(full.headers.get('X-Total-Count'), '2');
      assert.equal(((await full.json()) as { reports: unknown[] }).reports.length, 2);

      // Paginated: one item, but the total header still says 2.
      const paged = await fetch(`${baseUrl}/api/reports?limit=1`);
      assert.equal(paged.headers.get('X-Total-Count'), '2');
      const pagedBody = (await paged.json()) as { reports: Array<{ id: string }> };
      assert.equal(pagedBody.reports.length, 1);

      // The export uses a targeted lookup: a real id succeeds, a bogus one 404s
      // (previously it scanned the whole list).
      const exportOk = await fetch(`${baseUrl}/api/reports/${pagedBody.reports[0]!.id}/export`);
      assert.equal(exportOk.status, 200);
      const exportMissing = await fetch(`${baseUrl}/api/reports/does-not-exist/export`);
      assert.equal(exportMissing.status, 404);
    });
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});
