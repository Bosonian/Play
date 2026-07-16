// vitest's environment for this project is 'node' (see store.test.ts's SPEC
// RISK #4 comment) — there is no browser, so no localStorage. passcode.ts's
// own test file gets away without stubbing it only because passcode.test.ts
// never calls loadPasscodeRecord/savePasscodeRecord; this file does, for
// every test, so it installs a minimal in-memory Storage implementation
// before anything else runs.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}
(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();

import { describe, it, expect, beforeEach } from 'vitest';
import { loadReportConfig, saveReportConfig, clearReportToken, type ReportConfig } from './reportConfig';

const STORAGE_KEY = 'companion.reportConfig.v1';

function fullConfig(overrides: Partial<ReportConfig> = {}): ReportConfig {
  return {
    version: 1,
    owner: 'bosonian',
    repo: 'Play',
    label: 'field-report',
    screenshotDir: 'field-reports',
    token: 'ghp_secret_token_value',
    repoIsPublic: false,
    verifiedAt: '2026-07-16T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('saveReportConfig / loadReportConfig', () => {
  it('round-trips a full config, including the token', () => {
    const config = fullConfig();
    saveReportConfig(config);
    expect(loadReportConfig()).toEqual(config);
  });

  it('returns null when nothing is stored yet', () => {
    expect(loadReportConfig()).toBeNull();
  });
});

describe('loadReportConfig — corrupt/wrong-shape input', () => {
  it('returns null for unparseable JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadReportConfig()).toBeNull();
  });

  it('returns null for well-formed JSON that does not match the ReportConfig shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner: 'bosonian' })); // missing every other field
    expect(loadReportConfig()).toBeNull();
  });
});

describe('clearReportToken', () => {
  it('blanks the token but keeps owner/repo/label/dir and the cached visibility fields', () => {
    saveReportConfig(fullConfig());
    clearReportToken();
    const after = loadReportConfig();
    expect(after?.token).toBe('');
    expect(after?.owner).toBe('bosonian');
    expect(after?.repo).toBe('Play');
    expect(after?.label).toBe('field-report');
    expect(after?.screenshotDir).toBe('field-reports');
    expect(after?.repoIsPublic).toBe(false);
    expect(after?.verifiedAt).toBe('2026-07-16T08:00:00.000Z');
  });

  it('is a no-op when no config is stored yet', () => {
    clearReportToken();
    expect(loadReportConfig()).toBeNull();
  });
});
