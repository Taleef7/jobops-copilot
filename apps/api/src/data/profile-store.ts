import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { getBaseResumeVersion, insertResumeVersion, updateResumeVersion } from '@/data/resume-version-store';
import { getPool, hasPostgresConnection } from '@/lib/postgres';
import { normalizeLayout, withLayout } from '@/lib/resume-layout';
import type { StructuredResume } from '@/types';

export interface UserProfile {
  userId: string;
  resumeText?: string;
  resumeFileName?: string;
  resumeFileUrl?: string;
  profileText?: string;
  baseResume?: StructuredResume | null;
  updatedAt?: string;
}

type ProfileRow = {
  user_id: string;
  resume_text: string | null;
  resume_file_name: string | null;
  resume_file_url: string | null;
  profile_text: string | null;
  base_resume: StructuredResume | null;
  updated_at: string;
};

function mapRow(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    resumeText: row.resume_text ?? undefined,
    resumeFileName: row.resume_file_name ?? undefined,
    resumeFileUrl: row.resume_file_url ?? undefined,
    profileText: row.profile_text ?? undefined,
    baseResume: row.base_resume ?? undefined,
    updatedAt: row.updated_at,
  };
}

// File-mode fallback (local dev / tests without DATABASE_URL).
const dataDir = () => join(process.cwd(), 'data');
const dataFile = () => join(dataDir(), 'user-profiles.json');

async function readFileProfiles(): Promise<Record<string, UserProfile>> {
  try {
    const raw = await readFile(dataFile(), 'utf8');
    return JSON.parse(raw) as Record<string, UserProfile>;
  } catch {
    return {};
  }
}

