import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatTelegramMessage,
  TelegramChannelAdapter,
} from './telegram';
import type { NotificationSettings } from '@/types';

test('Telegram message formatting with HTML escaping and deep links', () => {
  const formatted = formatTelegramMessage({
    kind: 'job_match',
    title: 'Senior Engineer <Core & Infrastructure>',
    body: 'Found on Greenhouse with 95% match & H1B sponsorship.',
    jobId: 'job-xyz-123',
    matchScore: 95,
  });

  assert.match(formatted, /🎯/);
  assert.match(formatted, /Senior Engineer &lt;Core &amp; Infrastructure&gt;/);
  assert.match(formatted, /<b>Match Score:<\/b> 95%/);
  assert.match(formatted, /<a href="http:\/\/localhost:3000\/jobs\/job-xyz-123">Open Job in JobOps Copilot<\/a>/);
});

test('TelegramChannelAdapter configuration resolution', () => {
  const adapter = new TelegramChannelAdapter();
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;

  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const baseSettings: NotificationSettings = {
      channels: { in_app: true, email: false, telegram: true, web_push: false },
      minMatchScore: 80,
      digestHour: 9,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
    };

    // Neither configured
    assert.equal(adapter.isConfigured(baseSettings), false);

    // Bot token only, no chat ID
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token';
    assert.equal(adapter.isConfigured(baseSettings), false);

    // Chat ID in settings
    const settingsWithChat: NotificationSettings = { ...baseSettings, telegramChatId: 'chat-12345' };
    assert.equal(adapter.isConfigured(settingsWithChat), true);

    // Chat ID in env fallback
    settingsWithChat.telegramChatId = null;
    process.env.TELEGRAM_CHAT_ID = 'chat-env-999';
    assert.equal(adapter.isConfigured(baseSettings), true);
  } finally {
    if (originalToken) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (originalChatId) process.env.TELEGRAM_CHAT_ID = originalChatId;
    else delete process.env.TELEGRAM_CHAT_ID;
  }
});

test('TelegramChannelAdapter send lifecycle with mocked fetch responses', async () => {
  const adapter = new TelegramChannelAdapter();
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalFetch = globalThis.fetch;

  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
  const settings: NotificationSettings = {
    channels: { in_app: true, email: false, telegram: true, web_push: false },
    minMatchScore: 80,
    digestHour: 9,
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    telegramChatId: 'test-chat-456',
  };

  try {
    // 1. Success delivery (HTTP 200)
    let interceptedUrl = '';
    let interceptedBody: Record<string, unknown> | null = null;

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      interceptedUrl = url ? url.toString() : '';
      interceptedBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const resultSuccess = await adapter.send('user-1', {
      kind: 'approval_needed',
      title: 'Resume Tailor Approval Needed',
      body: 'Tailored resume ready for review',
      jobId: 'job-abc',
    }, settings);

    assert.equal(resultSuccess.status, 'sent');
    assert.ok(resultSuccess.sentAt);
    assert.equal(interceptedUrl, 'https://api.telegram.org/bottest-token-123/sendMessage');
    const sentData = interceptedBody as { chat_id?: string; text?: string } | null;
    assert.equal(sentData?.chat_id, 'test-chat-456');
    assert.match(sentData?.text as string, /Resume Tailor Approval Needed/);

    // 2. Telegram API error (HTTP 400: chat not found)
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const resultApiError = await adapter.send('user-1', {
      kind: 'digest',
      title: 'Daily Digest',
      body: 'Digest content',
    }, settings);

    assert.equal(resultApiError.status, 'failed');
    assert.match(resultApiError.error || '', /Bad Request: chat not found/i);

    // 3. Network fetch error
    globalThis.fetch = async () => {
      throw new Error('Connection refused to api.telegram.org');
    };

    const resultNetError = await adapter.send('user-1', {
      kind: 'follow_up',
      title: 'Follow Up',
      body: 'Reminder',
    }, settings);

    assert.equal(resultNetError.status, 'failed');
    assert.match(resultNetError.error || '', /Connection refused/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
  }
});
