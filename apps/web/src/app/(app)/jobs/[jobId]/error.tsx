'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function JobDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-md items-center gap-3 p-8 text-center">
      <h2 className="font-heading text-lg font-semibold">Could not load that job</h2>
      <p className="text-muted-foreground text-sm">{error.message}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button render={<Link href="/jobs">Back to jobs</Link>} variant="outline" />
      </div>
    </Card>
  );
}
