import { createHash, randomUUID } from 'node:crypto';
import type { ApplicationAnswer, UpsertApplicationAnswerBody } from '@/types';
import { getPool } from '@/lib/postgres';

type ApplicationAnswerRow = {
  id: string;
  user_id: string;
  question_hash: string;
  question_text: string;
  answer: string;
  ats: string | null;
  created_at: string;
  updated_at: string;
};

function poolOrThrow() {
  const pool = getPool();
  if (!pool) {
    throw new Error('Postgres is not configured. Set DATABASE_URL to enable the database-backed store.');
  }
  return pool;
}

function mapRow(row: ApplicationAnswerRow): ApplicationAnswer {
  return {
    id: row.id,
    userId: row.user_id,
    questionHash: row.question_hash,
    questionText: row.question_text,
    answer: row.answer,
    ats: row.ats ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function hashQuestion(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex');
}

export async function listApplicationAnswers(userId: string): Promise<ApplicationAnswer[]> {
  const { rows } = await poolOrThrow().query<ApplicationAnswerRow>(
    'SELECT * FROM application_answers WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  return rows.map(mapRow);
}

export async function findApplicationAnswer(
  userId: string,
  questionTextOrHash: string,
): Promise<ApplicationAnswer | undefined> {
  const isHash = /^[a-f0-9]{64}$/i.test(questionTextOrHash);
  const qHash = isHash ? questionTextOrHash.toLowerCase() : hashQuestion(questionTextOrHash);

  const { rows } = await poolOrThrow().query<ApplicationAnswerRow>(
    'SELECT * FROM application_answers WHERE user_id = $1 AND question_hash = $2 LIMIT 1',
    [userId, qHash],
  );
  const row = rows[0];
  return row ? mapRow(row) : undefined;
}

export async function upsertApplicationAnswer(
  userId: string,
  body: UpsertApplicationAnswerBody,
): Promise<ApplicationAnswer> {
  const qHash = body.questionHash || hashQuestion(body.questionText);
  const { rows } = await poolOrThrow().query<ApplicationAnswerRow>(
    `
      INSERT INTO application_answers (id, user_id, question_hash, question_text, answer, ats, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, now(), now())
      ON CONFLICT (user_id, question_hash) DO UPDATE SET
        question_text = excluded.question_text,
        answer = excluded.answer,
        ats = COALESCE(excluded.ats, application_answers.ats),
        updated_at = now()
      RETURNING *
    `,
    [randomUUID(), userId, qHash, body.questionText.trim(), body.answer.trim(), body.ats ?? null],
  );
  const saved = rows[0];
  if (!saved) {
    throw new Error('Failed to save application answer');
  }
  return mapRow(saved);
}

export async function deleteApplicationAnswer(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await poolOrThrow().query(
    'DELETE FROM application_answers WHERE user_id = $1 AND id = $2',
    [userId, id],
  );
  return (rowCount ?? 0) > 0;
}
