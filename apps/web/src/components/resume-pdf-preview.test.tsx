import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchBaseResumePdf, downloadBaseResumePdf } = vi.hoisted(() => ({
  fetchBaseResumePdf: vi.fn(),
  downloadBaseResumePdf: vi.fn(async () => ({ pages: 1, unsupported: 0 })),
}));
vi.mock('@/lib/api', () => ({
  fetchBaseResumePdf,
  downloadBaseResumePdf,
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

import { ResumePdfPreview } from './resume-pdf-preview';

const pdf = (pages: number, unsupported = 0) => ({ blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), pages, unsupported });

beforeEach(() => {
  // jsdom has no object URLs.
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.clearAllMocks());

describe('ResumePdfPreview (#415)', () => {
  it('shows the PDF of the saved résumé, and how many pages it has', async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);

    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText('Your PDF is 1 page.')).toBeInTheDocument();
    expect(screen.getByTitle('Résumé PDF preview')).toHaveAttribute('src', 'blob:preview-1');
    expect(screen.getByRole('link', { name: /open the pdf in a new tab/i })).toHaveAttribute('href', 'blob:preview-1');
  });

  it('says when it runs to a second page, and when characters could not be printed', async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(2, 3));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText('Your PDF is 2 pages.')).toBeInTheDocument();
    expect(screen.getByText(/3 characters in your résumé can't be printed/)).toBeInTheDocument();
  });

  it('says why a preview failed', async () => {
    fetchBaseResumePdf.mockRejectedValueOnce(new Error('Too many requests, slow down.'));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests, slow down.');
  });

  it('downloads the PDF as "First Last – Résumé.pdf"', async () => {
    const user = userEvent.setup();
    render(<ResumePdfPreview name=" Zoë Núñez " />);
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadBaseResumePdf).toHaveBeenCalledWith('Zoë Núñez – Résumé.pdf');
  });

  it('drops a preview once the résumé changes, so an old one is never shown as current', async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1));
    const user = userEvent.setup();
    const { rerender } = render(<ResumePdfPreview name="Zoë Núñez" changes={0} />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    await screen.findByTitle('Résumé PDF preview');

    rerender(<ResumePdfPreview name="Zoë Núñez" changes={1} />);
    expect(screen.queryByTitle('Résumé PDF preview')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  // Fixes from review.
  it('waits for layout changes still being saved before rendering', async () => {
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => (settle = resolve));
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" pending={() => pending} />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(fetchBaseResumePdf).not.toHaveBeenCalled();
    settle();
    expect(await screen.findByText('Your PDF is 1 page.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(downloadBaseResumePdf).toHaveBeenCalledOnce();
  });

  it('never shows a PDF made before the latest change', async () => {
    let answer!: (value: ReturnType<typeof pdf>) => void;
    fetchBaseResumePdf.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(2));
    const user = userEvent.setup();
    const { rerender } = render(<ResumePdfPreview name="Zoë Núñez" changes={0} />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    rerender(<ResumePdfPreview name="Zoë Núñez" changes={1} />);
    answer(pdf(1));

    // The old one is dropped and the current one rendered.
    expect(await screen.findByText('Your PDF is 2 pages.')).toBeInTheDocument();
    expect(screen.queryByText('Your PDF is 1 page.')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    expect(screen.getByTitle('Résumé PDF preview')).toHaveAttribute('src', 'blob:preview-2');
  });

  it("can't be used before there is a résumé", () => {
    render(<ResumePdfPreview name="" disabled />);
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });
});
