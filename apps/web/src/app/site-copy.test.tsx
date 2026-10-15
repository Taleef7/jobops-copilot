import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';

// The root layout loads fonts through Next's compiler; outside Next they only need a class name.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-sans' }),
  Geist_Mono: () => ({ variable: 'font-mono' }),
}));
// Capture the social card's markup instead of rasterising it.
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(
      public element: ReactElement,
      public options: unknown,
    ) {}
  },
}));

import { metadata } from './layout';
import manifest from './manifest';
import OpengraphImage, { alt } from './opengraph-image';
import * as twitterImage from './twitter-image';

const SENTENCE =
  'Tell me in 10 seconds if a job is worth applying to, give me an honest tailored résumé, and never let me miss a follow-up.';
const CLAIMS =
  /\bRAG\b|telemetry|verified|guaranteed|100%|\bzero\b|AI-powered|LangChain|pgvector|\bagents?\b|operations|time-series|portfolio|platform/i;

// #356: the spec is the source of truth for the sentence; the site quotes it, not a paraphrase.
it('quotes the product sentence from docs/SPEC.md', () => {
  const spec = readFileSync(path.resolve(__dirname, '../../../../docs/SPEC.md'), 'utf8');
  const section = /## The product in one sentence\s+([\s\S]*?)\s+##/.exec(spec)?.[1] ?? '';

  expect(section.replace(/\s+/g, ' ')).toBe(SENTENCE);
});

it('gives the site a plain title and the product sentence as its description', () => {
  expect(metadata.title).toEqual({ default: 'JobOps Copilot', template: '%s · JobOps Copilot' });
  expect(metadata.description).toBe(SENTENCE);
  expect(metadata.openGraph).toMatchObject({ title: 'JobOps Copilot', description: SENTENCE });
  expect(metadata.twitter).toMatchObject({ title: 'JobOps Copilot', description: SENTENCE });
  expect(JSON.stringify(metadata)).not.toMatch(CLAIMS);
});

it('describes the installed app with the product sentence', () => {
  const app = manifest();

  expect(app.description).toBe(SENTENCE);
  expect(JSON.stringify(app)).not.toMatch(CLAIMS);
});

it('puts the name and the product sentence on the social card, on a plain background', () => {
  const card = OpengraphImage() as unknown as { element: ReactElement<{ style: { background: string } }> };
  const { container } = render(card.element);

  expect(container).toHaveTextContent('JobOps Copilot');
  expect(container).toHaveTextContent(SENTENCE);
  expect(container.textContent).not.toMatch(CLAIMS);
  expect(card.element.props.style.background).not.toMatch(/gradient/);
  expect(alt).not.toMatch(CLAIMS);
  expect(twitterImage.alt).toBe(alt);
});
