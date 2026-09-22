import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { _resetContactStoreForTests } from '@/data/contact-store';
import { createJob, resetJobStoreForTests } from '@/data/job-store';
import type { JobContactRecord } from '@/types';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Test server did not provide a usable address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const USER_A = 'user_contacts_test_a';
const USER_B = 'user_contacts_test_b';

function hdrs(userId?: string) {
  return {
    'Content-Type': 'application/json',
    ...(userId ? { 'X-User-Id': userId } : {}),
  };
}

test('contacts API route lifecycle and fail-closed validation', async () => {
  const originalCwd = process.cwd();
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-contacts-test-'));

  try {
    process.chdir(tempDir);
    await resetJobStoreForTests();
    await _resetContactStoreForTests([]);

    // Seed a job for USER_A
    const jobA = await createJob(USER_A, {
      title: 'Senior Distributed Systems Engineer',
      company: 'Acme Cloud Inc',
      jobUrl: 'https://acme.com/jobs/dist-sys-1',
      descriptionText: 'Design and build distributed backend systems with Kafka and Go.',
      source: 'manual',
    });

    await withServer(async (baseUrl) => {
      // 1. Initial contacts list for job should be empty
      const listRes1 = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        headers: hdrs(USER_A),
      });
      assert.equal(listRes1.status, 200);
      const listData1 = (await listRes1.json()) as { contacts: JobContactRecord[] };
      assert.equal(listData1.contacts.length, 0);

      // 2. Reject if job not found or owned by another user
      const notFoundJobRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        headers: hdrs(USER_B),
      });
      assert.equal(notFoundJobRes.status, 404);

      // 3. Reject creation if missing name or roleTitle
      const badRes1 = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        method: 'POST',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          roleTitle: 'Engineering Manager',
          evidence: ['https://acme.com/team'],
        }),
      });
      assert.equal(badRes1.status, 400);

      // 4. Invariant: Fail closed when evidence is empty
      const badEvidenceRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        method: 'POST',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          name: 'Sarah Connor',
          roleTitle: 'Engineering Director',
          evidence: [],
        }),
      });
      assert.equal(badEvidenceRes.status, 400);
      const badEvidenceJson = (await badEvidenceRes.json()) as { error: string };
      assert.match(badEvidenceJson.error, /at least 1 public evidence URL/);

      // 5. Successful contact creation
      const createRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        method: 'POST',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          name: 'Sarah Connor',
          roleTitle: 'Engineering Director',
          evidence: [
            {
              url: 'https://news.ycombinator.com/item?id=3819201',
              title: 'Hiring Post',
              snippet: 'Leading backend platform team',
            },
          ],
          relevance: 'Hiring manager for Cloud Platform team',
          email: 'sconnor@acme.com',
          linkedinUrl: 'https://linkedin.com/in/sarah-connor-public',
        }),
      });
      assert.equal(createRes.status, 201);
      const createData = (await createRes.json()) as { contact: JobContactRecord };
      assert.ok(createData.contact.id);
      assert.equal(createData.contact.name, 'Sarah Connor');
      assert.equal(createData.contact.roleTitle, 'Engineering Director');
      assert.equal(createData.contact.status, 'found');
      assert.equal(createData.contact.evidence.length, 1);
      const contactId = createData.contact.id;

      // 6. Verify listed contacts contains created contact
      const listRes2 = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        headers: hdrs(USER_A),
      });
      assert.equal(listRes2.status, 200);
      const listData2 = (await listRes2.json()) as { contacts: JobContactRecord[] };
      assert.equal(listData2.contacts.length, 1);
      assert.equal(listData2.contacts[0]?.id, contactId);

      // 7. Update contact status and notes
      const patchRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          status: 'outreach_drafted',
          notes: 'Cold email draft prepared with shared background in Kafka',
        }),
      });
      assert.equal(patchRes.status, 200);
      const patchData = (await patchRes.json()) as { contact: JobContactRecord };
      assert.equal(patchData.contact.status, 'outreach_drafted');
      assert.equal(patchData.contact.notes, 'Cold email draft prepared with shared background in Kafka');

      // 8. Invariant: Updating evidence to empty must fail closed
      const badPatchRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          evidence: [],
        }),
      });
      assert.equal(badPatchRes.status, 400);

      // 9. Cross-user isolation: USER_B cannot patch or delete USER_A's contact
      const isolatePatchRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: hdrs(USER_B),
        body: JSON.stringify({ status: 'contacted' }),
      });
      assert.equal(isolatePatchRes.status, 404);

      const isolateDeleteRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'DELETE',
        headers: hdrs(USER_B),
      });
      assert.equal(isolateDeleteRes.status, 404);

      // 10. Delete contact as owner
      const deleteRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'DELETE',
        headers: hdrs(USER_A),
      });
      assert.equal(deleteRes.status, 200);

      // 11. Contacts list is empty again
      const listRes3 = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        headers: hdrs(USER_A),
      });
      assert.equal(listRes3.status, 200);
      const listData3 = (await listRes3.json()) as { contacts: JobContactRecord[] };
      assert.equal(listData3.contacts.length, 0);
    });
  } finally {
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await _resetContactStoreForTests([]);
    await rm(tempDir, { recursive: true, force: true });
  }
});
