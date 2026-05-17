import { randomUUID } from 'node:crypto';
import type {
  CreateJobBody,
  DraftOutreachBody,
  JobAnalysis,
  JobRecord,
  OutreachDraft,
  MessageType,
  ParseJobBody,
  ScoreFitBody,
  UpdateJobBody,
  WeeklyReportBody,
  WeeklyReportRecord,
} from '@/types';

const now = () => new Date().toISOString();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultAnalysis(descriptionText: string): JobAnalysis {
  const extractedSkills = extractKeywords(descriptionText);

  return {
    requiredSkills: extractedSkills.slice(0, 5),
    preferredSkills: extractedSkills.slice(5, 8),
    matchedSkills: [],
    missingSkills: extractedSkills.slice(0, 3),
    atsKeywords: extractedSkills.slice(0, 6),
    fitSummary: 'Initial placeholder analysis waiting for AI processing.',
    recommendedResumeAngle: 'Emphasize truthful, relevant experience from the current resume.',
    applyRecommendation: 'Review manually before deciding whether to apply.',
    confidenceScore: 48,
    modelUsed: 'mock-analysis-v1',
  };
}

function extractKeywords(text: string): string[] {
  const keywords = [
    'TypeScript',
    'JavaScript',
    'React',
    'Next.js',
    'Azure Functions',
    'Azure Blob Storage',
    'PostgreSQL',
    'SQL',
    'n8n',
    'Zapier',
    'Make.com',
    'OpenAI',
    'Azure OpenAI',
    'LLM',
    'Express',
    'Python',
    'Node.js',
    'Workflow automation',
    'CRM',
    'Analytics',
  ];

  return keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function createBaseJob(body: CreateJobBody): JobRecord {
  const timestamp = now();
  const workplaceType = body.workplaceType ?? 'remote';

  return {
    id: randomUUID(),
    jobUrl: body.jobUrl,
    source: body.source ?? 'manual',
    company: body.company.trim(),
    title: body.title.trim(),
    location: body.location?.trim() ?? 'Remote',
    employmentType: body.employmentType?.trim() ?? 'Full-time',
    workplaceType,
    datePosted: body.datePosted,
    discoveredAt: timestamp,
    descriptionText: body.descriptionText.trim(),
    status: 'discovered',
    priority: 'medium',
    fitScore: null,
    notes: undefined,
    nextAction: 'Run AI parsing and fit scoring after the record is saved.',
    nextActionDue: undefined,
    analysis: defaultAnalysis(body.descriptionText),
    outreach: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const jobs: JobRecord[] = [
  createBaseJob({
    jobUrl: 'https://careers.example.com/jobs/ai-automation-engineer',
    source: 'manual',
    company: 'Northwind Labs',
    title: 'AI Automation Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: '2026-05-14T09:00:00.000Z',
    descriptionText:
      'Build internal automations, agent workflows, and cloud integrations using TypeScript, Azure Functions, n8n, and modern LLM tooling.',
  }),
  createBaseJob({
    source: 'manual',
    company: 'AtlasHire',
    title: 'Workflow Operations Analyst',
    location: 'New York, NY',
    employmentType: 'Full-time',
    workplaceType: 'hybrid',
    datePosted: '2026-05-12T13:00:00.000Z',
    descriptionText:
      'Own CRM hygiene, reporting, follow-up tracking, and process automation across recruiting operations and hiring workflows.',
  }),
  createBaseJob({
    source: 'referral',
    company: 'BeaconOps',
    title: 'Solutions Consultant, HR Tech',
    location: 'Austin, TX',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: '2026-05-10T17:30:00.000Z',
    descriptionText:
      'Support HR customers with demos, discovery, implementation guidance, and workflow recommendations for SaaS operations tooling.',
  }),
];

const firstJob = jobs[0]!;
jobs[0] = {
  ...firstJob,
  status: 'shortlisted',
  priority: 'high',
  fitScore: 91,
  notes: 'Strong match for automation and serverless backend work.',
  nextAction: 'Review and tailor resume summary before sending a recruiter outreach draft.',
  nextActionDue: '2026-05-17T10:00:00.000Z',
  analysis: {
    requiredSkills: ['TypeScript', 'Azure Functions', 'Automation', 'LLM APIs', 'Workflow orchestration'],
    preferredSkills: ['n8n', 'PostgreSQL', 'React', 'Observability'],
    matchedSkills: ['TypeScript', 'Automation', 'React', 'PostgreSQL'],
    missingSkills: ['Azure Functions', 'n8n', 'Azure Blob Storage'],
    atsKeywords: ['serverless', 'CRM', 'workflow automation', 'human-in-the-loop'],
    fitSummary:
      'Excellent match for a product-minded builder who can combine frontend, backend, and workflow automation.',
    recommendedResumeAngle:
      'Position your work as operations automation and full-stack delivery for internal tools.',
    applyRecommendation: 'Apply with a customized resume and a short human-reviewed outreach message.',
    confidenceScore: 92,
    modelUsed: 'mock-analysis-v1',
  },
  outreach: [
    {
      id: randomUUID(),
      contactName: 'Maya Chen',
      contactRole: 'Talent Partner',
      contactSource: 'Company careers page',
      email: 'maya.chen@example.com',
      messageType: 'recruiter_email',
      draftText:
        'Hi Maya, I saw the AI Automation Engineer opening and wanted to share a concise note that I have hands-on experience building workflow-driven internal tools with TypeScript, React, and cloud APIs.',
      status: 'drafted',
      createdAt: '2026-05-15T08:30:00.000Z',
      followUpDue: '2026-05-22T08:30:00.000Z',
    },
  ],
};

const secondJob = jobs[1]!;
jobs[1] = {
  ...secondJob,
  status: 'outreach_drafted',
  priority: 'medium',
  fitScore: 82,
  notes: 'Good fit for operational rigor and reporting.',
  nextAction: 'Approve the outreach draft and schedule a follow-up reminder.',
  nextActionDue: '2026-05-18T16:00:00.000Z',
  analysis: {
    requiredSkills: ['CRM', 'Reporting', 'Process automation', 'Stakeholder communication'],
    preferredSkills: ['Slack', 'Google Sheets', 'Zapier', 'n8n'],
    matchedSkills: ['CRM', 'Reporting', 'Communication'],
    missingSkills: ['Zapier', 'n8n'],
    atsKeywords: ['operations', 'automation', 'candidate workflow', 'dashboard'],
    fitSummary: 'Solid match for someone who likes process design, dashboards, and clean follow-up systems.',
    recommendedResumeAngle: 'Emphasize ops rigor, reporting, and workflow ownership.',
    applyRecommendation: 'Apply after tailoring the summary and experience bullets toward operations tooling.',
    confidenceScore: 84,
    modelUsed: 'mock-analysis-v1',
  },
  outreach: [
    {
      id: randomUUID(),
      contactName: 'Jordan Patel',
      contactRole: 'Recruiting Manager',
      contactSource: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/jordanpatel',
      messageType: 'linkedin_connection',
      draftText:
        'Hi Jordan, I am reaching out because the Workflow Operations Analyst role lines up closely with the systems and reporting work I have been doing for internal teams.',
      status: 'drafted',
      createdAt: '2026-05-15T10:05:00.000Z',
      followUpDue: '2026-05-21T10:05:00.000Z',
    },
  ],
};

const thirdJob = jobs[2]!;
jobs[2] = {
  ...thirdJob,
  status: 'follow_up_due',
  priority: 'high',
  fitScore: 79,
  notes: 'Worth following up with the referral contact this week.',
  nextAction: 'Send a polite follow-up message and ask whether the referral partner is still available.',
  nextActionDue: '2026-05-16T15:00:00.000Z',
  analysis: {
    requiredSkills: ['Customer discovery', 'Implementation', 'Solution selling', 'HR tech'],
    preferredSkills: ['SaaS', 'Automation', 'Presentations'],
    matchedSkills: ['Customer communication', 'Automation', 'Presentation'],
    missingSkills: ['HR tech'],
    atsKeywords: ['solutions consultant', 'workflow', 'implementation', 'demos'],
    fitSummary: 'A good conversation role if you want to combine process thinking with client-facing work.',
    recommendedResumeAngle: 'Frame your resume around problem solving, implementation support, and workflow design.',
    applyRecommendation: 'Apply if you are comfortable with customer-facing work and implementation ownership.',
    confidenceScore: 77,
    modelUsed: 'mock-analysis-v1',
  },
  outreach: [
    {
      id: randomUUID(),
      contactName: 'Sam Rivera',
      contactRole: 'Referral Partner',
      contactSource: 'Internal referral',
      email: 'sam.rivera@example.com',
      messageType: 'referral_request',
      draftText:
        'Hi Sam, I wanted to follow up on the HR Tech Solutions Consultant role and ask if you still feel comfortable making an introduction.',
      status: 'approved',
      createdAt: '2026-05-15T11:45:00.000Z',
      followUpDue: '2026-05-16T15:00:00.000Z',
    },
  ],
};

jobs.push(
  {
    ...createBaseJob({
      source: 'job board',
      company: 'Meridian Systems',
      title: 'Technical Program Manager, AI Platforms',
      location: 'Seattle, WA',
      employmentType: 'Full-time',
      workplaceType: 'hybrid',
      datePosted: '2026-05-13T11:00:00.000Z',
      descriptionText:
        'Coordinate AI platform delivery, cross-functional planning, and release management across engineering and product teams.',
    }),
    status: 'applied',
    priority: 'medium',
    fitScore: 76,
    notes: 'Application submitted manually and is awaiting response.',
    nextAction: 'Track response window and prepare follow-up if no reply arrives.',
    nextActionDue: '2026-05-23T09:00:00.000Z',
    analysis: {
      requiredSkills: ['Program management', 'AI platforms', 'Cross-functional coordination'],
      preferredSkills: ['Release planning', 'Stakeholder communication', 'Cloud platforms'],
      matchedSkills: ['Stakeholder communication', 'Cloud platforms'],
      missingSkills: ['Program management', 'Release planning'],
      atsKeywords: ['technical program manager', 'AI', 'roadmap', 'delivery'],
      fitSummary: 'Possible fit if you want to lean into delivery coordination and AI program operations.',
      recommendedResumeAngle: 'Emphasize delivery ownership, cross-functional coordination, and product execution.',
      applyRecommendation: 'Apply only if you can credibly frame your work around program delivery.',
      confidenceScore: 73,
      modelUsed: 'mock-analysis-v1',
    },
    outreach: [],
    createdAt: now(),
    updatedAt: now(),
  },
  {
    ...createBaseJob({
      source: 'manual',
      company: 'Skyline Partners',
      title: 'Recruiting Operations Specialist',
      location: 'Remote',
      employmentType: 'Contract',
      workplaceType: 'remote',
      descriptionText:
        'Manage recruiting workflows, coordination, candidate follow-up, and reporting for a fast-moving talent team.',
    }),
    status: 'discovered',
    priority: 'low',
    fitScore: 68,
    notes: 'Good backup option for process-heavy recruiting work.',
    nextAction: 'Decide whether to shortlist after reviewing comp and contract details.',
    analysis: {
      requiredSkills: ['Recruiting operations', 'Coordination', 'Reporting'],
      preferredSkills: ['ATS', 'Calendar management', 'Automation'],
      matchedSkills: ['Coordination', 'Reporting'],
      missingSkills: ['ATS', 'Calendar management'],
      atsKeywords: ['recruiting operations', 'candidate tracking', 'follow-up'],
      fitSummary: 'Useful if you want a closer ops role with a hiring-team focus.',
      recommendedResumeAngle: 'Stress workflow ownership, follow-up discipline, and CRM/reporting habits.',
      applyRecommendation: 'Apply if contract work fits your target search strategy.',
      confidenceScore: 71,
      modelUsed: 'mock-analysis-v1',
    },
    outreach: [],
    createdAt: now(),
    updatedAt: now(),
  },
);

const weeklyReports: WeeklyReportRecord[] = [
  {
    id: randomUUID(),
    weekStart: '2026-05-11',
    weekEnd: '2026-05-17',
    jobsDiscovered: 14,
    jobsShortlisted: 5,
    jobsApplied: 2,
    outreachDrafted: 4,
    outreachSent: 1,
    responsesReceived: 1,
    interviews: 1,
    commonMissingSkills: ['Azure Functions', 'n8n', 'HR tech', 'Program management'],
    recommendations: [
      'Tailor the headline toward operations automation and workflow systems.',
      'Prioritize jobs that combine process ownership with hands-on technical delivery.',
      'Schedule follow-ups for all drafted outreach within seven days.',
    ],
    reportMarkdown:
      'This week focused on operational roles that reward workflow thinking. The strongest opportunities were the automation engineer and recruiting operations roles.',
  },
];

export const seedJobs = jobs;
export const seedWeeklyReports = weeklyReports;

export function listJobs() {
  return jobs;
}

export function getJobById(jobId: string) {
  return jobs.find((job) => job.id === jobId);
}

export function createJob(body: CreateJobBody) {
  const job = createBaseJob(body);
  jobs.unshift(job);
  return job;
}

export function updateJob(jobId: string, body: UpdateJobBody) {
  const job = getJobById(jobId);
  if (!job) {
    return undefined;
  }

  if (typeof body.status !== 'undefined') {
    job.status = body.status;
  }
  if (typeof body.priority !== 'undefined') {
    job.priority = body.priority;
  }
  if (typeof body.notes !== 'undefined') {
    job.notes = body.notes;
  }
  if (typeof body.fitScore !== 'undefined') {
    job.fitScore = body.fitScore;
  }
  if (typeof body.nextAction !== 'undefined') {
    job.nextAction = body.nextAction;
  }
  if (typeof body.nextActionDue !== 'undefined') {
    job.nextActionDue = body.nextActionDue;
  }

  job.updatedAt = now();
  return job;
}

export function appendOutreachDraft(jobId: string, draft: OutreachDraft) {
  const job = getJobById(jobId);
  if (!job) {
    return undefined;
  }

  job.outreach.push(draft);
  job.updatedAt = now();
  return draft;
}

export function listWeeklyReports() {
  return weeklyReports;
}

export function getLatestWeeklyReport() {
  return weeklyReports[0];
}

export function parseJobBody(payload: ParseJobBody) {
  const description = payload.description_text.trim();
  const keywords = extractKeywords(description);

  return {
    company: inferCompany(description),
    title: inferTitle(description),
    required_skills: keywords.slice(0, 5),
    preferred_skills: keywords.slice(5, 8),
    responsibilities: buildResponsibilities(keywords),
    seniority: inferSeniority(description),
    cloud_tools: keywords.filter((keyword) => /Azure|AWS|Google Cloud/i.test(keyword)),
    automation_tools: keywords.filter((keyword) => /n8n|Zapier|Make|workflow/i.test(keyword)),
    summary: `Parsed ${keywords.length} keywords from the job description and grouped them into structured fields.`,
  };
}

export function scoreFitBody(payload: ScoreFitBody) {
  const job = payload.job_id ? getJobById(payload.job_id) : undefined;
  const text = `${payload.resume_text} ${payload.profile_text}`.toLowerCase();
  const matchedSkills = job ? job.analysis.requiredSkills.filter((skill) => text.includes(skill.toLowerCase())) : [];
  const missingSkills = job
    ? job.analysis.requiredSkills.filter((skill) => !matchedSkills.includes(skill))
    : [];

  const score = clamp(56 + matchedSkills.length * 8 - missingSkills.length * 4, 30, 96);

  return {
    fit_score: job?.fitScore ?? score,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    ats_keywords: job?.analysis.atsKeywords ?? extractKeywords(text),
    fit_summary:
      job?.analysis.fitSummary ??
      'Mock fit summary generated without a live LLM. The future version will explain the score in plain language.',
    recommended_resume_angle:
      job?.analysis.recommendedResumeAngle ??
      'Focus on truthful phrasing, keyword alignment, and the highest-signal experience from the resume.',
    apply_recommendation:
      score >= 80 ? 'apply' : score >= 65 ? 'review' : 'pass',
  };
}

export function draftOutreachBody(payload: DraftOutreachBody) {
  const subjectMap: Record<MessageType, string> = {
    recruiter_email: 'Interest in the role and a quick introduction',
    linkedin_connection: 'Thanks for connecting',
    referral_request: 'Quick follow-up on the referral intro',
    follow_up: 'Following up on the application',
    thank_you: 'Thank you for your time',
  };

  const subject = subjectMap[payload.message_type];

  return {
    subject,
    draft_text: buildDraftText(payload, subject),
    safety_notes:
      'Draft only. Human review is required before sending. Keep claims truthful and specific to the evidence in the resume and profile.',
  };
}

export function generateWeeklyReportBody(payload: WeeklyReportBody) {
  const report = getLatestWeeklyReport();

  if (!report) {
    throw new Error('Weekly report seed is missing');
  }

  return {
    summary: `Weekly report draft for ${payload.week_start} through ${payload.week_end}.`,
    metrics: {
      jobs_discovered: report.jobsDiscovered,
      jobs_shortlisted: report.jobsShortlisted,
      jobs_applied: report.jobsApplied,
      outreach_drafted: report.outreachDrafted,
      outreach_sent: report.outreachSent,
      responses_received: report.responsesReceived,
      interviews: report.interviews,
    },
    common_missing_skills: report.commonMissingSkills,
    recommended_next_actions: report.recommendations,
    report_markdown: report.reportMarkdown,
  };
}

function inferCompany(description: string) {
  const match = description.match(/for\s+([A-Z][A-Za-z0-9&.,\s-]{2,40})/);
  return match?.[1]?.trim() ?? 'Unknown Company';
}

function inferTitle(description: string) {
  const titleCandidates = [
    'Automation Engineer',
    'Workflow Operations Analyst',
    'Solutions Consultant',
    'Technical Program Manager',
    'Recruiting Operations Specialist',
  ];

  return titleCandidates.find((candidate) =>
    description.toLowerCase().includes(candidate.toLowerCase()),
  ) ?? 'Untitled Role';
}

function inferSeniority(description: string) {
  if (/senior|staff|principal/i.test(description)) {
    return 'senior';
  }

  if (/manager|lead/i.test(description)) {
    return 'mid';
  }

  return 'mid';
}

function buildResponsibilities(keywords: string[]) {
  return keywords.slice(0, 4).map((keyword) => `Contribute to ${keyword.toLowerCase()} initiatives.`);
}

function buildDraftText(payload: DraftOutreachBody, subject: string) {
  const salutation = payload.contact_name ? `Hi ${payload.contact_name},` : 'Hi there,';
  const roleLine = payload.contact_role
    ? `I noticed the ${payload.message_type.replaceAll('_', ' ')} opportunity with ${payload.contact_role} and wanted to share a quick note.`
    : `I noticed the ${payload.message_type.replaceAll('_', ' ')} opportunity and wanted to share a quick note.`;
  const jobContext = payload.job_context?.replace(/\s+/g, ' ').trim();
  const resumeSummary = payload.resume_summary?.replace(/\s+/g, ' ').trim();
  const jobContextLine = jobContext
    ? `The role context points to ${jobContext.length > 160 ? `${jobContext.slice(0, 157)}...` : jobContext}.`
    : 'I wanted to keep the message grounded in the actual role details and shared context.';
  const resumeSummaryLine = resumeSummary
    ? `My background includes ${resumeSummary.length > 160 ? `${resumeSummary.slice(0, 157)}...` : resumeSummary}.`
    : 'I have relevant experience in workflow automation, structured operations, and thoughtful communication.';

  return [
    salutation,
    '',
    roleLine,
    jobContextLine,
    resumeSummaryLine,
    '',
    `Subject: ${subject}`,
    '',
    'Best,',
    'JobOps Copilot',
  ].join('\n');
}
