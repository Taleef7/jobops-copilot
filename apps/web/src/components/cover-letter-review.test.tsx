import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoverLetterRecord } from '@/types/job';

const { getCoverLetter, writeCoverLetter, editCoverLetterParagraph, removeCoverLetterParagraph, resolveCoverLetterFlag, downloadCoverLetter } =
  vi.hoisted(() => ({
    getCoverLetter: vi.fn(),
    writeCoverLetter: vi.fn(),
    editCoverLetterParagraph: vi.fn(),
    removeCoverLetterParagraph: vi.fn(),
    resolveCoverLetterFlag: vi.fn(),
    downloadCoverLetter: vi.fn(),
  }));
const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/api', () => ({
  getCoverLetter,
  writeCoverLetter,
  editCoverLetterParagraph,
  removeCoverLetterParagraph,
  resolveCoverLetterFlag,
  downloadCoverLetter,
}));

import { CoverLetterReview, resetCoverLetterStoreForTests, setTailorKeywords, startCoverLetter } from './cover-letter-review';

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
      id: 'c0',
      paragraph: null,
      text: 'At Globex I cut p95 latency by 60% with Redis caching.',
      dropped: true,
      severity: 'drop',
      dropReason: "adds the number 60%, which isn't in your base résumé",
      issues: [{ code: 'NEW_NUMBER', term: '60%', message: "adds the number 60%, which isn't in your base résumé", severity: 'drop' }],
    },
    {
      id: 'c1',
      paragraph: 1,
      text: 'I would enjoy working on PayLink.',
      dropped: false,
      severity: 'flag',
      resolution: 'kept',
      issues: [{ code: 'NEW_NAME', term: 'PayLink', message: 'mentions "PayLink" from the posting, not your résumé', severity: 'flag' }],
    },
    { id: 'c2', paragraph: 2, text: 'I have worked with Kafka alongside Go.', dropped: false, severity: 'note', issues: [], confirmedTerms: ['Kafka'] },
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

