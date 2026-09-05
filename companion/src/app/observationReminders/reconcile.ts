import type { ObservationStudy } from '../../domain/observation';
import type { CompanionDatabase } from '../db/store';
import { getActiveObservationStudy } from '../db/store';
import { observationRemindersNative, type ObservationReminderNativeStatus } from './native';

export async function syncObservationReminderStudy(study: ObservationStudy): Promise<ObservationReminderNativeStatus | null> {
  if (!observationRemindersNative.isAvailable()) return null;
  const status = await observationRemindersNative.getStatus();
  const started = Date.parse(study.startedAt);
  const ended = Date.parse(study.plannedEndAt);
  const now = Date.now();
  const canSchedule = study.status === 'active' && Number.isFinite(started) && Number.isFinite(ended)
    && now >= started && now < ended && study.reminderPlan?.enabled;
  if (canSchedule && study.reminderPlan) {
    if (status.permission !== 'granted') return status;
    if (status.configured && status.studyId === study.id && status.revision === study.reminderPlan.revision) return status;
    return observationRemindersNative.replacePlan({
      studyId: study.id,
      revision: study.reminderPlan.revision,
      startedAt: study.startedAt,
      plannedEndAt: study.plannedEndAt,
      plan: study.reminderPlan,
    });
  }
  if (status.configured && status.studyId) return observationRemindersNative.cancelStudy(status.studyId);
  return status;
}

export async function reconcileObservationRemindersForPatient(database: CompanionDatabase, patient: string): Promise<void> {
  if (!observationRemindersNative.isAvailable()) return;
  const active = await getActiveObservationStudy(database, patient);
  if (active) { await syncObservationReminderStudy(active); return; }
  const status = await observationRemindersNative.getStatus();
  if (status.configured && status.studyId) await observationRemindersNative.cancelStudy(status.studyId);
}
