export interface ExtensionSettings {
  apiUrl: string;
  pat: string;
}

export interface VerifyResponse {
  ok: boolean;
  userId?: string;
  token?: {
    id: string;
    label: string;
    createdAt: string;
    lastUsedAt?: string | null;
  };
  error?: string;
}

export interface MatchedJobRecord {
  id: string;
  userId: string;
  company: string;
  title: string;
  status: string;
  jobUrl?: string;
  notes?: string;
  nextAction?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApplicationPackQuestionAnswer {
  questionText: string;
  questionHash: string;
  answer: string;
  category: 'work_authorization' | 'salary' | 'why_us' | 'behavioral' | 'custom';
  source: 'qa_memory' | 'profile' | 'research' | 'generated';
  flagged: boolean;
}

export interface ApplicationPackPayload {
  jobId: string;
  company: string;
  title: string;
  resumeVersionId: string | null;
  resumeFileUrl: string | null;
  coverLetterId: string | null;
  coverLetterText: string | null;
  contactBlock: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
  };
  answers: ApplicationPackQuestionAnswer[];
  flaggedQuestions: string[];
  generatedAt: string;
}

export interface MatchResponse {
  matched: boolean;
  job: MatchedJobRecord | null;
  applicationPack: ApplicationPackPayload | null;
  recentJobs?: MatchedJobRecord[];
  error?: string;
}

export interface ProfileFillData {
  profile: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    location: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    linkedinUrl: string;
    githubUrl: string;
    portfolioUrl: string;
    websiteUrl: string;
    summary: string;
    currentTitle: string;
    currentCompany: string;
    workAuthorization: {
      authorizedInUS: boolean;
      requireSponsorship: boolean;
    };
  };
  workExperience: Array<{
    company: string;
    position: string;
    startDate?: string;
    endDate?: string;
    highlights?: string[];
  }>;
  education: Array<{
    institution: string;
    studyType?: string;
    area?: string;
    startDate?: string;
    endDate?: string;
  }>;
  skills: string[];
  answers: Record<string, string>;
  error?: string;
}

export interface ApplicationAnswerItem {
  id: string;
  questionHash: string;
  questionText: string;
  answer: string;
  ats?: string | null;
  createdAt: string;
}

export interface CaptureApplicationPayload {
  jobId?: string;
  jobUrl?: string;
  company?: string;
  title?: string;
  atsName?: string;
  confirmationUrl?: string;
  notes?: string;
}

export interface CaptureApplicationResponse {
  success: boolean;
  jobId: string;
  status: string;
  created: boolean;
  error?: string;
}

export type ExtensionMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: ExtensionSettings }
  | { type: 'VERIFY_TOKEN' }
  | { type: 'MATCH_URL'; url: string }
  | { type: 'GET_PROFILE_FILL' }
  | { type: 'CAPTURE_SUBMISSION'; payload: CaptureApplicationPayload };
