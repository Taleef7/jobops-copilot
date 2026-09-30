import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '@/app';
import { summaryFromResume } from '@/routes/contacts';
import { _resetContactStoreForTests } from '@/data/contact-store';
import { createJob, getJobById, resetJobStoreForTests } from '@/data/job-store';
import { deleteUserProfile, upsertUserProfile } from '@/data/profile-store';
import type { JobContactRecord } from '@/types';
import { fakeAgentAnswer } from '@/test-support/fake-agent';

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

test('contacts API route lifecycle and validation', async () => {
  const originalCwd = process.cwd();
  const savedAgent = process.env.AGENT_SERVICE_URL;
  delete process.env.DATABASE_URL;
  const tempDir = await mkdtemp(join(tmpdir(), 'jobops-contacts-test-'));
  const agentBodies: Array<Record<string, unknown>> = [];
  const agent = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      if (raw) agentBodies.push(JSON.parse(raw) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fakeAgentAnswer(request.url)));
    });
  });
  await new Promise<void>((resolve) => agent.listen(0, resolve));
  const agentAddress = agent.address();
  if (!agentAddress || typeof agentAddress === 'string') throw new Error('no agent address');
  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${agentAddress.port}`;

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
        }),
      });
      assert.equal(badRes1.status, 400);

      // 4. A person the user knows needs no evidence: a name and a role are enough.
      const knownRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        method: 'POST',
        headers: hdrs(USER_A),
        body: JSON.stringify({ name: 'Jamie Lee', roleTitle: 'Recruiter' }),
      });
      assert.equal(knownRes.status, 201);
      const known = ((await knownRes.json()) as { contact: JobContactRecord }).contact;
      assert.deepEqual(known.evidence, []);
      assert.equal(known.status, 'found');

      const emptyEvidenceRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        method: 'POST',
        headers: hdrs(USER_A),
        body: JSON.stringify({ name: 'Priya Shah', roleTitle: 'Engineering Manager', evidence: [] }),
      });
      assert.equal(emptyEvidenceRes.status, 201);

      // Links are rendered as links, so they must be http(s).
      for (const body of [
        { name: 'X', roleTitle: 'Y', evidence: 'https://acme.com' },
        { name: 'X', roleTitle: 'Y', evidence: ['javascript:alert(1)'] },
        { name: 'X', roleTitle: 'Y', linkedinUrl: 'javascript:alert(1)' },
        { name: 'X', roleTitle: 'Y', linkedinUrl: 'linkedin.com/in/x' },
        // The card labels this link "LinkedIn", so other sites go in evidence.
        { name: 'X', roleTitle: 'Y', linkedinUrl: 'https://github.com/x' },
        { name: 'X', roleTitle: 'Y', linkedinUrl: 'https://notlinkedin.com/in/x' },
      ]) {
        const res = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
          method: 'POST',
          headers: hdrs(USER_A),
          body: JSON.stringify(body),
        });
        assert.equal(res.status, 400, JSON.stringify(body));
      }

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
      assert.equal(listData2.contacts.length, 3);
      assert.ok(listData2.contacts.some((c) => c.id === contactId));

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

      // 8. Evidence can be cleared, and a link must still be http(s)
      const clearPatchRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: hdrs(USER_A),
        body: JSON.stringify({
          evidence: [],
        }),
      });
      assert.equal(clearPatchRes.status, 200);
      const cleared = ((await clearPatchRes.json()) as { contact: JobContactRecord }).contact;
      assert.deepEqual(cleared.evidence, []);

      const badLinkPatchRes = await fetch(`${baseUrl}/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: hdrs(USER_A),
        body: JSON.stringify({ linkedinUrl: 'javascript:alert(1)' }),
      });
      assert.equal(badLinkPatchRes.status, 400);

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

      // 11. The deleted contact is gone
      const listRes3 = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, {
        headers: hdrs(USER_A),
      });
      assert.equal(listRes3.status, 200);
      const listData3 = (await listRes3.json()) as { contacts: JobContactRecord[] };
      assert.deepEqual(
        listData3.contacts.map((c) => c.name).sort(),
        ['Jamie Lee', 'Priya Shah'],
      );

      // 12. Scout People is gone: it invented contacts from the company name
      const scoutRes = await fetch(`${baseUrl}/api/jobs/${jobA.id}/scout`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(scoutRes.status, 404);

      // 13. Drafting outreach with no résumé on file is refused, and nothing is written
      const noResumeRes = await fetch(`${baseUrl}/api/contacts/${known.id}/draft-outreach`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(noResumeRes.status, 409);
      const noResume = (await noResumeRes.json()) as { code: string; error: string };
      assert.equal(noResume.code, 'RESUME_REQUIRED');
      assert.match(noResume.error, /résumé/);
      assert.equal((await getJobById(USER_A, jobA.id))?.outreach?.length ?? 0, 0);
      const afterRefusal = await fetch(`${baseUrl}/api/jobs/${jobA.id}/contacts`, { headers: hdrs(USER_A) });
      const refusedContact = ((await afterRefusal.json()) as { contacts: JobContactRecord[] }).contacts.find(
        (c) => c.id === known.id,
      );
      assert.equal(refusedContact?.status, 'found');

      // A structured résumé with nothing to draw on is refused the same way.
      await upsertUserProfile(USER_A, {
        baseResume: { basics: { name: 'A', email: 'a@example.com', summary: '' }, work: [], education: [], skills: [] },
      });
      const emptyResumeRes = await fetch(`${baseUrl}/api/contacts/${known.id}/draft-outreach`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(emptyResumeRes.status, 409);

      // 14. A structured résumé without a summary still grounds the draft (its role and skills)
      await upsertUserProfile(USER_A, {
        baseResume: {
          basics: { name: 'A', email: 'a@example.com', summary: '' },
          work: [{ company: 'Globex', position: 'Backend Engineer', startDate: '2022-01', highlights: [] }],
          education: [],
          skills: [{ category: 'Languages', skills: ['Go', 'Kafka'] }],
        },
      });
      const targetContact = known;
      const draftRes1 = await fetch(`${baseUrl}/api/contacts/${targetContact.id}/draft-outreach`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(draftRes1.status, 200);
      const draftData1 = (await draftRes1.json()) as {
        contact: JobContactRecord;
        draft: {
          id: string;
          contactName?: string;
          contactRole?: string;
          draftText: string;
          status: string;
        };
      };

      assert.equal(draftData1.contact.id, targetContact.id);
      assert.equal(draftData1.contact.status, 'outreach_drafted');
      assert.ok(draftData1.draft.id);
      assert.equal(draftData1.draft.contactName, targetContact.name);
      assert.equal(draftData1.draft.status, 'drafted');
      assert.ok(draftData1.draft.draftText.length > 0);
      assert.equal((await getJobById(USER_A, jobA.id))?.outreach?.length, 1);
      // The agent was given the user's own role and skills, not an invented background.
      const summarySent = String(agentBodies.at(-1)?.resume_summary ?? '');
      assert.match(summarySent, /Backend Engineer at Globex/);
      assert.match(summarySent, /Go, Kafka/);

      // 15. When the AI can't answer, the draft is refused as retryable and nothing is saved (#349).
      process.env.AGENT_SERVICE_URL = 'http://127.0.0.1:9';
      const unavailable = await fetch(`${baseUrl}/api/contacts/${targetContact.id}/draft-outreach`, {
        method: 'POST',
        headers: hdrs(USER_A),
      });
      assert.equal(unavailable.status, 503);
      assert.equal(((await unavailable.json()) as { retryable?: boolean }).retryable, true);
      assert.equal((await getJobById(USER_A, jobA.id))?.outreach?.length, 1);

      // Cross-user isolation: USER_B cannot draft outreach for USER_A's contact
      const isolateDraftRes = await fetch(
        `${baseUrl}/api/contacts/${targetContact.id}/draft-outreach`,
        {
          method: 'POST',
          headers: hdrs(USER_B),
        },
      );
      assert.equal(isolateDraftRes.status, 404);
    });
  } finally {
    if (savedAgent === undefined) delete process.env.AGENT_SERVICE_URL;
    else process.env.AGENT_SERVICE_URL = savedAgent;
    agent.closeAllConnections();
    await new Promise<void>((resolve) => agent.close(() => resolve()));
    await deleteUserProfile(USER_A);
    process.chdir(originalCwd);
    await resetJobStoreForTests();
    await _resetContactStoreForTests([]);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('summaryFromResume uses only fields from the user résumé', () => {
  assert.equal(summaryFromResume(null), '');
  assert.equal(
    summaryFromResume({ basics: { name: 'A', email: 'a@x.com', summary: '' }, work: [], education: [], skills: [] }),
    '',
  );
  assert.equal(
    summaryFromResume({
      basics: { name: 'A', email: 'a@x.com', summary: '', label: 'Software Engineer' },
      work: [
        { company: '', position: 'Intern', startDate: '2020', highlights: [] },
        { company: 'Globex', position: 'Backend Engineer', startDate: '2022', highlights: [] },
      ],
      education: [],
      skills: [
        { category: 'Languages', skills: ['Go', ' ', 'TypeScript'] },
        { category: 'Data', skills: ['PostgreSQL'] },
      ],
    }),
    'Software Engineer. Recent role: Backend Engineer at Globex. Skills: Go, TypeScript, PostgreSQL.',
  );
});
