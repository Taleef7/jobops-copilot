import assert from 'node:assert/strict';
import test from 'node:test';
import { TAILOR_BASE, TAILOR_JOB } from '@/test-support/tailor-fixtures';
import { groundLetter, splitSentences, type LetterContext } from './ground';

/**
 * The cover letter's check (#416, SPEC rule 6): every claim about the candidate comes from the
 * base résumé or a keyword they confirmed, and the company and role from the posting. A
 * sentence that adds a number, a tool, an employer, a degree or a title is dropped; the rest of
 * the letter stays. It reuses the tailoring check's evidence, numbers, terms and names.
 */

const JOB = {
  title: 'Backend Engineer',
  company: TAILOR_JOB.company,
  descriptionText:
    'Acme Pay is hiring a backend engineer to build payment APIs in Go. Kafka is a plus. You will work on PayLink, our merchant platform.',
};

const ctx = (overrides: Partial<LetterContext> = {}): LetterContext => ({
  base: TAILOR_BASE,
  job: JOB,
  jobTerms: TAILOR_JOB.jobTerms,
  confirmedKeywords: [],
  ...overrides,
});

/** One paragraph of one sentence, checked. */
const check = (sentence: string, overrides: Partial<LetterContext> = {}) => groundLetter([sentence], ctx(overrides));

/**
 * What the check does with a sentence (#416, the owner's rule): drops what it can prove, flags
 * for the user what it can only guess, and keeps the rest unmarked.
 */
const classOf = (sentence: string, overrides: Partial<LetterContext> = {}): 'drop' | 'flag' | 'kept' => {
  const result = check(sentence, overrides);
  if (result.paragraphs.length === 0) return 'drop';
  return result.checks.some((found) => found.severity === 'flag') ? 'flag' : 'kept';
};

test('sentences drawn from the résumé are kept as written', () => {
  const sentence =
    'At Globex I built the billing API in Go serving 2,000 merchants, and I reduced p95 latency by 40% with Redis caching.';
  const result = check(sentence);
  assert.deepEqual(result.paragraphs, [sentence]);
  assert.deepEqual(result.checks, []);
});

test('an invented metric drops its sentence, and the rest of the paragraph stays', () => {
  const kept = 'I build payment APIs in Go.';
  const invented = 'At Globex I cut p95 latency by 60% with Redis caching.';
  const result = groundLetter([`${kept} ${invented}`], ctx());
  assert.deepEqual(result.paragraphs, [kept]);
  assert.equal(result.checks.length, 1);
  const [dropped] = result.checks;
  assert.equal(dropped!.dropped, true);
  assert.equal(dropped!.text, invented);
  assert.equal(dropped!.issues[0]!.code, 'NEW_NUMBER');
  assert.match(dropped!.dropReason!, /60%/);
});

test('an invented skill drops its sentence, even one the posting asks for', () => {
  const result = check('I have run Kafka clusters in production for years.');
  assert.deepEqual(result.paragraphs, []);
  assert.equal(result.checks[0]!.dropped, true);
  assert.ok(result.checks[0]!.issues.some((issue) => issue.code === 'NEW_SKILL' && issue.term === 'Kafka'));
});

test('a keyword the user confirmed is theirs: kept, and marked as theirs', () => {
  const sentence = 'I have worked with Kafka alongside Go.';
  const result = check(sentence, { confirmedKeywords: ['Kafka'] });
  assert.deepEqual(result.paragraphs, [sentence]);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0]!.dropped, false);
  assert.deepEqual(result.checks[0]!.confirmedTerms, ['Kafka']);
  assert.equal(result.checks[0]!.paragraph, 0);
});

