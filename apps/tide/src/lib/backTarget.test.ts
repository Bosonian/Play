import { describe, expect, it } from 'vitest';
import { backTarget } from './backTarget';
import type { Screen } from '../App';

// One assertion per Screen union member (App.tsx), mirroring
// apps/runway/src/lib/backTarget.test.ts's own shape — each case verified
// against that screen's own ScreenHeader onBack (or, for `reportProblem`,
// this function itself, which ReportProblem.tsx now imports directly — see
// backTarget.ts's own header comment). Kept as one test per screen, rather
// than a table-driven loop, so a future Screen addition that's missing here
// shows up as a clearly named failing (or, per the exhaustive switch,
// non-compiling) test rather than an opaque loop index.
describe('backTarget', () => {
  it('home has nowhere to go back to (root — minimize, not navigate)', () => {
    expect(backTarget({ name: 'home' })).toBeNull();
  });

  it('weighInEntry backs to home', () => {
    expect(backTarget({ name: 'weighInEntry' })).toEqual({ name: 'home' });
  });

  it('history backs to home', () => {
    expect(backTarget({ name: 'history' })).toEqual({ name: 'home' });
  });

  it('settings backs to home', () => {
    expect(backTarget({ name: 'settings' })).toEqual({ name: 'home' });
  });

  it('plateCheckIn backs to home', () => {
    expect(backTarget({ name: 'plateCheckIn' })).toEqual({ name: 'home' });
  });

  it('platesToday backs to home', () => {
    expect(backTarget({ name: 'platesToday' })).toEqual({ name: 'home' });
  });

  it('activityLog backs to settings', () => {
    expect(backTarget({ name: 'activityLog' })).toEqual({ name: 'settings' });
  });

  it('reportProblem backs to settings when opened from settings', () => {
    const screen: Screen = { name: 'reportProblem', fromScreen: 'settings' };
    expect(backTarget(screen)).toEqual({ name: 'settings' });
  });

  it('reportProblem backs to home when opened from anywhere else, including home', () => {
    expect(backTarget({ name: 'reportProblem', fromScreen: 'home' })).toEqual({ name: 'home' });
  });
});
