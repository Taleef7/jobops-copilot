import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getJobById } from '@/data/job-store';
import { changeBaseResume, getUserProfile } from '@/data/profile-store';
import {
  getBaseResumeVersion,
  getResumeVersion,
  insertResumeVersion,
  listResumeVersionsForJob,
  updateResumeVersion,
} from '@/data/resume-version-store';
import { AiUnavailableError, normalizeStructuredResume, resolveTailorResume } from '@/lib/agent-client';
import { renderAtsResumePdf, renderResumePdf } from '@/lib/ats-resume-pdf';
import { requireUser } from '@/lib/auth';
import { storeResumePdf } from '@/lib/resume-storage';
import { addSkills, GROUNDING_VERSION, isGrounded, skillGroup, tailorFromAnswer } from '@/lib/tailor/apply';
import { isInjectionRefusal } from '@/lib/tailor/answer';
import { keywordCount, keywordCoverage, keywordsOnResume, keywordTerms } from '@/lib/tailor/keywords';
import { editableLines, setLine } from '@/lib/tailor/lines';
import { attachmentDisposition } from '@/lib/content-disposition';
import { buildTailorRequest, parseConfirmedKeywords, postingKeywords } from '@/lib/tailor/request';
import { norm } from '@/lib/tailor/text';
import type { ResumeVersionRecord } from '@/types';

export const resumeStudioRouter = Router();

const NOT_GROUNDED = {
  code: 'NOT_GROUNDED',
  error: "This draft wasn't checked against your base résumé, so it can't be used. Tailor it again.",
};

/**
 * POST /api/jobs/:id/tailor   body: { confirmedKeywords?: string[] }
 *
 * Tailors the base résumé to the job's posting (#351). The AI suggests edits to the summary
 * and bullets; the API applies the ones its grounding check accepts (lib/tailor) and saves a
 * draft that records what it was based on. A suggestion that adds a fact is dropped and shown
 * as dropped. `confirmedKeywords` are keywords the user said they have in the tailor window.
 *
 * - 409 BASE_RESUME_EMPTY / POSTING_EMPTY: nothing to tailor; the AI is not called.
 * - 503 retryable: the AI couldn't answer usefully; nothing is saved.
 * The strict limiter and the AI budget are mounted in app.ts (route inventory, #345).
 */
