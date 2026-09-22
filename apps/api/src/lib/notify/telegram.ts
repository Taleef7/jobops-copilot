import type { NotificationSettings } from '@/types';
import type {
  ChannelDeliveryResult,
  NotificationChannelAdapter,
  NotificationPayload,
} from '@/lib/notify/types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramMessage(
  payload: NotificationPayload,
  webBaseUrl: string = process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000',
): string {
  const parts: string[] = [];

  // Title with emoji icon based on kind
  let icon = '🔔';
  if (payload.kind === 'job_match') icon = '🎯';
  else if (payload.kind === 'digest') icon = '📰';
  else if (payload.kind === 'follow_up') icon = '⏰';
  else if (payload.kind === 'approval_needed') icon = '✍️';
  else if (payload.kind === 'agent_done') icon = '🤖';

  parts.push(`${icon} <b>${escapeHtml(payload.title)}</b>`);

  // Match score if available
  if (payload.matchScore !== undefined) {
    parts.push(`<b>Match Score:</b> ${payload.matchScore}%`);
  }

  // Body content
  if (payload.body) {
    parts.push(escapeHtml(payload.body));
  }

  // Deep link
  if (payload.jobId) {
    const jobUrl = `${webBaseUrl.replace(/\/$/, '')}/jobs/${encodeURIComponent(payload.jobId)}`;
    parts.push(`👉 <a href="${jobUrl}">Open Job in JobOps Copilot</a>`);
  }

  return parts.join('\n\n');
}

export class TelegramChannelAdapter implements NotificationChannelAdapter {
  name = 'telegram';

  isConfigured(settings: NotificationSettings): boolean {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = settings.telegramChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();
    return Boolean(token && chatId);
  }

  async send(
    _userId: string,
    payload: NotificationPayload,
    settings: NotificationSettings,
  ): Promise<ChannelDeliveryResult> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = settings.telegramChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();

    if (!token || !chatId) {
      return {
        status: 'skipped',
        error: 'Telegram bot token or chat ID is not configured',
      };
    }

    const text = formatTelegramMessage(payload);
    const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      if (!response.ok) {
        let errorDetail = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { description?: string };
          if (body.description) {
            errorDetail = body.description;
          }
        } catch {
          // ignore parsing error
        }
        return {
          status: 'failed',
          error: `Telegram API error: ${errorDetail}`,
        };
      }

      return {
        status: 'sent',
        sentAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return {
        status: 'failed',
        error: `Telegram delivery failed: ${message}`,
      };
    }
  }
}

export const telegramAdapter = new TelegramChannelAdapter();
