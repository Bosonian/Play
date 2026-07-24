import { describe, expect, it } from 'vitest';
import { parseStepSourcesValue, serializeStepSourcesValue, stepSourceLabel } from './healthSettings';

// Only the pure functions in healthSettings.ts are tested here —
// readSelectedStepSources/writeSelectedStepSources touch Dexie directly and
// have no dedicated test, matching healthSync.ts's own precedent (its
// Dexie-touching syncMovement/syncWeighIns aren't tested either; see that
// file's header comment).

describe('parseStepSourcesValue / serializeStepSourcesValue round trip (issue #20)', () => {
  it('parses undefined (row absent) as "all sources" ([])', () => {
    expect(parseStepSourcesValue(undefined)).toEqual([]);
  });

  it('parses an empty string (row present but cleared) as "all sources" ([]) too', () => {
    // The load-bearing case: MOVEMENT_STEP_SOURCES_SETTING's own doc comment
    // says absent and empty-string must mean exactly the same thing — a
    // cleared selection is written as '', not by deleting the row.
    expect(parseStepSourcesValue('')).toEqual([]);
  });

  it('parses a single package name', () => {
    expect(parseStepSourcesValue('com.sec.android.app.shealth')).toEqual(['com.sec.android.app.shealth']);
  });

  it('parses multiple comma-separated package names', () => {
    expect(parseStepSourcesValue('com.sec.android.app.shealth,com.google.android.apps.fitness')).toEqual([
      'com.sec.android.app.shealth',
      'com.google.android.apps.fitness',
    ]);
  });

  it('serialises an empty selection back to an empty string, not a single comma or undefined', () => {
    expect(serializeStepSourcesValue([])).toBe('');
  });

  it('serialises a single source with no trailing comma', () => {
    expect(serializeStepSourcesValue(['com.sec.android.app.shealth'])).toBe('com.sec.android.app.shealth');
  });

  it('round-trips a multi-source selection through serialise then parse', () => {
    const sources = ['com.sec.android.app.shealth', 'com.google.android.apps.fitness'];
    expect(parseStepSourcesValue(serializeStepSourcesValue(sources))).toEqual(sources);
  });

  it('round-trips the empty selection through serialise then parse', () => {
    expect(parseStepSourcesValue(serializeStepSourcesValue([]))).toEqual([]);
  });

  // Review hardening (0.6.1). These guard the ONE outcome this feature must
  // never produce: a filter that is non-empty but matches no records, which
  // Health Connect answers with zero steps. An empty segment would become
  // DataOrigin("") natively — see parseStepSourcesValue's own comment.
  it('drops empty segments rather than yielding a filter that matches nothing', () => {
    expect(parseStepSourcesValue(',')).toEqual([]);
    expect(parseStepSourcesValue('com.sec.android.app.shealth,')).toEqual(['com.sec.android.app.shealth']);
  });

  it('trims surrounding whitespace from each package name', () => {
    expect(parseStepSourcesValue(' com.sec.android.app.shealth , com.google.android.apps.fitness ')).toEqual([
      'com.sec.android.app.shealth',
      'com.google.android.apps.fitness',
    ]);
  });

  it('de-duplicates repeated package names', () => {
    expect(parseStepSourcesValue('com.sec.android.app.shealth,com.sec.android.app.shealth')).toEqual([
      'com.sec.android.app.shealth',
    ]);
  });
});

describe('stepSourceLabel', () => {
  it('maps Samsung Health', () => {
    expect(stepSourceLabel('com.sec.android.app.shealth')).toBe('Samsung Health');
  });

  it('maps the Galaxy Watch companion package', () => {
    expect(stepSourceLabel('com.samsung.android.wear.shealth')).toBe('Galaxy Watch');
  });

  it('maps Google Fit', () => {
    expect(stepSourceLabel('com.google.android.apps.fitness')).toBe('Google Fit');
  });

  it('maps Health Connect\'s own app', () => {
    expect(stepSourceLabel('com.google.android.apps.healthdata')).toBe('Health Connect');
  });

  it('falls back to the raw package name for an unrecognised source (deliberate — see stepSourceLabel doc comment)', () => {
    expect(stepSourceLabel('com.some.unknown.app')).toBe('com.some.unknown.app');
  });
});
