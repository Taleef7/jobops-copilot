import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * Any address that doesn't exist, including a job id that isn't yours or was deleted
 * (the job page calls notFound()). Before #349 this was Next's bare, unstyled 404.
 */
export default function NotFound() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="max-w-md items-center gap-3 p-8 text-center">
        <p className="text-muted-foreground text-sm font-medium">404</p>
        <h1 className="font-heading text-xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">
          This page doesn&apos;t exist, or the job was deleted.
        </p>
        <Button render={<Link href="/jobs" />}>Go to your pipeline</Button>
      </Card>
    </main>
  );
}
