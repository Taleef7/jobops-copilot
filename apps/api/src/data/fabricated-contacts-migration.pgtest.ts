import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { insertJobContact, listJobContacts } from './contact-store';
import { createJob } from './job-store';
import { findMigrationDir } from '@/lib/migrations';
import { getPool } from '@/lib/postgres';

// Runs only against a real, ephemeral Postgres (see the `db` CI job). Migration 025
// deletes contacts irreversibly, so it must remove exactly what Scout People generated
// and never a contact the user saved, even one with a careers@ or engineering@ address.
const DB = process.env.DATABASE_URL?.trim();

test(
  'migration 025 deletes only the contacts Scout People generated',
  { skip: DB ? false : 'DATABASE_URL not set — Postgres integration test skipped' },
  async () => {
    const userId = `itest_025_${randomUUID().slice(0, 8)}`;
    const job = await createJob(userId, { company: 'Acme Corp', title: 'Engineer', descriptionText: 'x' });

    // The three shapes the scout route and the graph fallback wrote.
    await insertJobContact(userId, job.id, {
      name: 'Acme Corp Talent Acquisition',
      roleTitle: 'Technical Recruiting Partner at Acme Corp',
      email: 'careers@acmecorp.com',
      notes: 'Discovered from verified public careers directory for Acme Corp',
    });
    await insertJobContact(userId, job.id, {
      name: 'Acme Corp Engineering Leadership',
      roleTitle: 'Engineering Leadership Team at Acme Corp',
      email: 'engineering@acmecorp.com',
      // Drafting outreach appended to the generated note.
      notes: 'Discovered from verified public leadership directory for Acme Corp\nDrafted outreach: "Hello"',
    });
    await insertJobContact(userId, job.id, {
      name: 'Talent Acquisition Lead',
      roleTitle: 'Technical Recruiting Partner at Acme Corp',
      email: 'careers@acmecorp.com',
      notes: 'Identified from verified public company career page',
    });

    // Contacts the user saved themselves.
    await insertJobContact(userId, job.id, {
      name: 'Acme careers inbox',
      roleTitle: 'Recruiting team',
      email: 'careers@acme.com',
      notes: 'From the posting footer',
    });
    await insertJobContact(userId, job.id, {
      name: 'Acme engineering',
      roleTitle: 'Engineering team',
      email: 'engineering@acme.com',
    });

    const dir = findMigrationDir(__dirname);
    assert.ok(dir, 'db/migrations not found');
    const sql = await readFile(join(dir, '025_delete_fabricated_contacts.sql'), 'utf8');
    await getPool()!.query(sql);

    const remaining = (await listJobContacts(userId, job.id)).map((c) => c.name).sort();
    assert.deepEqual(remaining, ['Acme careers inbox', 'Acme engineering']);
  },
);