test('the company and the role, as the posting names them, are not claims', () => {
  for (const sentence of [
    'I am applying for the Backend Engineer role at Acme Pay.',
    "I would like to bring my Go experience to Acme Pay's team.",
    'Acme Pay builds payment APIs, which is the work I do at Globex.',
  ]) {
    const result = check(sentence);
    assert.deepEqual(result.paragraphs, [sentence], sentence);
    assert.deepEqual(result.checks, [], sentence);
  }
  // A company whose name is also a tool ("Stripe"), and a title or company with a number.
  const stripe = 'I would like to join Stripe and build payment APIs in Go.';
  assert.deepEqual(check(stripe, { job: { ...JOB, company: 'Stripe' } }).paragraphs, [stripe]);
  const numbered = 'I am applying for the Software Engineer 2 role at 3M.';
  assert.deepEqual(check(numbered, { job: { ...JOB, title: 'Software Engineer 2', company: '3M' } }).paragraphs, [numbered]);
});

test('claiming to have worked at the company is flagged', () => {
  for (const sentence of ['I worked at Acme Pay on payment APIs in Go.', 'During my time at Acme Pay I built payment APIs.']) {
    assert.equal(classOf(sentence), 'flag', sentence);
    assert.equal(check(sentence).checks[0]!.issues[0]!.code, 'NEW_ENTITY', sentence);
  }
});

test('an invented degree is dropped; an invented employer or title is flagged', () => {
  const cases: Array<[string, string, 'drop' | 'flag']> = [
    ['Before Globex, I built payment APIs at Hooli.', 'NEW_TERM', 'flag'],
    ["I hold a master's degree in Computer Science.", 'NEW_ENTITY', 'drop'],
    ['As a senior backend engineer, I set the direction for payment APIs.', 'NEW_SENIORITY', 'flag'],
  ];
  for (const [sentence, code, finding] of cases) {
    const result = check(sentence);
    assert.equal(classOf(sentence), finding, sentence);
    assert.ok(
      result.checks[0]!.issues.some((issue) => issue.code === code),
      `${sentence}: ${JSON.stringify(result.checks)}`,
    );
  }
});

test("years of experience must be the résumé's own words; its dates are facts", () => {
  const years = check('I have 5 years of experience building payment APIs.');
  assert.deepEqual(years.paragraphs, []);
  assert.equal(years.checks[0]!.issues[0]!.code, 'NEW_NUMBER');
  const since = 'I have built payment APIs at Globex since 2022.';
  assert.deepEqual(check(since).paragraphs, [since]);
  const invented = check('I have built payment APIs at Globex since 2017.');
  assert.deepEqual(invented.paragraphs, []);
  assert.equal(invented.checks[0]!.issues[0]!.code, 'NEW_DATE');
});

test('a name from the posting is kept but marked for a look; a placeholder is dropped', () => {
  const paylink = 'I would enjoy working on PayLink with your team.';
  const named = check(paylink);
  assert.deepEqual(named.paragraphs, [paylink]);
  assert.equal(named.checks[0]!.dropped, false);
  assert.equal(named.checks[0]!.issues[0]!.code, 'NEW_NAME');

  const placeholder = check('I can start on [Start Date] and look forward to hearing from you.');
  assert.deepEqual(placeholder.paragraphs, []);
  assert.equal(placeholder.checks[0]!.issues[0]!.code, 'PLACEHOLDER');
});

test('a leadership verb the résumé never uses is kept and marked for a look', () => {
  const sentence = 'At Globex I managed the billing API in Go.';
  const result = check(sentence);
  assert.deepEqual(result.paragraphs, [sentence]);
  assert.equal(result.checks[0]!.issues[0]!.code, 'LEADERSHIP_CLAIM');
  // "Mentored" is in the résumé: no mark.
  assert.deepEqual(check('At Globex I mentored two interns.').checks, []);
});

