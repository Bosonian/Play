import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import type { Exam, StudySchedule } from '../db/types';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { RepeatEditor } from '../ui/RepeatEditor';
import { PRUEFUNG_GUIDED_DONE_KEY, isGuidedPassActive } from '../lib/guidedPass';
import { refreshWidgets } from '../native/widgets';
import { ensurePermissions, scheduleStudyBlockAlarms } from '../native/notifications';

interface ExamSetupProps {
  examId?: string;
  onNavigate: (screen: Screen) => void;
}

// Same three fixed lengths as SprintSetup's own SPRINT_LENGTHS — duplicated
// rather than imported, same "screen-local constant, not a lib/ dependency"
// reasoning nextMove.ts's own SPRINT_LENGTHS comment gives for its copy.
const STUDY_BLOCK_LENGTHS = [25, 50, 90] as const;
type StudyBlockMinutes = (typeof STUDY_BLOCK_LENGTHS)[number];

// An evening default, not TemplateEdit/DepartureSetup's morning-departure
// '08:00' — study blocks are a different kind of commitment (CLAUDE.md's own
// example is "Tuesday 19:00"), and a sensible starting point saves a tap
// even though every field here stays freely editable before save.
const DEFAULT_STUDY_TIME = '19:00';

/**
 * Create-or-edit for the single exam Prüfung mode is built around
 * (RUNWAY_PRUFUNG_PLAN.md §4.2). Mirrors TemplateEdit's create/edit split
 * (an `id`-shaped prop chooses the path) with one addition: when `examId`
 * is omitted, this screen doesn't assume "create" the way TemplateEdit
 * does for a new template. It looks for *any* existing exam first and
 * edits that instead. That's the enforcement of "v1 supports exactly one
 * exam" (db/types.ts's Exam doc comment) — Home's Prüfung link already
 * tries to route to the existing exam's overview when one exists, but a
 * stale link, a race on Home's own load, or a future caller that forgets
 * that rule would otherwise be able to create a second exam. Checking here
 * too means the one-exam rule holds regardless of how this screen is
 * reached.
 */
