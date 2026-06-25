'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { streamAssistantChat, type ChatMessage } from '@/lib/assistant-chat';

const STORAGE_KEY = 'jobops:assistant-chat';

interface StoredThread {
  userId: string;
  messages: ChatMessage[];
}

/** Derive the current job id from the path (`/jobs/<id>`), excluding `/jobs/new`. */
function jobIdFromPath(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const match = pathname.match(/^\/jobs\/([^/]+)$/);
  if (!match || match[1] === 'new') return undefined;
  return match[1];
}

function quickPromptsFor(jobId: string | undefined): string[] {
  return jobId
    ? [
        'What am I missing for this role?',
        'Improve my resume for this job',
        'Draft outreach for this job',
      ]
    : [
        'What should I focus on next?',
        'Summarize my pipeline',
        'How do I improve my fit scores?',
      ];
}

function readStored(): StoredThread | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredThread;
    if (typeof parsed?.userId === 'string' && Array.isArray(parsed.messages)) return parsed;
  } catch {
    // ignore malformed storage
  }
  return null;
}

export function AssistantWidget() {
  const pathname = usePathname();
  const { userId } = useAuth();
  const jobId = jobIdFromPath(pathname);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist after a turn — but never clobber a prior session's history with an
  // empty mount; an explicit clear removes the key instead.
  useEffect(() => {
    if (typeof window === 'undefined' || !userId || messages.length === 0) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, messages }));
  }, [userId, messages]);

  // Abort any in-flight stream when the widget unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Hydrate once, as soon as Clerk's userId is known — not on first open, which
  // can race with Clerk still loading (userId undefined) and permanently skip the
  // restore. Restore only the *current* user's thread so a logout→login can't leak.
  useEffect(() => {
    if (!userId || hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = readStored();
    if (stored && stored.userId === userId && stored.messages.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from sessionStorage, gated on the async Clerk userId
      setMessages(stored.messages);
    }
  }, [userId]);

  function openPanel() {
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setStreaming('');
    setError(null);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';

    await streamAssistantChat({
      messages: next,
      jobId,
      signal: controller.signal,
      onToken: (token) => {
        acc += token;
        setStreaming(acc);
      },
      onDone: () => {
        if (acc) setMessages((current) => [...current, { role: 'assistant', content: acc }]);
        setStreaming('');
        setBusy(false);
      },
      onError: (message) => {
        setError(message);
        setStreaming('');
        setBusy(false);
      },
    });
  }

  const prompts = quickPromptsFor(jobId);
  const empty = messages.length === 0 && !streaming;

  return (
    <>
      {/* Launcher */}
      <Button
        ref={launcherRef}
        type="button"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        onClick={() => (open ? closePanel() : openPanel())}
        className="fixed right-4 bottom-4 z-50 size-12 rounded-full p-0 shadow-lg motion-reduce:transition-none sm:right-6 sm:bottom-6"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>

      {/* Panel */}
      {open ? (
        <div
          role="dialog"
          aria-label="JobOps assistant"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closePanel();
          }}
          className="bg-background fixed right-4 bottom-20 z-50 flex h-[28rem] max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col rounded-xl border shadow-2xl sm:right-6 sm:bottom-24"
        >
          <header className="flex items-center gap-2 border-b px-4 py-3">
            <Sparkles className="size-4 text-indigo-500" />
            <p className="text-sm font-semibold">Assistant</p>
            {jobId ? (
              <span className="text-muted-foreground ml-auto text-xs">This job</span>
            ) : null}
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {empty ? (
              <p className="text-muted-foreground text-sm">
                Ask anything about your search{jobId ? ' or this job' : ''}. I can advise and draft —
                actions still happen in the app.
              </p>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground ml-auto'
                    : 'bg-muted',
                )}
              >
                {message.content}
              </div>
            ))}

            {streaming ? (
              <div className="bg-muted max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                {streaming}
              </div>
            ) : null}

            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>

          {empty ? (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="bg-muted hover:bg-muted/70 rounded-full px-3 py-1 text-xs motion-reduce:transition-none"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask the assistant…"
              aria-label="Message the assistant"
              autoFocus
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
