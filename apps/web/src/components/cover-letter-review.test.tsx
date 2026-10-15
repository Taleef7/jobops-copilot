import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoverLetterRecord } from '@/types/job';

const { getCoverLetter, writeCoverLetter, editCoverLetterParagraph, removeCoverLetterParagraph, downloadCoverLetter } = vi.hoisted(() => ({
  getCoverLetter: vi.fn(),
  writeCoverLetter: vi.fn(),
  editCoverLetterParagraph: vi.fn(),
  removeCoverLetterParagraph: vi.fn(),
  downloadCoverLetter: vi.fn(),
}));
const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api', () => ({ getCoverLetter, writeCoverLetter, editCoverLetterParagraph, removeCoverLetterParagraph, downloadCoverLetter }));

import { CoverLetterReview, resetCoverLetterStoreForTests, startCoverLetter } from './cover-letter-review';

afterEach(() => {
  vi.clearAllMocks();
  resetCoverLetterStoreForTests();
});

const letter: CoverLetterRecord = {
  id: 'letter-1',
  userId: 'user-1',
  jobId: 'job-1',
  length: 'concise',
  paragraphs: [
    { text: 'I am applying for the Backend Engineer role at Acme Pay.', edited: false },
    { text: 'At Globex I built the billing API in Go serving 2,000 merchants. I would enjoy working on PayLink.', edited: false },
    { text: 'I have worked with Kafka alongside Go.', edited: false },
  ],
  checks: [
    {
      paragraph: null,
      text: 'At Globex I cut p95 latency by 60% with Redis caching.',
      dropped: true,
      dropReason: "adds the number 60%, which isn't in your base résumé",
      issues: [{ code: 'NEW_NUMBER', term: '60%', message: "adds the number 60%, which isn't in your base résumé" }],
    },
    {
      paragraph: 1,
      text: 'I would enjoy working on PayLink.',
      dropped: false,
      issues: [{ code: 'NEW_NAME', term: 'PayLink', message: 'mentions "PayLink" from the posting, not your résumé' }],
    },
    { paragraph: 2, text: 'I have worked with Kafka alongside Go.', dropped: false, issues: [], confirmedTerms: ['Kafka'] },
  ],
  basedOn: {
    baseVersionId: 'base-1',
    baseUpdatedAt: '2026-10-01T10:00:00.000Z',
    jobId: 'job-1',
    postingSha256: 'a'.repeat(64),
    model: 'openai:gpt-6-luna',
    createdAt: '2026-10-14T12:00:00.000Z',
    grounding: { version: 1 },
    confirmedKeywords: ['Kafka'],
  },
  createdAt: '2026-10-14T12:00:00.000Z',
  updatedAt: '2026-10-14T12:00:00.000Z',
};

const renderLetter = (defaultKeywords: string[] = []) =>
  render(<CoverLetterReview jobId="job-1" jobCompany="Acme Pay" defaultKeywords={defaultKeywords} />);

