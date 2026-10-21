import { describe, expect, it } from 'vitest';
import { companyAndLocation, isDuplicateRemote, postingHref, salaryAsSaved } from './job-display';

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

// #355: the Add job review shows the salary as the store will save it: yearly, in its currency.
describe('salaryAsSaved', () => {
  it('writes a range, a floor, a ceiling and a single figure, a year, with the currency', () => {
    expect(salaryAsSaved({ min: 80000, max: 95000, currency: 'GBP' })).toBe('£80,000 – £95,000 a year (GBP)');
    expect(salaryAsSaved({ min: 90000, max: null, currency: 'USD' })).toBe('From $90,000 a year (USD)');
    expect(salaryAsSaved({ min: null, max: 120000, currency: 'EUR' })).toBe('Up to €120,000 a year (EUR)');
    expect(salaryAsSaved({ min: 100000, max: 100000, currency: 'USD' })).toBe('$100,000 a year (USD)');
  });
  it('writes plain figures for a currency it has no sign for', () => {
    expect(salaryAsSaved({ min: 120000, max: 150000, currency: 'CAD' })).toBe('120,000 – 150,000 a year (CAD)');
  });
  it('is nothing without an amount', () => {
    expect(salaryAsSaved({ min: null, max: null, currency: 'USD' })).toBeNull();
  });
});
