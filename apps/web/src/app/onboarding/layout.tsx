import type { Metadata } from 'next';

// page.tsx is a client component and so cannot export metadata; this layout
// exists only to give the route a title. Without it the tab reads
// "JobOps Copilot — AI Job Search Platform", the same as every other page.
export const metadata: Metadata = {
  title: 'Set up your workspace',
  description: 'Add your resume and target roles so JobOps Copilot can score fit against real experience.',
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
