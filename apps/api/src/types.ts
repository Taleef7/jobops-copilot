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

export type JobPriority = 'high' | 'medium' | 'low';

export type JobWorkplaceType = 'remote' | 'hybrid' | 'onsite' | 'flexible';

export type MessageType =
  | 'recruiter_email'
  | 'linkedin_connection'
  | 'referral_request'
  | 'follow_up'
  | 'thank_you';

export type OutreachStatus = 'drafted' | 'approved' | 'sent' | 'skipped';

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
  contactName?: string;
  contactRole?: string;
  contactSource?: string;
  linkedinUrl?: string;
  email?: string;
  gmailDraftId?: string;
  messageType: MessageType;
  draftText: string;
  status: OutreachStatus;
  createdAt: string;
  sentAt?: string;
  followUpDue?: string;
}

export interface JobRecord {
  id: string;
  jobUrl?: string;
  source: string;
  company: string;
  title: string;
  location: string;
  employmentType: string;
  workplaceType: JobWorkplaceType;
  datePosted?: string;
  discoveredAt: string;
  descriptionText: string;
  status: JobStatus;
  priority: JobPriority;
  fitScore: number | null;
  notes?: string;
  nextAction?: string;
  nextActionDue?: string;
  analysis: JobAnalysis;
  outreach: OutreachDraft[];
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyReportRecord {
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

export interface CreateJobBody {
  jobUrl?: string;
  source?: string;
  company: string;
  title: string;
  location?: string;
  employmentType?: string;
  workplaceType?: JobWorkplaceType;
  datePosted?: string;
  priority?: JobPriority;
  notes?: string;
  descriptionText: string;
}

export interface UpdateJobBody {
  status?: JobStatus;
  priority?: JobPriority;
  notes?: string;
  fitScore?: number | null;
  nextAction?: string;
  nextActionDue?: string;
}

export interface ParseJobBody {
  job_id?: string;
  description_text: string;
}

export interface ScoreFitBody {
  job_id?: string;
  resume_text: string;
  profile_text: string;
}

export interface DraftOutreachBody {
  job_id?: string;
  message_type: MessageType;
  contact_name?: string;
  contact_role?: string;
  contact_email?: string;
  job_context?: string;
  resume_summary?: string;
}

export interface UpdateOutreachBody {
  status?: OutreachStatus;
  gmailDraftId?: string;
  sentAt?: string;
  followUpDue?: string;
}

export interface WeeklyReportBody {
  week_start: string;
  week_end: string;
}

export interface N8nJobIntakeBody {
  company: string;
  title: string;
  description_text: string;
  job_url?: string;
  source?: string;
  location?: string;
  employment_type?: string;
  workplace_type?: JobWorkplaceType;
  date_posted?: string;
  priority?: JobPriority;
  notes?: string;
  resume_text?: string;
  profile_text?: string;
}

export interface N8nWeeklyReportBody {
  week_start: string;
  week_end: string;
}

export interface N8nFollowUpRemindersBody {
  as_of?: string;
}
