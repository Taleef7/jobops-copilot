import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';

// Without this the tab reads "JobOps Copilot — AI Job Search Platform", exactly
// like every other page, so a bookmark or a row of open tabs gives no clue
// which one is the sign-in. The root layout's template appends the product.
export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your JobOps Copilot workspace.',
};

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn />
    </AuthShell>
  );
}
