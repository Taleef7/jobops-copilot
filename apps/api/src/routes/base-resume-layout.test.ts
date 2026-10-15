import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { baseResumeRouter } from './base-resume';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion, listResumeVersionsForUser, resetResumeVersionStore } from '@/data/resume-version-store';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { readPdf } from '@/test-support/pdf-read';
import type { ResumeLayout, StructuredResume } from '@/types';

/**
 * The base résumé's layout (#415): its sections' order, headings and visibility, saved on
 * their own, kept by every other save, and a preview of the PDF that stores nothing.
 */

type Send = (method: string, path: string, body?: unknown, user?: string) => Promise<Response>;

async function withApi(run: (send: Send) => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-base-layout-'));
  process.chdir(tempDir);
  await resetResumeVersionStore();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const header = request.header('X-User-Id');
    if (header) request.userId = header.trim();
    next();
  });
  app.use('/api/profile/base-resume', baseResumeRouter);
  app.use(apiErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  const send: Send = (method, path, body, user = 'user-layout') =>
    fetch(`http://127.0.0.1:${address.port}/api/profile/base-resume${path}`, {
      method,
      headers: { 'X-User-Id': user, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    await run(send);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    await resetResumeVersionStore();
    await rm(tempDir, { recursive: true, force: true });
  }
}

const resume: StructuredResume = {
  basics: { name: 'Zoë Núñez', email: 'zoe@example.com', summary: 'Backend engineer who builds payment APIs.' },
  work: [{ company: 'Globex', position: 'Backend Engineer', startDate: '2022-01', current: true, highlights: ['Built the billing API'] }],
  education: [{ institution: 'University of Texas', studyType: 'BSc', area: 'Computer Science', endDate: '2019' }],
  skills: [{ category: 'Languages', skills: ['Go', 'Python'] }],
  projects: [{ name: 'Ledger Side Project', description: 'A double-entry ledger.' }],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', date: '2024-03' }],
};

// The layout from the issue's acceptance: Skills first and renamed, Projects hidden.
const LAYOUT: ResumeLayout = {
  sections: [
    { key: 'skills', title: 'Technical Skills' },
    { key: 'education' },
    { key: 'work', title: 'Professional Experience' },
    { key: 'summary' },
    { key: 'projects', hidden: true },
    { key: 'certificates' },
  ],
};

const savedLayout = async (send: Send) =>
  ((await (await send('GET', '')).json()) as { baseResume: StructuredResume }).baseResume.layout;

test('PATCH /layout saves the order, headings and hidden sections to both copies, and reads them back', async () => {
  await withApi(async (send) => {
    assert.equal((await send('PUT', '', { baseResume: resume })).status, 200);
    const patched = await send('PATCH', '/layout', LAYOUT);
    assert.equal(patched.status, 200);
    assert.deepEqual(((await patched.json()) as { layout: ResumeLayout }).layout, LAYOUT);

    assert.deepEqual(await savedLayout(send), LAYOUT);
    assert.deepEqual((await getUserProfile('user-layout'))?.baseResume?.layout, LAYOUT);
    // The base version's copy too: the résumé studio and outreach read it first.
    assert.deepEqual((await getBaseResumeVersion('user-layout'))?.structuredResume.layout, LAYOUT);
    // Only the layout changed.
    assert.deepEqual((await getUserProfile('user-layout'))!.baseResume, { ...resume, layout: LAYOUT });
  });
});

test('PATCH /layout changes only what it is sent: a page size keeps the sections', async () => {
  await withApi(async (send) => {
    await send('PUT', '', { baseResume: resume });
    await send('PATCH', '/layout', LAYOUT);
    const patched = await send('PATCH', '/layout', { pageSize: 'a4' });
    assert.equal(patched.status, 200);
    assert.deepEqual(await savedLayout(send), { ...LAYOUT, pageSize: 'a4' });
  });
});

test('PATCH /layout refuses a malformed layout with 400 and changes nothing', async () => {
  await withApi(async (send) => {
    await send('PUT', '', { baseResume: resume });
    await send('PATCH', '/layout', LAYOUT);
    for (const body of [
      { sections: [{ key: 'awards' }] },
      { sections: [{ key: 'skills' }, { key: 'skills' }] },
      { sections: [{ key: 'skills', hidden: 'yes' }] },
      { pageSize: 'legal' },
      {},
    ]) {
      const response = await send('PATCH', '/layout', body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.ok(((await response.json()) as { error: string }).error);
    }
    assert.deepEqual(await savedLayout(send), LAYOUT);
  });
});

test('PATCH /layout before there is a résumé is a 404, and creates nothing', async () => {
  await withApi(async (send) => {
    assert.equal((await send('PATCH', '/layout', LAYOUT)).status, 404);
    assert.equal((await getUserProfile('user-layout'))?.baseResume ?? null, null);
    assert.equal(await getBaseResumeVersion('user-layout'), null);
  });
});

test('a section save keeps the layout, and so does a résumé replaced from a file', async () => {
  await withApi(async (send) => {
    await send('PUT', '', { baseResume: resume });
    await send('PATCH', '/layout', LAYOUT);

    // A save from Settings: the layout it carries (another tab's, an old one) doesn't count.
    const edited = { ...resume, basics: { ...resume.basics, summary: 'Edited.' }, layout: { sections: [{ key: 'work' }] } };
    const saved = await send('PUT', '', { baseResume: edited });
    assert.equal(saved.status, 200);
    assert.deepEqual(((await saved.json()) as { baseResume: StructuredResume }).baseResume.layout, LAYOUT);
    assert.deepEqual(await savedLayout(send), LAYOUT);

    // Replaced from a file: the résumé read from it has no layout, and keeps the user's.
    const parsed: StructuredResume = { ...resume, projects: undefined };
    const replaced = await send('PUT', '', { baseResume: parsed, resumeText: 'Zoë Núñez\nBackend engineer', resumeFileName: 'new.pdf' });
    assert.equal(replaced.status, 200);
    assert.deepEqual(((await replaced.json()) as { baseResume: StructuredResume }).baseResume.layout, LAYOUT);
    const profile = await getUserProfile('user-layout');
    assert.deepEqual(profile?.baseResume?.layout, LAYOUT);
    assert.equal(profile?.baseResume?.projects, undefined, 'the rest is replaced');
    assert.deepEqual((await getBaseResumeVersion('user-layout'))?.structuredResume.layout, LAYOUT);
  });
});

test('a save before any layout stores none, whatever the body carries', async () => {
  await withApi(async (send) => {
    const saved = await send('PUT', '', { baseResume: { ...resume, layout: LAYOUT } });
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { baseResume: StructuredResume }).baseResume.layout, undefined);
    assert.equal(await savedLayout(send), undefined);
  });
});

test('GET /pdf renders the saved résumé in its layout, with its page count, and stores nothing', async () => {
  await withApi(async (send) => {
    await send('PUT', '', { baseResume: resume });
    await send('PATCH', '/layout', LAYOUT);
    const profileBefore = await getUserProfile('user-layout');
    const versionsBefore = await listResumeVersionsForUser('user-layout');

    const response = await send('GET', '/pdf');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('x-page-count'), '1');
    assert.equal(response.headers.get('x-pdf-unsupported-characters'), '0');
    // "First Last – Résumé.pdf", with the name outside ASCII kept in filename*.
    assert.match(response.headers.get('content-disposition') ?? '', /filename\*=UTF-8''Zo%C3%AB%20N%C3%BA%C3%B1ez%20%E2%80%93%20R%C3%A9sum%C3%A9\.pdf/);

    const { text } = await readPdf(Buffer.from(await response.arrayBuffer()));
    const at = (heading: string) => text.indexOf(heading);
    const order = ['Technical Skills', 'Education', 'Professional Experience', 'Summary', 'Certifications'];
    for (const heading of order) assert.ok(at(heading) >= 0, `${heading} is printed:\n${text}`);
    assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order, text);
    assert.ok(!text.includes('Projects') && !text.includes('Ledger Side Project'), 'the hidden section is left out');

    // Nothing written: no version row, no file, no change to the profile.
    assert.deepEqual(await listResumeVersionsForUser('user-layout'), versionsBefore);
    assert.deepEqual(await getUserProfile('user-layout'), profileBefore);
  });
});

test('GET /pdf follows a layout change at once', async () => {
  await withApi(async (send) => {
    await send('PUT', '', { baseResume: resume });
    await send('PATCH', '/layout', LAYOUT);
    await send('PATCH', '/layout', { sections: [{ key: 'education', title: 'Schooling' }, { key: 'projects' }] });
    const { text } = await readPdf(Buffer.from(await (await send('GET', '/pdf')).arrayBuffer()));
    assert.ok(text.indexOf('Schooling') >= 0 && text.indexOf('Schooling') < text.indexOf('Projects'), text);
    assert.ok(text.includes('Ledger Side Project'));
    assert.ok(!text.includes('Technical Skills'));
  });
});

test('GET /pdf with no résumé is a 404, and is per user', async () => {
  await withApi(async (send) => {
    assert.equal((await send('GET', '/pdf')).status, 404);
    await send('PUT', '', { baseResume: resume });
    assert.equal((await send('GET', '/pdf', undefined, 'someone-else')).status, 404);
    assert.equal((await send('GET', '/pdf')).status, 200);
  });
});
