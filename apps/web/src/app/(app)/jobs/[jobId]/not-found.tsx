import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function JobNotFound() {
  return (
    <Card className="mx-auto max-w-md items-center gap-3 p-8 text-center">
      <h2 className="font-heading text-lg font-semibold">That job does not exist</h2>
      <p className="text-muted-foreground text-sm">
        The record may have been removed or archived, or the URL is stale.
      </p>
      <div className="flex gap-2">
        <Button render={<Link href="/jobs">Back to jobs</Link>} />
        <Button render={<Link href="/jobs/new">Add a job</Link>} variant="outline" />
      </div>
    </Card>
  );
}
