import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeLayout } from '@/types/job';

const { saveResumeLayout, toastFn } = vi.hoisted(() => ({
  saveResumeLayout: vi.fn(async (patch: ResumeLayout) => patch),
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('@/lib/api', () => ({
  saveResumeLayout,
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

import { ResumeLayoutEditor } from './resume-layout-editor';

afterEach(() => vi.clearAllMocks());

// The API answers with the layout as saved: the whole of it, here the sections sent.
const answer = (sections: ResumeLayout['sections'], pageSize?: ResumeLayout['pageSize']) => ({ sections, ...(pageSize ? { pageSize } : {}) });

const rows = () =>
  within(screen.getByRole('list', { name: 'Sections, in the order they print' }))
    .getAllByRole('listitem')
    .map((row) => (within(row).getByRole('textbox') as HTMLInputElement).value + (within(row).queryByText('Hidden') ? ' (hidden)' : ''));

const lastSaved = () => saveResumeLayout.mock.calls.at(-1)![0];

describe('ResumeLayoutEditor (#415)', () => {
  it('lists every section in the saved order, with its heading and whether it prints', () => {
    render(
      <ResumeLayoutEditor
        initial={{ sections: [{ key: 'skills', title: 'Technical Skills' }, { key: 'education' }, { key: 'certificates', hidden: true }] }}
      />,
    );
    expect(rows()).toEqual(['Technical Skills', 'Education', 'Certifications (hidden)', 'Summary', 'Experience', 'Projects']);
    // The field says which section it is, whatever its heading.
    expect(screen.getByLabelText('Skills heading')).toHaveValue('Technical Skills');
    expect(screen.getByText(/Tailored résumés follow them until you download one or the job moves to Applied\./)).toBeInTheDocument();
  });

  it('moves a section with the keyboard, saves at once, and says where it went', async () => {
    saveResumeLayout.mockImplementation(async (patch: ResumeLayout) => answer(patch.sections));
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={undefined} />);

    screen.getByRole('button', { name: 'Move Education up' }).focus();
    await user.keyboard('{Enter}');
    expect(rows()).toEqual(['Summary', 'Education', 'Experience', 'Skills', 'Projects', 'Certifications']);
    expect(screen.getByRole('status')).toHaveTextContent('Education moved to position 2 of 6');
    expect(lastSaved()).toEqual({
      sections: ['summary', 'education', 'work', 'skills', 'projects', 'certificates'].map((key) => ({ key })),
    });

    // Focus stays on the button, and moves to "down" once the section is at the top.
    expect(screen.getByRole('button', { name: 'Move Education up' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(rows()[0]).toBe('Education');
    expect(screen.getByRole('button', { name: 'Move Education up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Education down' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Education moved to position 1 of 6');
    await user.keyboard('{Enter}');
    expect(rows().slice(0, 2)).toEqual(['Summary', 'Education']);
    await waitFor(() => expect(saveResumeLayout).toHaveBeenCalledTimes(3));
  });

  it('renames a section on Enter or when the field is left, and Escape cancels', async () => {
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={undefined} />);

    const skills = screen.getByLabelText('Skills heading');
    await user.clear(skills);
    await user.type(skills, 'Technical Skills{Enter}');
    expect(saveResumeLayout).toHaveBeenCalledOnce();
    expect(lastSaved().sections!.find((s) => s.key === 'skills')).toEqual({ key: 'skills', title: 'Technical Skills' });

    const work = screen.getByLabelText('Experience heading');
    await user.clear(work);
    await user.type(work, 'Oops');
    await user.keyboard('{Escape}');
    expect(work).toHaveValue('Experience');
    await user.tab();
    expect(saveResumeLayout).toHaveBeenCalledOnce();

    await user.clear(work);
    await user.type(work, 'Professional Experience');
    await user.tab();
    expect(saveResumeLayout).toHaveBeenCalledTimes(2);
    expect(lastSaved().sections!.find((s) => s.key === 'work')).toEqual({ key: 'work', title: 'Professional Experience' });
    expect(screen.getByRole('button', { name: 'Move Professional Experience up' })).toBeInTheDocument();

    // An empty heading is the default one again, and isn't saved as a title.
    await user.clear(skills);
    await user.tab();
    expect(skills).toHaveValue('Skills');
    expect(lastSaved().sections!.find((s) => s.key === 'skills')).toEqual({ key: 'skills' });
  });

  it('hides a section without losing it, and shows it again', async () => {
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={{ sections: [{ key: 'certificates', title: 'Licenses' }] }} />);

    await user.click(screen.getByRole('button', { name: 'Hide Licenses' }));
    expect(lastSaved().sections!.find((s) => s.key === 'certificates')).toEqual({ key: 'certificates', title: 'Licenses', hidden: true });
    expect(rows()[0]).toBe('Licenses (hidden)');
    expect(screen.getByRole('button', { name: 'Show Licenses' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Licenses hidden from the PDF');

    await user.click(screen.getByRole('button', { name: 'Show Licenses' }));
    expect(lastSaved().sections!.find((s) => s.key === 'certificates')).toEqual({ key: 'certificates', title: 'Licenses' });
  });

  it('saves the page size on its own', async () => {
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={{ sections: [{ key: 'skills' }] }} />);
    await user.selectOptions(screen.getByLabelText('Page size'), 'A4');
    expect(lastSaved()).toEqual({ pageSize: 'a4' });
  });

  it('resets the order, headings and hidden sections to the default', async () => {
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={{ sections: [{ key: 'skills', title: 'Tools', hidden: true }, { key: 'education' }], pageSize: 'a4' }} />);
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(lastSaved()).toEqual({ sections: ['summary', 'work', 'education', 'skills', 'projects', 'certificates'].map((key) => ({ key })) });
    expect(rows()).toEqual(['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications']);
    expect(screen.getByLabelText('Page size')).toHaveValue('a4');
  });

  it('puts a change back when its save fails, and says so', async () => {
    saveResumeLayout.mockRejectedValueOnce(new Error("The API couldn't be reached."));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={undefined} onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Move Skills up' }));
    await waitFor(() => expect(toastFn.error).toHaveBeenCalledWith("The API couldn't be reached."));
    expect(rows()).toEqual(['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications']);
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Move Skills up' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(rows()[2]).toBe('Skills');
  });

  // Fixes from review.
  it('after a failed save, shows what was saved even when another kind of change followed it', async () => {
    // The move's save fails only once the page size has changed too.
    let fail!: () => void;
    saveResumeLayout.mockImplementationOnce(
      () => new Promise<ResumeLayout>((_resolve, reject) => (fail = () => reject(new Error("The API couldn't be reached.")))),
    );
    saveResumeLayout.mockImplementationOnce(async () => ({ pageSize: 'a4' as const }));
    const user = userEvent.setup();
    render(<ResumeLayoutEditor initial={undefined} />);

    await user.click(screen.getByRole('button', { name: 'Move Skills up' }));
    await user.selectOptions(screen.getByLabelText('Page size'), 'A4');
    fail();
    await waitFor(() => expect(saveResumeLayout).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rows()).toEqual(['Summary', 'Experience', 'Education', 'Skills', 'Projects', 'Certifications']));
    expect(screen.getByLabelText('Page size')).toHaveValue('a4');
    expect(toastFn.error).toHaveBeenCalledOnce();
  });

  it("names a hidden section's field plainly, and says it is hidden", () => {
    render(<ResumeLayoutEditor initial={{ sections: [{ key: 'skills', hidden: true }] }} />);
    expect(screen.getByLabelText('Skills heading')).toHaveAccessibleDescription('Hidden');
  });

  it('says the sections are busy while a résumé save is on its way', () => {
    render(<ResumeLayoutEditor initial={undefined} busy />);
    expect(screen.getByRole('button', { name: 'Move Education up' })).toBeDisabled();
    expect(screen.queryByText(/save your résumé first/i)).not.toBeInTheDocument();
  });

  it("can't be changed before there is a résumé", () => {
    render(<ResumeLayoutEditor initial={undefined} disabled />);
    expect(screen.getByRole('button', { name: 'Move Education up' })).toBeDisabled();
    expect(screen.getByLabelText('Skills heading')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
    expect(screen.getByText(/save your résumé first/i)).toBeInTheDocument();
  });
});
