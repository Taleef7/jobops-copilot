'use client';

import { UserButton } from '@clerk/nextjs';
import { Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { ModeToggle } from '@/components/mode-toggle';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/jobs': 'Jobs',
  '/jobs/new': 'Add a job',
  '/outreach': 'Outreach',
  '/reports': 'Weekly reports',
  '/telemetry': 'Telemetry',
  '/settings': 'Settings',
};

function deriveTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/jobs/')) return 'Job detail';
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function AppHeader() {
  const pathname = usePathname();
  const title = deriveTitle(pathname);

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-6" />
      <h1 className="font-heading truncate text-base font-semibold sm:text-lg">{title}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div className="relative hidden sm:block">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search jobs, skills…"
            aria-label="Search"
            className="bg-card w-44 pl-8 lg:w-64"
          />
        </div>
        <ModeToggle />
        <UserButton />
      </div>
    </header>
  );
}
