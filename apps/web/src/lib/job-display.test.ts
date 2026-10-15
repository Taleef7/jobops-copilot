import { describe, expect, it } from 'vitest';
import { companyAndLocation, isDuplicateRemote, postingHref } from './job-display';

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
  it('returns false when the workplace is not stated (#355)', () => {
    expect(isDuplicateRemote('Remote', null)).toBe(false);
  });
});

// #355: a job can state no location; the list line is then the company alone.
describe('companyAndLocation', () => {
  it('joins the company and the location', () => {
    expect(companyAndLocation({ company: 'Acme', location: 'London, United Kingdom' })).toBe('Acme · London, United Kingdom');
  });
  it('is the company alone when the location is not stated', () => {
    expect(companyAndLocation({ company: 'Acme', location: '' })).toBe('Acme');
    expect(companyAndLocation({ company: 'Acme', location: '  ' })).toBe('Acme');
  });
});

// #353: the posting link opens only a web address, written out in full.
describe('postingHref', () => {
  it('returns an http or https address', () => {
    expect(postingHref('https://jobs.lever.co/jobot/123')).toBe('https://jobs.lever.co/jobot/123');
    expect(postingHref('http://boards.example.com/1')).toBe('http://boards.example.com/1');
  });
  it('writes out "http:host", which a page on http would resolve against itself', () => {
    expect(postingHref('http:evil.com')).toBe('http://evil.com/');
  });
  it('returns null for anything else', () => {
    expect(postingHref(undefined)).toBeNull();
    expect(postingHref('javascript:alert(1)')).toBeNull();
    expect(postingHref('not a url')).toBeNull();
  });
});
