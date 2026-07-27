import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth-shell';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Create a JobOps Copilot workspace and start tracking roles with AI.',
};

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp />
    </AuthShell>
  );
}
