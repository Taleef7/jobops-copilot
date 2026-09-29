import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import { listJobs } from '@/data/job-store';
import { listWeeklyReports } from '@/data/report-store';
import { requireUser } from '@/lib/auth';
import { isTooLong, STORED_TEXT_MAX, TOO_LONG_MESSAGE } from '@/lib/input-caps';
import { extractPdfText, PDF_MAX_CHARS, PdfUnreadableError } from '@/lib/pdf-text';

export const profileRouter = Router();

/** A file that isn't a PDF (by type, or by its first bytes). */
class NotAPdfError extends Error {}

const NOT_A_PDF_MESSAGE = 'Upload your résumé as a PDF, or paste its text.';

// Browsers sometimes send a real PDF with no type or as octet-stream; the %PDF- check
// below decides for those. A declared non-PDF type is refused before it's read.
const MAYBE_PDF_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']);

// One PDF of at most 5 MB, and nothing else in the form (#389).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 5, fieldNameSize: 100, parts: 6, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, accept) => {
    if (MAYBE_PDF_TYPES.has(file.mimetype)) accept(null, true);
    else accept(new NotAPdfError());
  },
});

/** Signed-in users only, checked before the upload is read into memory. */
function requireSignedIn(request: Request, response: Response, next: NextFunction) {
  if (requireUser(request, response)) next();
}

/** Receive the résumé file, answering plainly when it isn't one PDF within the limits. */
function receiveResumeFile(request: Request, response: Response, next: NextFunction) {
  upload.single('file')(request, response, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof NotAPdfError) {
      response.status(415).json({ error: NOT_A_PDF_MESSAGE });
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        response.status(413).json({ error: 'The file is too large. The limit is 5 MB.' });
        return;
      }
      response.status(400).json({ error: 'Upload one PDF file.' });
      return;
    }
    next(error);
  });
}

function publicProfile(profile: Awaited<ReturnType<typeof getUserProfile>>) {
  if (!profile) {
    return null;
  }
  // Never ship the full resume text to the client; expose presence + metadata.
  // Identity (name/avatar/email) lives in Clerk — not here (Phase 6).
  return {
    resumeFileName: profile.resumeFileName ?? null,
    hasResume: Boolean(profile.resumeText),
    profileText: profile.profileText ?? null,
    updatedAt: profile.updatedAt ?? null,
  };
}

profileRouter.get('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const profile = await getUserProfile(userId);
    response.json({ profile: publicProfile(profile) });
  } catch (error) {
    next(error);
  }
});

profileRouter.put('/', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const body = request.body as { profileText?: string };
    if (isTooLong(body.profileText, STORED_TEXT_MAX)) {
      return response.status(413).json({ error: TOO_LONG_MESSAGE });
    }
    const updated = await upsertUserProfile(userId, {
      profileText: body.profileText?.trim() || undefined,
    });
    response.json({ profile: publicProfile(updated) });
  } catch (error) {
    next(error);
  }
});

// Accept either a PDF upload (field "file") or pasted text in the JSON body.
profileRouter.post('/resume', requireSignedIn, receiveResumeFile, async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { resume_text?: string };
    if (isTooLong(body.resume_text, STORED_TEXT_MAX)) {
      return response.status(413).json({ error: TOO_LONG_MESSAGE });
    }
    let resumeText = body.resume_text?.trim();
    let resumeFileName: string | undefined;

    if (request.file) {
      if (request.file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return response.status(415).json({ error: NOT_A_PDF_MESSAGE });
      }
      resumeFileName = request.file.originalname;
      try {
        // Read off the event loop, with time, memory, page and length limits (#389).
        const pdf = await extractPdfText(request.file.buffer);
        if (pdf.truncated) {
          return response.status(413).json({
            error: `This PDF has more text than a résumé (the limit is ${PDF_MAX_CHARS.toLocaleString('en-US')} characters). Paste the text instead.`,
          });
        }
        resumeText = pdf.text;
      } catch (error) {
        if (error instanceof PdfUnreadableError) {
          return response.status(422).json({ error: `Couldn't read this PDF. ${error.message} Try another file or paste the text.` });
        }
        throw error;
      }
    }

    if (!resumeText) {
      return response.status(400).json({ error: 'Provide a PDF file or resume_text.' });
    }
    // Checked again after extraction: a small PDF can hold more text than the cap (#345).
    if (isTooLong(resumeText, STORED_TEXT_MAX)) {
      return response.status(413).json({ error: TOO_LONG_MESSAGE });
    }

    const updated = await upsertUserProfile(userId, {
      resumeText,
      resumeFileName: resumeFileName ?? 'resume.txt',
    });

    response.json({ profile: publicProfile(updated) });
  } catch (error) {
    next(error);
  }
});

// Full export of the signed-in user's data (Settings "Export data").
profileRouter.get('/export', async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;
    const [jobs, reports, profile] = await Promise.all([
      listJobs(userId),
      listWeeklyReports(userId),
      getUserProfile(userId),
    ]);
    response
      .set('Content-Disposition', 'attachment; filename="jobops-export.json"')
      .json({ exportedAt: new Date().toISOString(), profile: publicProfile(profile), jobs, reports });
  } catch (error) {
    next(error);
  }
});
