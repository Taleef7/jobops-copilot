import assert from 'node:assert/strict';
import test from 'node:test';
import { extractNumbers, unsupportedNumbers } from './numbers';

const values = (text: string) => extractNumbers(text).map((n) => [n.value, n.unit, n.year]);

test('numbers are read with their unit and multiplier', () => {
  assert.deepEqual(values('serving 2,000 merchants'), [[2000, '', false]]);
  assert.deepEqual(values('by 40%'), [[40, '%', false]]);
  assert.deepEqual(values('by 40 percent'), [[40, '%', false]]);
  assert.deepEqual(values('raised $1.2M'), [[1_200_000, 'cur', false]]);
  assert.deepEqual(values('2k users'), [[2000, '', false]]);
  assert.deepEqual(values('3x faster'), [[3, 'x', false]]);
  assert.deepEqual(values('from 12-15 min to 4 min'), [[12, '', false], [15, 't:minute', false], [4, 't:minute', false]]);
  assert.deepEqual(values('10+ years, a 3-month project, 40 ms'), [[10, 't:year', false], [3, 't:month', false], [40, 't:ms', false]]);
  assert.deepEqual(values('a million users, two thousand merchants'), [[1e6, '', false], [2000, '', false]]);
  assert.deepEqual(values('doubled throughput, halved costs, x3 faster, by60%'), [
    [2, 'x', false],
    [50, '%', false],
    [3, 'x', false],
    [60, '%', false],
  ]);
});

test('a unit of time is part of the claim', () => {
  assert.deepEqual(unsupportedNumbers('10 years of experience', 'saving 10 hours a week'), ['10 years']);
  assert.deepEqual(unsupportedNumbers('saving 10 hours weekly', 'saving 10 hours a week'), []);
  assert.deepEqual(unsupportedNumbers('Cut build time to 4 minutes', 'Cut build time to 4 min'), []);
});

test('each number in the evidence supports one claim', () => {
  assert.deepEqual(unsupportedNumbers('2,000 requests for 2,000 merchants', 'serving 2,000 merchants'), ['2,000']);
});

test('identifiers with a digit are not numbers', () => {
  assert.deepEqual(values('p95 latency on EC2 and S3 in Q3 with OAuth2'), []);
});

test('a plain four-digit year is a date', () => {
  assert.deepEqual(values('Since 2018'), [[2018, '', true]]);
});

test('number words count as numbers', () => {
  assert.deepEqual(values('Mentored two interns'), [[2, '', false]]);
  assert.deepEqual(values('three services, a dozen teams'), [[3, '', false], [12, '', false]]);
  // "one" is left out: "one of the first" is not a count.
  assert.deepEqual(values('one of the first'), []);
});

test('a number is supported by the same value, with the same unit or none', () => {
  const evidence = 'Reduced p95 latency by 40% for 2,000 merchants; mentored two interns';
  assert.deepEqual(unsupportedNumbers('Cut latency 40% for 2000 merchants', evidence), []);
  assert.deepEqual(unsupportedNumbers('Cut latency 40 percent', evidence), []);
  assert.deepEqual(unsupportedNumbers('Cut latency by 40', evidence), [], 'dropping a unit claims no more');
  assert.deepEqual(unsupportedNumbers('Mentored 2 interns', evidence), []);
  assert.deepEqual(unsupportedNumbers('Cut latency 60%', evidence), ['60%']);
  assert.deepEqual(unsupportedNumbers('Cut latency 40x', evidence), ['40x']);
  assert.deepEqual(unsupportedNumbers('Mentored three interns', evidence), ['three']);
});
