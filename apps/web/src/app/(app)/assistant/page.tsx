import type { Metadata } from 'next';
import { AssistantPanel } from '@/components/assistant-panel';
import { SectionCard } from '@/components/section-card';

export const metadata: Metadata = { title: 'Assistant' };

export default function AssistantPage() {
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
        description="Paste a job description (and optionally your resume) to start a streamed, human-in-the-loop run."
      >
        <AssistantPanel />
      </SectionCard>
    </div>
  );
}
