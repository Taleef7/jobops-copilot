'use client';

import { Bot, GraduationCap, Loader2, Search } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCompactDateTime } from '@/lib/format';
import {
  ApiRequestError,
  runInterviewPrep,
  runResearch,
  runSkillGap,
  type AgentOutputItem,
  type AgentOutputKind,
  type InterviewPrepResponse,
  type ResearchBriefResponse,
  type SkillGapPlanResponse,
} from '@/lib/api';

type AgentKind = 'interview' | 'research' | 'skillGap';

/** Persisted store kinds ↔ the panel's tab keys. */
const STORE_KIND: Record<AgentKind, AgentOutputKind> = {
  interview: 'interview_prep',
  research: 'research',
  skillGap: 'skill_gap',
};

interface OutputMeta {
  createdAt?: string;
  modelUsed?: string;
}

/** A persisted run may carry the model on its payload even though the run types omit it. */
function modelFrom(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'model_used' in payload) {
    const value = (payload as { model_used?: unknown }).model_used;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

const AGENTS = [
  { kind: 'interview' as const, icon: GraduationCap, label: 'Interview prep', desc: 'Likely questions, talking points & gaps' },
  { kind: 'research' as const, icon: Search, label: 'Research company', desc: 'Tool-using agent with web search' },
  { kind: 'skillGap' as const, icon: Bot, label: 'Skill-gap plan', desc: 'Prioritized learning plan' },
];

function EmptyHint({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground py-6 text-center text-sm">
      Run the {label.toLowerCase()} agent to see results here.
    </p>
  );
}

function RunPrompt({
  agent,
  running,
  onRun,
  hasResult,
}: {
  agent: (typeof AGENTS)[number];
  running: boolean;
  onRun: () => void;
  hasResult: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pb-1">
      <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
        <agent.icon className="size-5" />
      </span>
      <div className="mr-auto">
        <p className="text-sm font-semibold">{agent.label}</p>
        <p className="text-muted-foreground text-xs">{agent.desc}</p>
      </div>
      <Button size="sm" variant={hasResult ? 'outline' : 'secondary'} disabled={running} onClick={onRun}>
        {running ? <Loader2 className="size-4 animate-spin" /> : null}
        {running ? 'Running…' : hasResult ? 'Regenerate' : 'Run agent'}
      </Button>
    </div>
  );
}

// `false` during SSR + the initial client render, `true` once hydrated — the
// React-recommended, mismatch-free way to gate client-only rendering.
const noopSubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function GeneratedLine({ meta }: { meta: OutputMeta }) {
  // formatCompactDateTime renders in the runtime's local timezone, so the SSR
  // (server TZ) and hydration (browser TZ) outputs can disagree. Defer the
  // local-time string until after hydration to avoid a hydration mismatch.
  const hydrated = useHydrated();

  if (!meta.createdAt) return null;
  return (
    <p className="text-muted-foreground text-xs">
      Generated {hydrated ? formatCompactDateTime(meta.createdAt) : '…'}
      {meta.modelUsed ? ` · ${meta.modelUsed}` : ''}
    </p>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm">
            <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function seed<T>(outputs: AgentOutputItem[] | undefined, kind: AgentKind): T | null {
  const record = outputs?.find((output) => output.kind === STORE_KIND[kind]);
  return record ? (record.payload as T) : null;
}

function seedMeta(outputs: AgentOutputItem[] | undefined, kind: AgentKind): OutputMeta {
  const record = outputs?.find((output) => output.kind === STORE_KIND[kind]);
  if (!record) return {};
  return { createdAt: record.createdAt, modelUsed: record.modelUsed ?? modelFrom(record.payload) };
}

export function JobAgentsPanel({
  jobId,
  initialOutputs,
}: {
  jobId: string;
  initialOutputs?: AgentOutputItem[];
}) {
  const [running, setRunning] = useState<AgentKind | null>(null);
  const [interview, setInterview] = useState<InterviewPrepResponse | null>(
    () => seed<InterviewPrepResponse>(initialOutputs, 'interview'),
  );
  const [research, setResearch] = useState<ResearchBriefResponse | null>(
    () => seed<ResearchBriefResponse>(initialOutputs, 'research'),
  );
  const [skillGap, setSkillGap] = useState<SkillGapPlanResponse | null>(
    () => seed<SkillGapPlanResponse>(initialOutputs, 'skillGap'),
  );
  const [meta, setMeta] = useState<Record<AgentKind, OutputMeta>>(() => ({
    interview: seedMeta(initialOutputs, 'interview'),
    research: seedMeta(initialOutputs, 'research'),
    skillGap: seedMeta(initialOutputs, 'skillGap'),
  }));

  async function run<T>(kind: AgentKind, task: () => Promise<T>, onDone: (result: T) => void) {
    setRunning(kind);
    try {
      const result = await task();
      onDone(result);
      // The server upserts and stamps the row; mirror that on the client without a refetch.
      setMeta((current) => ({
        ...current,
        [kind]: { createdAt: new Date().toISOString(), modelUsed: modelFrom(result) },
      }));
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'The agent run failed.');
    } finally {
      setRunning(null);
    }
  }

  function trigger(kind: AgentKind) {
    if (kind === 'interview') run(kind, () => runInterviewPrep({ jobId }), setInterview);
    if (kind === 'research') run(kind, () => runResearch({ jobId }), setResearch);
    if (kind === 'skillGap') run(kind, () => runSkillGap({ jobId }), setSkillGap);
  }

  const agentMeta = (kind: AgentKind) => AGENTS.find((agent) => agent.kind === kind)!;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Real LangChain agents in the Python service. The research agent uses a web-search tool; all
        return structured, auditable output. Each agent has its own tab.
      </p>

      <Tabs defaultValue="interview">
        <TabsList>
          <TabsTrigger value="interview">Interview prep</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="skillGap">Skill-gap</TabsTrigger>
        </TabsList>

        <TabsContent value="interview" className="pt-4">
          <Card className="gap-4 p-5">
            <RunPrompt
              agent={agentMeta('interview')}
              running={running === 'interview'}
              hasResult={Boolean(interview)}
              onRun={() => trigger('interview')}
            />
            {interview ? (
              <>
                <GeneratedLine meta={meta.interview} />
                <ListBlock title="Likely questions" items={interview.likely_questions} />
                <ListBlock title="Talking points" items={interview.talking_points} />
                <ListBlock title="Gaps to address" items={interview.gaps_to_address} />
                <ListBlock title="Questions to ask them" items={interview.questions_to_ask} />
              </>
            ) : (
              <EmptyHint label={agentMeta('interview').label} />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="research" className="pt-4">
          <Card className="gap-4 p-5">
            <RunPrompt
              agent={agentMeta('research')}
              running={running === 'research'}
              hasResult={Boolean(research)}
              onRun={() => trigger('research')}
            />
            {research ? (
              <>
                <GeneratedLine meta={meta.research} />
                {research.used_web_search ? (
                  <Badge variant="secondary" className="w-fit gap-1">
                    <Search className="size-3" /> web search used
                  </Badge>
                ) : null}
                <p className="text-sm leading-relaxed">{research.company_summary}</p>
                <ListBlock title="Recent signals" items={research.recent_signals} />
                <ListBlock title="Talking points" items={research.talking_points} />
                <ListBlock title="Questions to ask them" items={research.questions_to_ask} />
              </>
            ) : (
              <EmptyHint label={agentMeta('research').label} />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="skillGap" className="pt-4">
          <Card className="gap-4 p-5">
            <RunPrompt
              agent={agentMeta('skillGap')}
              running={running === 'skillGap'}
              hasResult={Boolean(skillGap)}
              onRun={() => trigger('skillGap')}
            />
            {skillGap ? (
              <>
                <GeneratedLine meta={meta.skillGap} />
                <p className="text-sm leading-relaxed">{skillGap.summary}</p>
                <div className="space-y-3">
                  {skillGap.prioritized_skills.map((item, index) => (
                    <div key={index} className="border-l-primary/40 border-l-2 pl-3">
                      <p className="text-sm font-medium">
                        {item.skill}
                        {item.estimated_time ? (
                          <span className="text-muted-foreground font-normal"> · {item.estimated_time}</span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-sm">{item.why_it_matters}</p>
                      {item.learning_resources?.length ? (
                        <ul className="text-muted-foreground mt-1 list-inside list-disc text-xs">
                          {item.learning_resources.map((resource, resourceIndex) => (
                            <li key={resourceIndex}>{resource}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyHint label={agentMeta('skillGap').label} />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
