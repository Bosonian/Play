import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { PRUEFUNG_GUIDED_DONE_KEY, isGuidedPassActive } from '../lib/guidedPass';
import { refreshWidgets } from '../native/widgets';

interface ExamSetupProps {
  examId?: string;
  onNavigate: (screen: Screen) => void;
}

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

  // Populate once the existing exam (whichever path resolved it) has
  // loaded — same "runs once on load, not on every keystroke" pattern as
  // TemplateEdit's populate effect.
  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setWindowStart(existing.windowStart);
      setExamDate(existing.examDate ?? '');
    }
  }, [existing]);

  const nameValid = name.trim().length > 0;
  // <input type="date"> already yields an ISO YYYY-MM-DD string, so there's
  // no Date parsing needed to validate "is this a real date" — just
  // whether the browser gave us a non-empty value.
  const windowStartValid = windowStart.trim().length > 0;
  // ISO date strings compare correctly as plain strings (fixed-width
  // YYYY-MM-DD sorts lexicographically the same as chronologically), so
  // this doesn't need Date objects either.
  const examDateValid = examDate.trim() === '' || examDate >= windowStart;
  const canSave = nameValid && windowStartValid && examDateValid;

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

    let savedExamId: string;
    if (existing) {
      await db.exams.update(existing.id, {
        name: name.trim(),
        windowStart,
        examDate: examDateValue,
        updatedAt: now,
      });
      savedExamId = existing.id;
    } else {
      const id = crypto.randomUUID();
      await db.exams.add({
        id,
        name: name.trim(),
        windowStart,
        examDate: examDateValue,
        createdAt: now,
        updatedAt: now,
      });
      savedExamId = id;
    }

    // Widgets increment: the exam's anchor (windowStart/examDate) just
    // changed, which is exactly what the widget's "Ready by" colour band
    // and anchorLabel are computed from.
    await refreshWidgets();

    // Guided-layer increment (§2): while the walkthrough is still active,
    // Save chains straight into TopicEdit instead of the overview — "the
    // exam, then its topics, then a first sprint" (the guidance line
    // below), so the next screen the walkthrough shows is the one that
    // continues that chain, not a detour through the overview first.
    onNavigate(guidedPassActive ? { name: 'topicEdit', examId: savedExamId } : { name: 'exam' });
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
