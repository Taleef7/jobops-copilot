import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResumeVersionRecord, StructuredResume } from '@/types';
import {
  getBaseResumeVersion,
  getResumeVersion,
  insertResumeVersion,
  listResumeVersionsForJob,
  listResumeVersionsForUser,
  resetResumeVersionStore,
  updateResumeVersion,
} from './resume-version-store';

const sampleResume: StructuredResume = {
  basics: {
    name: 'Jordan Lee',
    label: 'Senior DevOps Engineer',
    email: 'jordan@example.com',
    summary: 'Cloud infrastructure expert.',
  },
  work: [
    {
      company: 'CloudScale',
      position: 'Staff SRE',
      startDate: '2021-03',
      highlights: ['99.99% SLA maintained across 5 regions'],
    },
  ],
  education: [
    {
      institution: 'MIT',
      area: 'Electrical Engineering & Computer Science',
      studyType: 'B.S.',
    },
  ],
  skills: [
    {
      category: 'Cloud',
      skills: ['Kubernetes', 'Terraform', 'AWS'],
    },
  ],
};

async function withTempStore(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), 'jobops-resume-versions-'));
  try {
    process.chdir(dir);
    await resetResumeVersionStore();
    await run();
  } finally {
    process.chdir(originalCwd);
    await resetResumeVersionStore();
    await rm(dir, { recursive: true, force: true });
  }
}

test('insertResumeVersion stores and retrieves a structured resume version', async () => {
  await withTempStore(async () => {
    const version: ResumeVersionRecord = {
      id: 'rv-1',
      userId: 'user-1',
      jobId: 'job-1',
      changeSummary: 'Tailored keywords for DevOps role',
      changeDetails: [
        {
          section: 'work[0].highlights',
          oldText: 'Maintained servers',
          newText: '99.99% SLA maintained across 5 regions',
          rationale: 'Emphasized reliability metrics',
        },
      ],
      structuredResume: sampleResume,
      approved: false,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const inserted = await insertResumeVersion(version);
    assert.equal(inserted.id, 'rv-1');
    assert.equal(inserted.userId, 'user-1');
    assert.equal(inserted.jobId, 'job-1');
    assert.equal(inserted.approved, false);
    assert.deepEqual(inserted.structuredResume.basics.name, 'Jordan Lee');

    const fetched = await getResumeVersion('user-1', 'rv-1');
    assert.ok(fetched);
    assert.equal(fetched.id, 'rv-1');
    assert.equal(fetched.changeDetails?.length, 1);
  });
});

test('getResumeVersion enforces user tenancy', async () => {
  await withTempStore(async () => {
    await insertResumeVersion({
      id: 'rv-secret',
      userId: 'user-alice',
      changeSummary: 'Base resume',
      structuredResume: sampleResume,
      approved: true,
      isBase: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const bobView = await getResumeVersion('user-bob', 'rv-secret');
    assert.equal(bobView, null);

    const aliceView = await getResumeVersion('user-alice', 'rv-secret');
    assert.ok(aliceView);
    assert.equal(aliceView.id, 'rv-secret');
  });
});

test('listResumeVersionsForJob and listResumeVersionsForUser', async () => {
  await withTempStore(async () => {
    await insertResumeVersion({
      id: 'rv-base',
      userId: 'user-1',
      changeSummary: 'Base resume',
      structuredResume: sampleResume,
      approved: true,
      isBase: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await insertResumeVersion({
      id: 'rv-tailored-1',
      userId: 'user-1',
      jobId: 'job-xyz',
      changeSummary: 'Tailored for SRE role',
      structuredResume: sampleResume,
      approved: false,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const jobVersions = await listResumeVersionsForJob('user-1', 'job-xyz');
    assert.equal(jobVersions.length, 1);
    assert.equal(jobVersions[0]?.id, 'rv-tailored-1');

    const allUserVersions = await listResumeVersionsForUser('user-1');
    assert.equal(allUserVersions.length, 2);

    const base = await getBaseResumeVersion('user-1');
    assert.ok(base);
    assert.equal(base.id, 'rv-base');
    assert.equal(base.isBase, true);
  });
});

test('updateResumeVersion updates approved status and PDF url', async () => {
  await withTempStore(async () => {
    await insertResumeVersion({
      id: 'rv-pending',
      userId: 'user-1',
      jobId: 'job-abc',
      changeSummary: 'Initial draft',
      structuredResume: sampleResume,
      approved: false,
      isBase: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = await updateResumeVersion('user-1', 'rv-pending', {
      approved: true,
      tailoredResumeFileUrl: 'https://storage.blob.core.windows.net/resumes/rv-pending.pdf',
    });

    assert.ok(updated);
    assert.equal(updated.approved, true);
    assert.equal(
      updated.tailoredResumeFileUrl,
      'https://storage.blob.core.windows.net/resumes/rv-pending.pdf',
    );

    const reFetched = await getResumeVersion('user-1', 'rv-pending');
    assert.equal(reFetched?.approved, true);
  });
});
