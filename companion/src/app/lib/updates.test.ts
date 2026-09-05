import { describe, expect, it, vi } from 'vitest';
import type { AppUpdateIdentity } from './appUpdateIdentity';
import { checkForUpdate, parseCompanionUpdateManifest } from './updates';

const signer = 'a'.repeat(64);
const otherSigner = 'b'.repeat(64);
const checksum = 'c'.repeat(64);
const identity: AppUpdateIdentity = {
  schemaVersion: 1,
  packageName: 'app.dosing.companion',
  versionCode: 6,
  versionName: '0.16.0',
  signerSha256: signer,
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    signerSha256: signer,
    versionCode: 7,
    versionName: '0.17.0',
    assetName: 'companion-7.apk',
    apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-build-7/companion-7.apk',
    sha256: checksum,
    sizeBytes: 4_200_000,
    ...overrides,
  };
}

function body(releases: unknown[], manifestOverrides: Record<string, unknown> = {}) {
  const manifest = {
    schemaVersion: 1,
    packageName: 'app.dosing.companion',
    releases,
    ...manifestOverrides,
  };
  return `Release notes\n<!-- companion-update-manifest:v1\n${JSON.stringify(manifest)}\n-->\nMore notes`;
}

function fakeFetch(releaseBody: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, json: async () => releaseBody }) as unknown as typeof fetch;
}

describe('companion update manifest', () => {
  it('selects one newer release for the installed package and current signer', async () => {
    const result = await checkForUpdate(identity, fakeFetch({ body: body([
      entry({ signerSha256: otherSigner }),
      entry(),
    ]) }));
    expect(result).toEqual({
      versionName: '0.17.0',
      versionCode: 7,
      apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-build-7/companion-7.apk',
      sha256: checksum,
      sizeBytes: 4_200_000,
    });
  });

  it('does not depend on the mutable companion-latest release assets array', async () => {
    await expect(checkForUpdate(identity, fakeFetch({ body: body([entry()]), assets: [] })))
      .resolves.toMatchObject({ versionCode: 7 });
  });

  it('rejects equal and older version codes', async () => {
    await expect(checkForUpdate(identity, fakeFetch({ body: body([entry({
      versionCode: 6,
      versionName: '0.16.0',
      assetName: 'companion-6.apk',
      apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-build-6/companion-6.apk',
    })]) }))).resolves.toBeNull();
    await expect(checkForUpdate(identity, fakeFetch({ body: body([entry({
      versionCode: 5,
      assetName: 'companion-5.apk',
      apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-build-5/companion-5.apk',
    })]) }))).resolves.toBeNull();
  });

  it('rejects unknown and duplicate signer entries', async () => {
    await expect(checkForUpdate(identity, fakeFetch({ body: body([
      entry({ signerSha256: otherSigner }),
    ]) }))).resolves.toBeNull();
    await expect(checkForUpdate(identity, fakeFetch({ body: body([
      entry(), entry({ versionName: 'duplicate' }),
    ]) }))).resolves.toBeNull();
    expect(parseCompanionUpdateManifest(body([
      entry(),
      entry({ signerSha256: otherSigner }),
      entry({ signerSha256: otherSigner, versionName: 'duplicate other signer' }),
    ]))).toBeNull();
  });

  it('rejects package mismatch, malformed JSON and duplicate markers', async () => {
    expect(parseCompanionUpdateManifest(body([entry()], { packageName: 'example.attacker' }))).toBeNull();
    expect(parseCompanionUpdateManifest('<!-- companion-update-manifest:v1\n{bad}\n-->')).toBeNull();
    const marker = body([entry()]);
    expect(parseCompanionUpdateManifest(`${marker}\n${marker}`)).toBeNull();
  });

  it.each([
    ['non-integer code', { versionCode: 7.5 }],
    ['version code beyond Android maximum', { versionCode: 2_100_000_001 }],
    ['bad checksum', { sha256: 'not-a-checksum' }],
    ['unsafe filename', { assetName: '../companion.apk' }],
    ['query URL', { apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-build-7/companion-7.apk?x=1' }],
    ['wrong host', { apkUrl: 'https://example.com/Bosonian/Play/releases/download/companion-build-7/companion-7.apk' }],
    ['wrong immutable tag', { apkUrl: 'https://github.com/Bosonian/Play/releases/download/companion-latest/companion-7.apk' }],
    ['nonpositive size', { sizeBytes: 0 }],
  ])('rejects invalid manifest metadata: %s', async (_name, overrides) => {
    await expect(checkForUpdate(identity, fakeFetch({ body: body([entry(overrides)]) })))
      .resolves.toBeNull();
  });

  it('fails silently for HTTP, JSON and network failures', async () => {
    await expect(checkForUpdate(identity, fakeFetch({}, false))).resolves.toBeNull();
    await expect(checkForUpdate(identity, fakeFetch({ body: 'no manifest' }))).resolves.toBeNull();
    const failed = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    await expect(checkForUpdate(identity, failed)).resolves.toBeNull();
  });
});
