import assert from 'node:assert/strict';
import test from 'node:test';
import { agentHeaders } from './agent-client';

// agentHeaders reads AGENT_API_KEY lazily, so each case toggles the env directly (QA·A).
test('agentHeaders attaches a Bearer token when AGENT_API_KEY is set', () => {
  process.env.AGENT_API_KEY = 'sh4red-secret';
  try {
    const headers = agentHeaders({ 'Content-Type': 'application/json' });
    assert.equal(headers.Authorization, 'Bearer sh4red-secret');
    assert.equal(headers['Content-Type'], 'application/json');
  } finally {
    delete process.env.AGENT_API_KEY;
  }
});

test('agentHeaders omits Authorization when AGENT_API_KEY is unset', () => {
  delete process.env.AGENT_API_KEY;
  const headers = agentHeaders({ 'Content-Type': 'application/json' });
  assert.equal('Authorization' in headers, false);
  assert.equal(headers['Content-Type'], 'application/json');
});

test('agentHeaders works with no extra headers', () => {
  process.env.AGENT_API_KEY = 'k';
  try {
    assert.equal(agentHeaders().Authorization, 'Bearer k');
  } finally {
    delete process.env.AGENT_API_KEY;
  }
});
