// Drill — the quiz + spaced-repetition play loop (design doc §6, §8.3.3). Takes
// a ready-made list of questions (built by the caller: a region's scope, or the
// day's due queue) and runs them one card at a time. After the reveal, a
// correct answer is self-graded Again/Hard/Good (feeds SM-2); a wrong answer
// continues (auto-graded Again). Every answer is recorded to SRS + mastery +
// the attempt log.

import { useEffect, useState } from 'react';
import type { Question } from '../engine/questionGen';
import { recordStudy } from '../engine/study';
import type { Grade } from '../engine/srs';
import { Feedback } from '../ui/Feedback';

type Phase = 'answering' | 'revealed';

export function Drill({
  questions,
  title,
  onExit,
}: {
  questions: Question[];
  title: string;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('answering');
  const [chosen, setChosen] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  const q = questions[idx];
  const done = idx >= questions.length;

  function choose(i: number) {
    if (phase !== 'answering') return;
    setChosen(i);
    setPhase('revealed');
    if (questions[idx].choices[i].correct) setCorrectCount((c) => c + 1);
  }

  async function finish(grade: Grade) {
    const question = questions[idx];
    const wasCorrect = chosen !== null && question.choices[chosen].correct;
    await recordStudy({
      factId: question.factId,
      masteryKey: question.masteryKey,
      rung: question.rung,
      mode: 'drill',
      correct: wasCorrect,
      grade,
    });
    setChosen(null);
    setPhase('answering');
    setIdx((i) => i + 1);
  }

  // Keyboard (Mac): 1..n pick an option while answering; Enter continues after
  // a wrong reveal (correct reveals wait for a self-grade).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return;
      if (phase === 'answering') {
        const n = Number(e.key);
        if (n >= 1 && n <= q.choices.length) choose(n - 1);
      } else if (e.key === 'Enter') {
        const wasCorrect = chosen !== null && q.choices[chosen].correct;
        if (!wasCorrect) void finish('again');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, chosen, done]);

  if (done) {
    return (
      <div className="flex h-full flex-col px-4 pt-3">
        <ModeBar title={title} onExit={onExit} progress={null} />
        <div className="mt-10">
          <p className="text-display font-semibold text-fg">Round complete.</p>
          <p className="mt-2 text-body text-fg-muted">
            {correctCount} of {questions.length} correct. Anything you missed
            will come back in review.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="mt-8 rounded-md bg-accent px-5 py-3 text-body font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const wasCorrect = chosen !== null && q.choices[chosen].correct;

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <ModeBar
        title={title}
        onExit={onExit}
        progress={`${idx + 1} / ${questions.length}`}
      />

      <div className="mt-4 flex-1 overflow-y-auto pb-4">
        <p className="text-body-lg font-medium text-fg">{q.stem}</p>

        <ul className="mt-4 space-y-2">
          {q.choices.map((c, i) => {
            const isChosen = chosen === i;
            const reveal = phase === 'revealed';
            // After reveal: mark the correct option, and the chosen-wrong one.
            let cls = 'border-line bg-surface text-fg';
            if (reveal && c.correct) cls = 'border-correct bg-correct/10 text-fg';
            else if (reveal && isChosen && !c.correct)
              cls = 'border-incorrect bg-incorrect/10 text-fg';
            else if (reveal) cls = 'border-line bg-surface text-fg-muted';
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={reveal}
                  onClick={() => choose(i)}
                  className={`flex w-full items-start gap-2 rounded-md border px-4 py-3 text-left text-body ${cls}`}
                >
                  <span className="mt-0.5 text-caption tabular-nums text-fg-faint">
                    {i + 1}
                  </span>
                  <span className="flex-1">{c.label}</span>
                  {reveal && c.correct && (
                    <span className="text-correct" aria-hidden>
                      ✓
                    </span>
                  )}
                  {reveal && isChosen && !c.correct && (
                    <span className="text-incorrect" aria-hidden>
                      ✗
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {phase === 'revealed' && chosen !== null && (
          <div className="mt-4">
            <Feedback
              correct={wasCorrect}
              chosenLabel={q.choices[chosen].label}
              correctLabel={q.choices.find((c) => c.correct)!.label}
              explanation={q.explanation}
              whyWrong={q.choices[chosen].whyWrong}
              crossLink={q.crossLink}
            />
          </div>
        )}
      </div>

      {/* Reach-zone actions: self-grade after a correct reveal; continue after
          a wrong one. */}
      {phase === 'revealed' && (
        <div className="flex-none border-t border-line pt-3 pb-safe-bottom">
          {wasCorrect ? (
            <div className="flex gap-2">
              {(['again', 'hard', 'good'] as Grade[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => finish(g)}
                  className="flex-1 rounded-md border border-line bg-surface py-3 text-label font-medium capitalize text-fg"
                >
                  {g}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => finish('again')}
              className="w-full rounded-md bg-accent py-3 text-body font-medium text-white"
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Shared thin top bar for a mode: close + title + progress. No bottom nav
// inside a mode (focus), per §8.3.
function ModeBar({
  title,
  onExit,
  progress,
}: {
  title: string;
  onExit: () => void;
  progress: string | null;
}) {
  return (
    <div className="flex flex-none items-center justify-between">
      <button
        type="button"
        onClick={onExit}
        aria-label="Close"
        className="-ml-1 p-1 text-fg-muted"
      >
        ✕
      </button>
      <span className="text-label font-medium text-fg-muted">{title}</span>
      <span className="w-10 text-right text-caption tabular-nums text-fg-faint">
        {progress ?? ''}
      </span>
    </div>
  );
}
