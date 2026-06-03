'use client';

import { useState } from 'react';
import {
  ApiRequestError,
  runInterviewPrep,
  runResearch,
  runSkillGap,
  type InterviewPrepResponse,
  type ResearchBriefResponse,
  type SkillGapPlanResponse,
} from '@/lib/api';

type JobAgentsPanelProps = {
  jobId: string;
  resumeText: string;
};

type AgentKind = 'interview' | 'research' | 'skillGap';

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) {
    return null;
  }
  return (
    <div className="detail-card">
      <p className="detail-card__title">{title}</p>
      <ul className="list">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function JobAgentsPanel({ jobId, resumeText }: JobAgentsPanelProps) {
  const [running, setRunning] = useState<AgentKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interview, setInterview] = useState<InterviewPrepResponse | null>(null);
  const [research, setResearch] = useState<ResearchBriefResponse | null>(null);
  const [skillGap, setSkillGap] = useState<SkillGapPlanResponse | null>(null);

  async function run<T>(kind: AgentKind, task: () => Promise<T>, onDone: (result: T) => void) {
    setError(null);
    setRunning(kind);
    try {
      onDone(await task());
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'The agent run failed.');
      }
    } finally {
      setRunning(null);
    }
  }

  const busy = running !== null;

  return (
    <div className="stack">
      <p className="callout__text">
        These are real LangChain agents running in the Python service. The research agent uses a web
        search tool; all three return structured, auditable output.
      </p>

      {error ? (
        <div className="callout callout--accent">
          <p className="callout__title">Agent run failed</p>
          <p className="callout__text">{error}</p>
        </div>
      ) : null}

      <div className="hero__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => run('interview', () => runInterviewPrep({ jobId, resumeText }), setInterview)}
        >
          {running === 'interview' ? 'Preparing…' : 'Interview prep'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => run('research', () => runResearch({ jobId }), setResearch)}
        >
          {running === 'research' ? 'Researching…' : 'Research company'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={() => run('skillGap', () => runSkillGap({ jobId, resumeText }), setSkillGap)}
        >
          {running === 'skillGap' ? 'Planning…' : 'Skill-gap plan'}
        </button>
      </div>

      {interview ? (
        <div className="stack">
          <h3 className="callout__title">Interview prep</h3>
          <DetailList title="Likely questions" items={interview.likely_questions} />
          <DetailList title="Talking points" items={interview.talking_points} />
          <DetailList title="Gaps to address" items={interview.gaps_to_address} />
          <DetailList title="Questions to ask them" items={interview.questions_to_ask} />
        </div>
      ) : null}

      {research ? (
        <div className="stack">
          <h3 className="callout__title">
            Company research{research.used_web_search ? ' · web search used' : ''}
          </h3>
          <div className="callout">
            <p className="callout__text">{research.company_summary}</p>
          </div>
          <DetailList title="Recent signals" items={research.recent_signals} />
          <DetailList title="Talking points" items={research.talking_points} />
          <DetailList title="Questions to ask them" items={research.questions_to_ask} />
        </div>
      ) : null}

      {skillGap ? (
        <div className="stack">
          <h3 className="callout__title">Skill-gap plan</h3>
          <div className="callout">
            <p className="callout__text">{skillGap.summary}</p>
          </div>
          {skillGap.prioritized_skills.map((item, index) => (
            <div key={`${item.skill}-${index}`} className="detail-card">
              <p className="detail-card__title">
                {item.skill}
                {item.estimated_time ? ` · ${item.estimated_time}` : ''}
              </p>
              <p className="detail-card__value">{item.why_it_matters}</p>
              {item.learning_resources?.length ? (
                <ul className="list">
                  {item.learning_resources.map((resource, resourceIndex) => (
                    <li key={`${item.skill}-resource-${resourceIndex}`}>{resource}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
