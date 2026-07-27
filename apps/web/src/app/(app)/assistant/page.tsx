import type { Metadata } from 'next';
import { AssistantPanel, type AssistantJobOption } from '@/components/assistant-panel';
import { SectionCard } from '@/components/section-card';
import { Card } from '@/components/ui/card';
import { loadJobs } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const { jobs, source } = await loadJobs();

  // `loadJobs` falls back to the local seed dataset when the API is
  // unreachable, so `source` has to be checked before any of this is offered
  // as "your pipeline" — otherwise an outage would put fabricated sample roles
  // in the picker and the user could run a real assistant pass against one.
  const pipelineReachable = source === 'api';

  // Only jobs that carry a description can be run: the assistant's first step
  // parses that text, so offering one without it would fail immediately.
  // Sent as {id, label, descriptionText} rather than whole Job objects to keep
  // the client payload to what the picker actually needs.
  const jobOptions: AssistantJobOption[] = pipelineReachable
    ? jobs
        .filter((job) => job.descriptionText.trim().length > 0)
        .map((job) => ({
          id: job.id,
          label: `${job.company} · ${job.title}`,
          descriptionText: job.descriptionText,
        }))
    : [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">Application assistant</h1>
        <p className="text-muted-foreground text-sm">
          A guided run — parse the role, score your fit, research the company, then draft outreach
          only after you approve. Each step streams live; nothing is sent automatically.
        </p>
      </div>
      {/* Say why the picker is missing, rather than letting it silently vanish
          for someone who knows they have jobs saved. Mirrors the "Seed data
          shown" notice on /jobs. */}
      {pipelineReachable ? null : (
        <Card className="gap-1 border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Your pipeline is unavailable
          </p>
          <p className="text-muted-foreground text-sm">
            The API is not reachable, so saved jobs can&apos;t be listed here. You can still paste a
            description below to run the assistant.
          </p>
        </Card>
      )}

      <SectionCard
        title="Run the assistant"
        description="Pick a job from your pipeline or paste a description to start a streamed, human-in-the-loop run. It scores against the resume on file."
      >
        <AssistantPanel jobs={jobOptions} />
      </SectionCard>
    </div>
  );
}
