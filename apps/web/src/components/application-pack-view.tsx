'use client';

import { useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Sparkles,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateJobApplicationPack, saveApplicationAnswer } from '@/lib/api';
import type { ApplicationPackPayload, ApplicationPackQuestionAnswer } from '@/types/job';

interface ApplicationPackViewProps {
  jobId: string;
  company: string;
  initialPack: ApplicationPackPayload | null;
  hasResume?: boolean;
}

export function ApplicationPackView({
  jobId,
  company,
  initialPack,
  hasResume = true,
}: ApplicationPackViewProps) {
  const [pack, setPack] = useState<ApplicationPackPayload | null>(initialPack);
  const [isGenerating, setIsGenerating] = useState(false);
  const [flaggedInputs, setFlaggedInputs] = useState<Record<string, string>>({});
  const [savingQuestion, setSavingQuestion] = useState<string | null>(null);

  async function handleGeneratePack() {
    setIsGenerating(true);
    try {
      const generated = await generateJobApplicationPack(jobId);
      setPack(generated);
      toast.success('Application pack assembled successfully!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate application pack.';
      toast.error(msg);
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard!`);
    } catch {
      toast.error(`Failed to copy ${label}.`);
    }
  }

  async function handleSaveFlaggedAnswer(questionText: string) {
    const inputVal = (flaggedInputs[questionText] || '').trim();
    if (!inputVal) {
      toast.error('Please enter an answer before saving.');
      return;
    }

    setSavingQuestion(questionText);
    try {
      await saveApplicationAnswer({
        questionText,
        answer: inputVal,
      });

      // Update local pack state: mark unflagged and update answer
      if (pack) {
        const updatedAnswers: ApplicationPackQuestionAnswer[] = pack.answers.map((ans) => {
          if (ans.questionText === questionText) {
            return {
              ...ans,
              answer: inputVal,
              source: 'qa_memory',
              flagged: false,
            };
          }
          return ans;
        });

        const updatedFlagged = (pack.flaggedQuestions || []).filter((q) => q !== questionText);

        setPack({
          ...pack,
          answers: updatedAnswers,
          flaggedQuestions: updatedFlagged,
        });
      }

      toast.success('Saved to Q&A memory! Pre-filled for this and future applications.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save answer.';
      toast.error(msg);
    } finally {
      setSavingQuestion(null);
    }
  }

  if (!pack) {
    return (
      <Card className="flex flex-col items-center justify-center gap-4 p-8 text-center sm:p-12">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl">
          <Briefcase className="size-7" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h3 className="font-heading text-lg font-semibold">Assemble your Application Pack</h3>
          <p className="text-muted-foreground text-sm">
            Pre-flight bundle with your tailored ATS resume, cover letter, verified contact fields,
            and copy-ready answers to ATS questions for {company}.
          </p>
        </div>
        <Button
          onClick={handleGeneratePack}
          disabled={isGenerating || !hasResume}
          className="gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Assembling application pack…
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Generate Application Pack
            </>
          )}
        </Button>
      </Card>
    );
  }

  const flaggedCount = pack.flaggedQuestions?.length ?? 0;
  const answersCount = pack.answers?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-base font-semibold">Application Pack</h3>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 size-3" /> Ready for autofill
            </Badge>
            {flaggedCount > 0 ? (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3" /> {flaggedCount} flagged for review
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {answersCount} ATS answers prepared · Ready for manual copying or 1-click Chrome Extension autofill
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGeneratePack}
          disabled={isGenerating}
          className="gap-1.5"
        >
          {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Regenerate pack
        </Button>
      </Card>

      {/* Flagged questions loop banner */}
      {flaggedCount > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5 space-y-4 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-amber-600 dark:text-amber-400 mt-0.5 size-5 shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Action Required: Answer ungrounded questions
              </h4>
              <p className="text-muted-foreground text-xs">
                Answers you provide below will be permanently remembered in your Q&A memory and automatically pre-filled on future jobs.
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {pack.flaggedQuestions.map((question) => {
              const currentInput = flaggedInputs[question] ?? '';
              const isSaving = savingQuestion === question;
              return (
                <div key={question} className="bg-background/80 space-y-2 rounded-lg border p-4">
                  <Label className="text-sm font-medium">{question}</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={currentInput}
                      onChange={(e) =>
                        setFlaggedInputs((prev) => ({ ...prev, [question]: e.target.value }))
                      }
                      placeholder="e.g. $165,000 USD base or competitive with market rate"
                      className="flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveFlaggedAnswer(question)}
                      disabled={isSaving || !currentInput.trim()}
                      className="shrink-0 gap-1.5"
                    >
                      {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Save to Q&A memory
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* Contact Block */}
      {pack.contactBlock ? (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h4 className="font-heading text-sm font-semibold">Verified Contact Block</h4>
            <Badge variant="secondary">Autofill verified</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pack.contactBlock.name ? (
              <div className="bg-muted/40 flex items-center justify-between rounded-lg p-2.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <User className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">{pack.contactBlock.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => copyToClipboard(pack.contactBlock?.name || '', 'Name')}
                  title="Copy Name"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}

            {pack.contactBlock.email ? (
              <div className="bg-muted/40 flex items-center justify-between rounded-lg p-2.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Mail className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">{pack.contactBlock.email}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => copyToClipboard(pack.contactBlock?.email || '', 'Email')}
                  title="Copy Email"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}

            {pack.contactBlock.phone ? (
              <div className="bg-muted/40 flex items-center justify-between rounded-lg p-2.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Phone className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">{pack.contactBlock.phone}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => copyToClipboard(pack.contactBlock?.phone || '', 'Phone')}
                  title="Copy Phone"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}

            {pack.contactBlock.location ? (
              <div className="bg-muted/40 flex items-center justify-between rounded-lg p-2.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <MapPin className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">{pack.contactBlock.location}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => copyToClipboard(pack.contactBlock?.location || '', 'Location')}
                  title="Copy Location"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}

            {pack.contactBlock.linkedin ? (
              <div className="bg-muted/40 flex items-center justify-between rounded-lg p-2.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileText className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate text-xs font-medium">LinkedIn URL</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => copyToClipboard(pack.contactBlock?.linkedin || '', 'LinkedIn')}
                  title="Copy LinkedIn URL"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Copy-Ready ATS Answers */}
      <div className="space-y-4">
        <h4 className="font-heading text-sm font-semibold">Copy-Ready ATS Answers ({answersCount})</h4>
        <div className="space-y-3">
          {pack.answers.map((qa) => {
            const isFlagged = qa.flagged || (pack.flaggedQuestions || []).includes(qa.questionText);
            return (
              <Card key={qa.questionHash} className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-semibold">{qa.questionText}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {qa.category.replace('_', ' ')}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        qa.source === 'qa_memory'
                          ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {qa.source === 'qa_memory' ? 'Q&A Memory' : qa.source}
                    </Badge>
                    {isFlagged ? (
                      <Badge variant="destructive" className="text-xs">
                        Flagged
                      </Badge>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(qa.answer, 'Answer')}
                      className="gap-1.5"
                    >
                      <Copy className="size-3.5" /> Copy answer
                    </Button>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap text-foreground/90">{qa.answer}</p>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
