import { Router } from 'express';
import multer from 'multer';
import { getUserProfile, upsertUserProfile } from '@/data/profile-store';
import { listJobs } from '@/data/job-store';
import { listWeeklyReports } from '@/data/report-store';
import { requireUser } from '@/lib/auth';

export const profileRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
    const updated = await upsertUserProfile(userId, {
      profileText: body.profileText?.trim() || undefined,
    });
    response.json({ profile: publicProfile(updated) });
  } catch (error) {
    next(error);
  }
});

// Accept either a PDF upload (field "file") or pasted text in the JSON body.
profileRouter.post('/resume', upload.single('file'), async (request, response, next) => {
  try {
    const userId = requireUser(request, response);
    if (!userId) return;

    const body = request.body as { resume_text?: string };
    let resumeText = body.resume_text?.trim();
    let resumeFileName: string | undefined;

    if (request.file) {
      resumeFileName = request.file.originalname;
      const { default: pdfParse } = await import('pdf-parse');
      const parsed = await pdfParse(request.file.buffer);
      resumeText = parsed.text?.trim();
    }

    if (!resumeText) {
      return response.status(400).json({ error: 'Provide a PDF file or resume_text.' });
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
