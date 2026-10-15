import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeVersionRecord } from '@/types/job';

const { tailorResumeForJob, getTailorKeywords, approveResumeVersion, reviewResumeChange, downloadResumeVersion } = vi.hoisted(() => ({
  tailorResumeForJob: vi.fn(),
  getTailorKeywords: vi.fn(),
  approveResumeVersion: vi.fn(),
  reviewResumeChange: vi.fn(),
  downloadResumeVersion: vi.fn(),
}));

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api', () => ({
  tailorResumeForJob,
  getTailorKeywords,
  approveResumeVersion,
  reviewResumeChange,
  downloadResumeVersion,
}));

import { TailoredResumeReview, resetTailorStoreForTests } from './tailored-resume-review';

afterEach(() => {
  vi.clearAllMocks();
  resetTailorStoreForTests();
});

const draft: ResumeVersionRecord = {
  id: 'ver-1',
  userId: 'user-1',
  jobId: 'job-1',
  approved: false,
  isBase: false,
  changeSummary: 'Reworded 2 lines. 1 suggestion was dropped.',
  changeDetails: [
    {
      id: 'c0',
      kind: 'rewrite',
      section: 'Experience · Globex',
      sourcePath: 'work[0].highlights[1]',
      targetPath: 'work[0].highlights[1]',
      oldText: 'Reduced p95 latency by 40% with Redis caching',
      newText: 'Cut p95 latency 40% with Redis caching',
      rationale: 'The posting asks for latency work.',
      dropped: false,
      issues: [],
      needsReview: false,
    },
    {
      id: 'c1',
      kind: 'rewrite',
      section: 'Experience · Globex',
      sourcePath: 'work[0].highlights[0]',
      targetPath: 'work[0].highlights[0]',
      oldText: 'Built the billing API in Go serving 2,000 merchants',
      newText: 'Built the billing API in Go and Kafka serving 2,000 merchants',
      rationale: 'The posting asks for Kafka.',
      dropped: true,
      dropReason: "adds Kafka, which this role doesn't mention",
      issues: [{ code: 'NEW_SKILL', term: 'Kafka', message: "adds Kafka, which this role doesn't mention" }],
      needsReview: false,
    },
    {
      id: 'c2',
      kind: 'rewrite',
      section: 'Summary',
      sourcePath: 'basics.summary',
      targetPath: 'basics.summary',
      oldText: 'Backend engineer who builds payment APIs in Go.',
      newText: 'Backend engineer who led payment API work in Go.',
      rationale: 'Leadership.',
      dropped: false,
      issues: [{ code: 'LEADERSHIP_CLAIM', term: 'led', message: 'says "led", which the original line doesn\'t' }],
      needsReview: true,
    },
  ],
  structuredResume: {
    basics: { name: 'Jordan Lee', email: 'jordan@example.com', summary: 'Backend engineer who led payment API work in Go.' },
    work: [{ company: 'Globex', position: 'Backend Engineer', startDate: '2022-01', highlights: ['a', 'b'] }],
    education: [],
    skills: [],
  },
  basedOn: {
    baseVersionId: 'base-1',
    baseUpdatedAt: '2026-10-01T10:00:00.000Z',
    jobId: 'job-1',
    postingSha256: 'a'.repeat(64),
    model: 'openai:gpt-6-luna',
    createdAt: '2026-10-14T12:00:00.000Z',
    grounding: { version: 1 },
    confirmedKeywords: [],
    gaps: ['Kafka streaming', 'Kubernetes'],
    coverage: { total: 6, before: 2, after: 4 },
  },
  createdAt: '2026-10-14T12:00:00.000Z',
  updatedAt: '2026-10-14T12:00:00.000Z',
};

const renderReview = (versions: ResumeVersionRecord[] = []) =>
  render(<TailoredResumeReview jobId="job-1" jobTitle="Backend Engineer" jobCompany="Acme Pay" initialVersions={versions} />);

