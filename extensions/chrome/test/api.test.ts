import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  captureApplication,
  getProfileFill,
  matchJobByUrl,
  saveAnswer,
  verifyConnection,
} from '../src/shared/api';
import {
  DEFAULT_API_URL,
  getSettings,
  resetMemoryStoreForTests,
  saveSettings,
} from '../src/shared/storage';

function createMockServer(handler: http.RequestListener): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Bad address');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('storage helper gets defaults and saves settings', async () => {
  resetMemoryStoreForTests();
  const initial = await getSettings();
  assert.equal(initial.apiUrl, DEFAULT_API_URL);
  assert.equal(initial.pat, '');

  await saveSettings({ apiUrl: 'https://jobops.example.com', pat: 'jop_test123' });
  const updated = await getSettings();
  assert.equal(updated.apiUrl, 'https://jobops.example.com');
  assert.equal(updated.pat, 'jop_test123');
});

test('verifyConnection checks PAT validity with the API', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ext/verify');
    assert.equal(req.headers.authorization, 'Bearer jop_valid_pat');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      userId: 'user_test_999',
      token: {
        id: 'tok_1',
        label: 'My Test Browser',
        createdAt: '2026-09-22T00:00:00Z',
      },
    }));
  });

  try {
    const validRes = await verifyConnection(baseUrl, 'jop_valid_pat');
    assert.equal(validRes.ok, true);
    assert.equal(validRes.userId, 'user_test_999');
    assert.equal(validRes.token?.label, 'My Test Browser');

    // Empty token should fail immediately without network call
    const emptyRes = await verifyConnection(baseUrl, '');
    assert.equal(emptyRes.ok, false);
    assert.match(emptyRes.error || '', /required/i);
  } finally {
    await close();
  }
});

test('matchJobByUrl queries CRM matching endpoint', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    const url = new URL(req.url || '', 'http://127.0.0.1');
    assert.equal(url.pathname, '/api/ext/match');
    assert.equal(url.searchParams.get('url'), 'https://boards.greenhouse.io/acme/jobs/123');
    assert.equal(req.headers.authorization, 'Bearer jop_match_token');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      matched: true,
      job: {
        id: 'job_123',
        company: 'Acme Corp',
        title: 'Staff Systems Architect',
        status: 'shortlisted',
      },
      applicationPack: {
        jobId: 'job_123',
        answers: [{ questionText: 'Authorized in US?', answer: 'Yes' }],
        flaggedQuestions: [],
      },
    }));
  });

  try {
    const res = await matchJobByUrl(baseUrl, 'jop_match_token', 'https://boards.greenhouse.io/acme/jobs/123');
    assert.equal(res.matched, true);
    assert.equal(res.job?.company, 'Acme Corp');
    assert.equal(res.applicationPack?.answers.length, 1);
  } finally {
    await close();
  }
});

test('getProfileFill retrieves profile and Q&A answers', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ext/profile-fill');
    assert.equal(req.headers.authorization, 'Bearer jop_fill_token');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      profile: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
      },
      workExperience: [],
      education: [],
      skills: ['TypeScript', 'Rust'],
      answers: { 'salary': '$180k' },
    }));
  });

  try {
    const res = await getProfileFill(baseUrl, 'jop_fill_token');
    assert.equal(res.profile.fullName, 'Jane Doe');
    assert.equal(res.skills[0], 'TypeScript');
    assert.equal(res.answers['salary'], '$180k');
  } finally {
    await close();
  }
});

test('captureApplication records submission confirmation', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ext/applications');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer jop_cap_token');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      jobId: 'job_456',
      status: 'applied',
      created: false,
    }));
  });

  try {
    const res = await captureApplication(baseUrl, 'jop_cap_token', {
      jobId: 'job_456',
      atsName: 'lever',
      confirmationUrl: 'https://jobs.lever.co/thanks',
    });
    assert.equal(res.success, true);
    assert.equal(res.status, 'applied');
  } finally {
    await close();
  }
});

test('saveAnswer records new question & answer in Q&A memory', async () => {
  const { baseUrl, close } = await createMockServer((req, res) => {
    assert.equal(req.url, '/api/ext/answers');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.authorization, 'Bearer jop_ans_token');

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      answer: {
        id: 'ans_1',
        questionText: 'Are you legally authorized to work in the US?',
        answer: 'Yes',
      },
    }));
  });

  try {
    const res = await saveAnswer(
      baseUrl,
      'jop_ans_token',
      'Are you legally authorized to work in the US?',
      'Yes',
    );
    assert.equal(res.answer.id, 'ans_1');
    assert.equal(res.answer.answer, 'Yes');
  } finally {
    await close();
  }
});
