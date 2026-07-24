import { TextField } from './TextField';

/** Monday-first (CLAUDE.md), ISO weekday numbers 1..7 paired with the
 * single-letter chip label this editor renders. Two Tuesdays/Saturdays in
 * a row read fine as single letters in a 7-chip row; `ariaLabel` carries
 * the full name so the chip's accessible name isn't just "T". */
const DAY_CHIPS: { iso: number; label: string; ariaLabel: string }[] = [
  { iso: 1, label: 'M', ariaLabel: 'Monday' },
  { iso: 2, label: 'T', ariaLabel: 'Tuesday' },
  { iso: 3, label: 'W', ariaLabel: 'Wednesday' },
  { iso: 4, label: 'T', ariaLabel: 'Thursday' },
  { iso: 5, label: 'F', ariaLabel: 'Friday' },
  { iso: 6, label: 'S', ariaLabel: 'Saturday' },
  { iso: 7, label: 'S', ariaLabel: 'Sunday' },
];

interface RepeatEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  time: string;
  onTimeChange: (time: string) => void;
  days: number[];
  onToggleDay: (iso: number) => void;
  /** `!enabled || (time !== '' && days.length > 0)` — computed by the
   * caller (both TemplateEdit and DepartureSetup already need the same
   * expression for their own `canSave`), not derived in here, so there's
   * exactly one place per screen that decides what "valid" means for that
   * screen's save button. */
  valid: boolean;
  /** An extra line shown above the Time field, only while `enabled` — e.g.
   * DepartureSetup's "This appointment repeats in your calendar." when the
   * toggle was pre-enabled from a parsed calendar RRULE (field report #10
   * §2). Omitted renders nothing extra; TemplateEdit has no such caller. */
  extraCaption?: string;
  /** The checkbox's own label text — defaults to "Repeat this departure",
   * the only wording every existing caller (TemplateEdit, DepartureSetup)
   * needs. Overridable (Prüfung rework 2) so ExamSetup's study-block toggle
   * doesn't have to say "departure" for something that isn't one. */
  label?: string;
  /** The closing guidance line shown only while `enabled`, below the day
   * chips — defaults to the original "Planned 7 days ahead..." departure
   * wording. Overridable (Prüfung rework 2) so a caller whose alarms mean
   * something other than "departure" can state that exactly, rather than
   * this component's default text quietly being wrong for what it's
   * actually describing. */
  footerCaption?: string;
}

/**
 * The Repeat toggle + time input + Monday-first day-chip row. Extracted
 * (field report #10) out of TemplateEdit, which was previously the only
 * screen that could set up a recurring schedule — DepartureSetup's create
 * flow (§2 of the fix) and the "Make repeating" promotion path (§3) both
 * need the exact same control now, and a second hand-copied version would
 * only ever drift from this one.
 *
 * Deliberately dumb: every value is a prop, every change calls back to the
 * owning screen. This component holds no state of its own and knows
 * nothing about Templates, Departures, or what saving means — that stays
 * with each screen, which is why `valid` is passed in rather than computed
 * here (TemplateEdit's `canSave` and DepartureSetup's `canSave` fold it in
 * differently).
 */
export function RepeatEditor({
  enabled,
  onEnabledChange,
  time,
  onTimeChange,
  days,
  onToggleDay,
  valid,
  extraCaption,
  label = 'Repeat this departure',
  footerCaption = 'Planned 7 days ahead. Open Runway at least once a week to keep alarms armed.',
}: RepeatEditorProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        />
        <span className="flex-1 text-slate-100">{label}</span>
      </label>

      {enabled && (
        <div className="flex flex-col gap-3 motion-safe:animate-fade-in">
          {extraCaption && <p className="text-sm text-slate-500">{extraCaption}</p>}

          <TextField
            label="Time"
            type="time"
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            containerClassName="w-32"
          />

          <div className="flex gap-1.5">
            {DAY_CHIPS.map((day) => {
              const selected = days.includes(day.iso);
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => onToggleDay(day.iso)}
                  aria-label={day.ariaLabel}
                  aria-pressed={selected}
                  className={`flex min-h-12 min-w-12 flex-1 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                      : 'border-slate-700 bg-raised text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>

          {!valid && <p className="text-sm text-red-400">Set a time and pick at least one day.</p>}

          <p className="text-sm text-slate-500">{footerCaption}</p>
        </div>
      )}
    </section>
  );
}
