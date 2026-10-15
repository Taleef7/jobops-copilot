import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { JobAnalysis } from '@/types/job';
import { JobAnalysisCard } from './job-analysis-card';

function analysis(overrides: Partial<JobAnalysis> = {}): JobAnalysis {
  return {
    requiredSkills: ['Go', 'Kafka'],
    preferredSkills: [],
    matchedSkills: ['Go'],
    missingSkills: ['Kafka'],
    matchedSkillDetails: [{ skill: 'Go', evidence: 'Built the billing API in Go.' }],
    missingSkillDetails: [{ skill: 'Kafka', postingQuote: 'Experience running Kafka in production' }],
    atsKeywords: ['Go', 'Kafka'],
    fitSummary: 'You build Go services.',
    recommendedResumeAngle: 'Lead with the Go services.',
    applyRecommendation: 'Review manually before deciding whether to apply.',
    confidenceScore: 70,
    modelUsed: 'openai:gpt-6-luna',
    subSignals: { skillsMatch: 80, titleSeniority: 70, salaryFit: null, sponsorshipLikelihood: null },
    ...overrides,
  };
}

// #354: confidence is 0–100, shown as a percentage, and absent when there is none.
it('shows the confidence as a percentage, reading a 0–1 value as one', () => {
  const { unmount } = render(<JobAnalysisCard analysis={analysis({ confidenceScore: 0.65 })} />);
  expect(screen.getByText('Confidence 65%')).toBeInTheDocument();
  unmount();

  render(<JobAnalysisCard analysis={analysis({ confidenceScore: 65 })} />);
  expect(screen.getByText('Confidence 65%')).toBeInTheDocument();
});

it('keeps a confidence of 1 as 1%', () => {
  render(<JobAnalysisCard analysis={analysis({ confidenceScore: 1 })} />);
  expect(screen.getByText('Confidence 1%')).toBeInTheDocument();
});

// #354: web and API deploy separately, so this web may get an API's answer from before #354.
it('shows the skill labels from an API that sends no details', () => {
  render(
    <JobAnalysisCard
      analysis={analysis({
        matchedSkillDetails: undefined,
        missingSkillDetails: undefined,
        subSignals: undefined,
        atsKeywords: [],
      })}
    />,
  );

  expect(screen.getByText('Go')).toBeInTheDocument();
  expect(screen.getByText('Kafka')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();
});

it('shows no confidence badge when there is no confidence', () => {
  render(<JobAnalysisCard analysis={analysis({ confidenceScore: null })} />);
  expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
});

// #354: an unknown signal says "unknown", with no "%" and no "—%".
it('shows an unknown signal as "unknown", never a number or "—%"', () => {
  const { container } = render(
    <JobAnalysisCard
      analysis={analysis({
        subSignals: { skillsMatch: 80, titleSeniority: null, salaryFit: null, sponsorshipLikelihood: null },
      })}
    />,
  );

  expect(screen.getByText('80%')).toBeInTheDocument();
  expect(screen.getAllByText('unknown')).toHaveLength(3);
  expect(container).not.toHaveTextContent('—%');
  expect(container).not.toHaveTextContent('unknown%');
});

it('shows Salary fit and Sponsorship as unknown for a job without a salary or visa preference', () => {
  render(<JobAnalysisCard analysis={analysis()} />);

  for (const label of ['Salary Fit', 'Sponsorship']) {
    expect(screen.getByText(label).nextElementSibling).toHaveTextContent(/^unknown$/);
  }
});

// #354: skills are short labels; the evidence shows on hover and focus.
it('shows each skill as a short label with its evidence on focus and hover', async () => {
  const user = userEvent.setup();
  render(<JobAnalysisCard analysis={analysis()} />);

  const matched = screen.getByRole('button', { name: 'Go' });
  const missing = screen.getByRole('button', { name: 'Kafka' });
  expect(screen.queryByText('Built the billing API in Go.')).not.toBeInTheDocument();

  for (let step = 0; step < 10 && document.activeElement !== matched; step += 1) await user.tab();
  expect(matched).toHaveFocus();
  expect(await screen.findByText('Built the billing API in Go.')).toBeInTheDocument();

  await user.hover(missing);
  expect(await screen.findByText('Experience running Kafka in production')).toBeInTheDocument();
});