test('a compound ending in a leadership verb describes the work, not the person; "co-led" still claims it', () => {
  for (const sentence of [
    'At Globex I built the billing API in Go with an evidence-led, self-directed approach.',
    'At Globex I built the billing API in Go on self-managed servers.',
    'At Globex I built the merchant-owned billing API in Go.',
  ]) {
    assert.deepEqual(check(sentence).checks, [], sentence);
  }
  const coLed = check('At Globex I co-led the billing API in Go.');
  assert.equal(coLed.checks[0]!.issues[0]!.code, 'LEADERSHIP_CLAIM');
  assert.equal(coLed.checks[0]!.issues[0]!.term, 'led');
});

test('a dash between words is a break, not a compound: the leadership claim after it is marked', () => {
  for (const [sentence, term] of [
    ['At Globex I built the billing API in Go—leading the billing team.', 'leading'],
    ['At Globex I built the billing API in Go–leading the billing team.', 'leading'],
    ['At Globex I built the billing API in Go--managing the rollout.', 'managing'],
  ] as const) {
    const issues = check(sentence).checks.flatMap((found) => found.issues);
    assert.ok(issues.some((found) => found.code === 'LEADERSHIP_CLAIM' && found.term === term), `${sentence}: ${JSON.stringify(issues)}`);
  }
  // And in the résumé, "Go—leading the payments team" is evidence of leading.
  const base = structuredClone(TAILOR_BASE);
  base.work[0]!.highlights.push('Built the payouts API in Go—leading the payments team');
  assert.deepEqual(check('At Globex I led the payments team.', { base }).checks, []);
});

test('the company by its short name, where the posting uses it, is not a name to note', () => {
  const job = {
    title: 'Backend Engineer',
    company: 'Initrode Technologies',
    descriptionText: 'At Initrode, we build payment APIs in Go. Initrode Technologies is hiring a backend engineer.',
  };
  assert.deepEqual(check('I would enjoy building payment APIs in Go at Initrode.', { job }).checks, []);
  for (const sentence of [
    'I would welcome the chance to bring that to Initrode’s payment APIs.',
    "I would welcome the chance to bring that to Initrode's payment APIs.",
    // Hopes that only look like ties.
    'At Initrode, I would bring my experience building payment APIs in Go.',
    "I'd love to build payment APIs in Go that an Initrode customer would enjoy.",
    "I'd love to support the teams who have used Initrode for years.",
    'I would welcome the chance to be employed by Initrode.',
    'If I worked at Initrode, I would build payment APIs in Go.',
    'If I had previously worked at Initrode, I would know its payment APIs.',
    'Once employed by Initrode, I would build payment APIs in Go.',
    'I hope to become employed by Initrode.',
  ]) {
    assert.deepEqual(check(sentence, { job }).checks, [], sentence);
  }
  // A tie to the company by its short name is still marked, in a hope too.
  for (const sentence of [
    'I worked at Initrode on payment APIs in Go.',
    'I built Initrode’s payment APIs in Go.',
    "I worked at Initrode, and I'd love to return.",
    'Having worked for Initrode before, I would enjoy building payment APIs in Go again.',
    'I would bring what I learned when I worked at Initrode to payment APIs in Go.',
    'I would note that I worked at Initrode on payment APIs in Go.',
    'I would bring lessons from my previous role at Initrode to payment APIs in Go.',
    'Being employed by Initrode taught me what I would want next.',
  ]) {
    const tie = check(sentence, { job });
    assert.equal(tie.checks[0]?.severity, 'flag', sentence);
    assert.ok(tie.checks[0]!.issues.some((found) => /^Initrode/.test(found.term ?? '')), sentence);
  }
});