describe('CoverLetterReview', () => {
  it('offers Concise or Full when there is no letter, and writes the one picked', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(null);
    writeCoverLetter.mockResolvedValueOnce({ ...letter, length: 'full' });
    renderLetter(['Kafka']);

    expect(await screen.findByRole('button', { name: 'Write cover letter' })).toBeInTheDocument();
    expect(screen.getByText(/always one page/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Full/ }));
    await user.click(screen.getByRole('button', { name: 'Write cover letter' }));

    expect(writeCoverLetter).toHaveBeenCalledWith('job-1', { length: 'full', confirmedKeywords: ['Kafka'] });
    expect(await screen.findByText('I am applying for the Backend Engineer role at Acme Pay.')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('shows the letter, what it was based on, what the check left out and what to look at', async () => {
    getCoverLetter.mockResolvedValueOnce(letter);
    renderLetter();

    expect(await screen.findByText('I am applying for the Backend Engineer role at Acme Pay.')).toBeInTheDocument();
    expect(screen.getByText(/^Based on your base résumé saved/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cover letter · Concise' })).toBeInTheDocument();
    const left = screen.getByRole('region', { name: 'Left out by the check' });
    expect(within(left).getByText('At Globex I cut p95 latency by 60% with Redis caching.')).toBeInTheDocument();
    expect(within(left).getByText(/adds the number 60%/)).toBeInTheDocument();
    expect(screen.getByText(/mentions "PayLink" from the posting/)).toBeInTheDocument();
    expect(screen.getByText('Uses Kafka, which you added')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/verified|guaranteed|ats-optimized/i);
  });

  it('a paragraph can be edited; the edit is saved, marked as yours, and its notes go', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    const mine = 'I would like to bring my payment API work to Acme Pay.';
    editCoverLetterParagraph.mockResolvedValueOnce({
      ...letter,
      paragraphs: [letter.paragraphs[0]!, { text: mine, edited: true }, letter.paragraphs[2]!],
      updatedAt: '2026-10-14T12:01:00.000Z',
    });
    renderLetter();

    const second = await screen.findByTestId('letter-paragraph-1');
    await user.click(within(second).getByRole('button', { name: 'Edit paragraph 2' }));
    const box = within(second).getByLabelText('Paragraph 2');
    await user.clear(box);
    await user.type(box, mine);
    await user.click(within(second).getByRole('button', { name: 'Save' }));

    expect(editCoverLetterParagraph).toHaveBeenCalledWith('job-1', 1, mine, letter.updatedAt);
    const saved = await screen.findByTestId('letter-paragraph-1');
    expect(await within(saved).findByText(mine)).toBeInTheDocument();
    expect(within(saved).getByText('Your words')).toBeInTheDocument();
    expect(screen.queryByText(/mentions "PayLink"/)).not.toBeInTheDocument();
  });

  it("a refused edit says why and keeps the user's text", async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(new Error('This would make the letter longer than one page. Shorten it.'));
    renderLetter();

    const first = await screen.findByTestId('letter-paragraph-0');
    await user.click(within(first).getByRole('button', { name: 'Edit paragraph 1' }));
    await user.type(within(first).getByLabelText('Paragraph 1'), ' More.');
    await user.click(within(first).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This would make the letter longer than one page. Shorten it.'));
    expect(within(first).getByLabelText('Paragraph 1')).toHaveValue(`${letter.paragraphs[0]!.text} More.`);
  });

  // #412: the days are the user's, not UTC's. In New York, the browser's zone in these tests,
  // 1:30 am UTC is the evening before.
  it("dates the letter's basis in the browser's time zone", async () => {
    const basedOn = { ...letter.basedOn, baseUpdatedAt: '2026-10-01T01:00:00.000Z', createdAt: '2026-10-15T01:30:00.000Z' };
    getCoverLetter.mockResolvedValueOnce({ ...letter, basedOn });
    renderLetter();
    expect(await screen.findByText(/^Based on your base résumé saved/)).toHaveTextContent(
      'saved Sep 30, 2026 and this posting · gpt-6-luna · written Oct 14, 2026',
    );
  });

  it("Download PDF dates the letter with the browser's local date", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T01:30:00.000Z'));
    try {
      const user = userEvent.setup();
      getCoverLetter.mockResolvedValueOnce(letter);
      downloadCoverLetter.mockResolvedValueOnce({ unsupported: 0 });
      renderLetter();

      await user.click(await screen.findByRole('button', { name: 'Download PDF' }));
      expect(downloadCoverLetter).toHaveBeenCalledWith('job-1', '2026-10-14');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed write says why with Try again, and keeps the letter there was', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    writeCoverLetter.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    writeCoverLetter.mockResolvedValueOnce({ ...letter, id: 'letter-2', length: 'full' });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Write again' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'concise', confirmedKeywords: ['Kafka'] });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The AI couldn't answer this time.");
    expect(screen.getByText('I am applying for the Backend Engineer role at Acme Pay.')).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(writeCoverLetter).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('an empty base résumé links to Settings', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(null);
    writeCoverLetter.mockRejectedValueOnce(
      Object.assign(new Error('Add a summary or work experience with bullet points in Settings → Résumé first.'), {
        status: 409,
        code: 'BASE_RESUME_EMPTY',
      }),
    );
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Write cover letter' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a letter started from the tailor window shows its progress, here or after a tab switch', async () => {
    getCoverLetter.mockResolvedValue(null);
    let finish: (value: CoverLetterRecord) => void = () => undefined;
    writeCoverLetter.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    startCoverLetter('job-1', { length: 'full', confirmedKeywords: [] });
    const first = renderLetter();
    expect(await screen.findByText(/Writing your cover letter/)).toBeInTheDocument();
    first.unmount();

    renderLetter();
    expect(screen.getByText(/Writing your cover letter/)).toBeInTheDocument();
    finish({ ...letter, length: 'full' });
    expect(await screen.findByText('I am applying for the Backend Engineer role at Acme Pay.')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it('a paragraph can be removed, and the last one cannot', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    removeCoverLetterParagraph.mockResolvedValueOnce({
      ...letter,
      paragraphs: [letter.paragraphs[0]!],
      checks: [letter.checks[0]!],
      updatedAt: '2026-10-14T12:02:00.000Z',
    });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Remove paragraph 3' }));
    expect(removeCoverLetterParagraph).toHaveBeenCalledWith('job-1', 2, letter.updatedAt);
    await waitFor(() => expect(screen.queryByTestId('letter-paragraph-1')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Remove paragraph/ })).not.toBeInTheDocument();
  });

  it('the progress is announced once, not every second', async () => {
    getCoverLetter.mockResolvedValue(null);
    writeCoverLetter.mockReturnValueOnce(new Promise(() => undefined));
    startCoverLetter('job-1', { length: 'concise', confirmedKeywords: [] });
    renderLetter();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Writing your cover letter');
    expect(status.textContent).not.toMatch(/\d+s/);
  });

  it('reads the letter again when it shows again (another tab may have written it)', async () => {
    getCoverLetter.mockResolvedValueOnce(null);
    const first = renderLetter();
    expect(await screen.findByRole('button', { name: 'Write cover letter' })).toBeInTheDocument();
    first.unmount();

    getCoverLetter.mockResolvedValueOnce(letter);
    renderLetter();
    expect(await screen.findByText('I am applying for the Backend Engineer role at Acme Pay.')).toBeInTheDocument();
    expect(getCoverLetter).toHaveBeenCalledTimes(2);
  });
});
