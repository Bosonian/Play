import { describe, expect, it } from 'vitest';
import type { Departure, Setting } from '../db/types';
import { APP_VERSION } from './appVersion';
import { backupFilename, buildBackup, SECRET_SETTING_KEYS, validateBackup, type BackupTables } from './backup';

const EMPTY_TABLES: BackupTables = {
  departures: [],
  templates: [],
  settings: [],
  exams: [],
  topics: [],
  sprints: [],
  milestones: [],
  fieldReports: [],
  tasks: [],
};

const SOME_DEPARTURE: Departure = {
  id: 'dep-1',
  templateId: null,
  name: 'Klinik',
  destination: 'Katharinenhospital',
  appointmentAt: '2026-07-14T08:00:00.000Z',
  travelMinutes: 20,
  bufferMinutes: 10,
  steps: [],
  status: 'planned',
  startedAt: null,
  leftAt: null,
  arrivalResult: null,
  arrivalLateMinutes: null,
  createdAt: '2026-07-13T08:00:00.000Z',
  originalAppointmentAt: '2026-07-14T08:00:00.000Z',
  scheduledForDate: null,
  wasReplanned: false,
  arrivalSteps: [],
  arrivedAt: null,
  arrivalWifiSsid: null,
};

describe('buildBackup', () => {
  it('round-trips every table\'s rows unchanged', () => {
    const tables: BackupTables = { ...EMPTY_TABLES, departures: [SOME_DEPARTURE] };
    const backup = buildBackup(tables, 5, new Date('2026-07-13T12:00:00.000Z'));

    expect(backup.app).toBe('runway');
    expect(backup.schemaVersion).toBe(5);
    expect(backup.appVersion).toBe(APP_VERSION);
    expect(backup.exportedAt).toBe('2026-07-13T12:00:00.000Z');
    expect(backup.tables.departures).toEqual([SOME_DEPARTURE]);
    expect(backup.tables.templates).toEqual([]);
  });

  it('excludes every SECRET_SETTING_KEYS row from tables.settings', () => {
    const settings: Setting[] = [
      { key: 'routesApiKey', value: 'secret-routes' },
      { key: 'geminiApiKey', value: 'secret-gemini' },
      { key: 'feedbackToken', value: 'secret-token' },
      { key: 'dayGaugeEnabled', value: 'true' },
      { key: 'lastBackupAt', value: '2026-07-01T00:00:00.000Z' },
    ];
    const backup = buildBackup({ ...EMPTY_TABLES, settings }, 5, new Date());

    const keys = backup.tables.settings.map((s) => s.key);
    for (const secretKey of SECRET_SETTING_KEYS) {
      expect(keys).not.toContain(secretKey);
    }
    expect(keys).toEqual(['dayGaugeEnabled', 'lastBackupAt']);
  });
});

describe('validateBackup', () => {
  function validBackup(schemaVersion: number) {
    return buildBackup(EMPTY_TABLES, schemaVersion, new Date('2026-07-13T12:00:00.000Z'));
  }

  it('accepts a well-formed backup at the current schema version', () => {
    const result = validateBackup(validBackup(5), 5);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object payload (null)', () => {
    const result = validateBackup(null, 5);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Runway backup.' });
  });

  it('rejects a non-object payload (a bare array)', () => {
    const result = validateBackup([1, 2, 3], 5);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Runway backup.' });
  });

  it('rejects a payload whose app is not "runway"', () => {
    const result = validateBackup({ ...validBackup(5), app: 'something-else' }, 5);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Runway backup.' });
  });

  it('rejects a payload with no tables object', () => {
    const { tables: _tables, ...rest } = validBackup(5);
    const result = validateBackup(rest, 5);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Runway backup.' });
  });

  it('rejects a payload with no schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...rest } = validBackup(5);
    const result = validateBackup(rest, 5);
    expect(result).toEqual({ ok: false, reason: 'That file is not a Runway backup.' });
  });

  it('accepts a backup from an older schema version than the current one', () => {
    const result = validateBackup(validBackup(3), 5);
    expect(result.ok).toBe(true);
  });

  it('accepts a backup from exactly the current schema version', () => {
    const result = validateBackup(validBackup(5), 5);
    expect(result.ok).toBe(true);
  });

  it('rejects a backup from a newer schema version with the exact upgrade-first copy', () => {
    const result = validateBackup(validBackup(9), 5);
    expect(result).toEqual({
      ok: false,
      reason: 'This backup is from a newer Runway (schema v9). Update the app first, then import.',
    });
  });
});

describe('backupFilename', () => {
  it('formats as runway-backup-YYYY-MM-DD.json using the local calendar date', () => {
    expect(backupFilename(new Date('2026-07-13T10:00:00'))).toBe('runway-backup-2026-07-13.json');
  });
});