test('the short name changes nothing but that note', () => {
  // Named like a tool: an invented tool is still dropped.
  const tableau = {
    title: 'Backend Engineer',
    company: 'Tableau Software',
    descriptionText: 'At Tableau, we build analytics. Tableau Software is hiring a backend engineer.',
  };
  const jobTerms = [...TAILOR_JOB.jobTerms, 'Tableau'];
  for (const sentence of ['At Globex I published billing dashboards to Tableau.', 'At Globex I moved reports from spreadsheets into Tableau.']) {
    assert.equal(classOf(sentence, { job: tableau, jobTerms }), 'drop', sentence);
  }
  // An ordinary word: an honest sentence using it is not flagged.
  const progress = {
    title: 'Backend Engineer',
    company: 'Progress Software',
    descriptionText: 'At Progress, we build payment APIs in Go.',
  };
  assert.equal(classOf('At Globex I tracked progress on the billing API in Go.', { job: progress }), 'kept');
  // Only the short name written as a name is a tie: "worked with progress" is the word.
  assert.equal(classOf('At Globex I worked with progress reports on the billing API in Go, and I would enjoy that again.', { job: progress }), 'kept');
  assert.equal(check('I worked with Progress on payment APIs in Go and would love to again.', { job: progress }).checks[0]?.severity, 'flag');
});

test('a short name only at the start of a line or after a colon is not one the posting uses', () => {
  for (const descriptionText of [
    'General Systems builds payment APIs in Go. General knowledge of Kafka helps.',
    'General Systems builds payment APIs in Go.\nNice to have: General knowledge of Kafka.',
    'General Systems builds payment APIs in Go.\nRequirements\nGeneral knowledge of Kafka.',
  ]) {
    const job = { title: 'Backend Engineer', company: 'General Systems', descriptionText };
    assert.deepEqual(check('I have general experience building payment APIs in Go.', { job }).checks, [], descriptionText);
    assert.equal(classOf('At Globex I worked with general contractors on the billing API in Go.', { job }), 'kept', descriptionText);
    // "General" stays a name from the posting to note.
    assert.equal(check('I would enjoy working at General.', { job }).checks[0]?.issues[0]?.code, 'NEW_NAME', descriptionText);
  }
});

test('a paragraph whose every sentence is dropped goes, and later marks point at the kept paragraphs', () => {
  const result = groundLetter(['I have run Kafka clusters for years.', 'I would enjoy working on PayLink with your team.'], ctx());
  assert.deepEqual(result.paragraphs, ['I would enjoy working on PayLink with your team.']);
  const dropped = result.checks.find((c) => c.dropped)!;
  assert.equal(dropped.paragraph, null);
  const marked = result.checks.find((c) => !c.dropped)!;
  assert.equal(marked.paragraph, 0);
});

test("the model's own greeting and sign-off are left out: the letter adds its own", () => {
  const body = 'I build payment APIs in Go.';
  const result = groundLetter(['Dear Hiring Manager,', body, 'Sincerely,', 'Jordan Lee'], ctx());
  assert.deepEqual(result.paragraphs, [body]);
  assert.deepEqual(groundLetter([`Dear Acme Pay team,\n\n${body}\n\nBest regards,\nJordan Lee`], ctx()).paragraphs, [body]);
});

test('sentences split at their ends, not at abbreviations, versions or decimals', () => {
  assert.deepEqual(splitSentences('I use Node.js and Go, e.g. for APIs. I moved 3.5 TB of data to the U.S. region. Done!'), [
    'I use Node.js and Go, e.g. for APIs.',
    'I moved 3.5 TB of data to the U.S. region.',
    'Done!',
  ]);
  assert.deepEqual(splitSentences('One line\nwith a break.  Two?'), ['One line with a break.', 'Two?']);
});

test("other people's titles and the candidate's own words are not claims", () => {
  for (const sentence of [
    'I would welcome the chance to talk with your engineering director.',
    "I build payment APIs in Go, and I'm keen to keep doing it.",
    'I have worked with Kafka 3 alongside Go.',
  ]) {
    const result = check(sentence, { confirmedKeywords: ['Kafka 3'] });
    assert.deepEqual(result.paragraphs, [sentence], JSON.stringify(result.checks));
    assert.ok(result.checks.every((c) => c.issues.length === 0), JSON.stringify(result.checks));
  }
});

