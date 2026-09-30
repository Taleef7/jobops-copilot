import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createApp } from './app';
import { getUserProfile } from '@/data/profile-store';
import { extractPdfText, PdfUnreadableError } from '@/lib/pdf-text';
import { buildPdf, fakePng } from '@/test-support/pdf-fixtures';

/**
 * #389: the résumé upload accepts one real PDF from a signed-in user, and reads it off the
 * event loop with a time and memory limit, so a hostile PDF can't stall the API.
 */
async function withApi(run: (base: string) => Promise<void>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-upload-'));
  delete process.env.DATABASE_URL;
  process.chdir(tempDir);
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

const USER = 'u_upload';

function upload(base: string, files: Array<{ data: Buffer; type: string; name: string }>, user: string | null = USER) {
  const form = new FormData();
  for (const file of files) form.append('file', new Blob([file.data], { type: file.type }), file.name);
  return fetch(`${base}/api/profile/resume`, {
    method: 'POST',
    headers: user ? { 'X-User-Id': user } : {},
    body: form,
  });
}

const pdf = (data: Buffer) => ({ data, type: 'application/pdf', name: 'resume.pdf' });

test('a real PDF résumé is read and stored', async () => {
  await withApi(async (base) => {
    const response = await upload(base, [pdf(buildPdf(['Backend engineer. Go, Postgres, Kafka.', 'Education: BSc']))]);
    assert.equal(response.status, 200);
    const profile = await getUserProfile(USER);
    assert.match(profile?.resumeText ?? '', /Backend engineer\. Go, Postgres, Kafka\./);
    assert.equal(profile?.resumeFileName, 'resume.pdf');
  });
});

test('uploads are refused before anything is read: sign-in, type, size and count', async () => {
  await withApi(async (base) => {
    // Sign-in is checked before multer reads the body (requireSignedIn); tests run with the
    // development user fallback, so a missing sign-in can't produce a 401 here.
    const png = await upload(base, [{ data: fakePng(), type: 'application/pdf', name: 'resume.pdf' }]);
    assert.equal(png.status, 415, 'a PNG renamed to .pdf');
    assert.match(((await png.json()) as { error: string }).error, /PDF/);
    assert.equal((await upload(base, [{ data: Buffer.from('plain text'), type: 'text/plain', name: 'resume.txt' }])).status, 415);

    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024, 32)]);
    const tooBig = await upload(base, [pdf(big)]);
    assert.equal(tooBig.status, 413);
    assert.match(((await tooBig.json()) as { error: string }).error, /5 MB/);

    assert.equal((await upload(base, [pdf(buildPdf(['a'])), pdf(buildPdf(['b']))])).status, 400, 'one file only');
    assert.equal(await getUserProfile(USER), undefined, 'nothing was stored');
  });
});

test('a 2,000-page PDF is refused quickly while the API keeps answering', async () => {
  const pages = Array.from({ length: 2000 }, (_, index) => `Page ${index + 1} of a very long document.`);
  await withApi(async (base) => {
    const started = Date.now();
    const uploading = upload(base, [pdf(buildPdf(pages))]);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const response = await uploading;
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { error: string }).error, /10 pages/);
    assert.ok(Date.now() - started < 10_000, 'within 10 seconds');
  });
});

test('extraction stops at the page limit, the text limit and the time limit', async () => {
  const short = await extractPdfText(buildPdf(['One', 'Two']));
  assert.equal(short.pages, 2);
  assert.equal(short.truncated, false);
  assert.match(short.text, /One/);

  // The text is cut inside the worker: what crosses to the main thread is already capped.
  const posted: number[] = [];
  const emit = Worker.prototype.emit;
  Worker.prototype.emit = function (this: Worker, event: string | symbol, ...args: unknown[]) {
    const message = args[0] as { text?: unknown } | undefined;
    if (event === 'message' && typeof message?.text === 'string') posted.push(message.text.length);
    return emit.call(this, event, ...args);
  };
  let long;
  try {
    long = await extractPdfText(buildPdf(Array.from({ length: 8 }, () => 'word '.repeat(2_000))), { maxChars: 20_000 });
  } finally {
    Worker.prototype.emit = emit;
  }
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, 20_000);
  assert.deepEqual(posted, [20_000]);

  await assert.rejects(extractPdfText(buildPdf(Array.from({ length: 11 }, () => 'p'))), PdfUnreadableError);
  await assert.rejects(extractPdfText(buildPdf(['slow']), { timeoutMs: 1 }), PdfUnreadableError);
  await assert.rejects(extractPdfText(Buffer.from('%PDF-1.4 not really a pdf')), PdfUnreadableError);
});

