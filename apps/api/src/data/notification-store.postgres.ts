import { randomUUID } from 'node:crypto';
import { getPool } from '@/lib/postgres';
import type {
  CreateNotificationInput,
  NotificationChannels,
  NotificationKind,
  NotificationRecord,
  NotificationSettings,
} from '@/types';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  channels: {
    in_app: true,
    email: false,
    telegram: false,
    web_push: false,
  },
  minMatchScore: 80,
  digestHour: 9,
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  telegramChatId: null,
  emailAddress: null,
};

type NotificationRow = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  job_id: string | null;
  dedupe_key: string | null;
  channels: unknown;
  read_at: string | null;
  created_at: string;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

function mapRow(row: NotificationRow): NotificationRecord {
  let parsedChannels: NotificationChannels = {};
  if (row.channels && typeof row.channels === 'object') {
    parsedChannels = row.channels as NotificationChannels;
  } else if (typeof row.channels === 'string') {
    try {
      parsedChannels = JSON.parse(row.channels) as NotificationChannels;
    } catch {
      parsedChannels = {};
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    jobId: row.job_id ?? undefined,
    dedupeKey: row.dedupe_key ?? undefined,
    channels: parsedChannels,
    readAt: row.read_at ?? undefined,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
  };
}

export async function insertNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<NotificationRecord> {
  const pool = poolOrThrow();
  const id = randomUUID();
  const channelsJson = JSON.stringify(input.channels ?? { in_app: { status: 'sent', sentAt: new Date().toISOString() } });

  const { rows } = await pool.query<NotificationRow>(
    `
      INSERT INTO notifications (id, user_id, kind, title, body, job_id, dedupe_key, channels)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (dedupe_key) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body
      RETURNING *
    `,
    [
      id,
      userId,
      input.kind,
      input.title,
      input.body,
      input.jobId ?? null,
      input.dedupeKey ?? null,
      channelsJson,
    ],
  );

  return mapRow(rows[0]!);
}

export async function getNotificationById(
  userId: string,
  id: string,
): Promise<NotificationRecord | undefined> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<NotificationRow>(
    `SELECT * FROM notifications WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function getNotificationByDedupeKey(
  dedupeKey: string,
): Promise<NotificationRecord | undefined> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<NotificationRow>(
    `SELECT * FROM notifications WHERE dedupe_key = $1 LIMIT 1`,
    [dedupeKey],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function listNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number; offset?: number },
): Promise<NotificationRecord[]> {
  const pool = poolOrThrow();
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
  const offset = Math.max(0, options?.offset ?? 0);

  let query = `SELECT * FROM notifications WHERE user_id = $1`;
  const params: unknown[] = [userId];

  if (options?.unreadOnly) {
    query += ` AND read_at IS NULL`;
  }

  query += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
  params.push(limit, offset);

  const { rows } = await pool.query<NotificationRow>(query, params);
  return rows.map(mapRow);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return parseInt(rows[0]?.count || '0', 10);
}

export async function markNotificationRead(
  userId: string,
  id: string,
): Promise<NotificationRecord | undefined> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<NotificationRow>(
    `
      UPDATE notifications
      SET read_at = NOW()
      WHERE user_id = $1 AND id = $2 AND read_at IS NULL
      RETURNING *
    `,
    [userId, id],
  );

  if (rows[0]) {
    return mapRow(rows[0]);
  }

  return getNotificationById(userId, id);
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const pool = poolOrThrow();
  const { rowCount } = await pool.query(
    `
      UPDATE notifications
      SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL
    `,
    [userId],
  );
  return rowCount ?? 0;
}

export async function updateNotificationChannels(
  id: string,
  channels: NotificationChannels,
): Promise<NotificationRecord | undefined> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<NotificationRow>(
    `
      UPDATE notifications
      SET channels = channels || $2::jsonb
      WHERE id = $1
      RETURNING *
    `,
    [id, JSON.stringify(channels)],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function getNotificationSettings(userId: string): Promise<NotificationSettings> {
  const pool = poolOrThrow();
  const { rows } = await pool.query<{ preferences: unknown }>(
    `SELECT preferences FROM user_profiles WHERE user_id = $1 LIMIT 1`,
    [userId],
  );

  if (!rows[0] || !rows[0].preferences) {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }

  let prefs = rows[0].preferences as Record<string, unknown>;
  if (typeof prefs === 'string') {
    try {
      prefs = JSON.parse(prefs);
    } catch {
      return { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
  }

  const notif = (prefs.notifications ?? {}) as Partial<NotificationSettings>;
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...notif,
    channels: {
      ...DEFAULT_NOTIFICATION_SETTINGS.channels,
      ...(notif.channels ?? {}),
    },
    quietHours: {
      ...DEFAULT_NOTIFICATION_SETTINGS.quietHours,
      ...(notif.quietHours ?? {}),
    },
  };
}

export async function updateNotificationSettings(
  userId: string,
  settingsPatch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const pool = poolOrThrow();
  const current = await getNotificationSettings(userId);
  const updated: NotificationSettings = {
    ...current,
    ...settingsPatch,
    channels: {
      ...current.channels,
      ...(settingsPatch.channels ?? {}),
    },
    quietHours: {
      ...current.quietHours,
      ...(settingsPatch.quietHours ?? {}),
    },
  };

  await pool.query(
    `
      INSERT INTO user_profiles (user_id, preferences)
      VALUES ($1, jsonb_build_object('notifications', $2::jsonb))
      ON CONFLICT (user_id) DO UPDATE SET
        preferences = jsonb_set(
          COALESCE(user_profiles.preferences, '{}'::jsonb),
          '{notifications}',
          $2::jsonb,
          true
        )
    `,
    [userId, JSON.stringify(updated)],
  );

  return updated;
}
