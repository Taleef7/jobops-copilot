'use client';

import { Bot, GraduationCap, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ApiRequestError,
  runInterviewPrep,
  runResearch,
  runSkillGap,
  type InterviewPrepResponse,
  type ResearchBriefResponse,
  type SkillGapPlanResponse,
} from '@/lib/api';

type AgentKind = 'interview' | 'research' | 'skillGap';

const AGENTS = [
  { kind: 'interview' as const, icon: GraduationCap, label: 'Interview prep', desc: 'Likely questions, talking points & gaps' },
  { kind: 'research' as const, icon: Search, label: 'Research company', desc: 'Tool-using agent with web search' },
  { kind: 'skillGap' as const, icon: Bot, label: 'Skill-gap plan', desc: 'Prioritized learning plan' },
];

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

export function JobAgentsPanel({ jobId, resumeText }: { jobId: string; resumeText: string }) {
  const [running, setRunning] = useState<AgentKind | null>(null);
  const [interview, setInterview] = useState<InterviewPrepResponse | null>(null);
  const [research, setResearch] = useState<ResearchBriefResponse | null>(null);
  const [skillGap, setSkillGap] = useState<SkillGapPlanResponse | null>(null);

  async function run<T>(kind: AgentKind, task: () => Promise<T>, onDone: (result: T) => void) {
    setRunning(kind);
    try {
      onDone(await task());
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'The agent run failed.');
    } finally {
      setRunning(null);
    }
  }

  function trigger(kind: AgentKind) {
    if (kind === 'interview') run(kind, () => runInterviewPrep({ jobId, resumeText }), setInterview);
    if (kind === 'research') run(kind, () => runResearch({ jobId }), setResearch);
    if (kind === 'skillGap') run(kind, () => runSkillGap({ jobId, resumeText }), setSkillGap);
  }

  const busy = running !== null;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Real LangChain agents in the Python service. The research agent uses a web-search tool; all
        return structured, auditable output.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {AGENTS.map((agent) => (
          <Card key={agent.kind} className="border-indigo-500/20 gap-2 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <agent.icon className="size-5" />
            </span>
            <p className="text-sm font-semibold">{agent.label}</p>
            <p className="text-muted-foreground text-xs">{agent.desc}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-1 w-full"
              disabled={busy}
              onClick={() => trigger(agent.kind)}
            >
              {running === agent.kind ? 'Running…' : 'Run agent'}
            </Button>
          </Card>
        ))}
      </div>

      {interview ? (
        <Card className="gap-4 p-5">
          <h3 className="font-heading font-semibold">Interview prep</h3>
          <ListBlock title="Likely questions" items={interview.likely_questions} />
          <ListBlock title="Talking points" items={interview.talking_points} />
          <ListBlock title="Gaps to address" items={interview.gaps_to_address} />
          <ListBlock title="Questions to ask them" items={interview.questions_to_ask} />
        </Card>
      ) : null}

      {research ? (
        <Card className="gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading font-semibold">Company research</h3>
            {research.used_web_search ? (
              <Badge variant="secondary" className="gap-1">
                <Search className="size-3" /> web search used
              </Badge>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed">{research.company_summary}</p>
          <ListBlock title="Recent signals" items={research.recent_signals} />
          <ListBlock title="Talking points" items={research.talking_points} />
          <ListBlock title="Questions to ask them" items={research.questions_to_ask} />
        </Card>
      ) : null}

      {skillGap ? (
        <Card className="gap-4 p-5">
          <h3 className="font-heading font-semibold">Skill-gap plan</h3>
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
        </Card>
      ) : null}
    </div>
  );
}
