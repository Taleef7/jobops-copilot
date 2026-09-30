import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeFlag } from '@/lib/api';
import type { StructuredResume } from '@/types/job';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ResumeImportConfirm } from './resume-import-confirm';

afterEach(() => vi.clearAllMocks());

const parsed: StructuredResume = {
  basics: { name: 'Jane Candidate', email: 'jane@example.com', summary: '' },
  work: [
    {
      company: 'Encoded9',
      position: 'Software Developer',
      startDate: '2026-05-01',
      highlights: ['Encoded 9 regulatory measures as documented business rules'],
    },
    { company: 'Riccle', position: 'Product Associate', startDate: '2025-09-01', endDate: '2026-05-01', highlights: [] },
  ],
  education: [{ institution: 'Purdue University' }],
  skills: [{ category: 'Languages', skills: ['Python'] }],
};
const flags: ResumeFlag[] = [
  { path: 'work[0].company', value: 'Encoded9', reason: '"Encoded9" has a number stuck to a word. Check the name.' },
];

// #350: nothing is saved until the user says the roles look right, and a flagged field can't
// be waved through: it has to be fixed or explicitly kept.
describe('ResumeImportConfirm', () => {
  it('shows each role as "Position at Company · dates", with the flag and its reason', () => {
    render(<ResumeImportConfirm parsed={parsed} flags={flags} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Product Associate at Riccle · Sep 2025 – May 2026')).toBeInTheDocument();
    expect(screen.getByText(/has a number stuck to a word/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /looks right/i })).toBeDisabled();
  });

  it('saves the corrected résumé once the flagged company is fixed', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ResumeImportConfirm parsed={parsed} flags={flags} onConfirm={onConfirm} onCancel={vi.fn()} />);

    const company = screen.getByLabelText('Company', { selector: '#import-work-0-company' });
    await user.clear(company);
    await user.type(company, 'Medical Informatics Engineering');
    await user.click(screen.getByRole('button', { name: /looks right/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
    const saved = onConfirm.mock.calls[0]![0] as StructuredResume;
    expect(saved.work[0]!.company).toBe('Medical Informatics Engineering');
    expect(saved.work[1]!.company).toBe('Riccle');
    expect(saved.education).toEqual(parsed.education);
  });

  it('lets a flagged value be kept, but only explicitly', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ResumeImportConfirm parsed={parsed} flags={flags} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /keep as is/i }));
    await user.click(screen.getByRole('button', { name: /looks right/i }));
    expect((onConfirm.mock.calls[0]![0] as StructuredResume).work[0]!.company).toBe('Encoded9');
  });

  it('cancelling saves nothing', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ResumeImportConfirm parsed={parsed} flags={[]} onConfirm={onConfirm} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

it('asks for a name when none was read, since the résumé can’t be saved without one', async () => {
  const onConfirm = vi.fn();
  const user = userEvent.setup();
  const nameless = { ...parsed, basics: { ...parsed.basics, name: '' } };
  render(<ResumeImportConfirm parsed={nameless} flags={[]} onConfirm={onConfirm} onCancel={vi.fn()} />);

  expect(screen.getByRole('button', { name: /looks right/i })).toBeDisabled();
  await user.type(screen.getByLabelText('Name', { selector: '#import-basics-name' }), 'Jane Candidate');
  await user.click(screen.getByRole('button', { name: /looks right/i }));
  expect((onConfirm.mock.calls[0]![0] as StructuredResume).basics.name).toBe('Jane Candidate');
});
