import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchBaseResumePdf, downloadBaseResumePdf, renderPdfPages } = vi.hoisted(() => ({
  fetchBaseResumePdf: vi.fn(),
  downloadBaseResumePdf: vi.fn(async () => ({ pages: 1, unsupported: 0 })),
  // pdf.js draws in a real browser; here each page is a blank canvas, as many as the stand-in
  // PDF below says.
  renderPdfPages: vi.fn(async (data: ArrayBuffer) =>
    Array.from({ length: new TextDecoder().decode(data).length - 7 }, () => document.createElement('canvas')),
  ),
}));
vi.mock('@/lib/api', () => ({
  fetchBaseResumePdf,
  downloadBaseResumePdf,
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
vi.mock('@/lib/pdf-pages', () => ({ renderPdfPages }));

import { ResumePdfPreview } from './resume-pdf-preview';

// A stand-in PDF: "%PDF-1." and one "x" per page.
const pdf = (pages: number, unsupported = 0) => ({
  blob: new Blob(['%PDF-1.' + 'x'.repeat(pages)], { type: 'application/pdf' }),
  pages,
  unsupported,
});

afterEach(() => vi.clearAllMocks());

describe('ResumePdfPreview (#415)', () => {
  it("draws the saved résumé's pages here, with how many there are, and no frame", async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);

    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText('Your PDF is 1 page.')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Page 1 of 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Résumé PDF preview' })).toBeInTheDocument();
    // A frame, or a link to a blob:, needs the browser's PDF viewer, which the CSP
    // (object-src 'none') can block.
    expect(document.querySelector('iframe, object, embed, a[href^="blob:"]')).toBeNull();
  });

  it('says when it runs to a second page, and when characters could not be printed', async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(2, 3));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText('Your PDF is 2 pages.')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Page 2 of 2' })).toBeInTheDocument();
    expect(screen.getByText(/3 characters in your résumé can't be printed/)).toBeInTheDocument();
  });

  it('says why a preview failed', async () => {
    fetchBaseResumePdf.mockRejectedValueOnce(new Error('Too many requests, slow down.'));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests, slow down.');
  });

  it("says so when the pages can't be drawn, and points to the download", async () => {
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1));
    renderPdfPages.mockRejectedValueOnce(new Error('canvas unavailable'));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText(/couldn't be shown here\. Download PDF has it/)).toBeInTheDocument();
  });

  it('a preview that failed to draw can be tried again, and the failure is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchBaseResumePdf.mockResolvedValueOnce(pdf(1)).mockResolvedValueOnce(pdf(1));
    renderPdfPages.mockRejectedValueOnce(new Error('canvas unavailable'));
    const user = userEvent.setup();
    render(<ResumePdfPreview name="Zoë Núñez" />);
    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByText(/couldn't be shown here/)).toBeInTheDocument();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('preview'), expect.objectContaining({ message: 'canvas unavailable' }));

    await user.click(screen.getByRole('button', { name: 'Preview PDF' }));
    expect(await screen.findByRole('img', { name: 'Page 1 of 1' })).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be shown here/)).not.toBeInTheDocument();
    logged.mockRestore();
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
    await screen.findByRole('img', { name: 'Page 1 of 1' });

    rerender(<ResumePdfPreview name="Zoë Núñez" changes={1} />);
    expect(screen.queryByRole('img', { name: 'Page 1 of 1' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your PDF is 1 page.')).not.toBeInTheDocument();
  });

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
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchBaseResumePdf).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Your PDF is 1 page.')).not.toBeInTheDocument();
  });

  it("can't be used before there is a résumé", () => {
    render(<ResumePdfPreview name="" disabled />);
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });
});
