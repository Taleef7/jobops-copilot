'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Bot,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  FileCheck,
  Newspaper,
  Settings,
  Sparkles,
  Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';
import type { NotificationItem, NotificationKind } from '@/types/notification';
import { cn } from '@/lib/utils';

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getNotificationIcon(kind: NotificationKind) {
  switch (kind) {
    case 'job_match':
      return <Target className="size-4 text-emerald-500" />;
    case 'digest':
      return <Newspaper className="size-4 text-blue-500" />;
    case 'approval_needed':
      return <FileCheck className="size-4 text-amber-500" />;
    case 'follow_up':
      return <Clock className="size-4 text-violet-500" />;
    case 'agent_done':
      return <Bot className="size-4 text-cyan-500" />;
    default:
      return <Sparkles className="size-4 text-primary" />;
  }
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function loadData() {
    try {
      setLoading(true);
      const res = await fetchNotifications({ limit: 30 });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // Fall back gracefully when offline/mock
    } finally {
      setLoading(false);
    }
  }

  // Load notifications on mount and refresh periodically
  useEffect(() => {
    let active = true;
    fetchNotifications({ limit: 30 })
      .then((res) => {
        if (!active) return;
        setNotifications(res.notifications || []);
        setUnreadCount(res.unreadCount || 0);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      fetchNotifications({ limit: 30 })
        .then((res) => {
          if (!active) return;
          setNotifications(res.notifications || []);
          setUnreadCount(res.unreadCount || 0);
        })
        .catch(() => {});
    }, 30_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Handle outside click to close popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  async function handleMarkRead(id: string, event?: React.MouseEvent) {
    if (event) {
      event.stopPropagation();
    }
    try {
      const updated = await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? updated : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || now })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  }

  function handleNotificationClick(item: NotificationItem) {
    if (!item.readAt) {
      handleMarkRead(item.id);
    }
    setOpen(false);
    if (item.jobId) {
      router.push(`/jobs/${encodeURIComponent(item.jobId)}`);
    } else if (item.kind === 'digest') {
      router.push('/feed');
    }
  }

  const displayedList = filter === 'unread'
    ? notifications.filter((n) => !n.readAt)
    : notifications;

  return (
    <div className="relative" ref={popoverRef} data-testid="notifications-bell-container">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            loadData();
          }
        }}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        className="relative size-9"
        data-testid="notifications-bell-button"
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <span
            data-testid="notifications-badge"
            className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold shadow-xs"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          data-testid="notifications-dropdown"
          className="bg-popover text-popover-foreground border-border absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-xl border shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-heading text-sm font-semibold">Notifications</span>
              {unreadCount > 0 ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                  {unreadCount} new
                </Badge>
              ) : null}
            </div>

            {unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                className="text-muted-foreground hover:text-foreground h-7 px-2 text-xs gap-1"
                data-testid="mark-all-read-btn"
              >
                <CheckCheck className="size-3.5" />
                <span>Mark all read</span>
              </Button>
            ) : null}
          </div>

          {/* Filter Tabs */}
          <div className="bg-muted/40 border-border flex items-center border-b px-4 py-1.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={cn(
                'rounded-md px-2.5 py-1 transition-colors',
                filter === 'all'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={cn(
                'rounded-md px-2.5 py-1 transition-colors',
                filter === 'unread'
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* List Content */}
          <div className="divide-border max-h-[360px] divide-y overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-xs">Loading notifications…</div>
            ) : displayedList.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-xs">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </div>
            ) : (
              displayedList.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    data-testid={`notification-item-${item.id}`}
                    className={cn(
                      'group relative flex cursor-pointer items-start gap-3 p-3.5 transition-colors hover:bg-muted/50',
                      isUnread ? 'bg-primary/[0.03]' : '',
                    )}
                  >
                    <div className="bg-muted/60 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                      {getNotificationIcon(item.kind)}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn('truncate text-xs', isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80')}>
                          {item.title}
                        </p>
                        <span className="text-muted-foreground text-[10px] shrink-0">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                        {item.body}
                      </p>

                      <div className="flex items-center gap-2 pt-0.5">
                        {item.jobId ? (
                          <span className="text-primary text-[10px] font-medium flex items-center gap-0.5">
                            View details <ExternalLink className="size-2.5 inline" />
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {isUnread ? (
                      <div className="flex shrink-0 items-center gap-1 self-center">
                        <button
                          type="button"
                          onClick={(e) => handleMarkRead(item.id, e)}
                          title="Mark as read"
                          className="hover:bg-muted text-muted-foreground hover:text-foreground rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <span className="bg-primary size-2 rounded-full" />
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="bg-muted/30 border-border flex items-center justify-between border-t px-4 py-2.5 text-xs">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              <Settings className="size-3.5" />
              <span>Notification settings</span>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
