// More — settings and the rest (design doc §8.1). Increment 1 wires the theme
// control (which is real and useful now) and shows placeholders for the
// content-review and data screens that arrive with later increments.

import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings, updateSettings } from '../db/db';
import type { ThemePreference } from '../db/types';
import { setTheme } from '../ui/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function More() {
  const settings = useLiveQuery(() => getSettings(), []);
  const theme = settings?.theme ?? 'system';

  async function pickTheme(value: ThemePreference) {
    setTheme(value); // apply immediately
    await updateSettings({ theme: value }); // persist
  }

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      <h1 className="text-title font-semibold text-fg">More</h1>

      <section className="mt-6">
        <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
          Appearance
        </p>
        {/* Segmented theme control. */}
        <div
          role="group"
          aria-label="Theme"
          className="mt-2 flex rounded-md border border-line bg-surface p-1"
        >
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => pickTheme(opt.value)}
                className={`flex-1 rounded-sm py-2 text-label font-medium transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-muted'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
          Content
        </p>
        <button
          type="button"
          disabled
          className="mt-2 flex w-full items-center justify-between rounded-md border border-line bg-surface px-4 py-3 text-left disabled:opacity-70"
        >
          <span className="text-body text-fg-muted">Review content</span>
          <span className="text-caption text-fg-faint">not built yet</span>
        </button>
      </section>

      <section className="mt-6">
        <p className="text-caption font-medium uppercase tracking-wide text-fg-faint">
          About
        </p>
        <p className="mt-2 text-body text-fg-muted">
          Head-in runs fully offline. Everything is stored on this device.
        </p>
        <p className="mt-1 text-caption text-fg-faint">
          Local data: {db.name}. Schema v1.
        </p>
      </section>
    </div>
  );
}
