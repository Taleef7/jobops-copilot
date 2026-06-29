'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery } from '@/lib/api';

// Mirrors the Adzuna source: these "locations" aren't geographic, so they're
// ignored as a `where` filter — we treat them as a remote-only signal instead.
const NON_GEOGRAPHIC_LOCATIONS = new Set(['remote', 'anywhere', 'worldwide', 'global']);

export default function OnboardingPage() {
  const router = useRouter();

  // Step 1 state
  const [step, setStep] = useState<1 | 2>(1);
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);

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
      toast.error('Could not save your resume. Please try again.');
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
          <div className="bg-primary/10 text-primary mb-2 flex size-11 items-center justify-center rounded-xl">
            <Sparkles className="size-5" />
          </div>
          {step === 1 ? (
            <>
              <h1 className="font-heading text-2xl font-medium leading-snug">Welcome to JobOps Copilot</h1>
              <CardDescription>
                Add your resume so the AI can score job fit and draft outreach grounded in your real
                experience. Nothing is sent anywhere without your review.
              </CardDescription>
            </>
          ) : (
            <>
              <h1 className="font-heading text-2xl font-medium leading-snug">What roles are you targeting?</h1>
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
                  className="border-border hover:border-primary/50 hover:bg-accent/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center transition-colors"
                >
                  {fileName ? (
                    <>
                      <FileText className="text-primary size-6" />
                      <span className="text-sm font-medium">{fileName}</span>
                      <span className="text-muted-foreground text-xs">Click to choose a different file</span>
                    </>
                  ) : (
                    <>
                      <Upload className="text-muted-foreground size-6" />
                      <span className="text-sm font-medium">Drop or choose your resume PDF</span>
                      <span className="text-muted-foreground text-xs">PDF, up to 5&nbsp;MB</span>
                    </>
                  )}
                  <input
                    id="resume-file"
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setPendingFile(file);
                      setFileName(file?.name ?? null);
                      if (file) setError(null);
                    }}
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

            <Button onClick={saveResume} disabled={saving} className="w-full">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue
            </Button>
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
              <Button onClick={discover} disabled={saving} className="flex-1">
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
          </CardContent>
        )}
      </Card>
    </main>
  );
}
