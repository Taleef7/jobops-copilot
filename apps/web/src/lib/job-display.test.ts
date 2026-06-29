import { describe, expect, it } from 'vitest';
import { isDuplicateRemote } from './job-display';

describe('isDuplicateRemote', () => {
  it('returns true when location is Remote and workplaceType is remote', () => {
    expect(isDuplicateRemote('Remote', 'remote')).toBe(true);
  });
  it('is case-insensitive for location', () => {
    expect(isDuplicateRemote('REMOTE', 'remote')).toBe(true);
    expect(isDuplicateRemote('remote', 'remote')).toBe(true);
  });
  it('trims leading/trailing whitespace from location', () => {
    expect(isDuplicateRemote('  Remote  ', 'remote')).toBe(true);
  });
  it('returns false when location is not Remote', () => {
    expect(isDuplicateRemote('New York, NY', 'remote')).toBe(false);
  });
  it('returns false when workplaceType is not remote', () => {
    expect(isDuplicateRemote('Remote', 'hybrid')).toBe(false);
  });
});
