import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createJob, getJobById, saveJobAnalysis } from './job-store';
import { getPool } from '@/lib/postgres';
import { sampleAnalysis } from '@/test-support/analysis';

// Runs only against a real, ephemeral Postgres (the `db` CI job). #354:
// - confidence is saved on 0–100 (the column takes integers, so a 0.65 used to fail the save);
// - matched_skills and missing_skills keep short labels as strings, which every API version
//   reads, and the evidence goes in the new *_skill_details columns;
// - a row from before #354 still reads: "label: why" strings, no details, four default 50s.
const DB = process.env.DATABASE_URL?.trim();

test(
  'the Postgres store keeps labels as strings, details apart, and reads old rows',
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
    assert.deepEqual(saved?.matchedSkills, ['Go']);
    assert.deepEqual(saved?.matchedSkillDetails, [{ skill: 'Go', evidence: 'Built the billing API in Go.' }]);

    const { rows } = await pool.query<{ matched_skills: unknown; matched_skill_details: unknown }>(
      'select matched_skills, matched_skill_details from job_analysis where job_id = $1',
      [job.id],
    );
    assert.deepEqual(rows[0]?.matched_skills, ['Go']);
    assert.deepEqual(rows[0]?.matched_skill_details, [{ skill: 'Go', evidence: 'Built the billing API in Go.' }]);

    // An API from before #354 rewrites the labels and leaves the details as they were.
    await pool.query(
      `update job_analysis
         set matched_skills = $2::jsonb, missing_skills = $3::jsonb, sub_signals = $4::jsonb
       where job_id = $1`,
      [
        job.id,
        JSON.stringify(['Go: built the billing API in Go', 'Rust']),
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
    assert.deepEqual(old?.matchedSkills, ['Go', 'Rust']);
    assert.deepEqual(old?.matchedSkillDetails, [
      { skill: 'Go', evidence: 'built the billing API in Go' },
      { skill: 'Rust', evidence: '' },
    ]);
    assert.deepEqual(old?.missingSkills, []);
    assert.deepEqual(old?.missingSkillDetails, [
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

test(
  'skills an API from before #354 saved as the agent objects still read, over stale details',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const pool = getPool();
    assert.ok(pool);
    const userId = `itest_354_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme', title: 'Engineer', descriptionText: 'Go and Kafka.' });
    await saveJobAnalysis(userId, job.id, sampleAnalysis(), 70);

    // That API passes the new agent's skills through as they come, and leaves the details.
    await pool.query(
      'update job_analysis set matched_skills = $2::jsonb, missing_skills = $3::jsonb where job_id = $1',
      [
        job.id,
        JSON.stringify([{ skill: 'Go', evidence: 'Wrote the payments service in Go.' }]),
        JSON.stringify([{ skill: 'Kafka', posting_quote: 'Experience with Kafka' }]),
      ],
    );

    const analysis = (await getJobById(userId, job.id))?.analysis;
    assert.deepEqual(analysis?.matchedSkills, ['Go']);
    assert.deepEqual(analysis?.matchedSkillDetails, [{ skill: 'Go', evidence: 'Wrote the payments service in Go.' }]);
    assert.deepEqual(analysis?.missingSkills, ['Kafka']);
    assert.deepEqual(analysis?.missingSkillDetails, [{ skill: 'Kafka', postingQuote: 'Experience with Kafka' }]);
  },
);
