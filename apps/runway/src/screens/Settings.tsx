import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { LIVE_TRAVEL_ENABLED_SETTING, ROUTES_API_KEY_SETTING } from '../lib/liveTravelSettings';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * Two settings, both for the live-travel increment (RUNWAY_PLAN.md
 * §5.1+§5.6): the Routes API key and the "use live travel" toggle. Both
 * rows live in the existing key-value `settings` table (db/db.ts v2) — the
 * same table the first-run card's dismissal already uses — rather than a
 * dedicated table, since two rows don't earn a schema change. Every other
 * screen that needs to know "is live travel on" reads through
 * lib/liveTravelSettings.ts's readLiveTravelConfig rather than these two
 * rows directly; this screen is the one place that writes them.
 */
export function Settings({ onNavigate }: SettingsProps) {
  const apiKeySetting = useLiveQuery(() => db.settings.get(ROUTES_API_KEY_SETTING), []);
  const enabledSetting = useLiveQuery(() => db.settings.get(LIVE_TRAVEL_ENABLED_SETTING), []);

  const savedApiKey = apiKeySetting?.value ?? '';
  const hasKey = savedApiKey !== '';
  const liveTravelEnabled = enabledSetting?.value === 'true';

  // A local draft, not written on every keystroke — same reason every other
  // form in this app (DepartureSetup, ExamSetup, ...) keeps local state:
  // half-typed key material shouldn't take effect character by character.
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  useEffect(() => {
    if (apiKeySetting !== undefined) setApiKeyDraft(savedApiKey);
  }, [apiKeySetting, savedApiKey]);

  async function saveApiKey() {
    await db.settings.put({ key: ROUTES_API_KEY_SETTING, value: apiKeyDraft.trim() });
  }

  async function clearApiKey() {
    await db.settings.put({ key: ROUTES_API_KEY_SETTING, value: '' });
    // Clearing the key makes live travel unusable regardless of the toggle
    // (readLiveTravelConfig requires both) — turning the toggle off too
    // keeps this settings row honest rather than leaving 'true' behind
    // nothing.
    await db.settings.put({ key: LIVE_TRAVEL_ENABLED_SETTING, value: 'false' });
    setApiKeyDraft('');
  }

  async function toggleLiveTravel() {
    await db.settings.put({ key: LIVE_TRAVEL_ENABLED_SETTING, value: liveTravelEnabled ? 'false' : 'true' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Settings" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <section className="flex flex-col gap-3">
        <TextField
          label="Routes API key"
          type="password"
          autoComplete="off"
          value={apiKeyDraft}
          onChange={(e) => setApiKeyDraft(e.target.value)}
          hint="Stored only on this device — never in the repository or its builds. In the Google Cloud console, restrict this key to the Routes API."
        />
        <div className="flex gap-2">
          <Button onClick={() => void saveApiKey()} className="flex-1">
            Save
          </Button>
          <Button variant="secondary" onClick={() => void clearApiKey()} className="flex-1" disabled={!hasKey}>
            Clear
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-900 p-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={liveTravelEnabled}
            disabled={!hasKey}
            onChange={() => void toggleLiveTravel()}
            className="h-6 w-6 shrink-0 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500 disabled:opacity-40"
          />
          <span className="flex-1 text-slate-100">Use live travel times</span>
        </label>
        {!hasKey && <p className="text-sm text-slate-500">Requires an API key.</p>}
      </section>

      <p className="text-sm text-slate-500">
        Live travel adds a network dependency and a location permission. Everything still works
        without it — travel minutes fall back to your manual estimate.
      </p>
    </div>
  );
}