// Review round (#416): what a real model writes, and what it must not get away with.

test("the posting's title is the role being applied for, never a job the candidate held", () => {
  const senior = { ...JOB, title: 'Senior Backend Engineer' };
  for (const sentence of [
    'As the Senior Backend Engineer at Globex, I built the billing API in Go.',
    'I have been the Senior Backend Engineer on the billing API at Globex.',
  ]) {
    const result = check(sentence, { job: senior });
    assert.equal(classOf(sentence, { job: senior }), 'flag', sentence);
    assert.ok(result.checks[0]!.issues.some((issue) => issue.code === 'NEW_SENIORITY'), JSON.stringify(result.checks));
  }
  assert.equal(classOf('I was the Tech Lead for billing at Globex.', { job: { ...JOB, title: 'Tech Lead' } }), 'flag');
});

test('the role in application phrasing is kept, as the posting writes it or shortened', () => {
  const cases: Array<[string, string]> = [
    ['Senior Backend Engineer (Payments)', 'I am applying for the Senior Backend Engineer role at Acme Pay.'],
    ['Senior Backend Engineer (Payments)', 'I am writing to apply for the position of Senior Backend Engineer (Payments).'],
    ['Senior Backend Engineer', 'I would like to join Acme Pay as a Senior Backend Engineer.'],
    ['Senior Backend Engineer', 'I am applying for your Senior Backend Engineer opening.'],
    ['Sr. Software Engineer', 'I am applying for the Sr. Software Engineer role.'],
    ['Sr. Software Engineer', 'I am applying for the Senior Software Engineer role.'],
  ];
  for (const [title, sentence] of cases) {
    const result = check(sentence, { job: { ...JOB, title } });
    assert.deepEqual(result.paragraphs, [sentence], `${title}: ${JSON.stringify(result.checks)}`);
    assert.deepEqual(result.checks, [], `${title}: ${sentence}`);
  }
});

test('a company named like a tool: naming the company is fine, claiming the tool is not', () => {
  const mongo = { job: { ...JOB, company: 'MongoDB' } };
  assert.deepEqual(check('I have run MongoDB clusters in production.', mongo).paragraphs, []);
  for (const sentence of ['I would like to join MongoDB and build payment APIs in Go.', "MongoDB's work on payments appeals to me."]) {
    assert.deepEqual(check(sentence, mongo).paragraphs, [sentence], sentence);
  }
  assert.deepEqual(check('I have built checkout flows on Stripe for years.', { job: { ...JOB, company: 'Stripe' } }).paragraphs, []);
});

test('ties to the company are flagged; hoping to work there is not', () => {
  for (const sentence of ['I have partnered with Acme Pay on integrations before.', 'As a longtime Acme Pay customer, I know the product well.']) {
    assert.equal(classOf(sentence), 'flag', sentence);
    assert.equal(check(sentence).checks[0]!.issues[0]!.code, 'NEW_ENTITY', sentence);
  }
  for (const sentence of [
    'I look forward to working at Acme Pay.',
    'I am excited about the prospect of working with Acme Pay.',
    'I am eager to start my next role at Acme Pay.',
    "I was impressed by Acme Pay's focus on merchants.",
  ]) {
    const result = check(sentence);
    assert.deepEqual(result.paragraphs, [sentence], `${sentence}: ${JSON.stringify(result.checks)}`);
    assert.deepEqual(result.checks, [], sentence);
  }
});

