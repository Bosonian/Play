import type { ISODateTime } from '../../domain/types';

// Types only, no logic — the field-report system itself is a Phase B build.
// This file exists in Phase A purely so store.ts's version(3) can declare
// the fieldReports table shape now (see store.ts's SPEC RISK A comment).
export type ReportStatus = 'pending' | 'synced' | 'failed';

export interface FieldReport {
  id: string;
  createdAt: ISODateTime;
  status: ReportStatus;
  description: string;
  screenshotBase64?: string;
  screenshotType?: string;
  metadata: { appVersion: string; screen: string; at: ISODateTime };
  attachedLog?: string;
  screenshotUrl?: string;
  issueUrl?: string;
  lastError?: string;
}

// Unused in Phase A — kept so Phase B needs no edit to this file.
export interface ReportDraft {
  description: string;
  screen: string;
  screenshotBase64?: string;
  screenshotType?: string;
  attachLog: boolean;
}
