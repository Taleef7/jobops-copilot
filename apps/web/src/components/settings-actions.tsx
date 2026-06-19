'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { clearMyData, seedDemoData, uploadResumeFile } from '@/lib/api';

export function ResumeReupload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      await uploadResumeFile(file);
      toast.success('Resume updated.');
      router.refresh();
    } catch {
      toast.error('Could not upload the resume.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Re-upload
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
    </>
  );
}

export function ExportDataButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => window.open('/api/proxy/api/profile/export', '_blank')}
    >
      <Download className="size-4" /> Export data
    </Button>
  );
}

export function DemoDataActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<'seed' | 'clear' | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  async function run(action: 'seed' | 'clear') {
    setBusy(action);
    try {
      if (action === 'seed') {
        await seedDemoData();
        toast.success('Sample data loaded into your account.');
      } else {
        await clearMyData();
        toast.success('Your data has been cleared.');
      }
      router.refresh();
    } catch {
      toast.error('Action failed. Please try again.');
    } finally {
      setBusy(null);
      setConfirmingClear(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-lg">
        <Database className="size-4" />
      </span>
      <div className="mr-auto">
        <p className="text-sm font-medium">Sample data</p>
        <p className="text-muted-foreground text-xs">Load a demo CRM into your account, or wipe everything.</p>
      </div>
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run('seed')}>
        {busy === 'seed' ? <Loader2 className="size-4 animate-spin" /> : null}
        Load sample data
      </Button>
      {confirmingClear ? (
        <div
          role="group"
          aria-label="Confirm clearing all data"
          className="flex flex-wrap items-center gap-2"
        >
          <p className="text-muted-foreground text-xs">
            Permanently delete all jobs, outreach &amp; your resume?
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => setConfirmingClear(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy !== null}
            onClick={() => run('clear')}
          >
            {busy === 'clear' ? <Loader2 className="size-4 animate-spin" /> : null}
            Yes, delete everything
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => setConfirmingClear(true)}
        >
          Clear my data
        </Button>
      )}
    </div>
  );
}
