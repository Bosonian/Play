import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { StepNameLibraryEntry } from '../lib/learning';

interface StepNameAutocompleteProps {
  value: string;
  library: StepNameLibraryEntry[];
  onNameChange: (name: string) => void;
  onSelect: (entry: StepNameLibraryEntry) => void;
}

/** Up to 4 matches shown at once (CLAUDE.md: "defaults lean toward less,
 * not more") — a step name is a short, glanceable list, not a search
 * results page. */
const MAX_MATCHES = 4;

/** A 1-character query would substring-match nearly every entry in the
 * library and be noise, not help — 2 is the point real disambiguation
 * starts ("Sh" -> Shower/Shoes, not every step that happens to contain
 * "s"). */
const MIN_QUERY_CHARS = 2;

/**
 * Task-memory autocomplete for a step-name input (learning increment §5;
 * used by both TemplateEdit and DepartureSetup). A small custom dropdown
 * rather than a native `<datalist>`: a `<datalist>` option can only carry a
 * text label, and this needs to attach a learned-minutes VALUE that
 * selecting an option also fills in — a `<datalist>` has no mechanism for
 * that second field.
 *
 * `library` is expected to already be sorted (stepNameLibrary sorts by run
 * count descending) — this component only filters and truncates, it
 * doesn't re-sort, so "best match" here means "most-used match", not
 * "closest string match."
 */
export function StepNameAutocomplete({ value, library, onNameChange, onSelect }: StepNameAutocompleteProps) {
  // `open` is separate from "has a query long enough to match" — closing
  // on blur/Escape/selection must stick even if the text still qualifies,
  // otherwise the dropdown would immediately reopen on the next render.
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const query = value.trim().toLowerCase();
  const matches =
    query.length >= MIN_QUERY_CHARS
      ? library.filter((entry) => entry.name.toLowerCase().includes(query)).slice(0, MAX_MATCHES)
      : [];
  const showDropdown = open && matches.length > 0;
  const safeHighlighted = Math.min(highlighted, Math.max(matches.length - 1, 0));

  function choose(entry: StepNameLibraryEntry) {
    onSelect(entry);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((prev) => (prev + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((prev) => (prev - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      // Only intercepts Enter while a real dropdown is showing - an empty
      // or too-short query falls through to whatever the surrounding form
      // does with Enter (e.g. moving to the next field), unchanged from
      // before this component existed.
      e.preventDefault();
      choose(matches[safeHighlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={value}
        onChange={(e) => {
          onNameChange(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // A plain synchronous setOpen(false) here would close the
          // dropdown BEFORE a click on one of its options finishes
          // registering (blur fires first) — the short delay lets that
          // click's own handler run first. onMouseDown's
          // preventDefault below on each option is the other half of
          // this: it stops the input from losing focus at all for a
          // pointer selection, so this timeout mostly matters for
          // touch/other input methods where that trick doesn't apply.
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Step name"
        aria-label="Step name"
        autoComplete="off"
        className="min-h-12 w-full rounded-lg border border-slate-700 bg-raised px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
      />
      {showDropdown && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-raised shadow-lg">
          {matches.map((entry, index) => (
            <li key={entry.name}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(entry)}
                className={`flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  index === safeHighlighted ? 'bg-slate-800' : 'hover:bg-slate-800/60'
                }`}
              >
                <span className="text-slate-100">{entry.name}</span>
                {entry.learnedMinutes !== null && (
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {entry.learnedMinutes} min · {entry.runCount} runs
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
