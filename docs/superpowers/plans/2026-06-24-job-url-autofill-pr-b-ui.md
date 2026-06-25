# Job-URL Autofill — PR B (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An "Autofill" button on `/jobs/new` that fetches the pasted job URL via the PR-A endpoint and populates title/company/location/description/workplace — best-effort, always editable.

**Architecture:** A thin web API client (`extractJobFromUrl`) calls `POST /api/jobs/extract`; the create form gains an Autofill button beside the Job URL field that fills whatever fields the response returns, with a clear inline fallback when extraction is thin.

**Tech Stack:** Next.js client component, React, Vitest + Testing Library. Spec: `docs/superpowers/specs/2026-06-24-job-url-autofill-design.md` (task 3.2). Backend (`POST /api/jobs/extract`) returns camelCase `{ title?, company?, location?, descriptionText?, workplaceType?, source }`.

**Branch:** `feat/job-url-autofill-ui` (already created). **Scope:** PR B of 2 (PR A shipped the endpoint).

---

## Task 1: Web API client + Autofill UX

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add `ExtractedJobResponse` + `extractJobFromUrl`)
- Modify: `apps/web/src/components/job-create-form.tsx`
- Test: `apps/web/src/components/job-create-form.test.tsx` (create)

- [ ] **Step 1: Add the web API client**

In `apps/web/src/lib/api.ts`, add (near the other helpers; `requestJson` is the existing helper):

```ts
export interface ExtractedJobResponse {
  title?: string;
  company?: string;
  location?: string;
  descriptionText?: string;
  workplaceType?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  source: 'jsonld' | 'opengraph' | 'heuristic' | 'none';
}

export async function extractJobFromUrl(url: string): Promise<ExtractedJobResponse> {
  return requestJson<ExtractedJobResponse>('/api/jobs/extract', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/job-create-form.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { extractJobFromUrl, createJob } = vi.hoisted(() => ({
  extractJobFromUrl: vi.fn(),
  createJob: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  extractJobFromUrl,
  createJob,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { JobCreateForm } from './job-create-form';

afterEach(() => {
  vi.clearAllMocks();
});

it('disables Autofill until the URL is a valid http(s) URL', async () => {
  const user = userEvent.setup();
  render(<JobCreateForm />);

  const autofill = screen.getByRole('button', { name: /autofill/i });
  expect(autofill).toBeDisabled();

  await user.type(screen.getByLabelText(/job url/i), 'https://boards.greenhouse.io/x/jobs/1');
  expect(autofill).toBeEnabled();
});

it('populates the form from a successful extraction', async () => {
  extractJobFromUrl.mockResolvedValue({
    title: 'AI Engineer',
    company: 'Pebble',
    location: 'Remote',
    descriptionText: 'Build agents.',
    workplaceType: 'remote',
    source: 'jsonld',
  });
  const user = userEvent.setup();
  render(<JobCreateForm />);

  await user.type(screen.getByLabelText(/job url/i), 'https://x/y');
  await user.click(screen.getByRole('button', { name: /autofill/i }));

  await waitFor(() => expect(screen.getByLabelText(/company/i)).toHaveValue('Pebble'));
  expect(screen.getByLabelText(/job title/i)).toHaveValue('AI Engineer');
  expect(screen.getByLabelText(/job description/i)).toHaveValue('Build agents.');
});

it('shows a manual-entry fallback when nothing could be extracted', async () => {
  extractJobFromUrl.mockResolvedValue({ source: 'none' });
  const user = userEvent.setup();
  render(<JobCreateForm />);

  await user.type(screen.getByLabelText(/job url/i), 'https://x/y');
  await user.click(screen.getByRole('button', { name: /autofill/i }));

  expect(await screen.findByText(/couldn.t read that posting/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/job title/i)).toHaveValue('');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/components/job-create-form.test.tsx`
Expected: FAIL — no Autofill button.

- [ ] **Step 4: Implement the form changes**

In `apps/web/src/components/job-create-form.tsx`:

