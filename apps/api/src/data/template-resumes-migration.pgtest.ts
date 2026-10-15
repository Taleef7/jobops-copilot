import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createJob } from './job-store';
import { getResumeVersion, insertResumeVersion } from './resume-version-store';
import { GROUNDING_VERSION, isGrounded } from '@/lib/tailor/apply';
import { findMigrationDir } from '@/lib/migrations';
import { getPool } from '@/lib/postgres';
import type { ResumeVersionRecord, StructuredResume } from '@/types';

// Runs only against a real, ephemeral Postgres (the `db` CI job). Migration 029 deletes the
// template-tailored résumé versions (#351): every non-base version without the API's
// grounding marker, approved or not. Base résumés and checked drafts stay.
const DB = process.env.DATABASE_URL?.trim();

const resume: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Analyst.' },
  work: [],
  education: [],
  skills: [],
};

test(
  'migration 029 deletes the template-tailored versions and keeps base résumés and checked drafts',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_029_${randomUUID().slice(0, 8)}`;
    const other = `itest_029_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Analyst', descriptionText: 'SQL.' });
    const now = new Date().toISOString();
    const add = async (fields: Partial<ResumeVersionRecord>) => {
      const id = randomUUID();
      await insertResumeVersion({
        id,
        userId,
        jobId: job.id,
        changeSummary: 'Tailored resume draft for Analyst at Acme',
        structuredResume: resume,
        approved: false,
        isBase: false,
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
      return id;
    };
    const basedOn = {
      baseVersionId: null,
      baseUpdatedAt: null,
      jobId: job.id,
      postingSha256: 'a'.repeat(64),
      model: 'openai:gpt-6-luna',
      createdAt: now,
      grounding: { version: GROUNDING_VERSION },
    };

    const kept = {
      base: await add({ isBase: true, jobId: null, approved: true, changeSummary: 'Initial base resume created' }),
      checked: await add({ basedOn }),
      checkedApproved: await add({ basedOn, approved: true }),
      otherUsersBase: randomUUID(),
    };
    await insertResumeVersion({
      id: kept.otherUsersBase,
      userId: other,
      jobId: null,
      changeSummary: 'Initial base resume created',
      structuredResume: resume,
      approved: true,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    const deleted = {
      template: await add({}),
      templateApproved: await add({ approved: true, tailoredResumeFileUrl: 'file:///tmp/x.pdf' }),
      templateNoJob: await add({ jobId: null }),
      basisWithoutGrounding: await add({ basedOn: { ...basedOn, grounding: undefined } as unknown as ResumeVersionRecord['basedOn'] }),
    };

    const dir = findMigrationDir(__dirname);
    assert.ok(dir, 'db/migrations not found');
    await pool.query(await readFile(join(dir, '029_delete_template_tailored_resumes.sql'), 'utf8'));

    for (const [name, id] of Object.entries(kept)) {
      const owner = name === 'otherUsersBase' ? other : userId;
      assert.ok(await getResumeVersion(owner, id), `${name} should be kept`);
    }
    for (const [name, id] of Object.entries(deleted)) {
      assert.equal(await getResumeVersion(userId, id), null, `${name} should be deleted`);
    }

    // What's left is what the API can use: base résumés and checked drafts.
    const { rows } = await pool.query<{ is_base: boolean; based_on: ResumeVersionRecord['basedOn'] }>(
      'select is_base, based_on from resume_versions where user_id = $1',
      [userId],
    );
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.is_base || isGrounded({ basedOn: row.based_on })));
  },
);
