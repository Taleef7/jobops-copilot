'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { saveResumeText, uploadResumeFile } from '@/lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    try {
      if (pendingFile) {
        await uploadResumeFile(pendingFile);
      } else if (resumeText.trim()) {
        await saveResumeText(resumeText.trim());
      } else {
        toast.error('Add your resume to continue — upload a PDF or paste the text.');
        return;
      }
      toast.success('You’re all set. Welcome to JobOps Copilot.');
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error('Could not save your resume. Please try again.');
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
          <CardTitle className="font-heading text-2xl">Welcome to JobOps Copilot</CardTitle>
          <CardDescription>
            Add your resume so the AI can score job fit and draft outreach grounded in your real
            experience. Nothing is sent anywhere without your review.
          </CardDescription>
        </CardHeader>
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
                  }}
                />
              </label>
            </TabsContent>

            <TabsContent value="paste" className="pt-4">
              <Textarea
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder="Paste your resume text here…"
                className="min-h-48"
              />
            </TabsContent>
          </Tabs>

          <Button onClick={finish} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue to dashboard
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
