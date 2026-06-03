import { SignUpButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import {
  ArrowRight,
  Bot,
  Database,
  LineChart,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const features = [
  {
    icon: Bot,
    title: 'Multi-step AI agents',
    body: 'Interview prep, company research with live web search, and skill-gap planning — real LangChain agents with tool use.',
  },
  {
    icon: Database,
    title: 'RAG fit scoring',
    body: 'Your resume is embedded into pgvector and retrieved to ground every fit score in real evidence — no hallucinated matches.',
  },
  {
    icon: LineChart,
    title: 'Time-series intelligence',
    body: 'Pandas-powered trend, anomaly detection, and forecasting over your pipeline — narrated by an LLM.',
  },
  {
    icon: Workflow,
    title: 'Workflow automation',
    body: 'n8n webhooks for job intake, follow-up reminders, and weekly reports. Operations, not just prompts.',
  },
  {
    icon: ShieldCheck,
    title: 'Human-approved by design',
    body: 'Drafts outreach and recommends actions, but never sends or fabricates. You stay in control at every step.',
  },
  {
    icon: Sparkles,
    title: 'Provider-agnostic LLMs',
    body: 'Anthropic Claude, Azure OpenAI, OpenAI, or Gemini — swappable behind one clean interface.',
  },
];

export default async function LandingPage() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="from-primary/10 pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b to-transparent"
        />
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <Badge variant="secondary" className="mb-5 gap-1.5">
            <Sparkles className="size-3.5" />
            AI Software Engineering · agents, RAG & telemetry
          </Badge>
          <h1 className="font-heading mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Run your job search like an{' '}
            <span className="text-primary">AI operations</span> team.
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-lg text-pretty">
            JobOps Copilot tracks roles in a CRM, then uses real LLMs, retrieval-augmented
            generation, and multi-step agents to analyze fit, research companies, prep interviews,
            and surface time-series insights — human-approved at every step.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {signedIn ? (
              <Button render={<Link href="/dashboard" />} size="lg" className="gap-2">
                Open dashboard <ArrowRight className="size-4" />
              </Button>
            ) : (
              <SignUpButton mode="modal">
                <Button size="lg" className="gap-2">
                  Get started free <ArrowRight className="size-4" />
                </Button>
              </SignUpButton>
            )}
            <Button render={<a href="#features">Explore features</a>} variant="outline" size="lg" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="gap-3 p-6 transition-shadow hover:shadow-md">
              <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                <feature.icon className="size-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold">{feature.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{feature.body}</p>
            </Card>
          ))}
        </div>

        {/* CTA */}
        <Card className="from-primary/10 mt-12 items-center gap-4 bg-gradient-to-br to-transparent p-8 text-center sm:p-12">
          <h2 className="font-heading text-2xl font-bold sm:text-3xl">
            Ready to operationalize your search?
          </h2>
          <p className="text-muted-foreground max-w-xl">
            Sign in to track jobs, run agents, and watch your pipeline telemetry in real time.
          </p>
          {signedIn ? (
            <Button render={<Link href="/dashboard" />} size="lg" className="gap-2">
              Go to dashboard <ArrowRight className="size-4" />
            </Button>
          ) : (
            <SignUpButton mode="modal">
              <Button size="lg" className="gap-2">
                Create your workspace <ArrowRight className="size-4" />
              </Button>
            </SignUpButton>
          )}
        </Card>
      </section>
    </>
  );
}
