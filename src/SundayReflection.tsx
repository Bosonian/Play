import { useState } from 'react';
import { saveReflection, skipReflection } from './db/reflection';
import { PastReflections } from './PastReflections';

// Brief §5.4 / §9 step 7. The two-question weekly dialog. Renders as a full
// view (replacing Today) when reflectionDue is true in App.
//
// Question 1 phrasing is non-negotiable per the brief — observation-based,
// not a yes/no audit. Don't "improve" it back into a closed question.
//
// Save / Skip both close the dialog by causing the WeeklyReflections live
// query in App to update; the disappearance is the confirmation. No toast.
export function SundayReflection() {
  const [didYouPlay, setDidYouPlay] = useState('');
  const [nextWeekScene, setNextWeekScene] = useState('');
  const [viewingPast, setViewingPast] = useState(false);

  if (viewingPast) {
    return <PastReflections onBack={() => setViewingPast(false)} />;
  }

  return (
    <main className="min-h-dvh max-w-xl mx-auto px-6 py-12 text-neutral-700">
      <div className="flex flex-col gap-8">
        <h1 className="text-base font-medium text-neutral-800">Two questions.</h1>

        <div className="flex flex-col gap-2">
          <label htmlFor="reflection-q1" className="text-sm text-neutral-600">
            1. What did you notice playfully this week?
          </label>
          <textarea
            id="reflection-q1"
            value={didYouPlay}
            onChange={(e) => setDidYouPlay(e.target.value)}
            rows={3}
            className="w-full resize-none border-b border-neutral-200 bg-transparent px-1 py-2 text-base text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="reflection-q2" className="text-sm text-neutral-600">
            2. What&apos;s one scene you&apos;d be glad to live next week?
          </label>
          <textarea
            id="reflection-q2"
            value={nextWeekScene}
            onChange={(e) => setNextWeekScene(e.target.value)}
            rows={3}
            className="w-full resize-none border-b border-neutral-200 bg-transparent px-1 py-2 text-base text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="flex gap-6 text-sm text-neutral-600">
          <button
            type="button"
            onClick={() => saveReflection(didYouPlay, nextWeekScene)}
            className="hover:text-neutral-900"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => skipReflection()}
            className="hover:text-neutral-900"
          >
            Skip this week
          </button>
        </div>

        <button
          type="button"
          onClick={() => setViewingPast(true)}
          className="mt-4 self-start text-xs text-neutral-400 hover:text-neutral-600"
        >
          see past reflections
        </button>
      </div>
    </main>
  );
}
