'use client';

import { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

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
      if (res.status === 503) {
        toast.error('The AI agent service is not available right now.');
        return;
      }
      if (!res.ok || !res.body) {
        toast.error('Assistant run failed.');
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
        <textarea
          className="border-input bg-background min-h-32 rounded-lg border p-3 text-sm"
          placeholder="Paste a job description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <textarea
          className="border-input bg-background min-h-32 rounded-lg border p-3 text-sm"
          placeholder="Paste your resume (optional)…"
          value={resume}
          onChange={(e) => setResume(e.target.value)}
        />
      </div>

      <Button onClick={run} disabled={running}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Run assistant
      </Button>

      {steps.length > 0 && (
        <ol className="space-y-1 text-sm">
          {steps.map((step, i) => (
            <li key={i} className="text-muted-foreground flex items-center gap-2">
              <Check className="size-3.5 text-emerald-500" />
              {NODE_LABELS[step.node] ?? step.node}
            </li>
          ))}
        </ol>
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
        <div className="rounded-lg border p-3">
          <p className="mb-1 text-xs font-medium tracking-wide uppercase">Drafted outreach (review before sending)</p>
          <p className="text-sm whitespace-pre-wrap">{draft}</p>
        </div>
      )}
    </div>
  );
}
