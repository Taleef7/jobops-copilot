import { SignInButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PRODUCT_SENTENCE } from '@/lib/product';

// Each step names what the app has today: Add job, Score fit on the job page, and the
// Resume studio tab with the follow-up date beside it.
const steps = [
  {
    title: 'Add a job',
    body: 'Paste the posting, or paste its URL and press Autofill. Check the details, then save.',
  },
  {
    title: 'See the fit',
    body: 'On the job page, Score fit shows the skills you match and miss, and whether to apply.',
  },
  {
    title: 'Tailor your résumé and follow up',
    body: 'Review each tailored line, download the PDF, and set a follow-up date.',
  },
];

export default async function LandingPage() {
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  return (
    <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-pretty sm:text-3xl">
        {PRODUCT_SENTENCE}
      </h1>

      <ol aria-label="How it works" className="mt-8 space-y-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span aria-hidden className="text-muted-foreground w-4 shrink-0 text-sm leading-6 tabular-nums">
              {index + 1}.
            </span>
            <div>
              <p className="leading-6 font-medium">{step.title}</p>
              <p className="text-muted-foreground text-sm">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        {signedIn ? (
          <Button render={<Link href="/dashboard" />}>Open dashboard</Button>
        ) : (
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
        )}
      </div>

      {/* A screenshot of the Pipeline goes here, under the steps (#356), once there is a real
          one of the current app. None in the repo is: docs/design/redesign shows seed data and
          pages that are being cut. */}
    </section>
  );
}
