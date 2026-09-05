import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { ObservationReminderPlanV1 } from '../../domain/observationReminders';

export type ObservationReminderPermission =
  | 'granted'
  | 'not-requested'
  | 'denied'
  | 'settings';

export interface ObservationReminderNativeStatus {
  schemaVersion: 1;
  permission: ObservationReminderPermission;
  configured: boolean;
  studyId: string | null;
  revision: number | null;
  nextScheduledAt: string | null;
}

export interface PendingObservationReminderOpen {
  occurrenceId: string;
  studyId: string;
  revision: number;
  scheduledAt: string;
  deliveredAt: string;
  openedAt: string;
}

export interface ObservationReminderOpenEvent {
  schemaVersion: 1;
}

export interface ReplaceObservationReminderPlanOptions {
  studyId: string;
  revision: number;
  startedAt: string;
  plannedEndAt: string;
  plan: ObservationReminderPlanV1;
}

interface ObservationRemindersNativePlugin {
  getStatus(): Promise<ObservationReminderNativeStatus>;
  requestPermission(): Promise<ObservationReminderNativeStatus>;
  replacePlan(options: ReplaceObservationReminderPlanOptions): Promise<ObservationReminderNativeStatus>;
  cancelStudy(options: { studyId: string }): Promise<ObservationReminderNativeStatus>;
  getPendingOpen(): Promise<{ schemaVersion: 1; pending: PendingObservationReminderOpen | null }>;
  acknowledgeOpen(options: { occurrenceId: string }): Promise<{ schemaVersion: 1; acknowledged: boolean }>;
  addListener(
    eventName: 'reminderOpen',
    listener: (event: ObservationReminderOpenEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const nativePlugin = registerPlugin<ObservationRemindersNativePlugin>('ObservationReminders');

export function isObservationRemindersNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function requireAndroid(): ObservationRemindersNativePlugin {
  if (!isObservationRemindersNativeAvailable()) {
    const error = new Error('Observation reminders are available only in the Android app.');
    Object.assign(error, { code: 'UNAVAILABLE' });
    throw error;
  }
  return nativePlugin;
}

export const observationRemindersNative = {
  isAvailable: isObservationRemindersNativeAvailable,
  getStatus: () => requireAndroid().getStatus(),
  requestPermission: () => requireAndroid().requestPermission(),
  replacePlan: (options: ReplaceObservationReminderPlanOptions) => requireAndroid().replacePlan(options),
  cancelStudy: (studyId: string) => requireAndroid().cancelStudy({ studyId }),
  getPendingOpen: () => requireAndroid().getPendingOpen(),
  acknowledgeOpen: (occurrenceId: string) => requireAndroid().acknowledgeOpen({ occurrenceId }),
  onReminderOpen: (listener: (event: ObservationReminderOpenEvent) => void) =>
    requireAndroid().addListener('reminderOpen', listener),
};