test("a credential claimed is dropped; a tool or client from the posting, claimed, is flagged", () => {
  const job = {
    ...JOB,
    descriptionText: `${JOB.descriptionText} PMP certification preferred. We run Temporal workflows for clients like Walmart.`,
  };
  for (const sentence of ['I hold the PMP certification.', 'I hold an active security clearance.', 'I am a licensed professional engineer.']) {
    assert.equal(classOf(sentence, { job }), 'drop', sentence);
  }
  for (const sentence of ['I have deep experience with Temporal.', 'I worked with Walmart on payment APIs in Go.']) {
    assert.equal(classOf(sentence, { job }), 'flag', sentence);
  }
  // Wanting to work on the posting's product, or liking it, is not a claim: kept, with a note
  // that doesn't hold up the PDF.
  for (const sentence of ['I would enjoy working on PayLink with your team.', 'I am excited about PayLink.']) {
    const result = check(sentence, { job });
    assert.deepEqual(result.paragraphs, [sentence], sentence);
    assert.equal(result.checks[0]!.issues[0]!.code, 'NEW_NAME', sentence);
    assert.equal(result.checks[0]!.severity, 'note', sentence);
  }
});

test('month names are dates, not names', () => {
  for (const sentence of ['Since January 2022, I have built payment APIs in Go at Globex.', 'From June 2019 to December 2021 I wrote Python at Initech.']) {
    const result = check(sentence);
    assert.deepEqual(result.paragraphs, [sentence], `${sentence}: ${JSON.stringify(result.checks)}`);
  }
});

test("a sentence about the company may use the posting's numbers; one about the candidate may not", () => {
  const job = { ...JOB, descriptionText: `${JOB.descriptionText} Acme Pay serves 5 million merchants across 30 countries.` };
  const company = 'Acme Pay serves 5 million merchants across 30 countries.';
  assert.deepEqual(check(company, { job }).paragraphs, [company]);
  assert.deepEqual(check('I have served 5 million merchants.', { job }).paragraphs, []);
});

test("other people's titles are not the candidate's", () => {
  for (const sentence of ["I was struck by the CTO's post on reliability.", "I enjoyed reading the founder's essay on payments.", "I admire Acme Pay's CTO."]) {
    const result = check(sentence);
    assert.deepEqual(result.paragraphs, [sentence], `${sentence}: ${JSON.stringify(result.checks)}`);
  }
});

test('a greeting on the same line as the letter goes, and the letter stays', () => {
  assert.deepEqual(groundLetter(['Dear Hiring Manager, I build payment APIs in Go.'], ctx()).paragraphs, ['I build payment APIs in Go.']);
});

// Adversarial review (#416, round 2): the probes that got past the check, kept as cases.

const POSTING_TOOLS = {
  ...JOB,
  descriptionText: `${JOB.descriptionText} Experience with Temporal and Snowflake preferred.`,
};

test('a name as the first word of a sentence is checked too', () => {
  for (const sentence of [
    'Google trained me as an engineer.',
    'Microsoft is where I learned Go.',
    'Netflix and Globex both relied on my Go services.',
    'Amazon promoted me twice.',
  ]) {
    const result = check(sentence);
    assert.notEqual(classOf(sentence), 'kept', sentence);
    assert.ok(result.checks[0]!.issues.some((issue) => issue.code === 'NEW_TERM'), sentence);
  }
  for (const sentence of [
    'Building payment APIs in Go is the work I do best.',
    'Previously, I built the billing API in Go at Globex.',
    'Payment APIs are the core of my work.',
    'Globex is where I built the billing API in Go.',
    'Thank you for your time.',
    'Before Globex, I built reports with Python at Initech.',
    'Python and Go are the languages I use most.',
  ]) {
    const result = check(sentence);
    assert.deepEqual(result.paragraphs, [sentence], `${sentence}: ${JSON.stringify(result.checks)}`);
  }
});

