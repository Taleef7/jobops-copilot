import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVocab, termsIn } from './terms';

const vocab = buildVocab(['Amazon Web Services (AWS)', 'Python 3.11', 'Snowflake']);

test('known tools are found by name or alias', () => {
  assert.deepEqual(termsIn('Wrote services in Golang', vocab), ['go']);
  assert.deepEqual(termsIn('Wrote services in Go', vocab), ['go']);
  assert.deepEqual(termsIn('Deployed on k8s with Node.js', vocab).sort(), ['kubernetes', 'node.js']);
  assert.deepEqual(termsIn('Ran it on AWS', vocab), ['amazon web services']);
  assert.deepEqual(termsIn('Scripts in Python', vocab), ['python']);
  assert.deepEqual(termsIn('Loaded data into Snowflake', vocab), ['snowflake']);
});

test('short names that are also words only count as written', () => {
  assert.deepEqual(termsIn('Partnered with sales on the go-to-market launch', vocab), []);
  assert.deepEqual(termsIn('Ready to go live', vocab), []);
  assert.deepEqual(termsIn('Built a service in Go', vocab), ['go']);
  assert.deepEqual(termsIn('Wrote C++ code', vocab), ['c++']);
  assert.deepEqual(termsIn('Wrote C# code', vocab), ['c#']);
});