export function ExamSetup({ examId, onNavigate }: ExamSetupProps) {
  const explicitExam = useLiveQuery(() => (examId ? db.exams.get(examId) : undefined), [examId]);
  const anyExistingExam = useLiveQuery(
    () => (examId ? undefined : db.exams.toCollection().first()),
    [examId],
  );
  const existing = examId ? explicitExam : anyExistingExam;

  // Guided-layer increment (§2): the first-open walkthrough's guidance line
  // and its "save chains straight to TopicEdit" behaviour both key off this
  // one flag — see lib/guidedPass.ts for why `undefined` (still loading)
  // reads as "active" here rather than "hidden".
  const guidedSetting = useLiveQuery(() => db.settings.get(PRUEFUNG_GUIDED_DONE_KEY), []);
  const guidedPassActive = isGuidedPassActive(guidedSetting);

  const [name, setName] = useState('');
  // Left blank rather than defaulted to today: unlike a departure's
  // appointment date (usually today or tomorrow), an exam window is
  // months out, so there's no "obvious" default to save the user from
  // re-picking — same reasoning DepartureSetup gives for leaving
  // appointmentTime blank.
  const [windowStart, setWindowStart] = useState('');
  const [examDate, setExamDate] = useState('');
  const [touched, setTouched] = useState(false);

  // Study blocks (Prüfung rework 2). Kept as separate state pieces, same
  // pattern TemplateEdit's own repeatEnabled/repeatTime/repeatDays use, plus
  // the length this control adds on top of RepeatEditor's toggle/time/days.
  const [studyEnabled, setStudyEnabled] = useState(false);
  const [studyTime, setStudyTime] = useState(DEFAULT_STUDY_TIME);
  const [studyDays, setStudyDays] = useState<number[]>([]);
  const [studyMinutes, setStudyMinutes] = useState<StudyBlockMinutes | null>(null);

  // Populate once the existing exam (whichever path resolved it) has
  // loaded — same "runs once on load, not on every keystroke" pattern as
  // TemplateEdit's populate effect.
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setWindowStart(existing.windowStart);
      setExamDate(existing.examDate ?? '');
      // undefined-as-null: an exam saved before this field existed has no
      // `studySchedule` property at all (db/types.ts's own doc comment on
      // the field) — `?? null` treats that exactly like an exam that has
      // the field but has it explicitly off.
      const schedule = existing.studySchedule ?? null;
      setStudyEnabled(schedule != null);
      if (schedule) {
        setStudyTime(schedule.time);
        setStudyDays(schedule.days);
        setStudyMinutes(schedule.minutes);
      }
    }
  }, [existing]);

  function toggleStudyDay(iso: number) {
    setStudyDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  const nameValid = name.trim().length > 0;
  // <input type="date"> already yields an ISO YYYY-MM-DD string, so there's
  // no Date parsing needed to validate "is this a real date" — just
  // whether the browser gave us a non-empty value.
  const windowStartValid = windowStart.trim().length > 0;
  // ISO date strings compare correctly as plain strings (fixed-width
  // YYYY-MM-DD sorts lexicographically the same as chronologically), so
  // this doesn't need Date objects either.
  const examDateValid = examDate.trim() === '' || examDate >= windowStart;
  // Split in two: `studyTimeAndDaysValid` is exactly what RepeatEditor's own
  // `valid` prop needs (time + at least one day) — passing the length check
  // in there too would make RepeatEditor's built-in "Set a time and pick at
  // least one day." message fire for a missing LENGTH, which is the wrong
  // message for that condition. `studyValid` folds the length requirement
  // back in for `canSave`, where all three actually have to hold together.
  const studyTimeAndDaysValid = !studyEnabled || (studyTime !== '' && studyDays.length > 0);
  const studyValid = studyTimeAndDaysValid && (!studyEnabled || studyMinutes !== null);
  const canSave = nameValid && windowStartValid && examDateValid && studyValid;

  const errors: string[] = [];
  if (touched) {
    if (!nameValid) errors.push('Name is required.');
    if (!windowStartValid) errors.push('Set when the exam window opens.');
    if (windowStartValid && examDate.trim() !== '' && !examDateValid) {
      errors.push('Exam date cannot be before the window start.');
    }
  }

  async function handleSave() {
    setTouched(true);
    if (!canSave) return;

    const now = new Date().toISOString();
    const examDateValue = examDate.trim() === '' ? null : examDate;
    const studySchedule: StudySchedule | null =
      studyEnabled && studyMinutes !== null ? { time: studyTime, days: studyDays, minutes: studyMinutes } : null;

    let savedExam: Exam;
    if (existing) {
      const patch = {
        name: name.trim(),
        windowStart,
        examDate: examDateValue,
        studySchedule,
        updatedAt: now,
      };
      await db.exams.update(existing.id, patch);
      savedExam = { ...existing, ...patch };
    } else {
      savedExam = {
        id: crypto.randomUUID(),
        name: name.trim(),
        windowStart,
        examDate: examDateValue,
        studySchedule,
        createdAt: now,
        updatedAt: now,
      };
      await db.exams.add(savedExam);
    }

    // Widgets increment: the exam's anchor (windowStart/examDate) just
    // changed, which is exactly what the widget's "Ready by" colour band
    // and anchorLabel are computed from.
    await refreshWidgets();

    // Prüfung rework 2: lazy permission request on save — never at app
    // launch (CLAUDE.md: no permission ambush) — same shape as
    // DepartureSetup/SprintSetup's own save paths. A denied or failed
    // schedule still leaves the exam (and its studySchedule) saved: the
    // schedule itself is the real commitment, the alarm is a convenience on
    // top of it, and the next materializer pass (main.tsx, every app open)
    // retries once permission is eventually granted.
    try {
      const granted = await ensurePermissions();
      if (granted) await scheduleStudyBlockAlarms(savedExam);
    } catch (err) {
      console.warn('Runway: failed to schedule study block alarms', err);
    }

    // Guided-layer increment (§2): while the walkthrough is still active,
    // Save chains straight into TopicEdit instead of the overview — "the
    // exam, then its topics, then a first sprint" (the guidance line
    // below), so the next screen the walkthrough shows is the one that
    // continues that chain, not a detour through the overview first.
    onNavigate(guidedPassActive ? { name: 'topicEdit', examId: savedExam.id } : { name: 'exam' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader
          title={existing ? 'Edit exam' : 'New exam'}
          onBack={() => onNavigate(existing ? { name: 'exam' } : { name: 'home' })}
        />
      </div>

      {/* Guided-layer increment (§2): only for the actual create path — an
          exam already exists once `existing` is set, so this is a re-edit,
          not the first-open walkthrough, even if the flag hasn't been set
          yet for some other reason. */}
      {!existing && guidedPassActive && (
        <p className="text-sm text-slate-500">
          Two minutes of setup: the exam, then its topics, then a first sprint.
        </p>
      )}

      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Facharztprüfung Neurologie"
        enterKeyHint="next"
      />

      <TextField
        label="Exam window opens"
        type="date"
        value={windowStart}
        onChange={(e) => setWindowStart(e.target.value)}
      />

      <TextField
        label="Exact exam date"
        type="date"
        value={examDate}
        onChange={(e) => setExamDate(e.target.value)}
        hint="Set when the date is announced. Until then the window start anchors the projection."
      />

      {/* Study blocks (Prüfung rework 2): the structural fix this rework
          exists for. A departure works because it's ARMED — scheduled,
          alarmed, materialized a week ahead; study time had none of that
          and relied on a spontaneous decision, which is exactly the
          decision ADHD declines to make. This section gives study time the
          same legitimacy a departure's appointment already has — Deepak
          choosing "Tuesday 19:00" here is a real, chosen commitment, the
          same as choosing a departure's appointment time, not a softer
          suggestion the app invented on his behalf. */}
      <RepeatEditor
        enabled={studyEnabled}
        onEnabledChange={setStudyEnabled}
        time={studyTime}
        onTimeChange={setStudyTime}
        days={studyDays}
        onToggleDay={toggleStudyDay}
        valid={studyTimeAndDaysValid}
        label="Study blocks"
        footerCaption="Scheduled sprints with real alarms. Planned 7 days ahead — open Runway at least once a week to keep them armed."
      />

      {studyEnabled && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Length</h2>
          <div className="flex gap-3">
            {STUDY_BLOCK_LENGTHS.map((minutes) => {
              const selected = studyMinutes === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setStudyMinutes(minutes)}
                  className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border py-4 text-2xl font-bold tabular-nums transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-500 text-slate-950'
                      : 'border-slate-800/60 bg-surface text-slate-100 hover:border-slate-700'
                  }`}
                >
                  {minutes}
                  <span className={`text-xs font-normal ${selected ? 'text-slate-900' : 'text-slate-500'}`}>min</span>
                </button>
              );
            })}
          </div>
          {studyMinutes === null && <p className="text-sm text-red-400">Pick a sprint length.</p>}
        </section>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-red-400">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <Button onClick={() => void handleSave()}>Save exam</Button>
    </div>
  );
}
