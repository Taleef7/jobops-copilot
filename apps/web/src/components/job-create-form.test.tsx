import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { extractJobFromUrl, parseJob, createJob, push, refresh } = vi.hoisted(() => ({
  extractJobFromUrl: vi.fn(),
  parseJob: vi.fn(),
  createJob: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/api', () => ({
  extractJobFromUrl,
  parseJob,
  createJob,
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public status: number,
      public fields?: Record<string, string>,
      public existingJobId?: string,
    ) {
      super(message);
    }
  },
}));

import { ApiRequestError } from '@/lib/api';
import { JobCreateForm } from './job-create-form';

afterEach(() => {
  vi.clearAllMocks();
});

const LINK = 'https://boards.greenhouse.io/acme/jobs/4012345';
const POSTING = `Backend Engineer
Acme
London, United Kingdom

We build payment APIs in Go and Postgres. The salary range is £80,000 - £95,000.`;

/** A parse-job answer for POSTING, as the API returns it (#355). */
function parsed(overrides: Record<string, unknown> = {}) {
  return {
    job_id: null,
    company: 'Acme',
    title: 'Backend Engineer',
    location: 'London, United Kingdom',
    workplace_type: 'hybrid',
    salary: { min: 80000, max: 95000, currency: 'GBP' },
    required_skills: ['Go'],
    preferred_skills: [],
    responsibilities: [],
    seniority: 'mid',
    cloud_tools: [],
    automation_tools: [],
    summary: 'Build payment APIs.',
    ...overrides,
  };
}

async function paste(text: string) {
  const user = userEvent.setup();
  render(<JobCreateForm />);
  // Typing a long posting key by key is slow; the box takes a paste like any input.
  await user.click(screen.getByLabelText('Paste a job link or the full posting'));
  if (text) await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Get details' }));
  return user;
}

const review = () => screen.findByRole('heading', { name: 'Check the details' });

// #355: the form showed two entry paths as one long form. The first screen is one box.
it('starts with one paste box and one primary button', () => {
  const { container } = render(<JobCreateForm />);

  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByLabelText('Paste a job link or the full posting')).toBeInTheDocument();
  expect(screen.getByText('Works with Greenhouse, Lever, Ashby, Workday and most job pages.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Get details' })).toHaveAttribute('type', 'submit');
  expect(screen.getByRole('button', { name: 'Enter details yourself' })).toHaveAttribute('type', 'button');
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/AI\s+extracts|analy[sz]e|priority|CRM/i);
});

it('reads a pasted link with the URL extractor and fills the review, saving nothing', async () => {
  extractJobFromUrl.mockResolvedValue({
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'London, United Kingdom',
    descriptionText: 'We build payment APIs in Go.',
    workplaceType: 'remote',
    source: 'jsonld',
  });
  await paste(`  ${LINK}  `);

  await review();
  expect(extractJobFromUrl).toHaveBeenCalledWith(LINK);
  expect(parseJob).not.toHaveBeenCalled();
  expect(createJob).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^Title/)).toHaveValue('Backend Engineer');
  expect(screen.getByLabelText(/^Company/)).toHaveValue('Acme');
  expect(screen.getByLabelText(/^Location/)).toHaveValue('London, United Kingdom');
  expect(screen.getByLabelText('Posting URL')).toHaveValue(LINK);
  expect(screen.getByRole('radio', { name: 'Remote' })).toBeChecked();
  for (const field of [/^Title/, /^Company/, /^Location/]) {
    expect(screen.getByLabelText(field)).toHaveAccessibleDescription(/from posting/);
  }
});

it('reads pasted posting text with parse-job, without a job id, and fills the review', async () => {
  parseJob.mockResolvedValue(parsed());
  await paste(POSTING);

  await review();
  expect(parseJob).toHaveBeenCalledWith({ descriptionText: POSTING });
  expect(extractJobFromUrl).not.toHaveBeenCalled();
  expect(createJob).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^Title/)).toHaveValue('Backend Engineer');
  expect(screen.getByLabelText(/^Company/)).toHaveValue('Acme');
  expect(screen.getByLabelText(/^Location/)).toHaveValue('London, United Kingdom');
  expect(screen.getByRole('radio', { name: 'Hybrid' })).toBeChecked();
  const salary = screen.getByRole('group', { name: 'Salary' });
  expect(salary).toHaveTextContent('£80,000 – £95,000');
  expect(salary).toHaveTextContent('from posting');
  expect(screen.getByLabelText('Posting URL')).toHaveValue('');
});

