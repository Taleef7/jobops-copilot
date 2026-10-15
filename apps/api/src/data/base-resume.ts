import { getUserProfile } from '@/data/profile-store';
import { getBaseResumeVersion, listResumeVersionsForJob, updateResumeVersion } from '@/data/resume-version-store';
import { layoutFrozen, withBaseLayout } from '@/lib/resume-layout';
import type { StructuredResume } from '@/types';

/**
 * The base résumé as Settings shows it: the profile's copy, else the base version's; null when
 * the user has none. Reading it writes nothing.
 */
export async function readBaseResume(userId: string): Promise<StructuredResume | null> {
  const [profile, baseVersion] = await Promise.all([getUserProfile(userId), getBaseResumeVersion(userId)]);
  return profile?.baseResume ?? baseVersion?.structuredResume ?? null;
}

/**
 * Copies the base résumé's layout onto a job's tailored drafts for good (#415), when the job is
 * marked applied: from then on they print with it, whatever the base résumé's layout becomes.
 * Drafts already frozen or downloaded are left alone, and so is one changed meanwhile (another
 * tab). Returns how many were frozen.
 */
export async function freezeDraftLayouts(userId: string, jobId: string): Promise<number> {
  const [versions, base] = await Promise.all([listResumeVersionsForJob(userId, jobId), readBaseResume(userId)]);
  const frozenAt = new Date().toISOString();
  let frozen = 0;
  for (const version of versions) {
    // Only drafts the API checked (#351) can be downloaded; older ones never print.
    if (!version.basedOn || layoutFrozen(version)) continue;
    const updated = await updateResumeVersion(
      userId,
      version.id,
      { structuredResume: withBaseLayout(version.structuredResume, base), basedOn: { ...version.basedOn, layoutFrozenAt: frozenAt } },
      { expect: { updatedAt: version.updatedAt, approved: false } },
    );
    if (updated) frozen += 1;
  }
  return frozen;
}
