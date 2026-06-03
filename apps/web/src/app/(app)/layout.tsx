import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { fetchProfile } from '@/lib/api';

// Routes in this group are protected by proxy.ts (Clerk). Unauthenticated
// requests are redirected to /sign-in before reaching the layout.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // First-run gate: send users without a profile to onboarding (which lives
  // outside this group, so there is no redirect loop). Best-effort — if the
  // API is unreachable we let them through rather than hard-blocking.
  try {
    const profile = await fetchProfile();
    if (!profile) {
      redirect('/onboarding');
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) {
      throw error; // re-throw Next's redirect signal
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
