import assert from 'node:assert/strict';
import test from 'node:test';
import type { StructuredResume } from '@/types';
import { keywordCount, keywordsOnResume, keywordTerms } from './keywords';

/** The posting's keywords in the tailor window (#351): skills to confirm, not requirements. */

const resume: StructuredResume = {
  basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Made it work for US customers at 5 pm. Led UX reviews.' },
  work: [{ company: 'Globex', position: 'Engineer', startDate: '2022-01', highlights: ['Built services in Node.js and C#'] }],
  education: [],
  skills: [{ category: 'Languages', skills: ['Go', 'C++'] }],
};

test('skills are offered, with digits, short names and words requirements also start with', () => {
  const skills = [
    'S3',
    'HTML5',
    'OAuth 2.0',
    'ES6+',
    'Java 8+',
    'Solid.js',
    'Master Data Management',
    'Knowledge Graphs',
    'Experience Design',
    'Strong typing',
  ];
  assert.deepEqual(keywordTerms(skills), skills);
});

test('requirements written as phrases are not offered', () => {
  assert.deepEqual(
    keywordTerms([
      'Excellent written communication skills',
      'Strong communication skills',
      "Bachelor's degree in CS",
      "Master's in Statistics",
      'Degree in Computer Science',
      '5+ years of Go',
      '3 years experience',
      'Experience with distributed systems',
      'Knowledge of payments',
      'Familiarity with Kafka',
      'Ability to work independently',
      'Proven track record',
      'Building reliable services for millions of users',
    ]),
    [],
  );
});

test('a short all-caps keyword is on the résumé only as that word, not a lower-case one', () => {
  assert.deepEqual(keywordsOnResume(['IT', 'PM', 'QA', 'UX', 'US'], resume), [
    { term: 'IT', onResume: false },
    { term: 'PM', onResume: false },
    { term: 'QA', onResume: false },
    { term: 'UX', onResume: true },
    { term: 'US', onResume: true },
  ]);
});

test('keywords with symbols match as whole words', () => {
  assert.deepEqual(
    keywordsOnResume(['C#', 'C++', 'Node.js', 'Go', 'C'], resume).map((k) => k.onResume),
    [true, true, true, true, false],
  );
  assert.equal(keywordCount(['IT', 'UX', 'C#', 'ux'], resume), 2);
});
