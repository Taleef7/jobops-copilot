import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetContactStoreForTests,
  deleteJobContact,
  getJobContactById,
  insertJobContact,
  listJobContacts,
  normalizeEvidence,
  updateJobContact,
} from './contact-store';

test('normalizeEvidence handles strings, objects, and trims empty items', () => {
  const result = normalizeEvidence([
    'https://company.com/team/jane',
    { url: ' https://news.ycombinator.com/item?id=123 ', title: 'Who is hiring post' },
    { url: '   ' } as unknown as { url: string },
    '' as unknown as string,
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { url: 'https://company.com/team/jane' });
  assert.deepEqual(result[1], {
    url: 'https://news.ycombinator.com/item?id=123',
    title: 'Who is hiring post',
    snippet: undefined,
  });
});

test('contact-store enforces evidence requirement and CRUD operations', async () => {
  await _resetContactStoreForTests([]);

  const userA = 'user_test_alpha';
  const userB = 'user_test_beta';
  const job1 = 'job_uuid_1';
  const job2 = 'job_uuid_2';

  // Invariant check: must fail closed when evidence is empty
  await assert.rejects(
    async () => {
      await insertJobContact(userA, job1, {
        name: 'Jane Doe',
        roleTitle: 'Engineering Manager',
        evidence: [],
      });
    },
    { message: /Every contact must carry at least 1 public evidence URL/ },
  );

  // Successful insert
  const contact1 = await insertJobContact(userA, job1, {
    name: 'Jane Doe',
    roleTitle: 'Engineering Manager',
    evidence: ['https://example.com/team/jane'],
    relevance: 'Hiring manager for Backend Team',
    email: 'jane@example.com',
  });

  assert.ok(contact1.id);
  assert.equal(contact1.name, 'Jane Doe');
  assert.equal(contact1.roleTitle, 'Engineering Manager');
  assert.equal(contact1.status, 'found');
  assert.equal(contact1.evidence.length, 1);
  assert.equal(contact1.evidence[0]?.url, 'https://example.com/team/jane');

  // Insert second contact for same job
  const contact2 = await insertJobContact(userA, job1, {
    name: 'Bob Recruiter',
    roleTitle: 'Tech Talent Lead',
    evidence: [{ url: 'https://linkedin.com/in/bob-public', title: 'Public profile' }],
  });

  // Insert contact for different job
  await insertJobContact(userA, job2, {
    name: 'Alice Staff',
    roleTitle: 'Principal Engineer',
    evidence: ['https://github.com/alice'],
  });

  // Insert contact for userB
  await insertJobContact(userB, job1, {
    name: 'Charlie Other',
    roleTitle: 'Director',
    evidence: ['https://example.com/charlie'],
  });

  // Verify list filtered by user and job
  const job1Contacts = await listJobContacts(userA, job1);
  assert.equal(job1Contacts.length, 2);
  assert.equal(job1Contacts[0]?.name, 'Jane Doe');
  assert.equal(job1Contacts[1]?.name, 'Bob Recruiter');

  // Verify user isolation
  const userBContacts = await listJobContacts(userB, job1);
  assert.equal(userBContacts.length, 1);
  assert.equal(userBContacts[0]?.name, 'Charlie Other');

  // Verify getJobContactById
  const retrieved = await getJobContactById(userA, contact1.id);
  assert.ok(retrieved);
  assert.equal(retrieved?.id, contact1.id);
  assert.equal(await getJobContactById(userB, contact1.id), null);

  // Verify update status and notes
  const updated = await updateJobContact(userA, contact1.id, {
    status: 'outreach_drafted',
    notes: 'Drafted introduction email',
  });
  assert.ok(updated);
  assert.equal(updated?.status, 'outreach_drafted');
  assert.equal(updated?.notes, 'Drafted introduction email');

  // Verify updating with empty evidence fails closed
  await assert.rejects(
    async () => {
      await updateJobContact(userA, contact1.id, {
        evidence: [],
      });
    },
    { message: /Every contact must carry at least 1 public evidence URL/ },
  );

  // Verify delete
  const deleted = await deleteJobContact(userA, contact1.id);
  assert.equal(deleted, true);
  assert.equal(await getJobContactById(userA, contact1.id), null);

  const remaining = await listJobContacts(userA, job1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, contact2.id);
});
