import { Capacitor, registerPlugin } from '@capacitor/core';

interface TapFeedbackNativePlugin {
  beginSession(options: { sessionToken: string }): Promise<unknown>;
  performTap(options: { sessionToken: string; requestedAtEpochMs: number }): Promise<unknown>;
  endSession(options: { sessionToken: string }): Promise<unknown>;
}

const nativePlugin = registerPlugin<TapFeedbackNativePlugin>('TapFeedback');

export function isTapFeedbackNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function quietly(action: () => Promise<unknown>): void {
  if (!isTapFeedbackNativeAvailable()) return;
  try { void action().catch(() => undefined); } catch { /* Visual feedback remains available. */ }
}

export const tapFeedbackNative = {
  isAvailable: isTapFeedbackNativeAvailable,
  beginSession: (sessionToken: string) => quietly(() => nativePlugin.beginSession({ sessionToken })),
  performTap: (sessionToken: string, requestedAtEpochMs: number) =>
    quietly(() => nativePlugin.performTap({ sessionToken, requestedAtEpochMs })),
  endSession: (sessionToken: string) => quietly(() => nativePlugin.endSession({ sessionToken })),
};
