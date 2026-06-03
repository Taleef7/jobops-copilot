import type { Metadata } from 'next';
import { Database, FileText, Webhook } from 'lucide-react';
import { SectionCard } from '@/components/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Settings' };

const providers = [
  { name: 'Anthropic Claude', model: 'claude-sonnet-4-6', active: true },
  { name: 'Azure OpenAI', model: 'gpt-4o deployment', active: false },
  { name: 'OpenAI', model: 'gpt-4o-mini', active: false },
  { name: 'Google Gemini', model: 'gemini-2.0-flash', active: false },
];

const integrations = [
  { icon: FileText, label: 'Gmail drafts', desc: 'Auto-create reviewable drafts', on: false },
  { icon: Webhook, label: 'n8n webhook', desc: 'Job intake & reminders', on: true },
  { icon: Database, label: 'Tavily web search', desc: 'Research agent tool', on: true },
];

function StatusDot({ on }: { on: boolean }) {
  return <span className={cn('size-2 rounded-full', on ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />;
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground text-sm">Manage providers, integrations, and data.</p>
      </div>

      <SectionCard title="Profile & resume" description="Used to ground fit scoring and outreach.">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full text-base font-semibold">
            T
          </span>
          <div className="mr-auto">
            <p className="text-sm font-medium">Taleef</p>
            <p className="text-muted-foreground text-xs">resume-2026.pdf</p>
          </div>
          <Button variant="outline" size="sm">
            Re-upload
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="AI provider" description="Provider-agnostic — swap behind one interface.">
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <Card
              key={provider.name}
              className={cn(
                'gap-1 p-4 transition-colors',
                provider.active ? 'border-primary/50 bg-primary/5' : '',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{provider.name}</p>
                {provider.active ? (
                  <Badge variant="secondary" className="gap-1">
                    <StatusDot on /> Connected
                  </Badge>
                ) : (
                  <span className="border-muted-foreground/30 size-4 rounded-full border" />
                )}
              </div>
              <p className="text-muted-foreground text-xs">{provider.model}</p>
            </Card>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Integrations" description="Connect automation and tools.">
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
              <Switch defaultChecked={integration.on} aria-label={integration.label} />
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Data & storage" description="Where your CRM and embeddings live.">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="gap-1.5">
            <StatusDot on /> PostgreSQL · Mexico Central
          </Badge>
          <Badge variant="secondary">pgvector enabled</Badge>
          <Button variant="outline" size="sm" className="ml-auto">
            Export data
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
