import { createHash, randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { getCoverLetter, saveCoverLetter, updateCoverLetter } from '@/data/cover-letter-store';
import { getJobById } from '@/data/job-store';
import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion } from '@/data/resume-version-store';
import { AiUnavailableError, normalizeStructuredResume, resolveCoverLetter } from '@/lib/agent-client';
import { requireUser } from '@/lib/auth';
import { attachmentDisposition } from '@/lib/content-disposition';
import { buildCoverLetterRequest } from '@/lib/cover-letter/answer';
import { groundLetter, LETTER_GROUNDING_VERSION, unresolvedFlags } from '@/lib/cover-letter/ground';
import { countWords, letterTooLong, MAX_GENERATED_WORDS, MAX_LETTER_CHARS, MAX_PARAGRAPH_CHARS, TARGET_WORDS } from '@/lib/cover-letter/limits';
import { renderCoverLetter, type CoverLetterPdfOptions } from '@/lib/cover-letter-pdf';
import { companyName } from '@/lib/tailor/ground';
import { editableLines } from '@/lib/tailor/lines';
import { parseConfirmedKeywords, postingKeywords } from '@/lib/tailor/request';
import type { CoverLetterLength, CoverLetterRecord, JobRecord, StructuredResume } from '@/types';

/**
 * The cover letter (#416), written in the tailor window: Concise (about 150–200 words) or Full
 * (about 300–400), one per job, always one page. The AI writes the body; the API keeps only the
 * sentences its check can ground in the base résumé, the confirmed keywords and the posting
 * (lib/cover-letter/ground.ts), and adds the letterhead, date, greeting and sign-off when it
 * prints. Each paragraph can then be edited: the user's words are theirs, and not checked.
 */
export const coverLetterRouter = Router();

const LENGTHS = new Set<CoverLetterLength>(['concise', 'full']);
// A paragraph is plain text: no control, format or separator characters (see tailor/request.ts).
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;

const LETTER_CHANGED = {
  code: 'LETTER_CHANGED',
  error: 'This letter changed in another tab. Reload the page to see it.',
};
const LETTER_TOO_LONG = 'LETTER_TOO_LONG';
const PARAGRAPH_CHANGED = {
  code: 'PARAGRAPH_CHANGED',
  error: 'That paragraph changed or moved in another tab. Reload the page to see the letter as it is.',
};

/** The paragraph's text as the page read it: given and different means the page meant another one. */
function paragraphMoved(expected: unknown, current: string): boolean {
  return expected !== undefined && (typeof expected !== 'string' || expected !== current);
}

/** The base résumé as Settings shows it: the profile's copy, else the base version. */
async function baseResumeOf(userId: string) {
  const [profile, baseVersion] = await Promise.all([getUserProfile(userId), getBaseResumeVersion(userId)]);
  const base = normalizeStructuredResume(profile?.baseResume ?? baseVersion?.structuredResume ?? null);
  return { base, baseVersion, profile };
}

