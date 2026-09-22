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

export type JobSeniority = 'junior' | 'mid' | 'senior' | 'lead' | 'unknown';
export interface KnownSponsorLikelihood {
  status: 'known_sponsor';
  approvals: number;
  denials: number;
}

export type SponsorLikelihood =
  | 'likely'
  | 'possible'
  | 'unlikely'
  | 'unknown'
  | KnownSponsorLikelihood;
export type JobLiveness = 'active' | 'stale' | 'expired';

export type MessageType =
  | 'recruiter_email'
  | 'linkedin_connection'
  | 'referral_request'
  | 'follow_up'
  | 'thank_you'
  | 'cover_letter';

export type OutreachStatus = 'drafted' | 'approved' | 'sent' | 'skipped';

export interface JobAnalysisSubSignals {
  skillsMatch?: number;
  titleSeniority?: number;
  salaryFit?: number;
  sponsorshipLikelihood?: number;
}

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
  subSignals?: JobAnalysisSubSignals;
}

export interface JobStatusEvent {
  id: string;
  jobId: string;
  userId: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus;
  createdAt: string;
}

export interface FeedItem {
  job: JobRecord;
  fitScore: number | null;
  adjustedScore: number | null;
  subSignals: JobAnalysisSubSignals;
  rankReasons: string[];
}

export interface FeedResult {
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface FeedQueryOptions {
  limit?: number;
  offset?: number;
  minScore?: number;
  seniority?: JobSeniority;
  sponsorOnly?: boolean;
  status?: JobStatus;
  workplaceType?: JobWorkplaceType;
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
  userId?: string;
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
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  seniority?: JobSeniority;
  sponsorLikelihood?: SponsorLikelihood | null;
  contentHash?: string | null;
  lastSeenAt?: string | null;
  liveness?: JobLiveness;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyReportRecord {
  id: string;
  userId?: string;
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
  status?: JobStatus;
  notes?: string;
  nextAction?: string;
  descriptionText: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  seniority?: JobSeniority;
  sponsorLikelihood?: SponsorLikelihood | null;
  contentHash?: string | null;
  lastSeenAt?: string | null;
  liveness?: JobLiveness;
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

export interface SavedSearch {
  id: string;
  userId?: string;
  query: string;
  location?: string;
  remoteOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedSearchBody {
  query: string;
  location?: string;
  remoteOnly?: boolean;
}

export type BoardType = 'greenhouse' | 'lever' | 'ashby';

export interface TargetCompany {
  id: string;
  userId: string;
  company: string;
  boardType: BoardType;
  boardToken: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTargetCompanyBody {
  company: string;
  boardType: BoardType;
  boardToken: string;
}

export interface ResumeLocation {
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface ResumeProfile {
  network: string;
  username?: string;
  url: string;
}

export interface ResumeBasics {
  name: string;
  label?: string;
  email: string;
  phone?: string;
  url?: string;
  summary: string;
  location?: ResumeLocation;
  profiles?: ResumeProfile[];
}

export interface ResumeWorkExperience {
  id?: string;
  company: string;
  position: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current?: boolean;
  summary?: string;
  highlights: string[];
}

export interface ResumeEducation {
  id?: string;
  institution: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
  highlights?: string[];
}

export interface ResumeSkill {
  category: string;
  skills: string[];
}

export interface ResumeProject {
  id?: string;
  name: string;
  description?: string;
  highlights?: string[];
  keywords?: string[];
  url?: string;
}

export interface ResumeCertificate {
  name: string;
  issuer: string;
  date?: string;
  url?: string;
}

export interface StructuredResume {
  basics: ResumeBasics;
  work: ResumeWorkExperience[];
  education: ResumeEducation[];
  skills: ResumeSkill[];
  projects?: ResumeProject[];
  certificates?: ResumeCertificate[];
}

export interface ResumeChangeDetail {
  section: string;
  oldText?: string | null;
  newText: string;
  rationale: string;
}

export interface ResumeVersionRecord {
  id: string;
  userId: string;
  jobId?: string | null;
  baseResumeFileUrl?: string | null;
  tailoredResumeFileUrl?: string | null;
  changeSummary: string;
  changeDetails?: ResumeChangeDetail[];
  structuredResume: StructuredResume;
  sourceConfigVersion?: number | null;
  approved: boolean;
  isBase: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationAnswer {
  id: string;
  userId: string;
  questionHash: string;
  questionText: string;
  answer: string;
  ats?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertApplicationAnswerBody {
  questionText: string;
  answer: string;
  ats?: string | null;
  questionHash?: string;
}

export interface ExtTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  label: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface CreateExtTokenResult {
  token: string;
  record: ExtTokenRecord;
}

export interface ApplicationPackContactBlock {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ApplicationPackQuestionAnswer {
  questionText: string;
  questionHash: string;
  answer: string;
  category: 'work_authorization' | 'salary' | 'why_us' | 'behavioral' | 'custom';
  source: 'qa_memory' | 'profile' | 'preferences' | 'research' | 'generated' | 'unanswerable';
  flagged?: boolean;
}

export interface ApplicationPackPayload {
  jobId: string;
  company: string;
  title: string;
  resumeVersionId?: string | null;
  resumeFileUrl?: string | null;
  coverLetterId?: string | null;
  coverLetterText?: string | null;
  contactBlock?: ApplicationPackContactBlock;
  answers: ApplicationPackQuestionAnswer[];
  flaggedQuestions: string[];
  generatedAt: string;
}

export type JobContactStatus =
  | 'found'
  | 'outreach_drafted'
  | 'contacted'
  | 'replied'
  | 'archived';

export interface JobContactEvidenceItem {
  url: string;
  title?: string;
  snippet?: string;
}

export interface JobContactRecord {
  id: string;
  userId: string;
  jobId: string;
  name: string;
  roleTitle: string;
  evidence: JobContactEvidenceItem[];
  relevance?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  status: JobContactStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobContactBody {
  name: string;
  roleTitle: string;
  evidence: Array<string | JobContactEvidenceItem>;
  relevance?: string;
  email?: string;
  linkedinUrl?: string;
  status?: JobContactStatus;
  notes?: string;
}

export interface UpdateJobContactBody {
  name?: string;
  roleTitle?: string;
  evidence?: Array<string | JobContactEvidenceItem>;
  relevance?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  status?: JobContactStatus;
  notes?: string | null;
}

export type NotificationKind =
  | 'job_match'
  | 'digest'
  | 'follow_up'
  | 'approval_needed'
  | 'agent_done';

export type ChannelDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface ChannelStatusInfo {
  status: ChannelDeliveryStatus;
  sentAt?: string;
  error?: string;
}

export type NotificationChannels = Record<string, ChannelStatusInfo>;

export interface NotificationRecord {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  jobId?: string | null;
  dedupeKey?: string | null;
  channels: NotificationChannels;
  readAt?: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  jobId?: string | null;
  dedupeKey?: string | null;
  channels?: NotificationChannels;
}

export interface NotificationChannelPreferences {
  in_app: boolean;
  email: boolean;
  telegram: boolean;
  web_push: boolean;
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
  timezone?: string;
}

export interface NotificationSettings {
  channels: NotificationChannelPreferences;
  minMatchScore: number;
  digestHour: number;
  quietHours: QuietHours;
  telegramChatId?: string | null;
  emailAddress?: string | null;
}



