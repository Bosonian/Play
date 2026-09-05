import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AppUpdateIdentity {
  schemaVersion: 1;
  packageName: string;
  versionCode: number;
  versionName: string;
  signerSha256: string;
}

interface AppUpdateIdentityNativePlugin {
  getIdentity(): Promise<unknown>;
}

const nativePlugin = registerPlugin<AppUpdateIdentityNativePlugin>('AppUpdateIdentity');

function isValidIdentity(value: unknown): value is AppUpdateIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppUpdateIdentity>;
  return candidate.schemaVersion === 1
    && typeof candidate.packageName === 'string'
    && candidate.packageName === 'app.dosing.companion'
    && typeof candidate.versionCode === 'number'
    && Number.isSafeInteger(candidate.versionCode)
    && candidate.versionCode > 0
    && candidate.versionCode <= 2_100_000_000
    && typeof candidate.versionName === 'string'
    && candidate.versionName.trim().length > 0
    && typeof candidate.signerSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(candidate.signerSha256);
}

export function isAndroidAppUpdateIdentityAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getAndroidAppIdentity(): Promise<AppUpdateIdentity | null> {
  if (!isAndroidAppUpdateIdentityAvailable()) return null;
  try {
    const identity = await nativePlugin.getIdentity();
    return isValidIdentity(identity) ? identity : null;
  } catch {
    return null;
  }
}
