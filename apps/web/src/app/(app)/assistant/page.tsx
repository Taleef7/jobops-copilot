import type { Metadata } from 'next';
import { AssistantPanel, type AssistantJobOption } from '@/components/assistant-panel';
import { SectionCard } from '@/components/section-card';
import { loadJobs } from '@/lib/job-data';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const { jobs } = await loadJobs();

  // Only jobs that carry a description can be run: the assistant's first step
  // parses that text, so offering one without it would fail immediately.
  // Sent as {id, label, descriptionText} rather than whole Job objects to keep
  // the client payload to what the picker actually needs.
  const jobOptions: AssistantJobOption[] = jobs
    .filter((job) => job.descriptionText.trim().length > 0)
    .map((job) => ({
      id: job.id,
      label: `${job.company} · ${job.title}`,
      descriptionText: job.descriptionText,
    }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">Application assistant</h1>
        <p className="text-muted-foreground text-sm">
          A guided run — parse the role, score your fit, research the company, then draft outreach
          only after you approve. Each step streams live; nothing is sent automatically.
        </p>
      </div>
      <SectionCard
        title="Run the assistant"
        description="Pick a job from your pipeline or paste a description to start a streamed, human-in-the-loop run. It scores against the resume on file."
      >
        <AssistantPanel jobs={jobOptions} />
      </SectionCard>
    </div>
  );
}