async function writeFileProfiles(profiles: Record<string, UserProfile>) {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(dataFile(), `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
}

// File-mode writes one at a time: each reads the file, changes it and writes it back.
let fileQueue: Promise<unknown> = Promise.resolve();
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(operation, operation);
  fileQueue = run.catch(() => undefined);
  return run;
}

export async function getUserProfile(userId: string): Promise<UserProfile | undefined> {
  if (hasPostgresConnection()) {
    const pool = getPool()!;
    const { rows } = await pool.query<ProfileRow>('select * from user_profiles where user_id = $1 limit 1', [userId]);
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  const profiles = await readFileProfiles();
  return profiles[userId];
}

export async function upsertUserProfile(
  userId: string,
  patch: Partial<Omit<UserProfile, 'userId'>>,
  client?: PoolClient,
): Promise<UserProfile> {
  if (hasPostgresConnection()) {
    const db = client ?? getPool()!;
    const { rows } = await db.query<ProfileRow>(
      `
        insert into user_profiles (user_id, resume_text, resume_file_name, resume_file_url, profile_text, base_resume)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (user_id) do update set
          resume_text = coalesce($2, user_profiles.resume_text),
          resume_file_name = coalesce($3, user_profiles.resume_file_name),
          resume_file_url = coalesce($4, user_profiles.resume_file_url),
          profile_text = coalesce($5, user_profiles.profile_text),
          base_resume = coalesce($6, user_profiles.base_resume)
        returning *
      `,
      [
        userId,
        patch.resumeText ?? null,
        patch.resumeFileName ?? null,
        patch.resumeFileUrl ?? null,
        patch.profileText ?? null,
        patch.baseResume ? JSON.stringify(patch.baseResume) : null,
      ],
    );
    return mapRow(rows[0]!);
  }

  return exclusive(async () => {
    const profiles = await readFileProfiles();
    const existing = profiles[userId] ?? { userId };
    const merged: UserProfile = {
      ...existing,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      userId,
      updatedAt: new Date().toISOString(),
    };
    profiles[userId] = merged;
    await writeFileProfiles(profiles);
    return merged;
  });
}

/**
 * Save the base résumé to both its copies (#408): the profile's, with the file's text for a
 * replacement file, and the base version's, which the résumé studio and outreach read first.
 * In Postgres one transaction, so a failed save changes neither. File mode has no
 * transactions: the profile is written first, then the version.
 *
 * The layout (section order, headings, page size) changes only through changeBaseResume
 * (PATCH /layout, #415): the save keeps the stored one, whatever `baseResume` carries. In
 * Postgres it's read under the profile row's lock, so a layout change can't land in between.
 * Returns the résumé as saved.
 */
export async function saveBaseResume(
  userId: string,
  baseResume: StructuredResume,
  source: { resumeText: string; resumeFileName: string } | null,
): Promise<StructuredResume> {
  if (!hasPostgresConnection()) {
    const stored = (await getUserProfile(userId))?.baseResume ?? (await getBaseResumeVersion(userId))?.structuredResume;
    const saved = withLayout(baseResume, normalizeLayout(stored?.layout));
    await upsertUserProfile(userId, { baseResume: saved, ...source });
    await saveBaseVersion(userId, saved);
    return saved;
  }

  const client = await getPool()!.connect();
  try {
    await client.query('begin');
    // The same lock as changeBaseResume takes, in the same order (profile, then version).
    await client.query('insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
    const { rows } = await client.query<ProfileRow>('select * from user_profiles where user_id = $1 for update', [userId]);
    const stored = rows[0]?.base_resume ?? (await getBaseResumeVersion(userId, client))?.structuredResume;
    const saved = withLayout(baseResume, normalizeLayout(stored?.layout));
    await upsertUserProfile(userId, { baseResume: saved, ...source }, client);
    await saveBaseVersion(userId, saved, client);
    await client.query('commit');
    return saved;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Updates the base version, or creates it on the first save. */
async function saveBaseVersion(userId: string, baseResume: StructuredResume, client?: PoolClient) {
  const existing = await getBaseResumeVersion(userId, client);
  if (existing) {
    await updateResumeVersion(
      userId,
      existing.id,
      { structuredResume: baseResume, changeSummary: 'Base resume updated via editor', approved: true },
      {},
      client,
    );
    return;
  }
  const now = new Date().toISOString();
  await insertResumeVersion(
    {
      id: randomUUID(),
      userId,
      jobId: null,
      changeSummary: 'Initial base resume created',
      structuredResume: baseResume,
      approved: true,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    },
    client,
  );
}

/**
 * Change the base résumé as it is now, not as it was read earlier (#351): read, change and
 * write as one step, so a save made meanwhile (Settings, another tailoring) isn't overwritten.
 * `fallback` is the résumé to start from when the profile has none (the base version's).
 * `change` returns the new résumé, or null to change nothing. Returns what was saved, or null.
 */
export async function changeBaseResume(
  userId: string,
  fallback: StructuredResume | null,
  change: (resume: StructuredResume) => StructuredResume | null,
): Promise<StructuredResume | null> {
  if (hasPostgresConnection()) {
    const client = await getPool()!.connect();
    try {
      await client.query('begin');
      // A row to lock, even for a user without one yet (rolled back if nothing changes): runs at
      // once then wait for each other instead of each starting from the fallback.
      await client.query('insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
      // The row stays locked until commit: a Settings save waits, then saves after this one.
      const { rows } = await client.query<ProfileRow>('select * from user_profiles where user_id = $1 for update', [userId]);
      const current = rows[0]?.base_resume ?? fallback;
      const changed = current ? change(structuredClone(current)) : null;
      if (!changed) {
        await client.query('rollback');
        return null;
      }
      await client.query(
        `
          insert into user_profiles (user_id, base_resume) values ($1, $2)
          on conflict (user_id) do update set base_resume = excluded.base_resume
        `,
        [userId, JSON.stringify(changed)],
      );
      // The base version's copy too, in the same transaction (#408).
      const baseVersion = await getBaseResumeVersion(userId, client);
      if (baseVersion) await updateResumeVersion(userId, baseVersion.id, { structuredResume: changed }, {}, client);
      await client.query('commit');
      return changed;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return exclusive(async () => {
    const profiles = await readFileProfiles();
    const existing = profiles[userId] ?? { userId };
    const current = existing.baseResume ?? fallback;
    const changed = current ? change(structuredClone(current)) : null;
    if (!changed) return null;
    profiles[userId] = { ...existing, baseResume: changed, userId, updatedAt: new Date().toISOString() };
    await writeFileProfiles(profiles);
    const baseVersion = await getBaseResumeVersion(userId);
    if (baseVersion) await updateResumeVersion(userId, baseVersion.id, { structuredResume: changed });
    return changed;
  });
}

/** Deletes a user's stored profile (resume + profile text). */
export async function deleteUserProfile(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    const pool = getPool()!;
    await pool.query('delete from user_profiles where user_id = $1', [userId]);
    return;
  }

  await exclusive(async () => {
    const profiles = await readFileProfiles();
    if (userId in profiles) {
      delete profiles[userId];
      await writeFileProfiles(profiles);
    }
  });
}