test('a PDF sent with no type, or as octet-stream, is judged by its bytes', async () => {
  await withApi(async (base) => {
    const bytes = buildPdf(['Backend engineer. Go.']);
    assert.equal((await upload(base, [{ data: bytes, type: 'application/octet-stream', name: 'resume.pdf' }])).status, 200);
    assert.equal((await upload(base, [{ data: bytes, type: '', name: 'resume.pdf' }])).status, 200);
    // Unknown type, but not a PDF inside: the byte check refuses it.
    assert.equal((await upload(base, [{ data: fakePng(), type: 'application/octet-stream', name: 'resume.pdf' }])).status, 415);
    // A declared non-PDF type is refused up front.
    assert.equal((await upload(base, [{ data: bytes, type: 'image/png', name: 'resume.png' }])).status, 415);
  });
});

test('extraction stops when the process grows past the memory budget', async () => {
  // Inflated streams live outside the V8 heap, so the worker's heap limit doesn't bound
  // them: a watchdog stops the worker when the process's memory grows too far.
  let reading = 0;
  await assert.rejects(
    extractPdfText(buildPdf(['A page']), {
      memory: { budgetBytes: 100 * 1024 * 1024, intervalMs: 1, read: () => (reading += 64 * 1024 * 1024) },
    }),
    (error: unknown) => error instanceof PdfUnreadableError && /memory/i.test(error.message),
  );
});

// #350: Settings shows what was read from the PDF, so a misread is visible before it spreads.
test('the upload answers with the text it read, and only the owner can read it back', async () => {
  await withApi(async (base) => {
    const response = await upload(base, [pdf(buildPdf(['Backend engineer. Go, Postgres, Kafka.']))]);
    const body = (await response.json()) as { profile: Record<string, unknown>; resumeText?: string };
    assert.equal(response.status, 200);
    assert.match(body.resumeText ?? '', /Backend engineer\. Go, Postgres, Kafka\./);
    assert.equal(body.profile.resumeText, undefined, 'the profile itself still never carries the text');

    const mine = await fetch(`${base}/api/profile/resume-text`, { headers: { 'X-User-Id': USER } });
    assert.equal(mine.status, 200);
    const read = (await mine.json()) as { resumeText: string | null; resumeFileName: string | null };
    assert.match(read.resumeText ?? '', /Backend engineer/);
    assert.equal(read.resumeFileName, 'resume.pdf');

    const other = await fetch(`${base}/api/profile/resume-text`, { headers: { 'X-User-Id': 'u_someone_else' } });
    assert.deepEqual(await other.json(), { resumeText: null, resumeFileName: null, updatedAt: null });
  });
});

// #350: replacing a résumé from Settings reads the file without storing it, so cancelling the
// check leaves the old résumé in place (discovery scores against the stored text).
test('a preview upload reads the PDF without replacing the stored résumé', async () => {
  await withApi(async (base) => {
    await upload(base, [pdf(buildPdf(['Old resume: Go, Postgres.']))]);

    const form = new FormData();
    form.append('file', new Blob([buildPdf(['New resume: Rust, Kafka.'])], { type: 'application/pdf' }), 'new.pdf');
    const preview = await fetch(`${base}/api/profile/resume?preview=1`, { method: 'POST', headers: { 'X-User-Id': USER }, body: form });
    assert.equal(preview.status, 200);
    const body = (await preview.json()) as { resumeText: string; resumeFileName: string };
    assert.match(body.resumeText, /New resume: Rust, Kafka\./);
    assert.equal(body.resumeFileName, 'new.pdf');

    const stored = await getUserProfile(USER);
    assert.match(stored?.resumeText ?? '', /Old resume/);
    assert.equal(stored?.resumeFileName, 'resume.pdf');
  });
});

test('confirmed text is stored with the name of the file it came from', async () => {
  await withApi(async (base) => {
    const response = await fetch(`${base}/api/profile/resume`, {
      method: 'POST',
      headers: { 'X-User-Id': USER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume_text: 'New résumé: Rust, Kafka.', resume_file_name: 'new.pdf' }),
    });
    assert.equal(response.status, 200);
    const stored = await getUserProfile(USER);
    assert.equal(stored?.resumeText, 'New résumé: Rust, Kafka.');
    assert.equal(stored?.resumeFileName, 'new.pdf');
  });
});
