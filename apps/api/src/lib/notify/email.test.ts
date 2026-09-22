import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';
import {
  EmailChannelAdapter,
  formatEmailHtml,
  formatEmailSubject,
  formatEmailText,
} from './email';
import type { NotificationSettings } from '@/types';
import type { NotificationPayload } from './types';

const defaultSettings: NotificationSettings = {
  channels: { in_app: true, email: true, telegram: false, web_push: false },
  minMatchScore: 80,
  digestHour: 9,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  emailAddress: 'user@example.com',
};

test('formatEmailSubject handles different notification kinds', () => {
  assert.equal(
    formatEmailSubject({
      kind: 'job_match',
      title: 'Senior Distributed Systems Engineer',
      body: 'Great match at Stripe',
      matchScore: 94,
    }),
    '[JobOps] 🎯 High Match: Senior Distributed Systems Engineer (94%)',
  );

  assert.equal(
    formatEmailSubject({
      kind: 'digest',
      title: 'Daily Digest: 3 matches, 1 follow-up',
      body: 'Your summary',
    }),
    '[JobOps] 📰 Daily Digest: 3 matches, 1 follow-up',
  );

  assert.equal(
    formatEmailSubject({
      kind: 'approval_needed',
      title: 'Review Tailored Resume for OpenAI',
      body: 'Draft resume ready',
    }),
    '[JobOps] ✍️ Action Required: Review Tailored Resume for OpenAI',
  );

  assert.equal(
    formatEmailSubject({
      kind: 'follow_up',
      title: 'Follow up with recruiter at Figma',
      body: '2 days overdue',
    }),
    '[JobOps] ⏰ Follow-up Due: Follow up with recruiter at Figma',
  );
});

test('formatEmailHtml and formatEmailText include deep links and match scores', () => {
  const payload: NotificationPayload = {
    kind: 'job_match',
    title: 'Principal Engineer <Platform>',
    body: 'First paragraph with detail.\n\nSecond paragraph with advice.',
    jobId: 'job-12345',
    matchScore: 91,
  };

  const html = formatEmailHtml(payload, 'http://localhost:3000');
  assert.match(html, /Principal Engineer &lt;Platform&gt;/);
  assert.match(html, /91% Match/);
  assert.match(html, /http:\/\/localhost:3000\/jobs\/job-12345/);
  assert.match(html, /http:\/\/localhost:3000\/settings/);
  assert.match(html, /First paragraph with detail/);

  const text = formatEmailText(payload, 'http://localhost:3000');
  assert.match(text, /Match Score: 91%/);
  assert.match(text, /http:\/\/localhost:3000\/jobs\/job-12345/);
  assert.match(text, /http:\/\/localhost:3000\/settings/);
});

test('EmailChannelAdapter isConfigured validation', () => {
  const adapter = new EmailChannelAdapter();
  const prevEnv = { ...process.env };

  try {
    delete process.env.DEFAULT_NOTIFICATION_EMAIL;
    delete process.env.N8N_EMAIL_WEBHOOK_URL;
    delete process.env.SMTP_HOST;
    process.env.NODE_ENV = 'production';

    // 1. Missing recipient
    assert.equal(
      adapter.isConfigured({ ...defaultSettings, emailAddress: undefined }),
      false,
    );

    // 2. Has recipient but no transport in production
    assert.equal(adapter.isConfigured(defaultSettings), false);

    // 3. n8n transport configured
    process.env.N8N_EMAIL_WEBHOOK_URL = 'https://n8n.example.com/webhook/email';
    assert.equal(adapter.isConfigured(defaultSettings), true);

    // 4. SMTP transport configured
    delete process.env.N8N_EMAIL_WEBHOOK_URL;
    process.env.SMTP_HOST = 'smtp.sendgrid.net';
    assert.equal(adapter.isConfigured(defaultSettings), true);

    // 5. Test mode
    delete process.env.SMTP_HOST;
    process.env.NODE_ENV = 'test';
    assert.equal(adapter.isConfigured(defaultSettings), true);
  } finally {
    process.env = prevEnv;
  }
});

test('EmailChannelAdapter sends via n8n webhook when configured', async () => {
  const adapter = new EmailChannelAdapter();
  const prevEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  try {
    process.env.N8N_EMAIL_WEBHOOK_URL = 'https://n8n.test.local/webhook/send-email';
    process.env.N8N_WEBHOOK_SECRET = 'secret-n8n-token';
    delete process.env.SMTP_HOST;

    let fetchCalled = false;
    let fetchUrl = '';
    let fetchOptions: RequestInit | undefined;

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalled = true;
      fetchUrl = String(url);
      fetchOptions = init;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const payload: NotificationPayload = {
      kind: 'job_match',
      title: 'Lead Architect',
      body: 'Matched 89%',
      matchScore: 89,
      jobId: 'job-lead-arch',
    };

    const result = await adapter.send('user-1', payload, defaultSettings);

    assert.equal(result.status, 'sent');
    assert.ok(result.sentAt);
    assert.equal(fetchCalled, true);
    assert.equal(fetchUrl, 'https://n8n.test.local/webhook/send-email');

    const headers = fetchOptions?.headers as Record<string, string>;
    assert.equal(headers['X-N8N-Webhook-Secret'], 'secret-n8n-token');

    const body = JSON.parse(fetchOptions?.body as string);
    assert.equal(body.to, 'user@example.com');
    assert.match(body.subject, /Lead Architect/);
    assert.equal(body.matchScore, 89);
    assert.equal(body.jobId, 'job-lead-arch');
  } finally {
    globalThis.fetch = originalFetch;
    process.env = prevEnv;
  }
});

test('EmailChannelAdapter sends via direct SMTP when configured', async () => {
  const adapter = new EmailChannelAdapter();
  const prevEnv = { ...process.env };
  const originalCreateTransport = nodemailer.createTransport;

  try {
    delete process.env.N8N_EMAIL_WEBHOOK_URL;
    process.env.SMTP_HOST = 'smtp.mailgun.org';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'postmaster@mg.example.com';
    process.env.SMTP_PASS = 'smtp-secret';

    let mailOptionsPassed: unknown;

    // @ts-expect-error Mock nodemailer createTransport
    nodemailer.createTransport = () => ({
      sendMail: async (options: unknown) => {
        mailOptionsPassed = options;
        return { messageId: '<msg-123@mg.example.com>' };
      },
    });

    const payload: NotificationPayload = {
      kind: 'approval_needed',
      title: 'Tailored Resume Ready',
      body: 'Please review before sending',
    };

    const result = await adapter.send('user-1', payload, defaultSettings);

    assert.equal(result.status, 'sent');
    assert.ok(result.sentAt);

    const mail = mailOptionsPassed as { to: string; subject: string; html: string; text: string };
    assert.equal(mail.to, 'user@example.com');
    assert.match(mail.subject, /Tailored Resume Ready/);
    assert.match(mail.html, /Tailored Resume Ready/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    process.env = prevEnv;
  }
});