describe('TailoredResumeReview', () => {
  it('offers to tailor, with plain copy', () => {
    renderReview();
    expect(screen.getByRole('button', { name: 'Tailor résumé' })).toBeInTheDocument();
    expect(screen.getByText('Single-column PDF with selectable text.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/verified|guaranteed|zero invented|ats-optimized|role-optimized/i);
  });

  it('the tailor window shows the posting keywords, takes picks and custom ones, and tailors', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValueOnce({
      fitRead: true,
      keywords: [
        { term: 'Go', onResume: true },
        { term: 'Kafka', onResume: false },
        { term: 'Kubernetes', onResume: false },
      ],
    });
    let finish: (result: { version: ResumeVersionRecord }) => void = () => undefined;
    tailorResumeForJob.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderReview();

    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    const window = await screen.findByRole('dialog', { name: 'Tailor your résumé' });
    expect(getTailorKeywords).toHaveBeenCalledWith('job-1');
    expect(within(window).getByText('Go')).toBeInTheDocument();
    await user.click(within(window).getByRole('button', { name: 'Kafka' }));
    await user.type(within(window).getByLabelText('Add a keyword you have'), 'Snowflake');
    await user.click(within(window).getByRole('button', { name: 'Add' }));
    await user.click(within(window).getByLabelText('Also add them to my base résumé'));
    await user.click(within(window).getByRole('button', { name: 'Tailor with 2 keywords' }));

    expect(tailorResumeForJob).toHaveBeenCalledWith('job-1', { confirmedKeywords: ['Kafka', 'Snowflake'], addToBase: true });
    expect(await screen.findByText(/Tailoring your résumé/)).toBeInTheDocument();
    finish({ version: draft });
    expect(await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
  });

  it('says when there is no fit read yet, and still allows custom keywords', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValueOnce({ fitRead: false, keywords: [] });
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    const window = await screen.findByRole('dialog', { name: 'Tailor your résumé' });
    expect(within(window).getByText(/Run a fit read to see the posting's keywords/)).toBeInTheDocument();
    expect(within(window).getByRole('button', { name: 'Tailor résumé' })).toBeInTheDocument();
  });

  it('shows the empty-résumé 409 with a Settings link, and a failed AI call with Try again', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValue({ fitRead: false, keywords: [] });
    tailorResumeForJob.mockRejectedValueOnce(
      Object.assign(new Error('Add a summary or work experience with bullet points in Settings → Résumé before tailoring.'), {
        status: 409,
        code: 'BASE_RESUME_EMPTY',
      }),
    );
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tailor résumé' }));
    expect(await screen.findByText(/Add a summary or work experience/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings → Résumé' })).toHaveAttribute('href', '/settings');

    tailorResumeForJob.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    tailorResumeForJob.mockResolvedValueOnce({ version: draft });
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tailor résumé' }));
    expect(await screen.findByText("The AI couldn't answer this time.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
    expect(tailorResumeForJob).toHaveBeenCalledTimes(3);
  });

  it('shows what the draft is based on, the keyword count and the gaps', () => {
    renderReview([draft]);
    expect(screen.getByText(/Based on your base résumé saved/)).toBeInTheDocument();
    expect(screen.getByText(/gpt-6-luna/)).toBeInTheDocument();
    expect(screen.getByText('Posting keywords in your résumé: 2 of 6 → 4 of 6')).toBeInTheDocument();
    expect(screen.getByText('Kafka streaming')).toBeInTheDocument();
    expect(screen.queryByText(/Groundedness/)).not.toBeInTheDocument();
  });

  it('each line can be kept, restored or edited, and a dropped one only edited', async () => {
    const user = userEvent.setup();
    reviewResumeChange.mockImplementation(async (_v: string, changeId: string, action: string, text?: string) => ({
      ...draft,
      changeDetails: draft.changeDetails!.map((d) =>
        d.id === changeId ? { ...d, resolution: action === 'keep' ? 'kept' : action === 'restore' ? 'restored' : 'edited', userText: text } : d,
      ),
    }));
    renderReview([draft]);

    const first = screen.getByTestId('change-c0');
    await user.click(within(first).getByRole('button', { name: 'Restore original' }));
    expect(reviewResumeChange).toHaveBeenCalledWith('ver-1', 'c0', 'restore', undefined);
    expect(await within(screen.getByTestId('change-c0')).findByText('Restored')).toBeInTheDocument();

    const droppedLine = screen.getByTestId('change-c1');
    expect(within(droppedLine).getByText("Suggestion dropped: adds Kafka, which this role doesn't mention")).toBeInTheDocument();
    expect(within(droppedLine).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument();
    await user.click(within(droppedLine).getByRole('button', { name: 'Edit' }));
    const box = within(screen.getByTestId('change-c1')).getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'Built the billing API in Go for 2,000 merchants');
    await user.click(within(screen.getByTestId('change-c1')).getByRole('button', { name: 'Save' }));
    expect(reviewResumeChange).toHaveBeenCalledWith('ver-1', 'c1', 'edit', 'Built the billing API in Go for 2,000 merchants');
    expect(await within(screen.getByTestId('change-c1')).findByText('Your words')).toBeInTheDocument();

    expect(within(screen.getByTestId('change-c2')).getByText('Check this line: says "led", which the original line doesn\'t')).toBeInTheDocument();
  });

  it('one Download approves the draft and downloads it; after that it is final', async () => {
    const user = userEvent.setup();
    approveResumeVersion.mockResolvedValueOnce({ version: { ...draft, approved: true }, approved: true });
    downloadResumeVersion.mockResolvedValue(undefined);
    renderReview([draft]);

    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(downloadResumeVersion).toHaveBeenCalledWith('ver-1', 'Jordan Lee – Acme Pay.pdf'));
    expect(approveResumeVersion).toHaveBeenCalledWith('ver-1');
    expect(await screen.findByText(/Downloaded\. To change it, tailor again\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore original' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(approveResumeVersion).toHaveBeenCalledTimes(1);
    expect(downloadResumeVersion).toHaveBeenCalledTimes(2);
  });

  it('an older row without line ids still shows its changes, without the line actions', () => {
    renderReview([
      {
        ...draft,
        basedOn: null,
        changeDetails: [{ section: 'basics.summary', oldText: 'Old.', newText: 'New.', rationale: 'Why.' }],
      },
    ]);
    expect(screen.getByText('New.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore original' })).not.toBeInTheDocument();
  });

  it('a run carries on across a tab switch: the new draft shows on return, with one toast', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValue({ fitRead: true, keywords: [{ term: 'Kafka', onResume: false }] });
    let finish: (result: { version: ResumeVersionRecord }) => void = () => undefined;
    tailorResumeForJob.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const older = { ...draft, id: 'ver-0', changeSummary: 'An older draft.', updatedAt: '2026-10-13T12:00:00.000Z' };
    const first = renderReview([older]);
    await user.click(screen.getByRole('button', { name: 'Tailor again' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tailor résumé' }));
    first.unmount();

    // Back on the tab, with the page's (older) versions, while the run is still going.
    const second = renderReview([older]);
    expect(screen.getByText(/Tailoring your résumé/)).toBeInTheDocument();
    finish({ version: draft });
    expect(await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
    second.unmount();

    renderReview([older]);
    expect(screen.getByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('Try again tailors with the same keywords', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValue({ fitRead: true, keywords: [{ term: 'Kafka', onResume: false }] });
    tailorResumeForJob.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    tailorResumeForJob.mockResolvedValueOnce({ version: draft });
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    const window = await screen.findByRole('dialog');
    await user.click(await within(window).findByRole('button', { name: 'Kafka' }));
    await user.click(within(window).getByRole('button', { name: 'Tailor with 1 keyword' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.');
    expect(tailorResumeForJob).toHaveBeenNthCalledWith(2, 'job-1', { confirmedKeywords: ['Kafka'], addToBase: false });
  });

  it('takes up to 25 keywords', async () => {
    const user = userEvent.setup();
    const terms = Array.from({ length: 26 }, (_, i) => `Tool${String.fromCharCode(65 + i)}`);
    getTailorKeywords.mockResolvedValueOnce({ fitRead: true, keywords: terms.map((term) => ({ term, onResume: false })) });
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    const window = await screen.findByRole('dialog');
    await within(window).findByRole('button', { name: 'ToolA' });
    for (const term of terms.slice(0, 25)) await user.click(within(window).getByRole('button', { name: term }));
    expect(within(window).getByRole('button', { name: 'ToolZ' })).toBeDisabled();
    expect(within(window).getByRole('button', { name: 'Tailor with 25 keywords' })).toBeInTheDocument();
    expect(within(window).getByText('Up to 25 keywords.')).toBeInTheDocument();
  });

  it("says when the keywords couldn't be added to the base résumé", async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValueOnce({ fitRead: true, keywords: [{ term: 'Kafka', onResume: false }] });
    tailorResumeForJob.mockResolvedValueOnce({ version: draft, addedToBase: false });
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    const window = await screen.findByRole('dialog');
    await user.click(await within(window).findByRole('button', { name: 'Kafka' }));
    await user.click(within(window).getByLabelText('Also add them to my base résumé'));
    await user.click(within(window).getByRole('button', { name: 'Tailor with 1 keyword' }));
    await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.');
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/couldn't be added to your base résumé/));
  });

  it('an edited dropped line can be restored; a line that matched nothing has no actions', async () => {
    const user = userEvent.setup();
    const edited: ResumeVersionRecord = {
      ...draft,
      changeDetails: [
        { ...draft.changeDetails![1]!, resolution: 'edited', userText: 'Built the billing API in Go for 2,000 merchants' },
        {
          id: 'c3',
          kind: 'rewrite',
          section: 'Résumé',
          sourcePath: null,
          oldText: null,
          newText: 'Shipped a new mobile app',
          rationale: 'Mobile.',
          dropped: true,
          dropReason: "doesn't match a line of your base résumé",
          issues: [],
          needsReview: false,
        },
      ],
    };
    reviewResumeChange.mockResolvedValueOnce({
      ...edited,
      changeDetails: [{ ...edited.changeDetails![0]!, resolution: 'restored' }, edited.changeDetails![1]!],
    });
    renderReview([edited]);
    await user.click(within(screen.getByTestId('change-c1')).getByRole('button', { name: 'Restore original' }));
    expect(reviewResumeChange).toHaveBeenCalledWith('ver-1', 'c1', 'restore', undefined);
    expect(within(screen.getByTestId('change-c3')).queryAllByRole('button')).toHaveLength(0);
  });

  it('the edit box is labelled, and Download waits for a line being saved', async () => {
    const user = userEvent.setup();
    let save: (version: ResumeVersionRecord) => void = () => undefined;
    reviewResumeChange.mockReturnValueOnce(new Promise((resolve) => (save = resolve)));
    renderReview([draft]);
    await user.click(within(screen.getByTestId('change-c0')).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByTestId('change-c0')).getByLabelText('Your words for this line')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('change-c0')).getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(within(screen.getByTestId('change-c2')).getByRole('button', { name: 'Keep' })).toBeDisabled();
    save(draft);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  });

  it('an added skill can be removed, and says so', async () => {
    const user = userEvent.setup();
    const withSkill: ResumeVersionRecord = {
      ...draft,
      changeDetails: [
        {
          id: 'c5',
          kind: 'skill-added',
          section: 'Skills · Other',
          sourcePath: null,
          oldText: null,
          newText: 'Kafka',
          rationale: 'You confirmed you have Kafka.',
          dropped: false,
          issues: [],
          needsReview: false,
        },
      ],
    };
    reviewResumeChange.mockResolvedValueOnce({ ...withSkill, changeDetails: [{ ...withSkill.changeDetails![0]!, resolution: 'restored' }] });
    renderReview([withSkill]);
    await user.click(within(screen.getByTestId('change-c5')).getByRole('button', { name: 'Remove' }));
    expect(reviewResumeChange).toHaveBeenCalledWith('ver-1', 'c5', 'restore', undefined);
    expect(await within(screen.getByTestId('change-c5')).findByText('Removed')).toBeInTheDocument();
  });

  it("reads the posting's keywords each time the window opens, and says when it can't", async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockRejectedValueOnce(new Error('Network error'));
    getTailorKeywords.mockResolvedValueOnce({ fitRead: true, keywords: [{ term: 'Kafka', onResume: false }] });
    renderReview();
    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    expect(
      await within(await screen.findByRole('dialog')).findByText("Couldn't read the posting's keywords. You can still add your own."),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Tailor résumé' }));
    expect(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Kafka' })).toBeInTheDocument();
    expect(getTailorKeywords).toHaveBeenCalledTimes(2);
  });

  it('a line being saved still holds Download after a tab switch', async () => {
    const user = userEvent.setup();
    let save: (version: ResumeVersionRecord) => void = () => undefined;
    reviewResumeChange.mockReturnValueOnce(new Promise((resolve) => (save = resolve)));
    const first = renderReview([draft]);
    await user.click(within(screen.getByTestId('change-c2')).getByRole('button', { name: 'Keep' }));
    first.unmount();

    renderReview([draft]);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    save({ ...draft, updatedAt: '2026-10-14T12:05:00.000Z' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  });

  it('editing a dropped suggestion starts from the original line, not the dropped text', async () => {
    const user = userEvent.setup();
    renderReview([draft]);
    await user.click(within(screen.getByTestId('change-c1')).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByTestId('change-c1')).getByRole('textbox')).toHaveValue('Built the billing API in Go serving 2,000 merchants');
  });

  it('a download in progress still holds Download after a tab switch', async () => {
    const user = userEvent.setup();
    let approve: (result: { version: ResumeVersionRecord; approved: boolean }) => void = () => undefined;
    approveResumeVersion.mockReturnValueOnce(new Promise((resolve) => (approve = resolve)));
    downloadResumeVersion.mockResolvedValue(undefined);
    const first = renderReview([draft]);
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    first.unmount();

    renderReview([draft]);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    approve({ version: { ...draft, approved: true, updatedAt: '2026-10-14T12:06:00.000Z' }, approved: true });
    expect(await screen.findByText(/Downloaded\. To change it, tailor again\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
    expect(approveResumeVersion).toHaveBeenCalledTimes(1);
  });

  const earlier: ResumeVersionRecord = {
    ...draft,
    id: 'ver-0',
    approved: true,
    changeSummary: 'An earlier version.',
    createdAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:00:00.000Z',
  };

  it('earlier versions stay selectable', async () => {
    const user = userEvent.setup();
    renderReview([draft, earlier]);
    expect(screen.getByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v2 · Draft' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'v1 · Downloaded' }));
    expect(screen.getByText('An earlier version.')).toBeInTheDocument();
    expect(screen.getByText(/Downloaded\. To change it, tailor again\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v1 · Downloaded' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a new draft shows first, and the earlier ones stay in the list', async () => {
    const user = userEvent.setup();
    getTailorKeywords.mockResolvedValueOnce({ fitRead: false, keywords: [] });
    tailorResumeForJob.mockResolvedValueOnce({ version: draft });
    renderReview([earlier]);
    expect(screen.queryByRole('button', { name: /^v1/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tailor again' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tailor résumé' }));
    expect(await screen.findByText('Reworded 2 lines. 1 suggestion was dropped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v2 · Draft' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'v1 · Downloaded' })).toBeInTheDocument();
  });
});