test('experience with the company, in a sentence about the candidate, is flagged unless it applies or hopes', () => {
  for (const sentence of [
    'I am a former employee of Acme Pay.',
    'Acme Pay was my employer.',
    'I was part of the Acme Pay team.',
    'I spent time on the Acme Pay team.',
    'As an ex-Acme Pay engineer, I build payment APIs in Go.',
    'Acme Pay hired me in the past.',
    'I returned to Acme Pay after Globex.',
    'I know the Acme Pay codebase well.',
    'I worked at ACME PAY for a while.',
  ]) {
    assert.equal(classOf(sentence), 'flag', sentence);
    assert.equal(check(sentence).checks[0]!.issues[0]!.code, 'NEW_ENTITY', sentence);
  }
  for (const sentence of [
    'I am applying for the Backend Engineer role at Acme Pay.',
    'I am writing to apply to Acme Pay.',
    'I would bring my Go experience to Acme Pay.',
    'Acme Pay builds payment APIs, which is the work I do at Globex.',
  ]) {
    assert.deepEqual(check(sentence).paragraphs, [sentence], sentence);
  }
  // A company the résumé names (a former employer) may be named.
  const former = { ...JOB, company: 'Globex' };
  assert.deepEqual(check('I built the billing API at Globex.', { job: former }).paragraphs, ['I built the billing API at Globex.']);
});

test("lowercase employers, and the posting's tools in any case, are caught in claims", () => {
  for (const sentence of [
    'I worked at google before Globex.',
    'Previously I was at stripe.',
    'I have used temporal workflows extensively.',
    'I have deep experience with snowflake.',
  ]) {
    assert.notEqual(classOf(sentence, { job: POSTING_TOOLS }), 'kept', sentence);
  }
  const honest = 'I worked at Globex on the billing API in Go.';
  assert.deepEqual(check(honest, { job: POSTING_TOOLS }).paragraphs, [honest]);
});

test('a confirmed keyword counts as a whole phrase only', () => {
  const confirmed = { confirmedKeywords: ['Google Cloud'] };
  assert.equal(classOf('I worked at Google for years.', confirmed), 'flag');
  const cloud = 'I moved the billing API to Google Cloud at Globex.';
  const result = check(cloud, confirmed);
  assert.deepEqual(result.paragraphs, [cloud], JSON.stringify(result.checks));
  assert.deepEqual(result.checks[0]!.confirmedTerms, ['Google Cloud']);
});

test('a link or an email address the résumé lacks drops its sentence', () => {
  assert.deepEqual(groundLetter(['I build payment APIs in Go. Visit https://evil.example.com for more.'], ctx()).paragraphs, [
    'I build payment APIs in Go.',
  ]);
  assert.deepEqual(check('I mentored two interns at Globex (see github.com/jordan).').paragraphs, []);
  assert.deepEqual(check('You can write to me at someone@evil.example.com.').paragraphs, []);
  const own = 'You can reach me at jordan@example.com.';
  assert.deepEqual(check(own).paragraphs, [own]);
  const aspnet = 'I would like to learn ASP.NET too.';
  assert.deepEqual(check(aspnet, { confirmedKeywords: ['ASP.NET'] }).paragraphs, [aspnet]);
});

test('a sign-off is found on one line with the name, or without a blank line; a thank-you mid-letter is not one', () => {
  const body = 'I build payment APIs in Go.';
  assert.deepEqual(groundLetter([`Dear Hiring Manager,\n\n${body}\n\nBest regards, Jordan Lee`], ctx()).paragraphs, [body]);
  assert.deepEqual(groundLetter([`Dear Hiring Manager,\n${body}\nSincerely,\nJordan Lee`], ctx()).paragraphs, [body]);
  assert.deepEqual(groundLetter([body, 'Sincerely, Jordan Lee'], ctx()).paragraphs, [body]);
  assert.deepEqual(groundLetter([body, 'Jordan Lee'], ctx()).paragraphs, [body]);
  assert.deepEqual(groundLetter([body, 'Thank you!', 'I mentored two interns.'], ctx()).paragraphs, [
    body,
    'Thank you!',
    'I mentored two interns.',
  ]);
  const thanks = `${body} Thank you for your time.`;
  assert.deepEqual(groundLetter([thanks], ctx()).paragraphs, [thanks]);
});
