import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDueFollowUps } from './n8n';
import type { JobRecord } from '@/types';

// #412: a cleared next action reads back as '', and the reminder still says what to do.
test('a due follow-up with no next action gets the default one', () => {
  const job = {
    id: 'due-job',
    company: 'Acme',
    title: 'Engineer',
    status: 'follow_up_due',
    nextAction: '',
    nextActionDue: '2026-05-16T09:00:00.000Z',
    outreach: [],
  } as unknown as JobRecord;
  const [reminder] = selectDueFollowUps([job], new Date('2026-05-17T09:00:00.000Z'));
  assert.equal(reminder?.nextAction, 'Review the job and decide on the next step.');
});
