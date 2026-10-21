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

/** Each 0–100, or null when unknown (#354): never a default. */
export interface JobAnalysisSubSignals {
  skillsMatch?: number | null;
  titleSeniority?: number | null;
  salaryFit?: number | null;
  sponsorshipLikelihood?: number | null;
}

/** A skill the résumé shows: a label of at most four words, and where it shows it (#354). */
export interface MatchedSkill {
  skill: string;
  evidence: string;
}

/** A skill the posting asks for that the résumé doesn't show, with the posting's words (#354). */
export interface MissingSkill {
  skill: string;
  postingQuote: string;
}

export interface JobAnalysis {
  requiredSkills: string[];
  preferredSkills: string[];
  /** Short labels, as strings: every web version reads these (#354). */
  matchedSkills: string[];
  missingSkills: string[];
  /** The same skills with their evidence, in the same order; absent on rows from before #354. */
  matchedSkillDetails?: MatchedSkill[];
  missingSkillDetails?: MissingSkill[];
  atsKeywords: string[];
  fitSummary: string;
  recommendedResumeAngle: string;
  applyRecommendation: string;
  /** 0–100. Null when there is none, e.g. the discovery pre-rank, a keyword estimate. */
  confidenceScore: number | null;
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
  /** Empty when the posting doesn't say (#355). */
  location: string;
  /** Empty when the posting doesn't say (#355). */
  employmentType: string;
  /** Null when the posting doesn't say (#355). */
  workplaceType: JobWorkplaceType | null;
  datePosted?: string;
  discoveredAt: string;
  descriptionText: string;
  status: JobStatus;
  priority: JobPriority;
  fitScore: number | null;
  notes?: string;
  nextAction?: string;
  nextActionDue?: string;
  /** Null until a real fit score succeeds (#349). */
  analysis: JobAnalysis | null;
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

/** Enough of a tracked job to point the user at it (#346). */
export type TrackedJobRef = Pick<JobRecord, 'id' | 'company' | 'title'>;

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
  /** null clears it, as for nextAction and nextActionDue; left out, it's unchanged. */
  notes?: string | null;
  fitScore?: number | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
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

export type ResumeSectionKey = 'summary' | 'work' | 'education' | 'skills' | 'projects' | 'certificates';

/**
 * Section order, titles and visibility, and page size, for the PDF (#352). Edited in Settings
 * and saved through PATCH /api/profile/base-resume/layout only (#415).
 */
export interface ResumeLayout {
  sections?: Array<{ key: ResumeSectionKey; title?: string; hidden?: boolean }>;
  pageSize?: 'letter' | 'a4';
}

export interface StructuredResume {
  basics: ResumeBasics;
  work: ResumeWorkExperience[];
  education: ResumeEducation[];
  skills: ResumeSkill[];
  projects?: ResumeProject[];
  certificates?: ResumeCertificate[];
  layout?: ResumeLayout;
}

/**
 * Why a tailored line was dropped or needs a look (#351). Every code but NEW_NAME and
 * LEADERSHIP_CLAIM drops the suggestion: the résumé keeps the base line. Those two keep it,
 * marked for review.
 */
export type GroundingCode =
  | 'INVALID_PATH'
  | 'EMPTY_LINE'
  | 'NOT_A_REWRITE'
  | 'NEW_NUMBER'
  | 'NEW_DATE'
  | 'NEW_SKILL'
  | 'NEW_TERM'
  | 'NEW_ENTITY'
  | 'NEW_SENIORITY'
  | 'ODD_CHARACTERS'
  | 'NEW_NAME'
  | 'LEADERSHIP_CLAIM'
  // A cover letter's sentence with a gap to fill in, such as "[Start Date]" (#416).
  | 'PLACEHOLDER';

export interface GroundingIssue {
  code: GroundingCode;
  /** The word or number at issue ("Kafka", "60%"). */
  term?: string;
  /** For the user, after "Suggestion dropped: …": "adds Kafka, which this role doesn't mention". */
  message: string;
  /**
   * A cover letter's finding (#416): `drop` is what the check can prove (a number, a date, a link,
   * a credential, a posting skill, a placeholder); `flag` is what it can only guess (a name, a tie,
   * an employer, a language, a title, leadership) and the user keeps or removes.
   */
  severity?: 'drop' | 'flag';
}

export interface ResumeChangeDetail {
  /** "Summary", "Experience · Globex", "Skills · Data". */
  section: string;
  /** The base résumé's text, never the model's. */
  oldText?: string | null;
  newText: string;
  rationale: string;
  // Set by the tailoring check (#351); older rows don't have these.
  id?: string;
  kind?: 'rewrite' | 'reorder' | 'skills-reorder' | 'skill-added';
  /** Where the line is in the base résumé, e.g. "work[0].highlights[2]". */
  sourcePath?: string | null;
  /** The suggestion failed the check and isn't in the résumé. */
  dropped?: boolean;
  /** Why it was dropped (the first blocking issue's message). */
  dropReason?: string;
  issues?: GroundingIssue[];
  /** Kept, but worth a look: a leadership verb, or a keyword the user added. */
  needsReview?: boolean;
  /** Confirmed keywords the line uses that the base résumé doesn't ("uses Kafka, which you added"). */
  confirmedTerms?: string[];
  /** Where the line is in the tailored résumé, after any reorder ("work[0].highlights[0]"). */
  targetPath?: string | null;
  /**
   * What the user chose in the review (#351): keep the suggestion, restore the base line, or
   * their own words (`userText`), which are theirs and not checked.
   */
  resolution?: 'kept' | 'restored' | 'edited';
  userText?: string;
}

/**
 * What a tailored résumé version was based on (#351): the base résumé version it was made
 * from, the posting, and the model. `grounding` is set only by the API's grounding check;
 * a version without it can't be downloaded.
 */
export interface ResumeVersionBasis {
  baseVersionId: string | null;
  baseUpdatedAt: string | null;
  jobId: string;
  /**
   * SHA-256 of the job's whole posting text when it was tailored, to tell when the posting
   * changed since. (The model is sent at most its first 20,000 characters.)
   */
  postingSha256: string;
  model: string;
  createdAt: string;
  grounding: { version: number };
  /** Keywords the user confirmed having in the tailor window. */
  confirmedKeywords?: string[];
  /** Posting requirements the base résumé doesn't support; shown, never put in the résumé. */
  gaps?: string[];
  /** Posting keywords (from the fit read) in the base résumé and the draft, and which were counted. */
  coverage?: { total: number; before: number; after: number; terms?: string[] };
  /**
   * When the base résumé's layout was copied onto the version for good (#415): on download, or
   * when its job was marked applied. Until then a draft prints with the base résumé's layout.
   */
  layoutFrozenAt?: string;
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
  /** Tailored versions only (#351). */
  basedOn?: ResumeVersionBasis | null;
  createdAt: string;
  updatedAt: string;
}

export type CoverLetterLength = 'concise' | 'full';

/** A paragraph of a cover letter: as the check kept it, or the user's own words (`edited`). */
export interface CoverLetterParagraph {
  text: string;
  edited: boolean;
}

/**
 * A sentence of the AI's letter the check dropped or marked (#416). `paragraph` is the kept
 * paragraph it is in, or null when it was dropped with the rest of its paragraph.
 */
export interface CoverLetterCheck {
  /** Stable within the letter ("c0", "c1"…): what a Keep or Remove names. */
  id: string;
  paragraph: number | null;
  text: string;
  dropped: boolean;
  /**
   * `drop`: left out of the letter. `flag`: kept in it, highlighted, and the PDF waits until the
   * user keeps or removes it. `note`: a confirmed keyword it uses, marked as the user's.
   */
  severity: 'drop' | 'flag' | 'note';
  /** A flag's outcome: kept, removed from its paragraph, or the paragraph was edited. */
  resolution?: 'kept' | 'removed' | 'edited';
  /** Why it was dropped (the first blocking issue's message). */
  dropReason?: string;
  issues: GroundingIssue[];
  /** Confirmed keywords the sentence uses ("uses Kafka, which you added"). */
  confirmedTerms?: string[];
}

/** What a cover letter was written from (#416), like a tailored résumé's basis. */
export interface CoverLetterBasis {
  baseVersionId: string | null;
  baseUpdatedAt: string | null;
  jobId: string;
  /** SHA-256 of the job's posting text when the letter was written. */
  postingSha256: string;
  model: string;
  createdAt: string;
  grounding: { version: number };
  confirmedKeywords: string[];
}

/** One cover letter per job and user (#416): its body only; the PDF adds the frame. */
export interface CoverLetterRecord {
  id: string;
  userId: string;
  jobId: string;
  length: CoverLetterLength;
  paragraphs: CoverLetterParagraph[];
  checks: CoverLetterCheck[];
  basedOn: CoverLetterBasis;
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
  /** True until the user has answered or confirmed this question. */
  needsReview: boolean;
  /** Alias of `needsReview`, kept while older clients still read it. */
  flagged?: boolean;
  /** One short line explaining where the answer came from, or why it is blank. */
  note?: string;
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
  /** Optional public links about the person. A contact the user knows needs none. */
  evidence?: Array<string | JobContactEvidenceItem>;
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



