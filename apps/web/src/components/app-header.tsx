'use client';

import { UserButton } from '@clerk/nextjs';
import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = deriveTitle(pathname);

  // Keep the box in sync with the active jobs query so it reflects deep links
  // and reads back what the user is currently filtering by. Adjusting state
  // during render (vs. an effect) is the React-recommended way to reset on a
  // changing input. https://react.dev/learn/you-might-not-need-an-effect
  const activeQuery = pathname === '/jobs' ? (searchParams.get('q') ?? '') : '';
  const [query, setQuery] = useState(activeQuery);
  const [syncedQuery, setSyncedQuery] = useState(activeQuery);
  if (activeQuery !== syncedQuery) {
    setSyncedQuery(activeQuery);
    setQuery(activeQuery);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ q: trimmed });
    router.push(`/jobs?${params.toString()}`);
  }

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-6" />
      <h1 className="font-heading truncate text-base font-semibold sm:text-lg">{title}</h1>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <form onSubmit={handleSubmit} role="search" className="relative hidden sm:block">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            type="search"
            name="q"
            enterKeyHint="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search jobs…"
            aria-label="Search jobs"
            className="bg-card w-44 pl-8 lg:w-64"
          />
        </form>
        <ModeToggle />
        <UserButton />
      </div>
    </header>
  );
}