it('says "Not stated" for what the posting does not state, and fills in no default', async () => {
  parseJob.mockResolvedValue(parsed({ location: null, workplace_type: null, salary: null }));
  await paste(POSTING);

  await review();
  expect(screen.getByLabelText(/^Location/)).toHaveValue('');
  expect(screen.getByLabelText(/^Location/)).toHaveAccessibleDescription(/Not stated/);
  expect(screen.getByRole('radio', { name: 'Not stated' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Remote' })).not.toBeChecked();
  expect(screen.getByRole('group', { name: 'Salary' })).toHaveTextContent('Not stated');
});

it('drops the "from posting" hint from a field the user changes', async () => {
  parseJob.mockResolvedValue(parsed());
  const user = await paste(POSTING);
  await review();

  const location = screen.getByLabelText(/^Location/);
  await user.clear(location);
  await user.type(location, 'Manchester');

  expect(location).not.toHaveAccessibleDescription(/from posting|Not stated/);
});

it('shows the description collapsed, with its length, and opens it to edit', async () => {
  parseJob.mockResolvedValue(parsed());
  const user = await paste(POSTING);
  await review();

  const toggle = screen.getByRole('button', { name: 'Edit description' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText(`${POSTING.length.toLocaleString('en-US')} characters`)).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(POSTING);
});

it('opens an empty review to enter the details by hand', async () => {
  const user = userEvent.setup();
  render(<JobCreateForm />);
  await user.click(screen.getByRole('button', { name: 'Enter details yourself' }));

  await review();
  expect(screen.getByLabelText(/^Title/)).toHaveValue('');
  expect(screen.getByLabelText(/^Company/)).toHaveValue('');
  expect(screen.getByLabelText(/^Location/)).toHaveValue('');
  expect(screen.getByRole('radio', { name: 'Not stated' })).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
  expect(document.body.textContent).not.toMatch(/from posting/);
  expect(extractJobFromUrl).not.toHaveBeenCalled();
  expect(parseJob).not.toHaveBeenCalled();
});

it('asks for something to read when Get details is pressed on an empty box', async () => {
  await paste('');

  expect(await screen.findByText('Paste a job link or the posting’s text first.')).toBeInTheDocument();
  expect(screen.getByLabelText('Paste a job link or the full posting')).toHaveFocus();
  expect(extractJobFromUrl).not.toHaveBeenCalled();
  expect(parseJob).not.toHaveBeenCalled();
});

// #355, following A2 (#349): a failure says why, under the paste box, and the user can try
// again or type the details in.
it('shows why reading the posting failed under the box, with Try again and Enter details yourself', async () => {
  parseJob.mockRejectedValueOnce(new ApiRequestError("The AI couldn't answer this time. Try again in a moment.", 503));
  parseJob.mockResolvedValueOnce(parsed());
  const user = await paste(POSTING);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("Couldn't get the details");
  expect(alert).toHaveTextContent("The AI couldn't answer this time. Try again in a moment.");
  expect(within(alert).getByRole('button', { name: 'Enter details yourself' })).toBeInTheDocument();
  expect(screen.getByLabelText('Paste a job link or the full posting')).toHaveValue(POSTING);

  await user.click(within(alert).getByRole('button', { name: 'Try again' }));
  await review();
  expect(parseJob).toHaveBeenCalledTimes(2);
});

it('offers to enter the details by hand when the link has nothing to read', async () => {
  extractJobFromUrl.mockResolvedValue({ source: 'none' });
  const user = await paste(LINK);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Couldn’t find a job on that page. Paste the posting’s text instead, or enter the details yourself.');
  await user.click(within(alert).getByRole('button', { name: 'Enter details yourself' }));

  await review();
  expect(screen.getByLabelText('Posting URL')).toHaveValue(LINK);
  expect(screen.getByLabelText(/^Title/)).toHaveValue('');
});

it('shows the API’s reason when a link can’t be fetched', async () => {
  extractJobFromUrl.mockRejectedValue(new ApiRequestError('Could not read that page.', 400));
  await paste(LINK);

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read that page.');
});

it('Save and run fit saves the reviewed job once and opens it to run the fit', async () => {
  parseJob.mockResolvedValue(parsed());
  createJob.mockResolvedValue({ id: 'job-9' });
  const user = await paste(POSTING);
  await review();

  await user.click(screen.getByRole('button', { name: 'Save and run fit' }));

  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/job-9?run=fit'));
  expect(createJob).toHaveBeenCalledTimes(1);
  expect(createJob).toHaveBeenCalledWith({
    company: 'Acme',
    title: 'Backend Engineer',
    location: 'London, United Kingdom',
    workplaceType: 'hybrid',
    jobUrl: undefined,
    source: 'manual',
    descriptionText: POSTING,
    salaryMin: 80000,
    salaryMax: 95000,
    salaryCurrency: 'GBP',
  });
});

it('Save only saves the job with nothing it doesn’t state, and opens it', async () => {
  parseJob.mockResolvedValue(parsed({ location: null, workplace_type: null, salary: null }));
  createJob.mockResolvedValue({ id: 'job-9' });
  const user = await paste(POSTING);
  await review();

  await user.click(screen.getByRole('button', { name: 'Save only' }));

  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/job-9'));
  expect(createJob).toHaveBeenCalledTimes(1);
  const payload = createJob.mock.calls[0]![0] as Record<string, unknown>;
  expect(payload).toMatchObject({ company: 'Acme', title: 'Backend Engineer', descriptionText: POSTING });
  for (const key of ['location', 'workplaceType', 'priority', 'employmentType', 'salaryMin', 'salaryMax']) {
    expect(payload[key]).toBeUndefined();
  }
});

it('needs a title, a company and a description before saving', async () => {
  const user = userEvent.setup();
  render(<JobCreateForm />);
  await user.click(screen.getByRole('button', { name: 'Enter details yourself' }));
  await review();

  await user.click(screen.getByRole('button', { name: 'Save only' }));

  expect(await screen.findByText('Add the job title.')).toBeInTheDocument();
  expect(screen.getByText('Add the company.')).toBeInTheDocument();
  expect(screen.getByText('Add the job description.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveFocus());
  expect(createJob).not.toHaveBeenCalled();
});

it('links to the job you already added when the URL is tracked (#346)', async () => {
  extractJobFromUrl.mockResolvedValue({ title: 'Engineer', company: 'Stripe', descriptionText: 'Build payments.', source: 'jsonld' });
  createJob.mockRejectedValue(
    new ApiRequestError('You already added this job.', 409, { jobUrl: 'You already added this job.' }, 'job-123'),
  );
  const user = await paste(LINK);
  await review();

  await user.click(screen.getByRole('button', { name: 'Save and run fit' }));

  expect(await screen.findByText('You already added this job.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open the job/i })).toHaveAttribute('href', '/jobs/job-123');
  expect(push).not.toHaveBeenCalled();
});

it('goes back to the paste box with Start over', async () => {
  parseJob.mockResolvedValue(parsed());
  const user = await paste(POSTING);
  await review();

  await user.click(screen.getByRole('button', { name: 'Start over' }));

  await waitFor(() => expect(screen.getByLabelText('Paste a job link or the full posting')).toHaveFocus());
  expect(screen.queryByRole('heading', { name: 'Check the details' })).not.toBeInTheDocument();
});

it('works by keyboard alone, from the paste box to saving', async () => {
  extractJobFromUrl.mockResolvedValue({ title: 'Backend Engineer', company: 'Acme', descriptionText: 'Build APIs.', source: 'jsonld' });
  createJob.mockResolvedValue({ id: 'job-9' });
  const user = userEvent.setup();
  render(<JobCreateForm />);

  await user.tab();
  expect(screen.getByLabelText('Paste a job link or the full posting')).toHaveFocus();
  await user.keyboard(LINK);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Get details' })).toHaveFocus();
  await user.keyboard('{Enter}');

  // The review takes focus, so a screen reader hears the new step.
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Check the details' })).toHaveFocus());
  await user.tab();
  expect(screen.getByLabelText(/^Title/)).toHaveFocus();
  // Enter in a field saves with the primary button, as a click on it would.
  await user.keyboard('{Enter}');

  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/job-9?run=fit'));
  expect(createJob).toHaveBeenCalledTimes(1);
});
