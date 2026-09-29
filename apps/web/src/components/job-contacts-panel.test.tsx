import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobContactsPanel } from './job-contacts-panel';
import * as api from '@/lib/api';
import type { JobContactRecord } from '@/types/job';

vi.mock('@/lib/api', () => ({
  createJobContact: vi.fn(),
  deleteContact: vi.fn(),
  draftContactOutreach: vi.fn(),
  updateContactStatus: vi.fn(),
}));

function contact(overrides: Partial<JobContactRecord> = {}): JobContactRecord {
  return {
    id: 'contact-1',
    userId: 'user-1',
    jobId: 'job-1',
    name: 'Jamie Lee',
    roleTitle: 'Recruiter',
    evidence: [],
    status: 'found',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('JobContactsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an honest empty state, with no scouting and no "verified" claims', () => {
    render(<JobContactsPanel jobId="job-1" company="Acme" />);
    expect(screen.getByText('No contacts for this job. Add someone you know or found yourself.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/scout/i);
    expect(document.body.textContent).not.toMatch(/verified/i);
    expect(document.body.textContent).not.toMatch(/fail-closed/i);
  });

  it('adds a contact with only a name and a role', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createJobContact).mockResolvedValueOnce(contact());
    render(<JobContactsPanel jobId="job-1" company="Acme" />);

    await user.click(screen.getAllByRole('button', { name: 'Add contact' })[0]!);
    await user.type(screen.getByLabelText('Name'), '  Jamie Lee ');
    await user.type(screen.getByLabelText('Role'), 'Recruiter');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => {
      expect(api.createJobContact).toHaveBeenCalledWith('job-1', { name: 'Jamie Lee', roleTitle: 'Recruiter' });
    });
    expect(await screen.findByText('Jamie Lee')).toBeInTheDocument();
    expect(screen.getByText('1 contact')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('sends the optional link and note when given', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createJobContact).mockResolvedValueOnce(
      contact({ linkedinUrl: 'https://www.linkedin.com/in/jamie', notes: 'Met at a meetup' }),
    );
    render(<JobContactsPanel jobId="job-1" company="Acme" />);

    await user.click(screen.getAllByRole('button', { name: 'Add contact' })[0]!);
    await user.type(screen.getByLabelText('Name'), 'Jamie Lee');
    await user.type(screen.getByLabelText('Role'), 'Recruiter');
    await user.type(screen.getByLabelText('LinkedIn or other link (optional)'), 'https://www.linkedin.com/in/jamie');
    await user.type(screen.getByLabelText('Note (optional)'), 'Met at a meetup');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => {
      expect(api.createJobContact).toHaveBeenCalledWith('job-1', {
        name: 'Jamie Lee',
        roleTitle: 'Recruiter',
        linkedinUrl: 'https://www.linkedin.com/in/jamie',
        notes: 'Met at a meetup',
      });
    });
    expect(await screen.findByText('Met at a meetup')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://www.linkedin.com/in/jamie');
  });

  it('keeps a non-LinkedIn link as a general link, not as "LinkedIn"', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createJobContact).mockResolvedValueOnce(
      contact({ evidence: [{ url: 'https://github.com/jamie' }] }),
    );
    render(<JobContactsPanel jobId="job-1" company="Acme" />);

    await user.click(screen.getAllByRole('button', { name: 'Add contact' })[0]!);
    await user.type(screen.getByLabelText('Name'), 'Jamie Lee');
    await user.type(screen.getByLabelText('Role'), 'Recruiter');
    await user.type(screen.getByLabelText('LinkedIn or other link (optional)'), 'https://github.com/jamie');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));

    await waitFor(() => {
      expect(api.createJobContact).toHaveBeenCalledWith('job-1', {
        name: 'Jamie Lee',
        roleTitle: 'Recruiter',
        evidence: ['https://github.com/jamie'],
      });
    });
    expect(await screen.findByRole('link', { name: /github\.com\/jamie/ })).toHaveAttribute('href', 'https://github.com/jamie');
    expect(screen.queryByRole('link', { name: /LinkedIn/ })).not.toBeInTheDocument();
  });

  it('does not save a contact without a role', async () => {
    const user = userEvent.setup();
    render(<JobContactsPanel jobId="job-1" company="Acme" />);

    await user.click(screen.getAllByRole('button', { name: 'Add contact' })[0]!);
    await user.type(screen.getByLabelText('Name'), 'Jamie Lee');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));

    expect(api.createJobContact).not.toHaveBeenCalled();
  });

  it('labels a person\'s links plainly and deletes a contact', async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteContact).mockResolvedValueOnce(undefined);
    render(
      <JobContactsPanel
        jobId="job-1"
        company="Acme"
        initialContacts={[
          contact({
            linkedinUrl: 'https://www.linkedin.com/in/jamie',
            evidence: [{ url: 'https://acme.com/team', title: 'Team page' }],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Links')).toBeInTheDocument();
    expect(screen.queryByText('Company Profile')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/verified/i);

    await user.click(screen.getByRole('button', { name: 'Delete Jamie Lee' }));
    await waitFor(() => expect(api.deleteContact).toHaveBeenCalledWith('contact-1'));
    expect(await screen.findByText('No contacts for this job. Add someone you know or found yourself.')).toBeInTheDocument();
  });
});