/** "2026-10-15" → "October 15, 2026"; anything else → today's date. */
function letterDate(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : new Date();
  const valid = match && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
  return (valid ? date : new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** The letter as it prints: the base résumé's name and contact line around its paragraphs. */
function pdfOptions(paragraphs: string[], base: StructuredResume | null, job: JobRecord, date?: unknown): CoverLetterPdfOptions {
  const basics = base?.basics;
  const name = basics?.name?.trim() || 'Candidate';
  const place = [basics?.location?.city, basics?.location?.region].map((part) => part?.trim()).filter(Boolean).join(', ');
  const company = companyName(job.company) || job.company.trim();
  return {
    candidateName: name,
    candidateEmail: basics?.email?.trim() || undefined,
    candidatePhone: basics?.phone?.trim() || undefined,
    candidateLocation: place || undefined,
    // No recipient's name: the app never makes up a contact (SPEC rule 1).
    companyName: job.company.trim() || undefined,
    subject: job.title.trim() || undefined,
    date: letterDate(date),
    bodyText: [company ? `Dear ${company} hiring team,` : 'Dear hiring team,', ...paragraphs, `Sincerely,\n${name}`].join('\n\n'),
  };
}

async function pagesOf(paragraphs: string[], base: StructuredResume | null, job: JobRecord): Promise<number> {
  return (await renderCoverLetter(pdfOptions(paragraphs, base, job))).pages;
}

/** An ISO time, as a letter's updatedAt is. */
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

/** The job, or a 404 sent. */
async function jobFor(userId: string, jobId: string, response: Response): Promise<JobRecord | null> {
  const job = await getJobById(userId, jobId);
  if (!job) {
    response.status(404).json({ error: `Job not found: ${jobId}` });
    return null;
  }
  return job;
}

/**
 * POST /api/jobs/:id/cover-letter   body: { length: 'concise' | 'full', confirmedKeywords?: string[] }
 *
 * Writes the job's cover letter, replacing the one it had. `confirmedKeywords` are the keywords
 * the user said they have in the tailor window, which the letter may use, marked as theirs.
 *
 * - 409 BASE_RESUME_EMPTY / POSTING_EMPTY: nothing to write from; the AI is not called.
 * - 422 POSTING_REFUSED: the posting looks like instructions to the AI.
 * - 503 retryable: the AI couldn't answer usefully (down, an unusable answer, a letter the check
 *   cut to less than half the length asked for, or one too long for one page). Nothing is written.
 * The strict limiter and the AI budget are mounted in app.ts (route inventory, #345).
 */
coverLetterRouter.post('/jobs/:id/cover-letter', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;

    const body = (request.body ?? {}) as { length?: unknown; confirmedKeywords?: unknown };
    if (!LENGTHS.has(body.length as CoverLetterLength)) {
      return response.status(400).json({ error: "length must be 'concise' or 'full'." });
    }
    const length = body.length as CoverLetterLength;
    const confirmedKeywords = parseConfirmedKeywords(body.confirmedKeywords);
    if (!confirmedKeywords) {
      return response.status(400).json({ error: 'confirmedKeywords must be a list of up to 25 keywords of up to 60 characters.' });
    }

    const { base, baseVersion, profile } = await baseResumeOf(userId);
    if (!base || editableLines(base).length === 0) {
      return response.status(409).json({
        code: 'BASE_RESUME_EMPTY',
        error: 'Add a summary or work experience with bullet points in Settings → Résumé before writing a cover letter.',
      });
    }
    if (!job.descriptionText?.trim()) {
      return response.status(409).json({
        code: 'POSTING_EMPTY',
        error: 'This job has no posting text to write to. Add the job description first.',
      });
    }

    const answer = await resolveCoverLetter(buildCoverLetterRequest(base, job, confirmedKeywords, length));
    // Trying again can't help a refused posting, and each try is a paid call.
    if (answer.refused) {
      return response.status(422).json({
        code: 'POSTING_REFUSED',
        error: "This posting seems to contain instructions to the AI, so no letter was written. Check the job description.",
      });
    }

    // An answer far longer than any letter isn't one: refused before the check reads it.
    const total = answer.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
    if (total > 3 * MAX_LETTER_CHARS || answer.paragraphs.some((paragraph) => paragraph.length > 2 * MAX_PARAGRAPH_CHARS)) {
      throw new AiUnavailableError("The AI's answer was far longer than a letter, so it wasn't read. Try again.");
    }
    const grounded = groundLetter(answer.paragraphs, { base, job, jobTerms: postingKeywords(job), confirmedKeywords });
    const words = grounded.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0);
    // Less than half of the length asked for is left: most of what the AI wrote was dropped.
    // Flagged sentences are still in the letter, so only drops count here.
    if (words < Math.ceil(TARGET_WORDS[length].min / 2)) {
      throw new AiUnavailableError("Most of the AI's letter said things your base résumé doesn't, so it wasn't kept. Try again.");
    }
    if (words > MAX_GENERATED_WORDS[length] || letterTooLong(grounded.paragraphs)) {
      throw new AiUnavailableError(`The AI wrote a letter too long for a ${length} one. Try again.`);
    }
    // Saved only as it will print: on one page.
    if ((await pagesOf(grounded.paragraphs, base, job)) > 1) {
      throw new AiUnavailableError('The AI wrote a letter too long for one page. Try again.');
    }

    const now = new Date().toISOString();
    const letter: CoverLetterRecord = {
      id: randomUUID(),
      userId,
      jobId: job.id,
      length,
      paragraphs: grounded.paragraphs.map((text) => ({ text, edited: false })),
      checks: grounded.checks,
      basedOn: {
        baseVersionId: baseVersion?.id ?? null,
        baseUpdatedAt: baseVersion?.updatedAt ?? profile?.updatedAt ?? null,
        jobId: job.id,
        postingSha256: createHash('sha256').update(job.descriptionText).digest('hex'),
        model: answer.model_used,
        createdAt: now,
        grounding: { version: LETTER_GROUNDING_VERSION },
        confirmedKeywords,
      },
      createdAt: now,
      updatedAt: now,
    };
    return response.status(201).json({ coverLetter: await saveCoverLetter(letter) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/jobs/:id/cover-letter → { coverLetter: the job's letter, or null }. */
coverLetterRouter.get('/jobs/:id/cover-letter', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;
    return response.json({ coverLetter: await getCoverLetter(userId, job.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/jobs/:id/cover-letter/paragraphs/:index   body: { text, expectedText?, updatedAt? }
 *
 * The user's own words for one paragraph: saved as theirs, not checked. The letter must still fit
 * on one page (400 LETTER_TOO_LONG). `expectedText` is the paragraph as the page read it: if the
 * paragraph at `index` is another one now, 409 PARAGRAPH_CHANGED. With `updatedAt`, only onto
 * the letter as it was read (409 LETTER_CHANGED otherwise).
 */
coverLetterRouter.patch('/jobs/:id/cover-letter/paragraphs/:index', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;
    const letter = await getCoverLetter(userId, job.id);
    if (!letter) {
      return response.status(404).json({ error: 'This job has no cover letter yet.' });
    }
    const index = Number(request.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= letter.paragraphs.length) {
      return response.status(404).json({ error: `Paragraph not found: ${request.params.index}` });
    }

    const body = (request.body ?? {}) as { text?: unknown; expectedText?: unknown; updatedAt?: unknown };
    if (paragraphMoved(body.expectedText, letter.paragraphs[index]!.text)) return response.status(409).json(PARAGRAPH_CHANGED);
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > MAX_PARAGRAPH_CHARS || NOT_PLAIN.test(text)) {
      return response.status(400).json({
        error: `text must be a paragraph of plain text, up to ${MAX_PARAGRAPH_CHARS.toLocaleString('en-US')} characters.`,
      });
    }
    if (body.updatedAt !== undefined && !isTimestamp(body.updatedAt)) {
      return response.status(400).json({ error: 'updatedAt must be the letter’s updatedAt.' });
    }

    const paragraphs = letter.paragraphs.map((paragraph, i) => (i === index ? { text, edited: true } : paragraph));
    // The user's words are theirs: the paragraph's flags are settled by the edit.
    const checks = letter.checks.map((check) =>
      check.severity === 'flag' && check.paragraph === index && !check.resolution ? { ...check, resolution: 'edited' as const } : check,
    );
    const texts = paragraphs.map((paragraph) => paragraph.text);
    const tooLong = letterTooLong(texts);
    if (tooLong) return response.status(400).json({ code: LETTER_TOO_LONG, error: tooLong });
    const { base } = await baseResumeOf(userId);
    if ((await pagesOf(texts, base, job)) > 1) {
      return response.status(400).json({ code: LETTER_TOO_LONG, error: 'This would make the letter longer than one page. Shorten it.' });
    }

    const updated = await updateCoverLetter(
      userId,
      job.id,
      { paragraphs, checks },
      { expect: { updatedAt: (body.updatedAt as string | undefined) ?? letter.updatedAt } },
    );
    if (!updated) return response.status(409).json(LETTER_CHANGED);
    return response.json({ coverLetter: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/jobs/:id/cover-letter/paragraphs/:index   body: { expectedText?, updatedAt? }
 *
 * Removes one paragraph, and the check's marks on it. A letter keeps at least one (400).
 * `expectedText` and `updatedAt` (also accepted in the query) work as for PATCH.
 */
coverLetterRouter.delete('/jobs/:id/cover-letter/paragraphs/:index', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;
    const letter = await getCoverLetter(userId, job.id);
    if (!letter) {
      return response.status(404).json({ error: 'This job has no cover letter yet.' });
    }
    const index = Number(request.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= letter.paragraphs.length) {
      return response.status(404).json({ error: `Paragraph not found: ${request.params.index}` });
    }
    if (letter.paragraphs.length === 1) {
      return response.status(400).json({ error: 'A letter keeps at least one paragraph. Edit it, or write the letter again.' });
    }
    const body = (request.body ?? {}) as { expectedText?: unknown; updatedAt?: unknown };
    if (paragraphMoved(body.expectedText ?? request.query.expectedText, letter.paragraphs[index]!.text)) {
      return response.status(409).json(PARAGRAPH_CHANGED);
    }
    const updatedAt = body.updatedAt ?? request.query.updatedAt;
    if (updatedAt !== undefined && !isTimestamp(updatedAt)) {
      return response.status(400).json({ error: 'updatedAt must be the letter’s updatedAt.' });
    }
    const expected = (updatedAt as string | undefined) ?? letter.updatedAt;

    const paragraphs = letter.paragraphs.filter((_paragraph, i) => i !== index);
    // Marks on the removed paragraph go; later ones move up. A dropped sentence stays listed.
    const checks = letter.checks.flatMap((check) => {
      if (check.paragraph === null || check.paragraph < index) return [check];
      if (check.paragraph > index) return [{ ...check, paragraph: check.paragraph - 1 }];
      return check.dropped ? [{ ...check, paragraph: null }] : [];
    });
    const updated = await updateCoverLetter(userId, job.id, { paragraphs, checks }, { expect: { updatedAt: expected } });
    if (!updated) return response.status(409).json(LETTER_CHANGED);
    return response.json({ coverLetter: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/jobs/:id/cover-letter/checks/:checkId   body: { action: 'keep' | 'remove', expectedText?, updatedAt? }
 *
 * The user's answer to a flagged sentence (#416): keep it, or remove it from its paragraph (the
 * paragraph goes too when it was its only sentence, unless it is the letter's last). `expectedText`
 * is the paragraph as the page shows it, as for an edit: 409 PARAGRAPH_CHANGED if it moved.
 */
coverLetterRouter.patch('/jobs/:id/cover-letter/checks/:checkId', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;
    const letter = await getCoverLetter(userId, job.id);
    const check = letter?.checks.find((found) => found.id === request.params.checkId && found.severity === 'flag');
    if (!letter || !check || check.paragraph === null) {
      return response.status(404).json({ error: `Flag not found: ${request.params.checkId}` });
    }
    const body = (request.body ?? {}) as { action?: unknown; expectedText?: unknown; updatedAt?: unknown };
    if (body.action !== 'keep' && body.action !== 'remove') {
      return response.status(400).json({ error: "action must be 'keep' or 'remove'." });
    }
    if (body.updatedAt !== undefined && !isTimestamp(body.updatedAt)) {
      return response.status(400).json({ error: 'updatedAt must be the letter’s updatedAt.' });
    }
    const index = check.paragraph;
    const paragraph = letter.paragraphs[index];
    if (!paragraph || paragraphMoved(body.expectedText, paragraph.text) || !paragraph.text.includes(check.text)) {
      return response.status(409).json(PARAGRAPH_CHANGED);
    }

    let paragraphs = letter.paragraphs;
    let checks = letter.checks.map((found) => (found.id === check.id ? { ...found, resolution: body.action === 'keep' ? ('kept' as const) : ('removed' as const) } : found));
    if (body.action === 'remove') {
      const text = paragraph.text.replace(check.text, ' ').replace(/\s+/g, ' ').trim();
      if (text) {
        paragraphs = letter.paragraphs.map((p, i) => (i === index ? { ...p, text } : p));
      } else if (letter.paragraphs.length === 1) {
        return response.status(400).json({ error: 'A letter keeps at least one paragraph. Edit it, or write the letter again.' });
      } else {
        // Its only sentence: the paragraph goes, and later marks move up.
        paragraphs = letter.paragraphs.filter((_p, i) => i !== index);
        checks = checks.flatMap((found) => {
          if (found.paragraph === null || found.paragraph < index) return [found];
          if (found.paragraph > index) return [{ ...found, paragraph: found.paragraph - 1 }];
          return found.id === check.id || found.dropped ? [{ ...found, paragraph: null }] : [];
        });
      }
    }
    const updated = await updateCoverLetter(
      userId,
      job.id,
      { paragraphs, checks },
      { expect: { updatedAt: (body.updatedAt as string | undefined) ?? letter.updatedAt } },
    );
    if (!updated) return response.status(409).json(LETTER_CHANGED);
    return response.json({ coverLetter: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/:id/cover-letter/download?date=YYYY-MM-DD
 *
 * The letter as a one-page PDF, "First Last – Company – Cover letter.pdf", dated `date` (the
 * user's local date; the server's otherwise).
 */
coverLetterRouter.get('/jobs/:id/cover-letter/download', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const job = await jobFor(userId, request.params.id!, response);
    if (!job) return;
    const letter = await getCoverLetter(userId, job.id);
    if (!letter) {
      return response.status(404).json({ error: 'This job has no cover letter yet.' });
    }

    const unresolved = unresolvedFlags(letter).length;
    if (unresolved > 0) {
      return response.status(409).json({
        code: 'FLAGS_UNRESOLVED',
        error: `Keep or remove the ${unresolved === 1 ? 'highlighted sentence' : `${unresolved} highlighted sentences`} before you download.`,
      });
    }

    const { base } = await baseResumeOf(userId);
    const options = pdfOptions(
      letter.paragraphs.map((paragraph) => paragraph.text),
      base,
      job,
      request.query.date,
    );
    const { pdf, pages, unsupported } = await renderCoverLetter(options);
    // Every saved letter fits; a base résumé with a far longer name or contact line could still
    // push one over, and a letter is never cut.
    if (pages > 1) {
      return response.status(422).json({ code: LETTER_TOO_LONG, error: "This letter doesn't fit on one page. Shorten a paragraph." });
    }

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Page-Count', String(pages));
    // Characters the font can't print (CJK, emoji), shown as "?" (#429).
    response.setHeader('X-Pdf-Unsupported-Characters', String(unsupported));
    const company = companyName(job.company) || job.company.trim().replace(/\.+$/, '');
    response.setHeader(
      'Content-Disposition',
      attachmentDisposition(`${options.candidateName} – ${company || 'Company'} – Cover letter.pdf`),
    );
    return response.send(pdf);
  } catch (error) {
    next(error);
  }
});
