import { Capacitor, registerPlugin } from '@capacitor/core';

export type MedicineOcrCheckState =
  | 'not-configured'
  | 'not-tested'
  | 'ok'
  | 'failed'
  | 'configuration-error';

export interface MedicineOcrStatus {
  schemaVersion: 1;
  configured: boolean;
  projectId: string | null;
  checkState: MedicineOcrCheckState;
  androidPackage: string;
  androidCertSha1: string;
}

export interface MedicineOcrPoint {
  x: number;
  y: number;
}

export interface MedicineOcrLine {
  text: string;
  polygon: [MedicineOcrPoint, MedicineOcrPoint, MedicineOcrPoint, MedicineOcrPoint];
}

export interface MedicineOcrResult {
  schemaVersion: 1;
  requestId: string;
  imageSha256: string;
  imageWidth: number;
  imageHeight: number;
  text: string;
  lines: MedicineOcrLine[];
}

export interface MedicineOcrConnectionResult {
  schemaVersion: 1;
  ok: true;
}

interface MedicineOcrNativePlugin {
  getStatus(): Promise<MedicineOcrStatus>;
  configureKey(options: { projectId: string }): Promise<MedicineOcrStatus>;
  removeKey(): Promise<MedicineOcrStatus>;
  testConnection(): Promise<MedicineOcrConnectionResult>;
  extractPhoto(options: {
    requestId: string;
    imageBase64: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  }): Promise<MedicineOcrResult>;
  cancelExtraction(options: { requestId: string }): Promise<{ requestId: string; cancelled: boolean }>;
}

const nativePlugin = registerPlugin<MedicineOcrNativePlugin>('MedicineOcr');

export function isMedicineOcrNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function requireAndroid(): MedicineOcrNativePlugin {
  if (!isMedicineOcrNativeAvailable()) {
    const error = new Error('Medicine OCR is available only in the Android app.');
    Object.assign(error, { code: 'UNAVAILABLE' });
    throw error;
  }
  return nativePlugin;
}

export const medicineOcrNative = {
  isAvailable: isMedicineOcrNativeAvailable,
  getStatus: () => requireAndroid().getStatus(),
  configureKey: (projectId: string) => requireAndroid().configureKey({ projectId }),
  removeKey: () => requireAndroid().removeKey(),
  testConnection: () => requireAndroid().testConnection(),
  extractPhoto: (options: Parameters<MedicineOcrNativePlugin['extractPhoto']>[0]) =>
    requireAndroid().extractPhoto(options),
  cancelExtraction: (requestId: string) => requireAndroid().cancelExtraction({ requestId }),
};
