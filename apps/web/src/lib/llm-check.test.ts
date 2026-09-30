import { describe, expect, it } from 'vitest';
import { describeLlmCheck } from './llm-check';

// #348: Settings shows when the model last answered a real call, from the scheduled canary.
const NOW = new Date('2026-09-30T12:00:00Z');

describe('describeLlmCheck', () => {
  it('says when no check has run yet', () => {
    expect(describeLlmCheck(null, NOW)).toEqual({ ok: null, text: 'No model check has run yet.' });
  });

  it('says when the last check passed, and how long it took', () => {
    expect(
      describeLlmCheck({ ok: true, model: 'gpt-5.4-nano', latencyMs: 812, error: null, checkedAt: '2026-09-30T10:00:00Z' }, NOW),
    ).toEqual({ ok: true, text: 'Last model check passed 2 hours ago (0.8 s).' });
  });

  it('says when the last check failed, with the reason', () => {
    expect(
      describeLlmCheck(
        { ok: false, model: 'gpt-6-luna', latencyMs: null, error: 'Function tools are not supported for gpt-6-luna', checkedAt: '2026-09-30T11:55:00Z' },
        NOW,
      ),
    ).toEqual({ ok: false, text: 'Last model check failed 5 minutes ago: Function tools are not supported for gpt-6-luna' });
  });

  it('counts days for an old result', () => {
    expect(describeLlmCheck({ ok: true, model: 'm', latencyMs: null, error: null, checkedAt: '2026-09-27T12:00:00Z' }, NOW).text).toBe(
      'Last model check passed 3 days ago.',
    );
  });
});
