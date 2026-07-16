import type { PatientEvent } from '../../../domain/types';
import { eventLabel, formatTimeHM, shiftEventTime } from '../../patient/log';

interface EventDetailProps {
  event: PatientEvent;
  onChangeTime: (delta: number) => void;
  onDelete: () => void;
  onBack: () => void;
}

export function EventDetail({ event, onChangeTime, onDelete, onBack }: EventDetailProps) {
  const nowISO = new Date().toISOString();
  // Compute the clamp with the same pure helper the actual shift uses,
  // rather than re-deriving "is this already at `now`" here — one rule,
  // one place (per SPEC: "don't duplicate the rule").
  const plusFiveClamped = shiftEventTime(event, 5, nowISO).at === event.at;

  const dateLine = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(event.at));

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="self-start py-3 pr-3 text-label text-fg-muted underline underline-offset-2"
      >
        Back
      </button>

      <h1 className="text-label text-fg-muted">Entry</h1>
      <p className="text-title text-fg">{eventLabel(event)}</p>

      <h2 className="mt-8 text-label text-fg-muted">Time</h2>
      <div className="mt-2 flex items-center gap-8">
        <button
          type="button"
          aria-label="5 minutes earlier"
          onClick={() => onChangeTime(-5)}
          className="min-h-[76px] min-w-[76px] rounded-md border border-line bg-surface text-title text-fg"
        >
          −
        </button>
        <span className="flex-1 text-center text-display font-medium text-fg">{formatTimeHM(event.at)}</span>
        <button
          type="button"
          aria-label="5 minutes later"
          disabled={plusFiveClamped}
          onClick={() => onChangeTime(5)}
          className="min-h-[76px] min-w-[76px] rounded-md border border-line bg-surface text-title text-fg disabled:opacity-60"
        >
          +
        </button>
      </div>
      <p className="mt-2 text-body text-fg-muted">{dateLine}</p>
      <p className="mt-1 text-caption text-fg-muted">Changes in steps of 5 minutes.</p>

      <button
        type="button"
        onClick={onDelete}
        className="mt-8 min-h-[76px] w-full rounded-md border border-line text-body-lg text-warn"
      >
        Delete this entry
      </button>
    </div>
  );
}
