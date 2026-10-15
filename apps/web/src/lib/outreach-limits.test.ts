import { describe, expect, it } from 'vitest';
import { draftLengthWarning } from './outreach-limits';

// #354: LinkedIn cuts a connection note at 300 characters, counted as JS .length (UTF-16).
describe('draftLengthWarning', () => {
  it('warns about a LinkedIn connection note over 300 characters', () => {
    expect(draftLengthWarning('linkedin_connection', 'a'.repeat(301))).toMatch(/^Over 300 characters \(301\)/);
    expect(draftLengthWarning('linkedin_connection', 'a'.repeat(300))).toBeNull();
  });

  it('counts UTF-16 units, as LinkedIn does', () => {
    // 299 characters and one emoji: 301 UTF-16 units.
    expect(draftLengthWarning('linkedin_connection', `${'a'.repeat(299)}\u{1F44B}`)).toMatch(/\(301\)/);
  });

  it('has no limit for other message types', () => {
    expect(draftLengthWarning('recruiter_email', 'a'.repeat(420))).toBeNull();
  });
});
