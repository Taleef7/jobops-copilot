import type {
  ChannelDeliveryStatus,
  NotificationKind,
  NotificationRecord,
  NotificationSettings,
} from '@/types';

export interface NotificationPayload {
  kind: NotificationKind;
  title: string;
  body: string;
  jobId?: string;
  dedupeKey?: string;
  matchScore?: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelDeliveryResult {
  status: ChannelDeliveryStatus;
  sentAt?: string;
  error?: string;
}

export interface NotificationChannelAdapter {
  name: string;
  isConfigured(settings: NotificationSettings): boolean;
  send(
    userId: string,
    payload: NotificationPayload,
    settings: NotificationSettings,
  ): Promise<ChannelDeliveryResult>;
}

export interface DispatchResult {
  notification: NotificationRecord;
  deliveredChannels: string[];
  skippedChannels: string[];
  failedChannels: string[];
}
