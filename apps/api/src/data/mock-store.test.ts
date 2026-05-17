import assert from 'node:assert/strict';
import test from 'node:test';
import { draftOutreachBody } from './mock-store';

test('draft outreach copy uses the contact role naturally and avoids raw enum names', () => {
  const result = draftOutreachBody({
    message_type: 'recruiter_email',
    contact_name: 'Maya',
    contact_role: 'Recruiter',
    job_context: 'Workflow automation and CRM ownership',
    resume_summary: 'workflow automation, reporting, and operations support',
  });

  assert.equal(result.subject, 'Interest in the role and a quick introduction');
  assert.match(result.draft_text, /Hi Maya,/);
  assert.match(result.draft_text, /you'?re the recruiter/i);
  assert.doesNotMatch(result.draft_text, /recruiter_email/);
  assert.doesNotMatch(result.draft_text, /opportunity with Recruiter/);
});

test('draft outreach copy falls back to generic resume language when no summary is provided', () => {
  const result = draftOutreachBody({
    message_type: 'follow_up',
    contact_role: 'Hiring Manager',
  });

  assert.match(result.draft_text, /I have relevant experience in workflow automation/i);
});
