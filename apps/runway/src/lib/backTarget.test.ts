import { describe, expect, it } from 'vitest';
import { backTarget } from './backTarget';
import type { Screen } from '../App';

// One assertion per Screen union member (App.tsx) — each mirrors that
// screen's own ScreenHeader onBack (or, for `report`, its own local
// backTarget), verified against the source in backTarget.ts's own doc
// comment. Kept as one test per screen, rather than a table-driven loop,
// so a future Screen addition that's missing here shows up as a clearly
// named failing (or, per the exhaustive switch, non-compiling) test rather
// than an opaque loop index.
describe('backTarget', () => {
  it('home has nowhere to go back to (root — minimize, not navigate)', () => {
    expect(backTarget({ name: 'home' })).toBeNull();
  });

  it('templateEdit backs to home', () => {
    expect(backTarget({ name: 'templateEdit' })).toEqual({ name: 'home' });
  });

  it('departureSetup backs to home', () => {
    expect(backTarget({ name: 'departureSetup' })).toEqual({ name: 'home' });
  });

  it('runway backs to home', () => {
    const screen: Screen = { name: 'runway', departureId: 'dep-1' };
    expect(backTarget(screen)).toEqual({ name: 'home' });
  });

  it('history backs to home', () => {
    expect(backTarget({ name: 'history' })).toEqual({ name: 'home' });
  });

  it('settings backs to home', () => {
    expect(backTarget({ name: 'settings' })).toEqual({ name: 'home' });
  });

  it('learning backs to history', () => {
    expect(backTarget({ name: 'learning' })).toEqual({ name: 'history' });
  });

  it('exam backs to home', () => {
    expect(backTarget({ name: 'exam' })).toEqual({ name: 'home' });
  });

  it('examSetup backs to exam when examId is set (edit path)', () => {
    const screen: Screen = { name: 'examSetup', examId: 'exam-1' };
    expect(backTarget(screen)).toEqual({ name: 'exam' });
  });

  it('examSetup backs to home when examId is omitted (create path)', () => {
    const screen: Screen = { name: 'examSetup' };
    expect(backTarget(screen)).toEqual({ name: 'home' });
  });

  it('topicEdit backs to exam', () => {
    const screen: Screen = { name: 'topicEdit', examId: 'exam-1' };
    expect(backTarget(screen)).toEqual({ name: 'exam' });
  });

  it('sprintSetup backs to exam', () => {
    const screen: Screen = { name: 'sprintSetup' };
    expect(backTarget(screen)).toEqual({ name: 'exam' });
  });

  it('sprint backs to exam', () => {
    const screen: Screen = { name: 'sprint', sprintId: 'sprint-1' };
    expect(backTarget(screen)).toEqual({ name: 'exam' });
  });

  it('milestoneEdit backs to exam', () => {
    const screen: Screen = { name: 'milestoneEdit', examId: 'exam-1' };
    expect(backTarget(screen)).toEqual({ name: 'exam' });
  });

  it('report backs to settings when opened from settings (mirrors ReportProblem.tsx)', () => {
    const screen: Screen = { name: 'report', fromScreen: 'settings' };
    expect(backTarget(screen)).toEqual({ name: 'settings' });
  });

  it('report backs to home when opened from anywhere else, including home', () => {
    expect(backTarget({ name: 'report', fromScreen: 'home' })).toEqual({ name: 'home' });
  });

  it('taskSetup backs to home', () => {
    expect(backTarget({ name: 'taskSetup' })).toEqual({ name: 'home' });
  });

  it('task backs to home', () => {
    const screen: Screen = { name: 'task', taskId: 'task-1' };
    expect(backTarget(screen)).toEqual({ name: 'home' });
  });

  it('activityLog backs to settings', () => {
    expect(backTarget({ name: 'activityLog' })).toEqual({ name: 'settings' });
  });
});
