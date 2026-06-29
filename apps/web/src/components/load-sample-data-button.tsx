'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { seedDemoData } from '@/lib/api';

export function LoadSampleDataButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await seedDemoData();
      toast.success('Sample data loaded.');
      router.refresh();
    } catch {
      toast.error('Could not load sample data.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" disabled={busy} onClick={handleClick}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
      Load sample data
    </Button>
  );
}
