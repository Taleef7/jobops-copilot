import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getPool, hasPostgresConnection } from '@/lib/postgres';

export interface UserProfile {
  userId: string;
  resumeText?: string;
  resumeFileName?: string;
  resumeFileUrl?: string;
  profileText?: string;
  updatedAt?: string;
}

type ProfileRow = {
  user_id: string;
  resume_text: string | null;
  resume_file_name: string | null;
  resume_file_url: string | null;
  profile_text: string | null;
  updated_at: string;
};

function mapRow(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    resumeText: row.resume_text ?? undefined,
    resumeFileName: row.resume_file_name ?? undefined,
    resumeFileUrl: row.resume_file_url ?? undefined,
    profileText: row.profile_text ?? undefined,
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
): Promise<UserProfile> {
  if (hasPostgresConnection()) {
    const pool = getPool()!;
    const { rows } = await pool.query<ProfileRow>(
      `
        insert into user_profiles (user_id, resume_text, resume_file_name, resume_file_url, profile_text)
        values ($1, $2, $3, $4, $5)
        on conflict (user_id) do update set
          resume_text = coalesce($2, user_profiles.resume_text),
          resume_file_name = coalesce($3, user_profiles.resume_file_name),
          resume_file_url = coalesce($4, user_profiles.resume_file_url),
          profile_text = coalesce($5, user_profiles.profile_text)
        returning *
      `,
      [
        userId,
        patch.resumeText ?? null,
        patch.resumeFileName ?? null,
        patch.resumeFileUrl ?? null,
        patch.profileText ?? null,
      ],
    );
    return mapRow(rows[0]!);
  }

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
}

/** Deletes a user's stored profile (resume + profile text). */
export async function deleteUserProfile(userId: string): Promise<void> {
  if (hasPostgresConnection()) {
    const pool = getPool()!;
    await pool.query('delete from user_profiles where user_id = $1', [userId]);
    return;
  }

  const profiles = await readFileProfiles();
  if (userId in profiles) {
    delete profiles[userId];
    await writeFileProfiles(profiles);
  }
}
