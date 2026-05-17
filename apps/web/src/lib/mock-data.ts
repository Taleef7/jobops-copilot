import type { Job, JobPriority, JobStatus, WeeklyReport } from '@/types/job';

export const jobStatusOrder: JobStatus[] = [
  'discovered',
  'shortlisted',
  'outreach_drafted',
  'outreach_sent',
  'referral_requested',
  'follow_up_due',
  'applied',
  'interview',
  'offer',
  'rejected',
  'archived',
];

export const mockJobs: Job[] = [
  {
    id: 'job-01',
    jobUrl: 'https://careers.example.com/jobs/ai-automation-engineer',
    source: 'manual',
    company: 'Northwind Labs',
    title: 'AI Automation Engineer',
    location: 'Remote',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: '2026-05-14T09:00:00.000Z',
    discoveredAt: '2026-05-15T08:15:00.000Z',
    descriptionText:
      'Build internal automations, agent workflows, and cloud integrations using TypeScript, Azure Functions, n8n, and modern LLM tooling.',
    status: 'shortlisted',
    priority: 'high',
    fitScore: 91,
    notes: 'Strong match for ops automation and serverless backend work.',
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
        id: 'outreach-01',
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
  },
  {
    id: 'job-02',
    source: 'manual',
    company: 'AtlasHire',
    title: 'Workflow Operations Analyst',
    location: 'New York, NY',
    employmentType: 'Full-time',
    workplaceType: 'hybrid',
    datePosted: '2026-05-12T13:00:00.000Z',
    discoveredAt: '2026-05-15T09:10:00.000Z',
    descriptionText:
      'Own CRM hygiene, reporting, follow-up tracking, and process automation across recruiting operations and hiring workflows.',
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
        id: 'outreach-02',
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
  },
  {
    id: 'job-03',
    source: 'referral',
    company: 'BeaconOps',
    title: 'Solutions Consultant, HR Tech',
    location: 'Austin, TX',
    employmentType: 'Full-time',
    workplaceType: 'remote',
    datePosted: '2026-05-10T17:30:00.000Z',
    discoveredAt: '2026-05-14T14:15:00.000Z',
    descriptionText:
      'Support HR customers with demos, discovery, implementation guidance, and workflow recommendations for SaaS operations tooling.',
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
        id: 'outreach-03',
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
  },
  {
    id: 'job-04',
    source: 'job board',
    company: 'Meridian Systems',
    title: 'Technical Program Manager, AI Platforms',
    location: 'Seattle, WA',
    employmentType: 'Full-time',
    workplaceType: 'hybrid',
    datePosted: '2026-05-13T11:00:00.000Z',
    discoveredAt: '2026-05-15T12:30:00.000Z',
    descriptionText:
      'Coordinate AI platform delivery, cross-functional planning, and release management across engineering and product teams.',
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
  },
  {
    id: 'job-05',
    source: 'manual',
    company: 'Skyline Partners',
    title: 'Recruiting Operations Specialist',
    location: 'Remote',
    employmentType: 'Contract',
    workplaceType: 'remote',
    discoveredAt: '2026-05-15T13:40:00.000Z',
    descriptionText:
      'Manage recruiting workflows, coordination, candidate follow-up, and reporting for a fast-moving talent team.',
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
  },
];

export const mockWeeklyReports: WeeklyReport[] = [
  {
    id: 'report-01',
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

export function getJobById(jobId: string): Job | undefined {
  return mockJobs.find((job) => job.id === jobId);
}

export function getStatusCount(status: JobStatus): number {
  return mockJobs.filter((job) => job.status === status).length;
}

export function getPriorityCount(priority: JobPriority): number {
  return mockJobs.filter((job) => job.priority === priority).length;
}
