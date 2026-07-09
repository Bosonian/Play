import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { LIVE_TRAVEL_ENABLED_SETTING, ROUTES_API_KEY_SETTING } from '../lib/liveTravelSettings';
import { DEFAULT_FEEDBACK_REPO, FEEDBACK_REPO_SETTING, FEEDBACK_TOKEN_SETTING } from '../lib/reportSettings';

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

  // Field-reports increment: same two-rows-in-`settings` shape as the
  // Routes API key above, and the same local-draft-until-Save pattern for
  // the same reason — half-typed token material shouldn't take effect
  // character by character.
  const feedbackTokenSetting = useLiveQuery(() => db.settings.get(FEEDBACK_TOKEN_SETTING), []);
  const feedbackRepoSetting = useLiveQuery(() => db.settings.get(FEEDBACK_REPO_SETTING), []);
  const savedFeedbackToken = feedbackTokenSetting?.value ?? '';
  const hasFeedbackToken = savedFeedbackToken !== '';

  const [feedbackTokenDraft, setFeedbackTokenDraft] = useState('');
  useEffect(() => {
    if (feedbackTokenSetting !== undefined) setFeedbackTokenDraft(savedFeedbackToken);
  }, [feedbackTokenSetting, savedFeedbackToken]);

  const [feedbackRepoDraft, setFeedbackRepoDraft] = useState('');
  useEffect(() => {
    if (feedbackRepoSetting !== undefined) setFeedbackRepoDraft(feedbackRepoSetting?.value ?? '');
  }, [feedbackRepoSetting]);

  async function saveFeedbackToken() {
    await db.settings.put({ key: FEEDBACK_TOKEN_SETTING, value: feedbackTokenDraft.trim() });
  }

  async function clearFeedbackToken() {
    await db.settings.put({ key: FEEDBACK_TOKEN_SETTING, value: '' });
    setFeedbackTokenDraft('');
  }

  async function saveFeedbackRepo() {
    await db.settings.put({ key: FEEDBACK_REPO_SETTING, value: feedbackRepoDraft.trim() });
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

      <section className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-surface p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={liveTravelEnabled}
            disabled={!hasKey}
            onChange={() => void toggleLiveTravel()}
            className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:opacity-40"
          />
          <span className="flex-1 text-slate-100">Use live travel times</span>
        </label>
        {!hasKey && <p className="text-sm text-slate-500">Requires an API key.</p>}
      </section>

      <p className="text-sm text-slate-500">
        Live travel adds a network dependency and a location permission. Everything still works
        without it — travel minutes fall back to your manual estimate.
      </p>

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Feedback</h2>

        <TextField
          label="GitHub token"
          type="password"
          autoComplete="off"
          value={feedbackTokenDraft}
          onChange={(e) => setFeedbackTokenDraft(e.target.value)}
          hint="A fine-grained GitHub token with Issues and Contents write access to the target repo. Stored only on this device."
        />
        <div className="flex gap-2">
          <Button onClick={() => void saveFeedbackToken()} className="flex-1">
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => void clearFeedbackToken()}
            className="flex-1"
            disabled={!hasFeedbackToken}
          >
            Clear
          </Button>
        </div>

        <TextField
          label="Target repo"
          type="text"
          autoComplete="off"
          value={feedbackRepoDraft}
          onChange={(e) => setFeedbackRepoDraft(e.target.value)}
          placeholder="Bosonian/runway-feedback"
          hint="Reports filed to a public repository are publicly visible — including screenshots. A private repository keeps them between you and the reviewer."
        />
        <Button onClick={() => void saveFeedbackRepo()} className="w-full">
          Save
        </Button>

        <p className="text-sm text-slate-500">
          Left blank, reports file to {DEFAULT_FEEDBACK_REPO}. Reports are saved on this device the
          moment you file them, token or no token — they sync to GitHub Issues in the background
          whenever a token is set and the device is online.
        </p>

        <TextAction onClick={() => onNavigate({ name: 'report', fromScreen: 'settings' })} className="self-start">
          Report a problem
        </TextAction>
      </section>
    </div>
  );
}
