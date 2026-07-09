import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { formatExamAnchorLine } from '../lib/format';

interface ExamOverviewProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * Prüfung's home screen (RUNWAY_PRUFUNG_PLAN.md §4.1). This increment ships
 * only the placeholder named in the spec: name, anchor line, topic count
 * and total estimated hours, and the two edit links. The ready-date
 * centerpiece and weekly-requirement line — the actual point of the mode —
 * are increment 2's pace math; the closing line says so rather than
 * pretending they're coming with no timeline.
 *
 * Takes no `examId` prop and instead reads the single exam directly,
 * because v1 supports exactly one (db/types.ts's Exam doc comment) — a
 * prop here would just be a second place that "which exam" could get out
 * of sync with the one true answer db.exams holds.
 */
export function ExamOverview({ onNavigate }: ExamOverviewProps) {
  const exam = useLiveQuery(() => db.exams.toCollection().first(), []);
  const topics = useLiveQuery(
    async () => (exam ? db.topics.where('examId').equals(exam.id).toArray() : []),
    [exam],
  );

  // Reachable only from Home's Prüfung link, which already routes to
  // examSetup instead of here when no exam exists — so `exam` being
  // undefined at this point means the first Dexie read simply hasn't
  // resolved yet, not a real empty state to design copy for.
  if (!exam) return null;

  const totalEstimatedHours = topics?.reduce((sum, topic) => sum + topic.estimatedHours, 0) ?? 0;
  const topicCount = topics?.length ?? 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title={exam.name} onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <p className="text-slate-300">{formatExamAnchorLine(exam)}</p>

      <p className="text-sm tabular-nums text-slate-400">
        {topicCount} {topicCount === 1 ? 'topic' : 'topics'} &middot; {totalEstimatedHours}h estimated
      </p>

      <div className="flex flex-col items-start gap-1">
        <button
          onClick={() => onNavigate({ name: 'examSetup', examId: exam.id })}
          className="min-h-11 text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          Edit exam
        </button>
        <button
          onClick={() => onNavigate({ name: 'topicEdit', examId: exam.id })}
          className="min-h-11 text-sm font-medium text-sky-400 hover:text-sky-300"
        >
          Edit topics
        </button>
      </div>

      <p className="text-sm text-slate-500">Projection arrives in the next increment.</p>
    </div>
  );
}