1. Update imports — add `extractJobFromUrl` and a `Download` icon:
```ts
import { Download, Loader2, Sparkles } from 'lucide-react';
import { ApiRequestError, createJob, extractJobFromUrl } from '@/lib/api';
```

2. Add state below `isSubmitting`:
```ts
  const [isExtracting, setIsExtracting] = useState(false);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);
```

3. Add a URL check + the autofill handler (after `updateField`):
```ts
  function isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function handleAutofill() {
    const url = form.jobUrl.trim();
    if (!isHttpUrl(url)) return;
    setIsExtracting(true);
    setAutofillNote(null);
    try {
      const data = await extractJobFromUrl(url);
      const hasAny = Boolean(
        data.title || data.company || data.location || data.descriptionText || data.workplaceType,
      );
      if (!hasAny) {
        setAutofillNote('Couldn’t read that posting automatically — paste the description below.');
        return;
      }
      setForm((current) => ({
        ...current,
        title: data.title ?? current.title,
        company: data.company ?? current.company,
        location: data.location ?? current.location,
        descriptionText: data.descriptionText ?? current.descriptionText,
        workplaceType: data.workplaceType ?? current.workplaceType,
      }));
      setErrors({});
      const label = data.source === 'jsonld' ? 'the posting’s structured data' : 'page metadata';
      toast.success(`Autofilled from ${label} — review before saving.`);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not read that job posting.',
      );
    } finally {
      setIsExtracting(false);
    }
  }
```

5. Replace the Job URL field block (the `<div className="space-y-1.5">` containing the `jobUrl` Label + Input + error) with one that adds the Autofill button and note:
```tsx
        <div className="space-y-1.5">
          <Label htmlFor="jobUrl">Job URL</Label>
          <div className="flex gap-2">
            <Input
              id="jobUrl"
              value={form.jobUrl}
              onChange={(event) => updateField('jobUrl', event.target.value)}
              placeholder="https://…"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleAutofill}
              disabled={!isHttpUrl(form.jobUrl) || isExtracting}
              className="shrink-0 gap-1.5"
            >
              {isExtracting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Autofill
            </Button>
          </div>
          {errors.jobUrl ? <p className="text-destructive text-xs">{errors.jobUrl}</p> : null}
          {autofillNote ? <p className="text-muted-foreground text-xs">{autofillNote}</p> : null}
        </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npx vitest run src/components/job-create-form.test.tsx`
Expected: PASS (3 tests).

Then: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git add apps/web/src/lib/api.ts apps/web/src/components/job-create-form.tsx apps/web/src/components/job-create-form.test.tsx && git commit -F - <<'EOF'
feat(web): autofill the add-job form from a pasted URL (#120)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YY7NVS3QLuFeTqkmBaidAB
EOF
```

---

## Task 2: Full verification + open PR

- [ ] **Step 1: Full web suite + build**

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm test`
Expected: all PASS.

Run: `cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot/apps/web" && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Push + open PR**

```bash
cd "C:/Users/talee/OneDrive - Higher Education Commission/projects/JobOps Copilot" && git push -u origin feat/job-url-autofill-ui
```
Open the PR (base `main`), title `feat: add-job autofill from URL — frontend (#118 → #120 · PR B)`, body summarising the Autofill button + mapping + fallback, ending with the Generated-with line.

---

## Self-review notes
- **Spec coverage:** 3.2 (map → form fields, editable, clear fallback) = Task 1.
- **Type consistency:** `ExtractedJobResponse` (camelCase, matching the backend `ExtractedJob`); `extractJobFromUrl(url)` hits `POST /api/jobs/extract`. `workplaceType` union matches `Job['workplaceType']`.
- **Behavior:** overwrite-on-autofill (user clicked intentionally), button gated on a valid http(s) URL, inline fallback on `source: 'none'`/no fields, toast on API error (e.g. blocked URL). The URL is still saved on manual submit regardless.
- **No placeholders:** full code + exact commands.
