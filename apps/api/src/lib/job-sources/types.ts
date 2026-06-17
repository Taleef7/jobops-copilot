import type { SourcedJob } from './normalize';

export interface JobSearchOptions {
  location?: string;
  remoteOnly?: boolean;
  limit?: number;
}

/** A pluggable external job source. `name` reflects the source actually used. */
export interface JobSource {
  readonly name: string;
  search(query: string, opts?: JobSearchOptions): Promise<SourcedJob[]>;
}
