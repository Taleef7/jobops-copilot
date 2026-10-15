'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiRequestError, createJob, extractJobFromUrl, parseJob, type PostedSalary } from '@/lib/api';
import { salaryAsPosted } from '@/lib/job-display';
import type { WorkplaceType } from '@/types/job';

/**
 * Add job (#355): one box for a job link or the posting's text. The server reads the fields
 * (a link through the URL extractor, text through parse-job), the user checks them, and
 * nothing is saved until a save button is pressed. What the posting doesn't state is shown
 * as "Not stated" and saved as nothing, never as a default.
 */

type Workplace = Extract<WorkplaceType, 'remote' | 'hybrid' | 'onsite'>;

const WORKPLACE_CHOICES: Array<{ value: Workplace | null; label: string }> = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
  { value: null, label: 'Not stated' },
];

function asWorkplace(value: string | null | undefined): Workplace | null {
  return value === 'remote' || value === 'hybrid' || value === 'onsite' ? value : null;
}

/** A single line that is a web address is a link to read; anything else is posting text. */
function postingLink(text: string): string | null {
  const value = text.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try {
    void new URL(value);
    return value;
  } catch {
    return null;
  }
}

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

type Details = {
  title: string;
  company: string;
  location: string;
  workplaceType: Workplace | null;
  jobUrl: string;
  descriptionText: string;
};

const EMPTY_DETAILS: Details = {
  title: '',
  company: '',
  location: '',
  workplaceType: null,
  jobUrl: '',
  descriptionText: '',
};

/** What the posting said, to mark the fields it filled. Null when the user enters the job by hand. */
type Posted = {
  title: string;
  company: string;
  location: string;
  workplaceType: Workplace | null;
  salary: PostedSalary | null;
};

const NOTHING_TO_READ = 'Couldn’t find a job on that page. Paste the posting’s text instead, or enter the details yourself.';
const READ_FAILED = 'Something went wrong. Try again, or enter the details yourself.';

/** "from posting" while a field still holds what the posting said, "Not stated" while it's empty. */
function hintFor(value: string, posted: string | undefined): string | null {
  if (!value.trim()) return 'Not stated';
  if (posted !== undefined && posted.trim() && value === posted) return 'from posting';
  return null;
}

