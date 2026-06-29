import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { JobCreateForm } from '@/components/job-create-form';
import { SectionCard } from '@/components/section-card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Add a job' };

export default function AddJobPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button render={<Link href="/jobs" />} variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <ArrowLeft className="size-4" /> Back to jobs
      </Button>

      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Add a job</h1>
        <p className="text-muted-foreground text-sm">
          Paste a posting — AI extracts the company, title, and skills, then scores your fit.
        </p>
      </div>

      <SectionCard title="Job details" description="Saved to the CRM, then analyzed on the detail page.">
        <JobCreateForm />
      </SectionCard>
    </div>
  );
}
