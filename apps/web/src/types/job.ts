export type JobStatus =
  | 'discovered'
  | 'shortlisted'
  | 'applied'
  | 'outreach_drafted'
  | 'outreach_sent'
  | 'referral_requested'
  | 'follow_up_due'
  | 'interview'
  | 'rejected'
  | 'offer'
  | 'archived';

export type OutreachStatus = 'drafted' | 'approved' | 'sent' | 'skipped';

export type OutreachMessageType =
  | 'recruiter_email'
  | 'linkedin_connection'
  | 'referral_request'
  | 'follow_up'
  | 'thank_you';

export type JobPriority = 'high' | 'medium' | 'low';
export type WorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export interface JobAnalysis {
  requiredSkills: string[];
  preferredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  atsKeywords: string[];
  fitSummary: string;
  recommendedResumeAngle: string;
  applyRecommendation: string;
  confidenceScore: number;
  modelUsed: string;
}

export interface OutreachDraft {
  id: string;
  jobId?: string;
  contactName: string;
  contactRole: string;
  contactSource: string;
  linkedinUrl?: string;
  email?: string;
  gmailDraftId?: string;
  messageType: OutreachMessageType;
  draftText: string;
  status: OutreachStatus;
  createdAt: string;
  sentAt?: string;
  followUpDue?: string;
}

export interface Job {
  id: string;
  jobUrl?: string;
  source: string;
  company: string;
  title: string;
  location: string;
  employmentType: string;
  workplaceType: WorkplaceType;
  datePosted?: string;
  discoveredAt: string;
  descriptionText: string;
  status: JobStatus;
  priority: JobPriority;
  fitScore: number | null;
  notes?: string;
  nextAction: string;
  nextActionDue?: string;
  analysis: JobAnalysis;
  outreach: OutreachDraft[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WeeklyReport {
  id: string;
  weekStart: string;
  weekEnd: string;
  jobsDiscovered: number;
  jobsShortlisted: number;
  jobsApplied: number;
  outreachDrafted: number;
  outreachSent: number;
  responsesReceived: number;
  interviews: number;
  commonMissingSkills: string[];
  recommendations: string[];
  reportMarkdown: string;
  reportUrl?: string;
  createdAt: string;
}