/** The letter with its PayLink sentence flagged and not yet kept or removed. */
const flagged: CoverLetterRecord = {
  ...letter,
  checks: letter.checks.map((check) => (check.id === 'c1' ? { ...check, resolution: undefined } : check)),
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

    // The paragraph's text as it was read goes too: the API refuses if it moved or changed.
    expect(editCoverLetterParagraph).toHaveBeenCalledWith('job-1', 1, mine, letter.updatedAt, letter.paragraphs[1]!.text);
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
    expect(removeCoverLetterParagraph).toHaveBeenCalledWith('job-1', 2, letter.updatedAt, letter.paragraphs[2]!.text);
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
  it("while a paragraph is being edited, the other paragraphs can't be edited or removed", async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    expect(screen.getByRole('button', { name: 'Edit paragraph 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove paragraph 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove paragraph 3' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Write again' })).toBeDisabled();
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Remove paragraph 1' })).toBeEnabled();
  });

  it('Try again writes with the length and keywords as they are now', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(null);
    writeCoverLetter.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    writeCoverLetter.mockReturnValueOnce(new Promise(() => undefined));
    renderLetter(['Kafka']);

    await user.click(await screen.findByRole('button', { name: 'Write cover letter' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'concise', confirmedKeywords: ['Kafka'] });
    const alert = await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Full' }));
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'full', confirmedKeywords: ['Kafka'] });
  });
  it("Try again after a failed run from the tailor window keeps that run's keywords and length", async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValue(null);
    writeCoverLetter.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    writeCoverLetter.mockReturnValueOnce(new Promise(() => undefined));
    startCoverLetter('job-1', { length: 'full', confirmedKeywords: ['Snowflake'] });
    renderLetter([]);

    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'full', confirmedKeywords: ['Snowflake'] });
  });

  it('Write again uses the keywords of the latest tailoring, else the letter\'s', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    writeCoverLetter.mockReturnValue(new Promise(() => undefined));
    renderLetter();

    setTailorKeywords('job-1', ['Kafka', 'Snowflake']);
    await user.click(await screen.findByRole('button', { name: 'Write again' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'concise', confirmedKeywords: ['Kafka', 'Snowflake'] });
  });

  it('a paragraph that moved in another tab: the letter is read again and the edit stays open on it', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(
      Object.assign(new Error('That paragraph changed or moved in another tab.'), { status: 409, code: 'PARAGRAPH_CHANGED' }),
    );
    // Another tab removed the first paragraph: the one being edited is now the first.
    getCoverLetter.mockResolvedValueOnce({ ...letter, paragraphs: letter.paragraphs.slice(1), checks: [], updatedAt: '2026-10-14T12:05:00.000Z' });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    const box = screen.getByLabelText('Paragraph 2');
    await user.type(box, ' More.');
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(getCoverLetter).toHaveBeenCalledTimes(2));
    const moved = await screen.findByLabelText('Paragraph 1');
    expect(moved).toHaveValue(`${letter.paragraphs[1]!.text} More.`);
  });

  it('a paragraph that is gone in another tab: the editor closes and the typed text is kept to copy', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(
      Object.assign(new Error('That paragraph changed or moved in another tab.'), { status: 409, code: 'PARAGRAPH_CHANGED' }),
    );
    getCoverLetter.mockResolvedValueOnce({ ...letter, paragraphs: [letter.paragraphs[0]!, letter.paragraphs[2]!], checks: [] });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    await user.type(screen.getByLabelText('Paragraph 2'), ' More.');
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Save' }));

    const unsaved = await screen.findByLabelText('Your unsaved text');
    expect(unsaved).toHaveValue(`${letter.paragraphs[1]!.text} More.`);
    expect(screen.queryByLabelText(/^Paragraph \d$/)).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed in another tab/));
  });
  it('a flagged sentence is highlighted with its reason, and Download waits until it is kept or removed', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(flagged);
    resolveCoverLetterFlag.mockResolvedValueOnce(letter);
    renderLetter();

    const paragraph = await screen.findByTestId('letter-paragraph-1');
    expect(within(paragraph).getByText('I would enjoy working on PayLink.').tagName).toBe('MARK');
    expect(within(paragraph).getByText(/mentions "PayLink" from the posting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.getByText(/Keep or remove the 1 highlighted sentence before you download/)).toBeInTheDocument();

    await user.click(within(paragraph).getByRole('button', { name: 'Keep' }));
    expect(resolveCoverLetterFlag).toHaveBeenCalledWith('job-1', 'c1', 'keep', flagged.paragraphs[1]!.text, flagged.updatedAt);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  });

  it('Remove takes the flagged sentence out of its paragraph', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(flagged);
    resolveCoverLetterFlag.mockResolvedValueOnce({
      ...letter,
      paragraphs: [letter.paragraphs[0]!, { text: 'At Globex I built the billing API in Go serving 2,000 merchants.', edited: false }, letter.paragraphs[2]!],
      checks: letter.checks.map((check) => (check.id === 'c1' ? { ...check, resolution: 'removed' as const } : check)),
    });
    renderLetter();

    await user.click(within(await screen.findByTestId('letter-paragraph-1')).getByRole('button', { name: 'Remove' }));
    expect(resolveCoverLetterFlag).toHaveBeenCalledWith('job-1', 'c1', 'remove', flagged.paragraphs[1]!.text, flagged.updatedAt);
    expect(await screen.findByText('At Globex I built the billing API in Go serving 2,000 merchants.')).toBeInTheDocument();
  });

  it('a letter that changed in another tab is read again, the typed text kept, and the user told', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(Object.assign(new Error('This letter changed in another tab.'), { status: 409, code: 'LETTER_CHANGED' }));
    getCoverLetter.mockResolvedValueOnce({ ...letter, updatedAt: '2026-10-14T12:09:00.000Z' });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    await user.type(screen.getByLabelText('Paragraph 2'), ' More.');
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/changed in another tab/)));
    expect(screen.getByLabelText('Paragraph 2')).toHaveValue(`${letter.paragraphs[1]!.text} More.`);
  });

  it('when the letter cannot be read again after a 409, the user is told', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(Object.assign(new Error('That paragraph changed.'), { status: 409, code: 'PARAGRAPH_CHANGED' }));
    getCoverLetter.mockRejectedValueOnce(new Error('Network error'));
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/couldn't be read again|Reload/)));
  });

  it('a 409 on a paragraph that only moved still says the save did not apply', async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValueOnce(letter);
    editCoverLetterParagraph.mockRejectedValueOnce(Object.assign(new Error('That paragraph changed.'), { status: 409, code: 'PARAGRAPH_CHANGED' }));
    getCoverLetter.mockResolvedValueOnce({ ...letter, paragraphs: letter.paragraphs.slice(1), checks: [] });
    renderLetter();

    await user.click(await screen.findByRole('button', { name: 'Edit paragraph 2' }));
    await user.click(within(screen.getByTestId('letter-paragraph-1')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/moved.*wasn't saved|wasn't saved.*moved/)));
  });

  it("after a failed run, the toggle shows that run's length even if another was picked before", async () => {
    const user = userEvent.setup();
    getCoverLetter.mockResolvedValue(null);
    writeCoverLetter.mockRejectedValueOnce(Object.assign(new Error("The AI couldn't answer this time."), { status: 503 }));
    writeCoverLetter.mockReturnValueOnce(new Promise(() => undefined));
    renderLetter([]);
    await user.click(await screen.findByRole('button', { name: 'Concise' }));

    startCoverLetter('job-1', { length: 'full', confirmedKeywords: ['Snowflake'] });
    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(writeCoverLetter).toHaveBeenLastCalledWith('job-1', { length: 'full', confirmedKeywords: ['Snowflake'] });
  });
});