function FieldLabel({
  htmlFor,
  required,
  hint,
  hintId,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  hint: string | null;
  hintId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={htmlFor} className="gap-0.5">
        {children}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {hint ? (
        <span id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (...ids: Array<string | false | null | undefined>) => ids.filter(Boolean).join(' ') || undefined;

export function JobCreateForm() {
  const router = useRouter();
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  // Step 1: the paste box.
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const reading = useRef(false);

  // Step 2: the review.
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [posted, setPosted] = useState<Posted | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  // The job this URL is already tracked as (a 409 from the API, #346).
  const [existingJobId, setExistingJobId] = useState<string | null>(null);
  const [saving, setSaving] = useState<'fit' | 'save' | 'done' | null>(null);
  const savingRef = useRef(false);
  // Which save button sent the form. Enter in a field clicks the first one, Save and run fit.
  const intent = useRef<'fit' | 'save'>('fit');

  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const jobUrlRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // Where focus goes after a step change: the review's heading, so a screen reader hears
  // the new step, or back to the paste box. Nothing takes focus on first load.
  const pendingFocus = useRef<'review' | 'paste' | null>(null);

  useEffect(() => {
    if (pendingFocus.current === 'review') reviewHeadingRef.current?.focus();
    if (pendingFocus.current === 'paste') pasteRef.current?.focus();
    pendingFocus.current = null;
  }, [step]);

  function openReview(next: Details, from: Posted | null) {
    setDetails(next);
    setPosted(from);
    setDescriptionOpen(!next.descriptionText.trim());
    setErrors({});
    setSaveError(null);
    setExistingJobId(null);
    setReadError(null);
    pendingFocus.current = 'review';
    setStep('review');
  }

  /** "Enter details yourself": an empty review, keeping what was pasted (a link or the text). */
  function enterByHand() {
    const link = postingLink(pasteText);
    openReview({ ...EMPTY_DETAILS, jobUrl: link ?? '', descriptionText: link ? '' : pasteText.trim() }, null);
  }

  async function readPosting() {
    if (reading.current) return;
    const text = pasteText.trim();
    if (!text) {
      setPasteError('Paste a job link or the posting’s text first.');
      pasteRef.current?.focus();
      return;
    }
    reading.current = true;
    setIsReading(true);
    setPasteError(null);
    setReadError(null);
    try {
      const link = postingLink(text);
      if (link) {
        const data = await extractJobFromUrl(link);
        if (!(data.title || data.company || data.location || data.descriptionText)) {
          setReadError(NOTHING_TO_READ);
          return;
        }
        const from: Posted = {
          title: data.title ?? '',
          company: data.company ?? '',
          location: data.location ?? '',
          workplaceType: asWorkplace(data.workplaceType),
          salary: data.salary ?? null,
        };
        openReview({ ...from, jobUrl: link, descriptionText: data.descriptionText ?? '' }, from);
      } else {
        const data = await parseJob({ descriptionText: text });
        const from: Posted = {
          title: data.title ?? '',
          company: data.company ?? '',
          location: data.location ?? '',
          workplaceType: asWorkplace(data.workplace_type),
          salary: data.salary ?? null,
        };
        openReview({ ...from, jobUrl: '', descriptionText: text }, from);
      }
    } catch (error) {
      setReadError(error instanceof ApiRequestError ? error.message : READ_FAILED);
    } finally {
      reading.current = false;
      setIsReading(false);
    }
  }

  function startOver() {
    setDetails(EMPTY_DETAILS);
    setPosted(null);
    setErrors({});
    setSaveError(null);
    setExistingJobId(null);
    pendingFocus.current = 'paste';
    setStep('paste');
  }

  function update<K extends keyof Details>(field: K, value: Details[K]) {
    setDetails((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: '' }));
    if (field === 'jobUrl') setExistingJobId(null);
  }

  function validate(values: Details) {
    const next: Record<string, string> = {};
    if (!values.title.trim()) next.title = 'Add the job title.';
    if (!values.company.trim()) next.company = 'Add the company.';
    if (values.jobUrl.trim() && !isWebAddress(values.jobUrl.trim())) {
      next.jobUrl = 'Enter the posting’s full web address, starting with https://.';
    }
    if (!values.descriptionText.trim()) next.descriptionText = 'Add the job description.';
    return next;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const runFit = intent.current === 'fit';
    const nextErrors = validate(details);
    setErrors(nextErrors);
    setSaveError(null);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.descriptionText) setDescriptionOpen(true);
      // Focus the first field to fix, in page order, once React has drawn the messages.
      setTimeout(() => {
        const order = [
          { key: 'title', ref: titleRef },
          { key: 'company', ref: companyRef },
          { key: 'jobUrl', ref: jobUrlRef },
          { key: 'descriptionText', ref: descriptionRef },
        ] as const;
        order.find(({ key }) => nextErrors[key])?.ref.current?.focus();
      }, 0);
      return;
    }

    savingRef.current = true;
    setSaving(runFit ? 'fit' : 'save');
    const salary = posted?.salary ?? null;
    try {
      const job = await createJob({
        company: details.company.trim(),
        title: details.title.trim(),
        location: details.location.trim() || undefined,
        workplaceType: details.workplaceType ?? undefined,
        jobUrl: details.jobUrl.trim() || undefined,
        source: 'manual',
        descriptionText: details.descriptionText.trim(),
        // What the review showed is what's saved.
        ...(salary ? { salaryMin: salary.min, salaryMax: salary.max, salaryCurrency: salary.currency } : {}),
      });
      setSaving('done');
      toast.success('Job saved.');
      // The job page starts the fit run once, through Score fit's own guard (#353).
      router.push(runFit ? `/jobs/${job.id}?run=fit` : `/jobs/${job.id}`);
      router.refresh();
    } catch (error) {
      savingRef.current = false;
      setSaving(null);
      if (error instanceof ApiRequestError) {
        const fields = error.fields ?? {};
        setErrors(fields);
        setExistingJobId(error.status === 409 ? (error.existingJobId ?? null) : null);
        if (Object.keys(fields).length === 0) setSaveError(error.message);
      } else {
        setSaveError(error instanceof Error ? error.message : 'The job wasn’t saved. Try again.');
      }
    }
  }

  if (step === 'paste') {
    return (
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void readPosting();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="job-paste">Paste a job link or the full posting</Label>
          {/* Capped so a long paste scrolls inside the box (the Textarea grows with its content). */}
          <Textarea
            ref={pasteRef}
            id="job-paste"
            name="posting"
            value={pasteText}
            onChange={(event) => {
              setPasteText(event.target.value);
              if (pasteError) setPasteError(null);
            }}
            className="max-h-80 min-h-32 overflow-y-auto"
            // Read-only, not disabled, while the server reads it, so focus stays put.
            readOnly={isReading}
            aria-busy={isReading || undefined}
            aria-invalid={pasteError ? true : undefined}
            aria-describedby={describedBy('job-paste-help', pasteError && 'job-paste-error')}
          />
          <p id="job-paste-help" className="text-muted-foreground text-xs">
            Works with Greenhouse, Lever, Ashby, Workday and most job pages.
          </p>
          {pasteError ? (
            <p id="job-paste-error" className="text-destructive text-xs">
              {pasteError}
            </p>
          ) : null}
        </div>

        {readError ? (
          <ErrorState title="Couldn't get the details" message={readError} onRetry={() => void readPosting()}>
            <Button type="button" size="sm" variant="ghost" onClick={enterByHand}>
              Enter details yourself
            </Button>
          </ErrorState>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" aria-disabled={isReading || undefined} className="w-full gap-1.5 sm:w-auto">
            {isReading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isReading ? 'Getting details…' : 'Get details'}
          </Button>
          {readError ? null : (
            <Button type="button" variant="link" onClick={enterByHand} className="w-full sm:w-auto">
              Enter details yourself
            </Button>
          )}
        </div>
      </form>
    );
  }

  // Title and Company must be filled in, so "Not stated" only says the posting left them
  // out; entered by hand, they need no hint. An empty Location is saved as not stated.
  const hints = {
    title: posted ? hintFor(details.title, posted.title) : null,
    company: posted ? hintFor(details.company, posted.company) : null,
    location: hintFor(details.location, posted?.location),
  };
  const workplaceHint = posted?.workplaceType && details.workplaceType === posted.workplaceType ? 'from posting' : null;
  const salaryText = posted?.salary ? salaryAsPosted(posted.salary) : null;
  const characters = details.descriptionText.length.toLocaleString('en-US');

  return (
    <form className="space-y-5" onSubmit={save} noValidate>
      <div className="space-y-1">
        <h3 ref={reviewHeadingRef} tabIndex={-1} className="font-heading text-base font-semibold outline-none">
          Check the details
        </h3>
        <p className="text-muted-foreground text-sm">Nothing is saved until you press Save.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="job-title" required hint={hints.title} hintId="job-title-hint">
            Title
          </FieldLabel>
          <Input
            ref={titleRef}
            id="job-title"
            name="title"
            autoComplete="off"
            value={details.title}
            onChange={(event) => update('title', event.target.value)}
            placeholder="e.g. Backend Engineer"
            required
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={describedBy(hints.title && 'job-title-hint', errors.title && 'job-title-error')}
          />
          {errors.title ? (
            <p id="job-title-error" className="text-destructive text-xs">
              {errors.title}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="job-company" required hint={hints.company} hintId="job-company-hint">
            Company
          </FieldLabel>
          <Input
            ref={companyRef}
            id="job-company"
            name="company"
            autoComplete="organization"
            value={details.company}
            onChange={(event) => update('company', event.target.value)}
            placeholder="e.g. Acme"
            required
            aria-invalid={errors.company ? true : undefined}
            aria-describedby={describedBy(hints.company && 'job-company-hint', errors.company && 'job-company-error')}
          />
          {errors.company ? (
            <p id="job-company-error" className="text-destructive text-xs">
              {errors.company}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor="job-location" hint={hints.location} hintId="job-location-hint">
            Location
          </FieldLabel>
          <Input
            id="job-location"
            name="location"
            autoComplete="off"
            value={details.location}
            onChange={(event) => update('location', event.target.value)}
            placeholder="e.g. London, United Kingdom"
            aria-describedby={describedBy(hints.location && 'job-location-hint')}
          />
        </div>

        <fieldset className="min-w-0 space-y-1.5" aria-describedby={describedBy(workplaceHint && 'job-workplace-hint')}>
          <div className="flex items-baseline justify-between gap-2">
            <legend className="text-sm leading-none font-medium">Workplace</legend>
            {workplaceHint ? (
              <span id="job-workplace-hint" className="text-muted-foreground text-xs">
                {workplaceHint}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {WORKPLACE_CHOICES.map((choice) => (
              <label key={choice.label} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="workplace"
                  value={choice.value ?? ''}
                  checked={details.workplaceType === choice.value}
                  onChange={() => update('workplaceType', choice.value)}
                  className="accent-primary size-4"
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        {posted ? (
          // Read-only: the salary is what the posting states, not something to type in.
          <div role="group" aria-labelledby="job-salary-label" className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p id="job-salary-label" className="text-sm leading-none font-medium">
                Salary
              </p>
              {salaryText ? <span className="text-muted-foreground text-xs">from posting</span> : null}
            </div>
            <p className="text-sm">{salaryText ?? <span className="text-muted-foreground">Not stated</span>}</p>
          </div>
        ) : null}

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="job-url">Posting URL</Label>
          <Input
            ref={jobUrlRef}
            id="job-url"
            name="jobUrl"
            type="url"
            autoComplete="url"
            value={details.jobUrl}
            onChange={(event) => update('jobUrl', event.target.value)}
            placeholder="e.g. https://jobs.lever.co/acme/123"
            aria-invalid={errors.jobUrl ? true : undefined}
            aria-describedby={describedBy(errors.jobUrl && 'job-url-error')}
          />
          {errors.jobUrl ? (
            <p id="job-url-error" className="text-destructive text-xs">
              {errors.jobUrl}
              {existingJobId ? (
                <>
                  {' '}
                  <Link
                    href={`/jobs/${existingJobId}`}
                    className="text-foreground font-medium underline underline-offset-2"
                  >
                    Open the job
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          {descriptionOpen ? (
            <FieldLabel htmlFor="job-description" required hint={null} hintId="job-description-hint">
              Description
            </FieldLabel>
          ) : (
            <p className="text-sm leading-none font-medium">Description</p>
          )}
          <span className="text-muted-foreground text-xs">{characters} characters</span>
        </div>
        {descriptionOpen ? (
          // Capped so a long posting scrolls inside the box.
          <Textarea
            ref={descriptionRef}
            id="job-description"
            name="description"
            value={details.descriptionText}
            onChange={(event) => update('descriptionText', event.target.value)}
            className="max-h-80 min-h-32 overflow-y-auto"
            required
            aria-invalid={errors.descriptionText ? true : undefined}
            aria-describedby={describedBy(errors.descriptionText && 'job-description-error')}
          />
        ) : (
          // The clamp is on an inner line box: overflow is cut at the padding edge, so with
          // the padding on the same element a fifth line would show through it.
          <div className="bg-muted/40 rounded-lg p-3">
            <p className="text-muted-foreground line-clamp-4 text-sm break-words whitespace-pre-line">
              {details.descriptionText}
            </p>
          </div>
        )}
        {errors.descriptionText ? (
          <p id="job-description-error" className="text-destructive text-xs">
            {errors.descriptionText}
          </p>
        ) : null}
        {/* Nothing to fold away while it's empty. */}
        {details.descriptionText.trim() ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0"
            aria-expanded={descriptionOpen}
            aria-controls={descriptionOpen ? 'job-description' : undefined}
            onClick={() => setDescriptionOpen((open) => !open)}
          >
            {descriptionOpen ? 'Done editing' : 'Edit description'}
          </Button>
        ) : null}
      </div>

      {saveError ? (
        <p role="alert" className="text-destructive text-sm">
          {saveError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="submit"
          onClick={() => (intent.current = 'fit')}
          disabled={saving !== null}
          className="w-full sm:w-auto"
        >
          {saving === 'fit' ? 'Saving…' : saving === 'done' ? 'Opening the job…' : 'Save and run fit'}
        </Button>
        <Button
          type="submit"
          variant="outline"
          onClick={() => (intent.current = 'save')}
          disabled={saving !== null}
          className="w-full sm:w-auto"
        >
          {saving === 'save' ? 'Saving…' : 'Save only'}
        </Button>
        <Button
          type="button"
          variant="link"
          onClick={startOver}
          disabled={saving !== null}
          className="w-full sm:ml-auto sm:w-auto"
        >
          Start over
        </Button>
      </div>
    </form>
  );
}
