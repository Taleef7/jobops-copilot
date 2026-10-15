import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Create your JobOps Copilot account.',
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp />
    </AuthShell>
  );
}
