'use client';

import { useState } from 'react';
import type { DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { SignOutButton } from '@clerk/nextjs';
import { ArrowLeft, FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery } from '@/lib/api';
import { cn } from '@/lib/utils';

// Mirrors the Adzuna source: these "locations" aren't geographic, so they're
// ignored as a `where` filter — we treat them as a remote-only signal instead.
const NON_GEOGRAPHIC_LOCATIONS = new Set(['remote', 'anywhere', 'worldwide', 'global']);

/** Matches the API's multer limit. Checked here so the failure is specific. */
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

const TOTAL_STEPS = 2;

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export default function OnboardingPage() {
  const router = useRouter();

  // Step 1 state
  const [step, setStep] = useState<1 | 2>(1);
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);

  /**
   * Shared by the file picker and the drop target so both paths get the same
   * validation. Previously nothing was checked here, so a 40 MB file or a .docx
   * only failed server-side and surfaced as a generic "Could not save your
   * resume", with no hint what was wrong.
   */
  function acceptFile(file: File | null) {
    if (!file) return;

    if (!isPdf(file)) {
      const message = `“${file.name}” isn’t a PDF. Upload a PDF, or switch to “Paste text”.`;
      setError(message);
      toast.error(message);
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      const megabytes = (file.size / (1024 * 1024)).toFixed(1);
      const message = `“${file.name}” is ${megabytes} MB — the limit is 5 MB.`;
      setError(message);
      toast.error(message);
      return;
    }

    setPendingFile(file);
    setFileName(file.name);
    setError(null);
  }

  // The drop zone advertised "Drop or choose your resume PDF" but had no drag
  // handlers at all, so dropping a file made the browser navigate away from the
  // app to render the PDF — losing the half-finished onboarding.
  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  async function saveResume() {
    setSaving(true);
    setError(null);
    try {
      if (pendingFile) {
        await uploadResumeFile(pendingFile);
      } else if (resumeText.trim()) {
        await saveResumeText(resumeText.trim());
      } else {
        const message = 'Add your resume to continue — upload a PDF or paste the text.';
        setError(message);
        toast.error(message);
        return;
      }
      setStep(2);
    } catch {
      // Name the fallback explicitly: a PDF that fails to parse is the most
      // likely failure here, and without this the user has no way forward.
      const message = pendingFile
        ? "We couldn't read that PDF. Try another file, or paste the text instead."
        : 'Could not save your resume. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function discover() {
    const trimmed = query.trim();
    if (!trimmed) {
      const message = 'Add at least one role or keyword to find jobs.';
      setError(message);
      toast.error(message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // A non-geographic "location" (e.g. "Remote") is dropped by the Adzuna
      // source and does nothing; it's the remoteOnly flag that biases toward
      // remote roles. Normalize so a user who types one still gets a remote feed.
      const trimmedLocation = location.trim();
      const isRemoteLocation = NON_GEOGRAPHIC_LOCATIONS.has(trimmedLocation.toLowerCase());
      await createSavedSearch({
        query: trimmed,
        location: isRemoteLocation ? undefined : trimmedLocation || undefined,
        remoteOnly: remoteOnly || isRemoteLocation,
      });
      try {
        const result = await runDiscovery();
        toast.success(
          result.inserted > 0
            ? `Found ${result.inserted} matching job${result.inserted === 1 ? '' : 's'}.`
            : "Search saved — new jobs will appear as they're posted.",
        );
      } catch {
        toast.success("Search saved — we'll pull matching jobs shortly.");
      }
      router.push('/jobs');
      router.refresh();
    } catch {
      toast.error('Could not save your search. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
              <Sparkles className="size-5" />
            </div>
            {/* The flow always had two steps but never said so. */}
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                Step {step} of {TOTAL_STEPS}
              </span>
              <span className="flex gap-1" aria-hidden>
                {Array.from({ length: TOTAL_STEPS }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      // shrink-0: these are empty flex children, so without it
                      // they collapse to zero width and the indicator vanishes.
                      'h-1 w-6 shrink-0 rounded-full transition-colors',
                      index < step ? 'bg-primary' : 'bg-muted',
                    )}
                  />
                ))}
              </span>
            </div>
          </div>
          {step === 1 ? (
            <>
              <h1 className="font-heading text-2xl font-medium leading-snug">
                Welcome to JobOps Copilot
              </h1>
              <CardDescription>
                Add your resume so the AI can score job fit and draft outreach grounded in your real
                experience. Nothing is sent anywhere without your review.
              </CardDescription>
            </>
          ) : (
            <>
              <h1 className="font-heading text-2xl font-medium leading-snug">
                What roles are you targeting?
              </h1>
              <CardDescription>
                We&apos;ll pull matching postings into your feed, already scored against your resume.
              </CardDescription>
            </>
          )}
        </CardHeader>

        {step === 1 ? (
          <CardContent className="space-y-5">
            <Tabs defaultValue="upload">
              <TabsList className="w-full">
                <TabsTrigger value="upload" className="flex-1">
                  Upload PDF
                </TabsTrigger>
                <TabsTrigger value="paste" className="flex-1">
                  Paste text
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="pt-4">
                <label
                  htmlFor="resume-file"
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center transition-colors',
                    isDraggingOver
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/40',
                  )}
                >
                  {fileName ? (
                    <>
                      <FileText className="text-primary size-6" />
                      <span className="text-sm font-medium">{fileName}</span>
                      <span className="text-muted-foreground text-xs">
                        Click to choose a different file
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload
                        className={cn(
                          'size-6 transition-colors',
                          isDraggingOver ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="text-sm font-medium">
                        {isDraggingOver ? 'Drop to upload' : 'Drop or choose your resume PDF'}
                      </span>
                      <span className="text-muted-foreground text-xs">PDF, up to 5&nbsp;MB</span>
                    </>
                  )}
                  <input
                    id="resume-file"
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </TabsContent>

              <TabsContent value="paste" className="pt-4">
                <Textarea
                  value={resumeText}
                  onChange={(event) => {
                    setResumeText(event.target.value);
                    if (event.target.value.trim()) setError(null);
                  }}
                  placeholder="Paste your resume text here…"
                  className="min-h-48"
                />
              </TabsContent>
            </Tabs>

            {error ? (
              <p role="alert" className="text-destructive text-sm font-medium">
                {error}
              </p>
            ) : null}

            <Button onClick={saveResume} disabled={saving} aria-busy={saving} className="w-full">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue
            </Button>

            {/* A resume is genuinely required — every downstream feature is
                grounded on it, and the app redirects here until a profile
                exists. Say why, and leave a way out instead of trapping
                someone whose PDF will not parse. */}
            <p className="text-muted-foreground text-center text-xs">
              Your resume grounds every fit score and draft.{' '}
              <SignOutButton>
                <button type="button" className="hover:text-foreground underline underline-offset-2">
                  Sign out
                </button>
              </SignOutButton>{' '}
              if you&apos;d rather come back later.
            </p>
          </CardContent>
        ) : (
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role or keywords</Label>
              <Input
                id="role"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (event.target.value.trim()) setError(null);
                }}
                placeholder="e.g. AI Engineer, automation"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc">Location</Label>
              <Input
                id="loc"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Optional · e.g. San Francisco (use the toggle for remote)"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="remote" checked={remoteOnly} onCheckedChange={setRemoteOnly} />
              <Label htmlFor="remote" className="text-sm font-normal">
                Remote roles only
              </Label>
            </div>

            {error ? (
              <p role="alert" className="text-destructive text-sm font-medium">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                onClick={discover}
                disabled={saving}
                aria-busy={saving}
                className="flex-1"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Find matching jobs
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  router.push('/dashboard');
                  router.refresh();
                }}
                disabled={saving}
              >
                Skip for now
              </Button>
            </div>

            {/* Step 2 was a one-way door: the resume was already saved, but
                there was no way back to review or replace it. */}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep(1);
              }}
              disabled={saving}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs disabled:opacity-50"
            >
              <ArrowLeft className="size-3.5" />
              Back to your resume
            </button>
          </CardContent>
        )}
      </Card>
    </main>
  );
}
