export type NotificationKind =
  | 'job_match'
  | 'digest'
  | 'follow_up'
  | 'approval_needed'
  | 'agent_done';

export type ChannelDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface ChannelStatusInfo {
  status: ChannelDeliveryStatus;
  sentAt?: string;
  error?: string;
}

export interface NotificationChannels {
  in_app?: ChannelStatusInfo;
  email?: ChannelStatusInfo;
  telegram?: ChannelStatusInfo;
  web_push?: ChannelStatusInfo;
  [channel: string]: ChannelStatusInfo | undefined;
}

export interface NotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  jobId?: string | null;
  dedupeKey?: string | null;
  channels: NotificationChannels;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationChannelPreferences {
  in_app: boolean;
  email: boolean;
  telegram: boolean;
  web_push: boolean;
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  timezone?: string;
}

export interface NotificationSettings {
  channels: NotificationChannelPreferences;
  minMatchScore: number;
  digestHour: number;
  quietHours: QuietHours;
  telegramChatId?: string | null;
  emailAddress?: string | null;
}
