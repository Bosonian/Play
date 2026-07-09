import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';

interface SprintSetupProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * Placeholder only — increment 3 replaces this with the real ≤3-tap flow
 * (topic → length → start ritual, RUNWAY_PRUFUNG_PLAN.md §4.2). It exists
 * now purely so ExamOverview's "Start a sprint" button has somewhere real
 * to navigate to and the Screen union type-checks; there is nothing to
 * build here yet.
 */
export function SprintSetup({ onNavigate }: SprintSetupProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Start a sprint" onBack={() => onNavigate({ name: 'exam' })} />
      </div>
      <p className="text-slate-400">Sprint flow arrives in the next increment.</p>
    </div>
  );
}