resumeStudioRouter.post('/jobs/:id/tailor', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id!;
    const job = await getJobById(userId, jobId);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${jobId}` });
    }

    const body = (request.body ?? {}) as { confirmedKeywords?: unknown; addToBase?: unknown };
    const confirmedKeywords = parseConfirmedKeywords(body.confirmedKeywords);
    if (!confirmedKeywords) {
      return response.status(400).json({ error: 'confirmedKeywords must be a list of up to 25 keywords of up to 60 characters.' });
    }
    if (body.addToBase !== undefined && typeof body.addToBase !== 'boolean') {
      return response.status(400).json({ error: 'addToBase must be true or false.' });
    }

    // The base résumé as Settings shows it: the profile's copy, else the base version.
    const [profile, baseVersion] = await Promise.all([getUserProfile(userId), getBaseResumeVersion(userId)]);
    const base = normalizeStructuredResume(profile?.baseResume ?? baseVersion?.structuredResume ?? null);
    // Tailoring rewords the summary and work bullets (project bullets follow with the layout
    // work, #415): with none of either there is nothing to tailor.
    const tailorRequest = base ? buildTailorRequest(base, job, confirmedKeywords) : null;
    if (!base || !tailorRequest || editableLines(base).length === 0) {
      return response.status(409).json({
        code: 'BASE_RESUME_EMPTY',
        error: 'Add a summary or work experience with bullet points in Settings → Résumé before tailoring.',
      });
    }
    if (tailorRequest.lines.length === 0) {
      return response.status(409).json({
        code: 'RESUME_LINES_TOO_LONG',
        error:
          'Your summary and bullet points are too long to tailor (a bullet over 1,000 characters, a summary over 3,000). Shorten them in Settings → Résumé.',
      });
    }
    if (!job.descriptionText?.trim()) {
      return response.status(409).json({
        code: 'POSTING_EMPTY',
        error: 'This job has no posting text to tailor to. Add the job description first.',
      });
    }

    const answer = await resolveTailorResume(tailorRequest);
    // The agent refuses a posting that looks like a prompt injection (INJECTION_ACTION=refuse).
    // Trying again can't help, and each try is a paid call.
    if (isInjectionRefusal(answer)) {
      return response.status(422).json({
        code: 'POSTING_REFUSED',
        error: "This posting seems to contain instructions to the AI, so it wasn't tailored. Check the job description.",
      });
    }
    const result = tailorFromAnswer(base, answer, {
      company: job.company,
      jobTerms: postingKeywords(job),
      confirmedKeywords,
      sentPaths: tailorRequest.lines.map((line) => line.path),
    });
    // Nothing from the AI (the API's own additions of confirmed keywords don't count).
    if (result.suggested === 0) {
      throw new AiUnavailableError("The AI didn't suggest any changes. Try again.");
    }

    const now = new Date().toISOString();
    const postingTerms = keywordTerms(postingKeywords(job));
    const version: ResumeVersionRecord = {
      id: randomUUID(),
      userId,
      jobId,
      changeSummary: result.changeSummary,
      changeDetails: result.details,
      structuredResume: result.resume,
      approved: false,
      isBase: false,
      basedOn: {
        baseVersionId: baseVersion?.id ?? null,
        baseUpdatedAt: baseVersion?.updatedAt ?? profile?.updatedAt ?? null,
        jobId,
        postingSha256: createHash('sha256').update(job.descriptionText).digest('hex'),
        model: answer.model_used,
        createdAt: now,
        grounding: { version: GROUNDING_VERSION },
        confirmedKeywords,
        gaps: result.gaps,
        ...(postingTerms.length > 0 ? { coverage: keywordCoverage(postingTerms, base, result.resume) } : {}),
      },
      createdAt: now,
      updatedAt: now,
    };
    await insertResumeVersion(version);

    // "Also add them to my base résumé" in the tailor window: after the draft is saved, so a
    // failed tailoring changes nothing. The keywords go on the base résumé as it is now: the
    // user may have saved it in Settings, or another run added keywords, while the AI worked.
    // The draft is saved either way: a failure here mustn't send the user to tailor again (a
    // paid call), so it's reported, not thrown.
    let addedToBase = false;
    if (body.addToBase === true && confirmedKeywords.length > 0) {
      let updatedBase: ReturnType<typeof normalizeStructuredResume> = null;
      const currentBaseVersion = await getBaseResumeVersion(userId).catch(() => null);
      try {
        updatedBase = await changeBaseResume(userId, currentBaseVersion?.structuredResume ?? null, (current) => {
          const next = normalizeStructuredResume(current);
          return next && addSkills(next, confirmedKeywords).length > 0 ? next : null;
        });
        addedToBase = true;
      } catch (error) {
        console.error('[resume-studio] adding confirmed keywords to the base résumé failed', error);
      }
      // The base version's copy follows the profile's, which Settings shows. Failing here leaves
      // the keywords on the base résumé, so it's only logged.
      if (updatedBase && currentBaseVersion) {
        await updateResumeVersion(userId, currentBaseVersion.id, { structuredResume: updatedBase }).catch((error: unknown) =>
          console.error("[resume-studio] updating the base version's copy failed", error),
        );
      }
    }

    return response.status(201).json({
      status: 'awaiting_approval',
      version,
      ...(body.addToBase === true && confirmedKeywords.length > 0 ? { addedToBase } : {}),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/:id/resume-versions
 *
 * Lists all tailored resume versions associated with a specific job.
 */
resumeStudioRouter.get('/jobs/:id/resume-versions', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const jobId = request.params.id;
    const versions = await listResumeVersionsForJob(userId, jobId!);
    return response.json({ versions });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/jobs/:id/tailor/keywords
 *
 * For the tailor window (#351): the posting's keywords from its fit read, and which the base
 * résumé already has. The user picks the ones they have; `fitRead` is false before a fit read.
 */
resumeStudioRouter.get('/jobs/:id/tailor/keywords', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const job = await getJobById(userId, request.params.id!);
    if (!job) {
      return response.status(404).json({ error: `Job not found: ${request.params.id}` });
    }
    const [profile, baseVersion] = await Promise.all([getUserProfile(userId), getBaseResumeVersion(userId)]);
    const base = normalizeStructuredResume(profile?.baseResume ?? baseVersion?.structuredResume ?? null);
    return response.json({ fitRead: Boolean(job.analysis), keywords: keywordsOnResume(keywordTerms(postingKeywords(job)), base) });
  } catch (error) {
    next(error);
  }
});

/** A tailored draft of this user's, or null. Base versions are not drafts. */
async function getDraft(userId: string, id: string): Promise<ResumeVersionRecord | null> {
  const version = await getResumeVersion(userId, id);
  return version && !version.isBase ? version : null;
}

/**
 * POST /api/resume-versions/:id/approve
 *
 * Approves a tailored draft the API checked (422 NOT_GROUNDED otherwise): renders the PDF,
 * stores it, and marks the version approved.
 */
resumeStudioRouter.post('/resume-versions/:id/approve', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }
    if (!isGrounded(version)) {
      return response.status(422).json(NOT_GROUNDED);
    }

    const pdfBuffer = await renderAtsResumePdf(version.structuredResume);
    const { fileUrl } = await storeResumePdf(version, pdfBuffer);
    // Approved as rendered: a line saved meanwhile (another tab) would make the PDF differ.
    const updated = await updateResumeVersion(
      userId,
      id!,
      { approved: true, tailoredResumeFileUrl: fileUrl },
      { expect: { updatedAt: version.updatedAt } },
    );
    if (!updated) {
      return response.status(409).json(VERSION_CHANGED);
    }

    return response.json({
      version: updated,
      fileUrl,
      approved: true,
    });
  } catch (error) {
    next(error);
  }
});

const VERSION_CHANGED = {
  code: 'VERSION_CHANGED',
  error: 'This draft changed in another tab or was just downloaded. Reload the page to see it.',
};

const MAX_USER_LINE = 1_000;
const MAX_USER_SUMMARY = 3_000;
// One line of plain text (see request.ts): no control, format or separator characters.
const NOT_PLAIN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;

/**
 * PATCH /api/resume-versions/:id/changes/:changeId   body: { action: 'keep' | 'restore' | 'edit', text? }
 *
 * The review's choice for one line of a draft (#351): keep the suggestion, restore the base
 * line, or use the user's own words. Their words are theirs: not checked, and marked as edited.
 * A dropped suggestion can't be kept, nor sent back unchanged as an edit; only edited. Bullet
 * and skill orders can only be kept. Once downloaded (approved) the version is final: 409
 * VERSION_FINAL. A draft that changed since it was read (another tab): 409 VERSION_CHANGED.
 */
resumeStudioRouter.patch('/resume-versions/:id/changes/:changeId', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id, changeId } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }
    if (!isGrounded(version)) {
      return response.status(422).json(NOT_GROUNDED);
    }
    if (version.approved) {
      return response.status(409).json({
        code: 'VERSION_FINAL',
        error: 'This version was downloaded, so it can no longer change. Tailor again to make a new one.',
      });
    }
    const details = structuredClone(version.changeDetails ?? []);
    const detail = details.find((d) => d.id === changeId);
    if (!detail) {
      return response.status(404).json({ error: `Change not found: ${changeId}` });
    }

    const body = (request.body ?? {}) as { action?: unknown; text?: unknown };
    const action = body.action;
    if (action !== 'keep' && action !== 'restore' && action !== 'edit') {
      return response.status(400).json({ error: "action must be 'keep', 'restore' or 'edit'." });
    }
    const resume = structuredClone(version.structuredResume);
    const path = detail.targetPath ?? detail.sourcePath ?? null;
    if (detail.dropped && action === 'keep') {
      return response.status(400).json({ error: 'A dropped suggestion adds something your résumé lacks. Edit it into your own words instead.' });
    }
    // A draft saved before lines knew where they moved (#423): its bullet may have moved with
    // the role's new order, so changing the line at sourcePath could change another bullet.
    const role = /^work\[(\d+)\]\.highlights\[\d+\]$/.exec(path ?? '')?.[1];
    if (
      detail.kind === 'rewrite' &&
      detail.targetPath === undefined &&
      role !== undefined &&
      details.some((d) => d.kind === 'reorder' && d.sourcePath === `work[${role}].highlights`)
    ) {
      return response.status(409).json({
        code: 'TAILOR_AGAIN',
        error: 'This draft was made before lines could be changed one by one. Tailor again to review it.',
      });
    }

    if (detail.kind === 'rewrite' && path) {
      if (action === 'edit') {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const max = path === 'basics.summary' ? MAX_USER_SUMMARY : MAX_USER_LINE;
        if (!text || text.length > max || (path !== 'basics.summary' && /\n/.test(text)) || NOT_PLAIN.test(text.replace(/\n/g, ''))) {
          return response.status(400).json({ error: `text must be one line of up to ${max.toLocaleString('en-US')} characters.` });
        }
        if (detail.dropped && norm(text) === norm(detail.newText)) {
          return response.status(400).json({
            error: "That's the suggestion that was dropped. Write the line in your own words, or restore the original.",
          });
        }
        setLine(resume, path, text);
        detail.userText = text;
      } else if (action === 'keep') {
        setLine(resume, path, detail.newText);
        delete detail.userText;
      } else {
        setLine(resume, path, detail.oldText ?? '');
        delete detail.userText;
      }
    } else if (detail.kind === 'skill-added' && !detail.dropped) {
      if (action === 'edit') return response.status(400).json({ error: 'An added skill can be kept or removed.' });
      const listed = resume.skills.find((group) => group.skills.includes(detail.newText));
      if (action === 'restore' && listed) {
        listed.skills.splice(listed.skills.indexOf(detail.newText), 1);
        if (listed.skills.length === 0) resume.skills.splice(resume.skills.indexOf(listed), 1);
      } else if (action === 'keep' && !listed) {
        skillGroup(resume, detail.section.replace(/^Skills · /, '')).skills.push(detail.newText);
      }
    } else if (detail.kind === 'rewrite' || detail.dropped) {
      // A dropped suggestion that matched no line, or a dropped skill: nothing to change.
      return response.status(400).json({ error: 'This suggestion was dropped, so there is nothing to change.' });
    } else if (action !== 'keep') {
      return response.status(400).json({ error: 'This change can only be kept.' });
    }

    detail.resolution = action === 'keep' ? 'kept' : action === 'restore' ? 'restored' : 'edited';
    // "Posting keywords in your résumé: X of N → Y of N" follows the review, recounted against
    // the keywords it was first counted against (a later fit read may list others).
    const coverage = version.basedOn?.coverage;
    const basedOn =
      version.basedOn && coverage?.terms
        ? { ...version.basedOn, coverage: { ...coverage, after: keywordCount(coverage.terms, resume) } }
        : version.basedOn;
    // Saved only onto the draft as it was read: still a draft, unchanged by another tab.
    const updated = await updateResumeVersion(
      userId,
      id!,
      { structuredResume: resume, changeDetails: details, ...(basedOn !== version.basedOn ? { basedOn } : {}) },
      { expect: { updatedAt: version.updatedAt, approved: false } },
    );
    if (!updated) {
      return response.status(409).json(VERSION_CHANGED);
    }
    return response.json({ version: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/resume-versions/:id/download
 *
 * The PDF of an approved tailored draft the API checked: 422 NOT_GROUNDED for a draft it
 * didn't check, 409 NOT_APPROVED before approval.
 */
resumeStudioRouter.get('/resume-versions/:id/download', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const { id } = request.params;
    const version = await getDraft(userId, id!);
    if (!version) {
      return response.status(404).json({ error: `Resume version not found: ${id}` });
    }
    if (!isGrounded(version)) {
      return response.status(422).json(NOT_GROUNDED);
    }
    if (!version.approved) {
      return response.status(409).json({ code: 'NOT_APPROVED', error: 'Approve this draft before downloading it.' });
    }

    const { pdf, pages } = await renderResumePdf(version.structuredResume);
    const candidateName = version.structuredResume.basics?.name?.trim() || 'Resume';
    const job = version.jobId ? await getJobById(userId, version.jobId) : null;

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Page-Count', String(pages));
    response.setHeader(
      'Content-Disposition',
      // "First Last – Company.pdf" (no "Inc..pdf").
      attachmentDisposition(`${candidateName} – ${job?.company?.trim().replace(/\.+$/, '') || 'Résumé'}.pdf`),
    );
    return response.send(pdf);
  } catch (error) {
    next(error);
  }
});
