// The feedback moment — the single most important UX detail in a learning game
// (design doc §8.4). One grammar across every mode: a three-channel signal
// (glyph + colour + text; never colour alone), then the four-part "why" —
// restate their answer, give the correct one, the mechanism, and a cross-link
// to the same fact seen through another mode.

type Props = {
  correct: boolean;
  chosenLabel?: string; // what the user picked (omit if not applicable)
  correctLabel: string; // the right answer, always surfaced
  explanation: string; // the mechanism — why the right answer is right
  whyWrong?: string; // why their specific wrong choice fails
  crossLink?: string; // the same fact through another lens
};

export function Feedback({
  correct,
  chosenLabel,
  correctLabel,
  explanation,
  whyWrong,
  crossLink,
}: Props) {
  return (
    <div
      className={`rounded-md border p-4 ${
        correct
          ? 'border-correct/40 bg-correct/10'
          : 'border-incorrect/40 bg-incorrect/10'
      }`}
    >
      {/* Channel 1+2+3: glyph, colour, word. */}
      <p
        className={`flex items-center gap-2 text-body-lg font-semibold ${
          correct ? 'text-correct' : 'text-incorrect'
        }`}
      >
        <span aria-hidden>{correct ? '✓' : '✗'}</span>
        {correct ? 'Correct.' : 'Not quite.'}
      </p>

      {/* Restate their answer + the correct one (surfaced even when right). */}
      {!correct && chosenLabel && (
        <p className="mt-2 text-body text-fg">
          <span className="text-fg-muted">You chose: </span>
          {chosenLabel}
        </p>
      )}
      <p className="mt-1 text-body text-fg">
        <span className="text-fg-muted">
          {correct ? 'Answer: ' : 'Correct: '}
        </span>
        {correctLabel}
      </p>

      {/* Why their choice was wrong, when we know. */}
      {!correct && whyWrong && (
        <p className="mt-2 text-body text-fg-muted">{whyWrong}</p>
      )}

      {/* The mechanism. */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
          Why
        </p>
        <p className="mt-1 text-body text-fg">{explanation}</p>
      </div>

      {/* The same fact through another lens. */}
      {crossLink && (
        <p className="mt-3 text-caption text-fg-muted">
          See also: <span className="text-accent">{crossLink}</span>
        </p>
      )}
    </div>
  );
}
