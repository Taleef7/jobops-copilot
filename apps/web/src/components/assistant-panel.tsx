'use client';

import { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Step {
  node: string;
  status?: string | null;
}

interface AssistantResult {
  thread_id?: string;
  draft?: { draft_text?: string } | null;
}

const NODE_LABELS: Record<string, string> = {
  parse: 'Parsing the job description',
  score: 'Scoring fit against your resume',
  research: 'Researching the company',
  review: 'Awaiting your approval',
  draft: 'Drafting outreach',
  pass: 'Below the fit bar — stopping',
  below_fit_bar: 'Below the fit bar — stopping',
};

export function AssistantPanel() {
  const [description, setDescription] = useState('');
  const [resume, setResume] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function handleFrame(frame: string) {
    const lines = frame.split('\n');
    const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
    const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
    if (!event || !dataLine) return;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }
    if (event === 'status') {
      setSteps((prev) => [...prev, { node: String(data.node), status: data.status as string }]);
    } else if (event === 'awaiting_approval') {
      setThreadId((data.thread_id as string) ?? null);
      setAwaiting(true);
    } else if (event === 'result') {
      const result = data as AssistantResult;
      if (result.draft?.draft_text) setDraft(result.draft.draft_text);
    } else if (event === 'error') {
      toast.error((data.message as string) ?? 'Assistant stream error');
    }
  }

  async function run() {
    if (!description.trim()) {
      toast.error('Paste a job description first.');
      return;
    }
    setSteps([]);
    setDraft(null);
    setThreadId(null);
    setAwaiting(false);
    setRunning(true);
    try {
      const res = await fetch('/api/assistant-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description_text: description, resume_text: resume }),
      });
      if (!res.ok || !res.body) {
        // Surface the upstream reason when present (e.g. "Assistant stream unavailable")
        // instead of a generic message, so a failed run isn't a confusing no-op.
        let message =
          res.status === 503 ? 'The AI agent service is not available right now.' : 'Assistant run failed.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // non-JSON body — keep the default message
        }
        toast.error(message);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) handleFrame(frame);
      }
    } catch {
      toast.error('Assistant run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function decide(approved: boolean) {
    if (!threadId) return;
    setAwaiting(false);
    try {
      const res = await fetch('/api/proxy/api/ai/assistant/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, approved }),
      });
      const data = (await res.json()) as AssistantResult;
      if (data?.draft?.draft_text) setDraft(data.draft.draft_text);
      else if (!approved) toast.info('Outreach skipped — nothing drafted.');
    } catch {
      toast.error('Could not submit your decision.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="assistant-jd">Job description</Label>
          <Textarea
            id="assistant-jd"
            className="min-h-32"
            placeholder="Paste a job description…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assistant-resume">Resume</Label>
          <Textarea
            id="assistant-resume"
            className="min-h-32"
            placeholder="Leave blank to use your saved resume…"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
          />
          {/* The old placeholder said "(optional)" while the API sent whatever
              was typed straight through — so leaving it blank scored the role
              against nothing and always failed the fit gate. */}
          <p className="text-muted-foreground text-xs">
            Optional — the run uses the resume on file unless you paste an override.
          </p>
        </div>
      </div>

      <Button onClick={run} disabled={running} aria-busy={running}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Run assistant
      </Button>

      {steps.length > 0 && (
        <>
          {/* Each step is appended as the run streams; a polite log announces the
              additions so a screen-reader user hears progress, not just sighted ones.
              No aria-busy here: it would defer these incremental announcements until
              the run ends. The "working" state lives on the Run button instead. */}
          <ol className="space-y-1 text-sm" role="log" aria-live="polite" aria-relevant="additions">
            {steps.map((step, i) => (
              <li key={i} className="text-muted-foreground flex items-center gap-2">
                {step.node === 'pass' || step.node === 'below_fit_bar' ? (
                  <X className="size-3.5 text-destructive" />
                ) : (
                  <Check className="size-3.5 text-emerald-500" />
                )}
                {NODE_LABELS[step.node] ?? step.node}
              </li>
            ))}
          </ol>
          {steps.some((s) => s.node === 'pass' || s.node === 'below_fit_bar') ? (
            <div role="status" className="bg-muted mt-3 rounded-md px-3 py-2 text-sm">
              <p className="font-medium">Below the fit threshold</p>
              <p className="text-muted-foreground mt-1">
                This role scored below the bar against your resume, so the run stopped before
                drafting. Use <strong>Score fit</strong> on the job detail page to see exactly which
                requirements are missing, or check that the resume on file in{' '}
                <strong>Settings</strong> is current.
              </p>
            </div>
          ) : null}
        </>
      )}

      {awaiting && (
        <div className="bg-muted/40 flex items-center gap-3 rounded-lg border p-3">
          <p className="mr-auto text-sm font-medium">Approve drafting outreach for this role?</p>
          <Button size="sm" onClick={() => decide(true)}>
            <Check className="size-4" /> Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide(false)}>
            <X className="size-4" /> Skip
          </Button>
        </div>
      )}

      {draft && (
        <div className="rounded-lg border p-3" role="status" aria-live="polite">
          <p className="mb-1 text-xs font-medium tracking-wide uppercase">Drafted outreach (review before sending)</p>
          <p className="text-sm whitespace-pre-wrap">{draft}</p>
        </div>
      )}
    </div>
  );
}
