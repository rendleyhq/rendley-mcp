export enum JobStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export type JobKind = "agent" | "export";

export interface Job {
  job_id: string;
  kind: JobKind;
  project_id: string;
  owner_key_id: string;
  status: JobStatus;
  last_message?: string;
  result?: unknown;
  error?: string;
  created_at: number;
  updated_at: number;
}

export interface CreateJobInput {
  kind: JobKind;
  project_id: string;
  owner_key_id: string;
}

export interface JobStore {
  create(input: CreateJobInput): Promise<Job>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: Partial<Job>): Promise<Job | null>;
}
