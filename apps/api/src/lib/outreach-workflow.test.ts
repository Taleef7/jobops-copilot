import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveOutreachJobUpdate } from './outreach-workflow';

test('preserves later workflow states when outreach changes', () => {
  assert.equal(
    deriveOutreachJobUpdate('interview', [{ status: 'drafted' }]),
    null,
  );
  assert.equal(
    deriveOutreachJobUpdate('rejected', [{ status: 'sent' }]),
    null,
  );
  assert.equal(
    deriveOutreachJobUpdate('offer', [{ status: 'approved' }]),
    null,
  );
});

test('keeps outreach_sent when any draft has been sent', () => {
  assert.deepEqual(
    deriveOutreachJobUpdate('outreach_drafted', [
      { status: 'drafted' },
      { status: 'sent' },
      { status: 'skipped' },
    ]),
    {
      status: 'outreach_sent',
      nextAction: 'Track the reply window and prepare a follow-up if needed.',
    },
  );
});

test('falls back to outreach_drafted when drafts exist but none are sent', () => {
  assert.deepEqual(
    deriveOutreachJobUpdate('applied', [
      { status: 'drafted' },
      { status: 'approved' },
    ]),
    {
      status: 'outreach_drafted',
      nextAction: 'Review the outreach draft and approve or skip it manually.',
    },
  );
});
