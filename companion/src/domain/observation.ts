import type { MotorState } from './motor';
import type { RegimenItem } from './regimen';

export const OBSERVATION_PROTOCOL_VERSION = 1 as const;
export type ObservationDurationDays = 14 | 28;
export type ObservationStudyStatus = 'active' | 'completed' | 'cancelled';

export interface ObservationStudy {
  id: string;
  patient: string;
  protocolVersion: typeof OBSERVATION_PROTOCOL_VERSION;
  durationDays: ObservationDurationDays;
  startedAt: string;
  plannedEndAt: string;
  status: ObservationStudyStatus;
  regimenSnapshot: RegimenItem[];
  completedAt?: string;
  clinicalQuestion?: string;
  timeZone?: string;
}

export type AssessmentKind =
  | 'check-in'
  | 'finger-tapping'
  | 'rest-tremor'
  | 'postural-tremor'
  | 'gait-turn'
  | 'sit-to-stand'
  | 'voice';
export type AssessmentReason =
  | 'pre-dose'
  | 'expected-onset'
  | 'expected-wearing-off'
  | 'symptom-triggered'
  | 'scheduled-daily';

export interface AssessmentRecord {
  id: string;
  studyId: string;
  patient: string;
  protocolVersion: typeof OBSERVATION_PROTOCOL_VERSION;
  kind: AssessmentKind;
  reason: AssessmentReason;
  startedAt: string;
  completedAt?: string;
  linkedDoseEventId?: string;
  selfReportedState?: MotorState;
  // Optional for records created before the revised tapping protocol.
  sessionId?: string;
  outcome?: 'completed' | 'interrupted' | 'unable' | 'protocol-not-followed';
  measurementProtocolVersion?: number;
  metadata?: Record<string, number | string | boolean>;
  quality: 'pending' | 'valid' | 'invalid';
  qualityReasons: string[];
  featureSchemaVersion?: number;
  features?: Record<string, number | string | boolean | null>;
}

const DAY_MS = 86_400_000;

export function plannedEndAt(startedAt: string, durationDays: ObservationDurationDays): string {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw new Error('Invalid observation start time');
  return new Date(start.getTime() + durationDays * DAY_MS).toISOString();
}

export function buildObservationStudy(input: {
  id: string;
  patient: string;
  durationDays: ObservationDurationDays;
  startedAt: string;
  regimen: RegimenItem[];
  clinicalQuestion?: string;
  timeZone?: string;
}): ObservationStudy {
  return {
    id: input.id,
    patient: input.patient,
    protocolVersion: OBSERVATION_PROTOCOL_VERSION,
    durationDays: input.durationDays,
    startedAt: input.startedAt,
    plannedEndAt: plannedEndAt(input.startedAt, input.durationDays),
    status: 'active',
    clinicalQuestion: input.clinicalQuestion?.trim() || undefined,
    timeZone: input.timeZone,
    regimenSnapshot: input.regimen.map((item) => ({
      ...item,
      times: item.times.map((time) => ({ ...time })),
      ...(item.prn ? { prn: { ...item.prn } } : {}),
    })),
  };
}

export function observationProgress(study: ObservationStudy, now = new Date()) {
  const startMs = new Date(study.startedAt).getTime();
  const elapsedMs = Math.max(0, now.getTime() - startMs);
  const complete = now.getTime() >= new Date(study.plannedEndAt).getTime();
  return {
    dayNumber: Math.min(study.durationDays, Math.floor(elapsedMs / DAY_MS) + 1),
    durationDays: study.durationDays,
    percent: complete ? 100 : Math.round((elapsedMs / (study.durationDays * DAY_MS)) * 100),
    collectionComplete: complete,
  };
}
