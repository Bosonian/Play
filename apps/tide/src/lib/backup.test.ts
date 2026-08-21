import { describe, expect, it } from 'vitest';
import type { Setting, WeighIn } from '../db/types';
import { APP_VERSION } from './appVersion';
import { backupFilename, buildBackup, SECRET_SETTING_KEYS, validateBackup, type BackupTables } from './backup';

const EMPTY_TABLES: BackupTables = {
  weighIns: [],
  meals: [],
  movement: [],
  settings: [],
  events: [],
};

const SOME_WEIGH_IN: WeighIn = {
  id: 'w-1',
  at: '2026-07-14T08:00:00.000Z',
  weightKg: 98.4,
  bodyFatPct: 27.1,
  source: 'manual',
};

describe('buildBackup', () => {
  it("round-trips every table's rows unchanged", () => {
    const tables: BackupTables = { ...EMPTY_TABLES, weighIns: [SOME_WEIGH_IN] };
    const backup = buildBackup(tables, 3, new Date('2026-07-13T12:00:00.000Z'));

    expect(backup.app).toBe('tide');
    expect(backup.schemaVersion).toBe(3);
    expect(backup.appVersion).toBe(APP_VERSION);
    expect(backup.exportedAt).toBe('2026-07-13T12:00:00.000Z');
    expect(backup.tables.weighIns).toEqual([SOME_WEIGH_IN]);
    expect(backup.tables.meals).toEqual([]);
  });

  it('excludes every SECRET_SETTING_KEYS row from tables.settings', () => {
    const settings: Setting[] = [
      { key: 'feedbackToken', value: 'secret-token' },
      { key: 'healthConnectEnabled', value: 'true' },
      { key: 'lastBackupAt', value: '2026-07-01T00:00:00.000Z' },
    ];
    const backup = buildBackup({ ...EMPTY_TABLES, settings }, 3, new Date());

    const keys = backup.tables.settings.map((s) => s.key);
    for (const secretKey of SECRET_SETTING_KEYS) {
      expect(keys).not.toContain(secretKey);
    }
    expect(keys).toEqual(['healthConnectEnabled', 'lastBackupAt']);
  });
});

describe('validateBackup', () => {
  function validBackup(schemaVersion: number) {
    return buildBackup(EMPTY_TABLES, schemaVersion, new Date('2026-07-13T12:00:00.000Z'));
  }

  it('accepts a well-formed backup at the current schema version', () => {
    const result = validateBackup(validBackup(3), 3);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object payload (null)', () => {
    const result = validateBackup(null, 3);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Tide backup.' });
  });

  it('rejects a non-object payload (a bare array)', () => {
    const result = validateBackup([1, 2, 3], 3);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Tide backup.' });
  });

  it('rejects a payload whose app is not "tide"', () => {
    const result = validateBackup({ ...validBackup(3), app: 'something-else' }, 3);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Tide backup.' });
  });

  it('rejects a payload with no tables object', () => {
    const { tables: _tables, ...rest } = validBackup(3);
    const result = validateBackup(rest, 3);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Tide backup.' });
  });

  it('rejects a payload with no schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...rest } = validBackup(3);
    const result = validateBackup(rest, 3);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Tide backup.' });
  });

  it('accepts a backup from an older schema version than the current one', () => {
    const result = validateBackup(validBackup(1), 3);
    expect(result.ok).toBe(true);
  });

  it('accepts a backup from exactly the current schema version', () => {
    const result = validateBackup(validBackup(3), 3);
    expect(result.ok).toBe(true);
  });

  it('rejects a backup from a newer schema version with the exact upgrade-first copy', () => {
    const result = validateBackup(validBackup(9), 3);
    expect(result).toEqual({
      ok: false,
      reason: 'This backup is from a newer Tide (schema v9). Update the app first, then import.',
    });
  });
});

describe('backupFilename', () => {
  it('formats as tide-backup-YYYY-MM-DD.json using the local calendar date', () => {
    expect(backupFilename(new Date('2026-07-13T10:00:00'))).toBe('tide-backup-2026-07-13.json');
  });
});
