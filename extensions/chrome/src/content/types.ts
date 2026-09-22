import type { ApplicationPackPayload, ProfileFillData } from '../types';

export interface AutofillContext {
  document: Document;
  url: string;
  profileData: ProfileFillData;
  applicationPack?: ApplicationPackPayload | null;
}

export interface AutofillResult {
  atsName: 'greenhouse' | 'lever' | 'ashby' | 'workday';
  filledFields: string[];
  skippedFields: string[];
  flaggedFields: string[];
}

export interface SubmissionDetails {
  atsName: 'greenhouse' | 'lever' | 'ashby' | 'workday';
  confirmationUrl?: string;
  notes?: string;
}

export interface AtsAdapter {
  readonly name: 'greenhouse' | 'lever' | 'ashby' | 'workday';
  matches(url: string, document: Document): boolean;
  autofill(context: AutofillContext): AutofillResult;
  detectSubmission(url: string, document: Document): SubmissionDetails | null;
}
