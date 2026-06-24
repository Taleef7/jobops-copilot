import type { Metadata } from 'next';
import { Database, FileText, Webhook } from 'lucide-react';
import { SectionCard } from '@/components/section-card';
import { DemoDataActions, ExportDataButton, ResumeReupload } from '@/components/settings-actions';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { fetchProfile, fetchStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

function StatusDot({ on }: { on: boolean }) {
  return <span className={cn('size-2 rounded-full', on ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  azure_openai: 'Azure OpenAI',
  google_genai: 'Google Gemini',
};

export default async function SettingsPage() {
  const [profile, status] = await Promise.all([
    fetchProfile().catch(() => null),
    fetchStatus().catch(() => null),
  ]);

  const provider = status?.agent.provider ?? null;
  // The agent is a scale-to-zero Container App: when it's asleep, /api/status can't
  // reach it within the health-check timeout, so provider/model come back empty even
  // though a real LLM-backed agent IS configured. Distinguish "configured but idle"
  // from "no agent / deterministic mock" so the card doesn't mislabel a sleeping agent.
  const agentEnabled = Boolean(status?.agent.enabled);
  const agentReachable = Boolean(status?.agent.reachable);
  // Reachable AND a usable LLM key — drives both the dot and the badge text so they agree.
  const agentConnected = agentReachable && status?.agent.llm_configured !== false;
  const providerLabel = provider
    ? (PROVIDER_LABELS[provider] ?? provider)
    : agentEnabled
      ? 'AI agent service'
      : 'Not configured';
  const providerDetail = status?.agent.model
    ? String(status.agent.model)
    : agentEnabled
      ? 'Idle — the agent scales to zero and wakes on the first request'
      : 'Deterministic mock (no LLM provider attached)';
  const initial = (profile?.displayName ?? 'You').slice(0, 1).toUpperCase();

  const integrations = [
    {
      icon: FileText,
      label: 'Gmail drafts',
      desc: 'Auto-create reviewable drafts',
      on: Boolean(status?.integrations.gmailDrafts),
    },
    {
      icon: Webhook,
      label: 'n8n webhook',
      desc: 'Job intake & reminders',
      on: Boolean(status?.integrations.n8nWebhook),
    },
    {
      icon: Database,
      label: 'Tavily web search',
      desc: 'Research agent tool',
      on: Boolean(status?.integrations.tavily),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground text-sm">Manage your profile, providers, and data.</p>
      </div>

      <SectionCard title="Profile & resume" description="Used to ground fit scoring and outreach.">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full text-base font-semibold">
            {initial}
          </span>
          <div className="mr-auto">
            <p className="text-sm font-medium">{profile?.displayName ?? 'Your profile'}</p>
            <p className="text-muted-foreground text-xs">
              {profile?.hasResume ? (profile.resumeFileName ?? 'Resume on file') : 'No resume uploaded yet'}
            </p>
          </div>
          <ResumeReupload />
        </div>
      </SectionCard>

      <SectionCard title="AI provider" description="Configured on the server — shown here for transparency.">
        <Card className={cn('gap-1 p-4', provider || agentEnabled ? 'border-primary/50 bg-primary/5' : '')}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{providerLabel}</p>
            <Badge variant="secondary" className="gap-1">
              <StatusDot on={agentConnected} />
              {agentConnected ? 'Connected' : agentEnabled ? 'Idle' : 'Mock fallback'}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">{providerDetail}</p>
        </Card>
      </SectionCard>

      <SectionCard title="Integrations" description="Configured via server environment.">
        <ul className="divide-border -my-1 divide-y">
          {integrations.map((integration) => (
            <li key={integration.label} className="flex items-center gap-3 py-3">
              <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-lg">
                <integration.icon className="size-4" />
              </span>
              <div className="mr-auto">
                <p className="text-sm font-medium">{integration.label}</p>
                <p className="text-muted-foreground text-xs">{integration.desc}</p>
              </div>
              <Badge variant={integration.on ? 'secondary' : 'outline'} className="gap-1.5">
                <StatusDot on={integration.on} />
                {integration.on ? 'Enabled' : 'Off'}
              </Badge>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Data & storage" description="Where your CRM and embeddings live.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="gap-1.5">
            <StatusDot on={status?.storeMode === 'postgres'} />
            {status?.storeMode === 'postgres' ? 'PostgreSQL' : 'Local file store'}
          </Badge>
          {status?.agent.rag_enabled ? <Badge variant="secondary">pgvector enabled</Badge> : null}
          <ExportDataButton />
        </div>
      </SectionCard>

      <SectionCard title="Demo" description="Explore with sample data or start clean.">
        <DemoDataActions />
      </SectionCard>
    </div>
  );
}
