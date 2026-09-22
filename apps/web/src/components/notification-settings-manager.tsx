'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Clock,
  Loader2,
  Mail,
  Send,
  SendHorizontal,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  fetchNotificationSettings,
  fetchVapidKey,
  sendTestNotification,
  subscribePushEndpoint,
  updateNotificationSettings,
} from '@/lib/api';
import { subscribeUserToPush } from '@/components/pwa-register';
import type { NotificationSettings } from '@/types/notification';

const DEFAULT_SETTINGS: NotificationSettings = {
  channels: {
    in_app: true,
    email: false,
    telegram: false,
    web_push: false,
  },
  minMatchScore: 80,
  digestHour: 9,
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '08:00',
  },
  telegramChatId: null,
  emailAddress: null,
};

interface NotificationSettingsManagerProps {
  initialSettings?: NotificationSettings | null;
}

export function NotificationSettingsManager({ initialSettings }: NotificationSettingsManagerProps) {
  const [settings, setSettings] = useState<NotificationSettings>(initialSettings || DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(!initialSettings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushSupported] = useState(() => {
    if (typeof window === 'undefined') return true;
    return 'serviceWorker' in navigator && 'PushManager' in window;
  });

  useEffect(() => {
    if (!initialSettings) {
      fetchNotificationSettings()
        .then((res) => {
          if (res) setSettings(res);
        })
        .catch(() => {
          // Fall back to defaults on error
        })
        .finally(() => setLoading(false));
    }
  }, [initialSettings]);

  async function handleSave() {
    try {
      setSaving(true);
      const updated = await updateNotificationSettings(settings);
      setSettings(updated);
      toast.success('Notification settings saved successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notification settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    try {
      setTesting(true);
      const item = await sendTestNotification();
      toast.success(`Test notification sent: "${item.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test notification.');
    } finally {
      setTesting(false);
    }
  }

  async function handleEnablePush() {
    if (!pushSupported) {
      toast.error('Web push notifications are not supported by this browser.');
      return;
    }

    try {
      setEnablingPush(true);
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast.warning('Browser notification permission was not granted.');
        return;
      }

      const vapidKey = await fetchVapidKey();
      if (!vapidKey) {
        toast.error('VAPID public key not configured on server.');
        return;
      }

      const subscription = await subscribeUserToPush(vapidKey);
      if (!subscription) {
        toast.error('Failed to create push subscription in browser.');
        return;
      }

      await subscribePushEndpoint(subscription, navigator.userAgent);
      setSettings((prev) => ({
        ...prev,
        channels: { ...prev.channels, web_push: true },
      }));
      toast.success('Web push subscribed and enabled!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enable push notifications.');
    } finally {
      setEnablingPush(false);
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading notification preferences…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="notification-settings-manager">
      {/* Delivery Channels */}
      <div className="space-y-4">
        <div>
          <h3 className="font-heading text-sm font-semibold">Delivery channels</h3>
          <p className="text-muted-foreground text-xs">
            Choose where JobOps Copilot delivers job alerts, daily digests, and follow-up reminders.
          </p>
        </div>

        <div className="divide-border rounded-lg border divide-y">
          {/* In-App Bell */}
          <div className="flex items-center justify-between gap-4 p-3.5">
            <div className="flex items-center gap-3">
              <span className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-md">
                <Bell className="size-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="channel-inapp" className="text-xs font-semibold cursor-pointer">
                    In-app inbox &amp; header bell
                  </Label>
                  <Badge variant="outline" className="text-[10px] py-0">Recommended</Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  Real-time alerts directly in JobOps Copilot app header.
                </p>
              </div>
            </div>
            <Switch
              id="channel-inapp"
              checked={settings.channels.in_app}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({
                  ...prev,
                  channels: { ...prev.channels, in_app: checked },
                }))
              }
              data-testid="switch-channel-inapp"
            />
          </div>

          {/* Email Channel */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 flex size-8 items-center justify-center rounded-md">
                  <Mail className="size-4" />
                </span>
                <div>
                  <Label htmlFor="channel-email" className="text-xs font-semibold cursor-pointer">
                    Email notifications &amp; morning digest
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Sent via n8n automation webhook or direct SMTP delivery.
                  </p>
                </div>
              </div>
              <Switch
                id="channel-email"
                checked={settings.channels.email}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    channels: { ...prev.channels, email: checked },
                  }))
                }
                data-testid="switch-channel-email"
              />
            </div>

            {settings.channels.email ? (
              <div className="pl-11 pr-2 pt-1">
                <Label htmlFor="email-address-input" className="text-muted-foreground text-xs">
                  Target email address (leave blank to use your account email)
                </Label>
                <Input
                  id="email-address-input"
                  type="email"
                  placeholder="name@company.com"
                  value={settings.emailAddress ?? ''}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      emailAddress: e.target.value.trim() || null,
                    }))
                  }
                  className="mt-1 max-w-sm text-xs"
                  data-testid="input-channel-email"
                />
              </div>
            ) : null}
          </div>

          {/* Telegram Channel */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex size-8 items-center justify-center rounded-md">
                  <Send className="size-4" />
                </span>
                <div>
                  <Label htmlFor="channel-telegram" className="text-xs font-semibold cursor-pointer">
                    Telegram bot alerts
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Instant alerts dispatched through your personal Telegram bot.
                  </p>
                </div>
              </div>
              <Switch
                id="channel-telegram"
                checked={settings.channels.telegram}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    channels: { ...prev.channels, telegram: checked },
                  }))
                }
                data-testid="switch-channel-telegram"
              />
            </div>

            {settings.channels.telegram ? (
              <div className="pl-11 pr-2 pt-1">
                <Label htmlFor="telegram-chat-id-input" className="text-muted-foreground text-xs">
                  Telegram chat ID or @username
                </Label>
                <Input
                  id="telegram-chat-id-input"
                  type="text"
                  placeholder="e.g. 123456789 or @handle"
                  value={settings.telegramChatId ?? ''}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      telegramChatId: e.target.value.trim() || null,
                    }))
                  }
                  className="mt-1 max-w-sm text-xs"
                  data-testid="input-channel-telegram"
                />
              </div>
            ) : null}
          </div>

          {/* Web Push */}
          <div className="p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="bg-violet-500/10 text-violet-600 dark:text-violet-400 flex size-8 items-center justify-center rounded-md">
                  <Smartphone className="size-4" />
                </span>
                <div>
                  <Label htmlFor="channel-webpush" className="text-xs font-semibold cursor-pointer">
                    Web push &amp; mobile PWA notifications
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Standard VAPID web push notifications even when the browser tab is closed.
                  </p>
                </div>
              </div>
              <Switch
                id="channel-webpush"
                checked={settings.channels.web_push}
                onCheckedChange={(checked) =>
                  setSettings((prev) => ({
                    ...prev,
                    channels: { ...prev.channels, web_push: checked },
                  }))
                }
                data-testid="switch-channel-webpush"
              />
            </div>

            <div className="pl-11 pr-2 pt-1 flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleEnablePush}
                disabled={enablingPush || !pushSupported}
                className="text-xs h-7 gap-1.5"
                data-testid="btn-enable-webpush"
              >
                {enablingPush ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Smartphone className="size-3.5" />
                )}
                <span>{settings.channels.web_push ? 'Re-subscribe push token' : 'Enable browser push'}</span>
              </Button>
              {!pushSupported ? (
                <span className="text-muted-foreground text-xs italic">
                  Not supported in current browser environment.
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Trigger Filters & Timing */}
      <div className="space-y-4">
        <div>
          <h3 className="font-heading text-sm font-semibold">Triggers &amp; schedule</h3>
          <p className="text-muted-foreground text-xs">
            Tune minimum fit thresholds and morning digest timing.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Minimum Match Score */}
          <div className="rounded-lg border p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="min-match-score" className="text-xs font-semibold">
                Match score threshold
              </Label>
              <Badge variant="secondary" className="font-mono text-xs">
                ≥ {settings.minMatchScore}%
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              Only notify for newly discovered jobs with a match score meeting or exceeding this threshold.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <input
                id="min-match-score"
                type="range"
                min="50"
                max="95"
                step="5"
                value={settings.minMatchScore}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    minMatchScore: parseInt(e.target.value, 10),
                  }))
                }
                className="w-full accent-primary cursor-pointer"
                data-testid="range-min-match-score"
              />
            </div>
          </div>

          {/* Daily Digest Hour */}
          <div className="rounded-lg border p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="digest-hour" className="text-xs font-semibold">
                Daily digest hour
              </Label>
              <Badge variant="secondary" className="font-mono text-xs">
                {String(settings.digestHour).padStart(2, '0')}:00 local
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              Hour of the day when the morning briefing of high-fit jobs and follow-ups is compiled.
            </p>
            <div className="pt-1">
              <select
                id="digest-hour"
                value={settings.digestHour}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    digestHour: parseInt(e.target.value, 10),
                  }))
                }
                className="bg-background text-foreground border-input flex h-8 w-full rounded-md border px-2.5 py-1 text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-digest-hour"
              >
                {Array.from({ length: 24 }).map((_, i) => {
                  const hourStr = String(i).padStart(2, '0') + ':00';
                  const label = i === 0 ? '12:00 AM (Midnight)' : i === 12 ? '12:00 PM (Noon)' : i < 12 ? `${i}:00 AM` : `${i - 12}:00 PM`;
                  return (
                    <option key={i} value={i}>
                      {hourStr} — {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Quiet Hours */}
      <div className="rounded-lg border p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-7 items-center justify-center rounded-md">
              <Clock className="size-3.5" />
            </span>
            <div>
              <Label htmlFor="quiet-hours-toggle" className="text-xs font-semibold cursor-pointer">
                Quiet hours
              </Label>
              <p className="text-muted-foreground text-xs">
                Defer job match and nudge alerts during rest hours. Digests and critical actions are unaffected.
              </p>
            </div>
          </div>
          <Switch
            id="quiet-hours-toggle"
            checked={settings.quietHours.enabled}
            onCheckedChange={(checked) =>
              setSettings((prev) => ({
                ...prev,
                quietHours: { ...prev.quietHours, enabled: checked },
              }))
            }
            data-testid="switch-quiet-hours"
          />
        </div>

        {settings.quietHours.enabled ? (
          <div className="grid grid-cols-2 gap-3 pt-2 pl-9">
            <div>
              <Label htmlFor="quiet-hours-start" className="text-muted-foreground text-xs">
                Start time
              </Label>
              <Input
                id="quiet-hours-start"
                type="time"
                value={settings.quietHours.start}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    quietHours: { ...prev.quietHours, start: e.target.value },
                  }))
                }
                className="mt-1 h-8 text-xs"
                data-testid="input-quiet-hours-start"
              />
            </div>
            <div>
              <Label htmlFor="quiet-hours-end" className="text-muted-foreground text-xs">
                End time
              </Label>
              <Input
                id="quiet-hours-end"
                type="time"
                value={settings.quietHours.end}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    quietHours: { ...prev.quietHours, end: e.target.value },
                  }))
                }
                className="mt-1 h-8 text-xs"
                data-testid="input-quiet-hours-end"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSendTest}
          disabled={testing}
          className="text-xs h-8 gap-1.5"
          data-testid="btn-send-test-notification"
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <SendHorizontal className="size-3.5" />
          )}
          <span>Send test notification</span>
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="text-xs h-8 gap-1.5"
          data-testid="btn-save-notification-settings"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          <span>Save preferences</span>
        </Button>
      </div>
    </div>
  );
}
