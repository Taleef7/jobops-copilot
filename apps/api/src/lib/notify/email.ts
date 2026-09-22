import nodemailer from 'nodemailer';
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
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatEmailSubject(payload: NotificationPayload): string {
  if (payload.kind === 'job_match') {
    const scoreStr = payload.matchScore !== undefined ? ` (${payload.matchScore}%)` : '';
    return `[JobOps] 🎯 High Match: ${payload.title}${scoreStr}`;
  }
  if (payload.kind === 'digest') {
    return `[JobOps] 📰 ${payload.title}`;
  }
  if (payload.kind === 'approval_needed') {
    return `[JobOps] ✍️ Action Required: ${payload.title}`;
  }
  if (payload.kind === 'follow_up') {
    return `[JobOps] ⏰ Follow-up Due: ${payload.title}`;
  }
  if (payload.kind === 'agent_done') {
    return `[JobOps] 🤖 ${payload.title}`;
  }
  return `[JobOps] ${payload.title}`;
}

export function formatEmailText(
  payload: NotificationPayload,
  webBaseUrl: string = process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000',
): string {
  const lines: string[] = [];
  lines.push(`JobOps Copilot - ${payload.title}`);
  lines.push('='.repeat(40));

  if (payload.matchScore !== undefined) {
    lines.push(`Match Score: ${payload.matchScore}%`);
  }

  if (payload.body) {
    lines.push('');
    lines.push(payload.body);
  }

  if (payload.jobId) {
    const jobUrl = `${webBaseUrl.replace(/\/$/, '')}/jobs/${encodeURIComponent(payload.jobId)}`;
    lines.push('');
    lines.push(`View Job: ${jobUrl}`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`Manage notification preferences: ${webBaseUrl.replace(/\/$/, '')}/settings`);

  return lines.join('\n');
}

export function formatEmailHtml(
  payload: NotificationPayload,
  webBaseUrl: string = process.env.NEXT_PUBLIC_WEB_BASE_URL || 'http://localhost:3000',
): string {
  const base = webBaseUrl.replace(/\/$/, '');
  const jobUrl = payload.jobId ? `${base}/jobs/${encodeURIComponent(payload.jobId)}` : undefined;
  const settingsUrl = `${base}/settings`;

  let actionButtonHtml = '';
  if (jobUrl) {
    actionButtonHtml = `
      <div style="margin: 24px 0;">
        <a href="${jobUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
          View Job in JobOps
        </a>
      </div>
    `;
  } else if (payload.kind === 'digest') {
    actionButtonHtml = `
      <div style="margin: 24px 0;">
        <a href="${base}/feed" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
          Open Job Feed
        </a>
      </div>
    `;
  }

  let matchScoreBadge = '';
  if (payload.matchScore !== undefined) {
    matchScoreBadge = `
      <span style="display: inline-block; background-color: #ecfdf5; color: #065f46; font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; margin-bottom: 12px;">
        ${payload.matchScore}% Match
      </span>
    `;
  }

  // Format body paragraphs (preserving newlines)
  const bodyHtml = escapeHtml(payload.body)
    .split('\n\n')
    .map((para) => `<p style="margin: 0 0 16px 0; line-height: 1.6; color: #334155;">${para.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(payload.title)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 20px 28px; text-align: left;">
              <span style="font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: -0.025em;">
                JobOps <span style="color: #818cf8;">Copilot</span>
              </span>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 28px;">
              ${matchScoreBadge}
              <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                ${escapeHtml(payload.title)}
              </h1>
              <div style="font-size: 15px;">
                ${bodyHtml}
              </div>
              ${actionButtonHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 28px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.5;">
              <p style="margin: 0 0 6px 0;">This email was sent by JobOps Copilot based on your alert preferences.</p>
              <p style="margin: 0;">
                <a href="${settingsUrl}" style="color: #4f46e5; text-decoration: underline;">Manage Notification Settings</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export class EmailChannelAdapter implements NotificationChannelAdapter {
  name = 'email';

  isConfigured(settings: NotificationSettings): boolean {
    const recipient = settings.emailAddress?.trim() || process.env.DEFAULT_NOTIFICATION_EMAIL?.trim();
    if (!recipient) {
      return false;
    }

    const hasN8n = Boolean(process.env.N8N_EMAIL_WEBHOOK_URL?.trim());
    const hasSmtp = Boolean(process.env.SMTP_HOST?.trim());
    const isTest = process.env.NODE_ENV === 'test' || process.env.MOCK_EMAIL_DELIVERY === 'true';

    return hasN8n || hasSmtp || isTest;
  }

  async send(
    _userId: string,
    payload: NotificationPayload,
    settings: NotificationSettings,
  ): Promise<ChannelDeliveryResult> {
    const recipient = settings.emailAddress?.trim() || process.env.DEFAULT_NOTIFICATION_EMAIL?.trim();

    if (!recipient) {
      return {
        status: 'skipped',
        error: 'No email address configured for user',
      };
    }

    const n8nWebhookUrl = process.env.N8N_EMAIL_WEBHOOK_URL?.trim();
    const smtpHost = process.env.SMTP_HOST?.trim();
    const isMock = process.env.NODE_ENV === 'test' || process.env.MOCK_EMAIL_DELIVERY === 'true';

    if (!n8nWebhookUrl && !smtpHost && !isMock) {
      return {
        status: 'skipped',
        error: 'Email delivery transport is not configured (N8N_EMAIL_WEBHOOK_URL or SMTP_HOST required)',
      };
    }

    const subject = formatEmailSubject(payload);
    const html = formatEmailHtml(payload);
    const text = formatEmailText(payload);

    // Option 1: n8n webhook outbound
    if (n8nWebhookUrl) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        const n8nSecret = process.env.N8N_WEBHOOK_SECRET?.trim();
        if (n8nSecret) {
          headers['X-N8N-Webhook-Secret'] = n8nSecret;
        }

        const res = await fetch(n8nWebhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            to: recipient,
            subject,
            html,
            text,
            kind: payload.kind,
            jobId: payload.jobId,
            matchScore: payload.matchScore,
            metadata: payload.metadata,
          }),
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          return {
            status: 'failed',
            error: `n8n webhook error HTTP ${res.status}: ${bodyText.slice(0, 200)}`,
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
          error: `n8n email dispatch failed: ${message}`,
        };
      }
    }

    // Option 2: Direct SMTP outbound via nodemailer
    if (smtpHost) {
      try {
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        const secure = process.env.SMTP_SECURE === 'true' || port === 465;
        const user = process.env.SMTP_USER?.trim();
        const pass = process.env.SMTP_PASS?.trim();

        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port,
          secure,
          auth: user ? { user, pass: pass || '' } : undefined,
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || 'JobOps Copilot <noreply@jobops.dev>',
          to: recipient,
          subject,
          html,
          text,
        });

        return {
          status: 'sent',
          sentAt: new Date().toISOString(),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'SMTP send failed';
        return {
          status: 'failed',
          error: `SMTP delivery failed: ${message}`,
        };
      }
    }

    // Option 3: Test/Mock simulated transport
    return {
      status: 'sent',
      sentAt: new Date().toISOString(),
    };
  }
}

export const emailAdapter = new EmailChannelAdapter();
