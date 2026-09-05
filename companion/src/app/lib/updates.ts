import type { AppUpdateIdentity } from './appUpdateIdentity';

// This request contains no patient data. Every response field is treated as
// untrusted and failures remain silent so update discovery cannot interrupt
// the patient workflow.
export interface UpdateInfo {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface CompanionUpdateManifestRelease extends UpdateInfo {
  signerSha256: string;
  assetName: string;
}

export interface CompanionUpdateManifestV1 {
  schemaVersion: 1;
  packageName: 'app.dosing.companion';
  releases: CompanionUpdateManifestRelease[];
}

export const RELEASE_API_URL =
  'https://api.github.com/repos/Bosonian/Play/releases/tags/companion-latest';

const MANIFEST_OPEN = '<!-- companion-update-manifest:v1\n';
const MANIFEST_CLOSE = '\n-->';
const PACKAGE_NAME = 'app.dosing.companion';
const MAX_RELEASES = 16;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validAssetName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(value)
    && !value.includes('..');
}

function validApkUrl(value: unknown, versionCode: number, assetName: string): value is string {
  if (typeof value !== 'string') return false;
  const expected = `https://github.com/Bosonian/Play/releases/download/companion-build-${versionCode}/${assetName}`;
  if (value !== expected) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'github.com'
      && parsed.port === ''
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function parseRelease(value: unknown): CompanionUpdateManifestRelease | null {
  const item = record(value);
  const keys = ['signerSha256', 'versionCode', 'versionName', 'assetName', 'apkUrl', 'sha256', 'sizeBytes'];
  if (!item || !hasExactKeys(item, keys)) return null;
  if (typeof item.signerSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.signerSha256)) return null;
  if (typeof item.versionCode !== 'number' || !Number.isSafeInteger(item.versionCode)
    || item.versionCode < 1 || item.versionCode > MAX_ANDROID_VERSION_CODE) return null;
  if (typeof item.versionName !== 'string' || item.versionName.trim().length === 0 || item.versionName.length > 100) return null;
  if (!validAssetName(item.assetName)) return null;
  if (!validApkUrl(item.apkUrl, item.versionCode, item.assetName)) return null;
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return null;
  if (typeof item.sizeBytes !== 'number' || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1) return null;
  return item as unknown as CompanionUpdateManifestRelease;
}

export function parseCompanionUpdateManifest(body: string): CompanionUpdateManifestV1 | null {
  const start = body.indexOf(MANIFEST_OPEN);
  if (start < 0 || body.indexOf(MANIFEST_OPEN, start + MANIFEST_OPEN.length) >= 0) return null;
  const payloadStart = start + MANIFEST_OPEN.length;
  const end = body.indexOf(MANIFEST_CLOSE, payloadStart);
  if (end < 0) return null;
  try {
    const parsed = record(JSON.parse(body.slice(payloadStart, end)));
    if (!parsed || !hasExactKeys(parsed, ['schemaVersion', 'packageName', 'releases'])) return null;
    if (parsed.schemaVersion !== 1 || parsed.packageName !== PACKAGE_NAME
      || !Array.isArray(parsed.releases) || parsed.releases.length < 1
      || parsed.releases.length > MAX_RELEASES) return null;
    const releases = parsed.releases.map(parseRelease);
    if (releases.some((release) => release === null)) return null;
    const signerIds = releases.map((release) => release!.signerSha256);
    if (new Set(signerIds).size !== signerIds.length) return null;
    return {
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      releases: releases as CompanionUpdateManifestRelease[],
    };
  } catch {
    return null;
  }
}

export async function checkForUpdate(
  identity: AppUpdateIdentity,
  fetchFn: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  if (identity.packageName !== PACKAGE_NAME || identity.schemaVersion !== 1
    || !Number.isSafeInteger(identity.versionCode) || identity.versionCode < 1
    || identity.versionCode > MAX_ANDROID_VERSION_CODE
    || !/^[a-f0-9]{64}$/.test(identity.signerSha256)) return null;
  try {
    const response = await fetchFn(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) return null;
    const release = record(await response.json());
    if (!release || typeof release.body !== 'string') return null;
    const manifest = parseCompanionUpdateManifest(release.body);
    if (!manifest || manifest.packageName !== identity.packageName) return null;
    const matches = manifest.releases.filter((entry) => entry.signerSha256 === identity.signerSha256);
    if (matches.length !== 1 || matches[0].versionCode <= identity.versionCode) return null;
    const match = matches[0];
    // sha256 and sizeBytes describe the immutable release asset. The browser
    // download/install handoff does not verify the downloaded bytes here.
    return {
      versionName: match.versionName,
      versionCode: match.versionCode,
      apkUrl: match.apkUrl,
      sha256: match.sha256,
      sizeBytes: match.sizeBytes,
    };
  } catch {
    return null;
  }
}
