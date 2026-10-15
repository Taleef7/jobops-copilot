import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { StructuredResume } from '@/types';
import { renderResumePdf } from './ats-resume-pdf';

/**
 * Every field the résumé PDF reads (#415), as `work[].highlights[]` paths. The list is kept in
 * resume-printed-paths.json, which the web's editor test reads: whatever the PDF prints, the
 * editor in Settings can change.
 */

const PRINTED: string[] = JSON.parse(readFileSync(join(__dirname, 'resume-printed-paths.json'), 'utf8'));

/** The résumé behind a proxy that records each field the renderer reads by name. */
function recording<T extends object>(value: T): { resume: T; reads: Set<string> } {
  const reads = new Set<string>();
  const wrap = (node: unknown, path: string): unknown => {
    if (!node || typeof node !== 'object') return node;
    const isList = Array.isArray(node);
    return new Proxy(node, {
      get(target, prop, receiver) {
        const child: unknown = Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string' || (isList && !/^\d+$/.test(prop))) return child;
        const at = isList ? `${path}[]` : path ? `${path}.${prop}` : prop;
        reads.add(at);
        return wrap(child, at);
      },
      // The size checks walk every field there is: only fields read by name count.
      ownKeys: () => (isList ? ['length'] : []),
    });
  };
  return { resume: wrap(value, '') as T, reads };
}

/** A résumé with every field filled, so every branch of the renderer reads what it can. */
const FULL: StructuredResume = {
  basics: {
    name: 'Zoë Núñez',
    label: 'Backend Engineer',
    email: 'zoe@example.com',
    phone: '+1 555 0142',
    url: 'https://zoe.dev',
    summary: 'Backend engineer who builds payment APIs.',
    location: { address: '1 Main St', postalCode: '78701', city: 'Austin', region: 'TX', countryCode: 'US' },
    profiles: [{ network: 'LinkedIn', username: 'zoe', url: 'https://www.linkedin.com/in/zoe' }],
  },
  work: [
    {
      id: 'w1',
      company: 'Globex',
      position: 'Backend Engineer',
      location: 'Remote',
      startDate: '2022-01',
      endDate: '2024-06',
      current: false,
      summary: 'Led the payments platform team.',
      highlights: ['Built the billing API'],
    },
  ],
  education: [
    {
      id: 'e1',
      institution: 'University of Texas',
      area: 'Computer Science',
      studyType: 'BSc',
      startDate: '2015',
      endDate: '2019',
      gpa: '3.8',
      highlights: ['Dean’s list'],
    },
  ],
  skills: [{ category: 'Languages', skills: ['Go', 'Python'] }],
  projects: [
    {
      id: 'p1',
      name: 'Ledger',
      description: 'A double-entry ledger.',
      highlights: ['Handles 1M entries a day'],
      keywords: ['Go'],
      url: 'https://github.com/zoe/ledger',
    },
  ],
  certificates: [{ name: 'AWS Solutions Architect', issuer: 'Amazon', date: '2024-03', url: 'https://aws.example/cert' }],
  layout: {
    sections: [
      { key: 'summary', title: 'Profile', hidden: false },
      { key: 'work', title: 'Work' },
      { key: 'education', title: 'Schooling' },
      { key: 'skills', title: 'Toolbox' },
      { key: 'projects', title: 'Built' },
      { key: 'certificates', title: 'Certified' },
    ],
    pageSize: 'letter',
  },
};

test('the fields the résumé PDF reads are the ones listed for the editor', async () => {
  const { resume, reads } = recording(FULL);
  await renderResumePdf(resume);
  const paths = [...reads];
  // Leaves only: "work[]" is read on the way to "work[].company".
  const leaves = paths.filter((path) => !paths.some((other) => other.startsWith(`${path}.`) || other.startsWith(`${path}[`)));
  assert.deepEqual(leaves.sort(), [...PRINTED].sort());
});
