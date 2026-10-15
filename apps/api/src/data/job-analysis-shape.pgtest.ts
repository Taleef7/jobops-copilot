import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, getJobById, saveJobAnalysis } from './job-store';
import { getPool } from '@/lib/postgres';
import { sampleAnalysis } from '@/test-support/analysis';

// Runs only against a real, ephemeral Postgres (the `db` CI job). #354: confidence is saved on
// 0–100 (the column takes integers 0–100, so a 0.65 used to fail the save), and a row from
// before #354 still reads: skills as "label: why" strings and four default sub-signals.
const DB = process.env.DATABASE_URL?.trim();

test(
  'the Postgres store saves a 0–1 confidence as a percentage and reads old rows in the new shape',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_354_${randomUUID().slice(0, 8)}`;
    const OLD_DEFAULT = 50;
    const job = await createJob(userId, { company: 'Acme', title: 'Engineer', descriptionText: 'Go and Kafka.' });

    await saveJobAnalysis(userId, job.id, sampleAnalysis({ confidenceScore: 0.65 }), 70);
    const saved = (await getJobById(userId, job.id))?.analysis;
    assert.equal(saved?.confidenceScore, 65);
    assert.deepEqual(saved?.matchedSkills, [{ skill: 'Go', evidence: 'Built the billing API in Go.' }]);

    await pool.query(
      `update job_analysis
         set matched_skills = $2::jsonb, missing_skills = $3::jsonb, sub_signals = $4::jsonb
       where job_id = $1`,
      [
        job.id,
        JSON.stringify(['Go: built the billing API in Go']),
        JSON.stringify(['Hands-on experience running large Kafka clusters in production']),
        JSON.stringify({
          skillsMatch: OLD_DEFAULT,
          titleSeniority: OLD_DEFAULT,
          salaryFit: OLD_DEFAULT,
          sponsorshipLikelihood: OLD_DEFAULT,
        }),
      ],
    );

    const old = (await getJobById(userId, job.id))?.analysis;
    assert.deepEqual(old?.matchedSkills, [{ skill: 'Go', evidence: 'built the billing API in Go' }]);
    assert.deepEqual(old?.missingSkills, [
      { skill: 'Other', postingQuote: 'Hands-on experience running large Kafka clusters in production' },
    ]);
    assert.deepEqual(old?.subSignals, {
      skillsMatch: null,
      titleSeniority: null,
      salaryFit: null,
      sponsorshipLikelihood: null,
    });
  },
);
