import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { LIVE_TRAVEL_ENABLED_SETTING, ROUTES_API_KEY_SETTING } from '../lib/liveTravelSettings';
import { DEFAULT_FEEDBACK_REPO, FEEDBACK_REPO_SETTING, FEEDBACK_TOKEN_SETTING } from '../lib/reportSettings';
import { GEMINI_API_KEY_SETTING } from '../lib/captureSettings';
import { CALENDAR_ENABLED_SETTING } from '../lib/calendarSettings';
import { requestCalendarAccess } from '../native/calendar';
import { DAY_GAUGE_ENABLED_SETTING } from '../lib/dayGaugeSettings';
import { refreshDayGauge } from '../lib/dayGaugeRefresh';
import { hideDayGauge } from '../native/dayGauge';
import { FOCUS_SOUND_KIND_SETTING, FOCUS_SOUND_VOLUME_SETTING } from '../lib/focusSoundSettings';
import { isFocusSoundPlaying, startFocusSound, type FocusSoundKind } from '../audio/focusSound';
import { ensurePermissions } from '../native/notifications';
import { backupFilename, buildBackup, LAST_BACKUP_AT_SETTING, validateBackup } from '../lib/backup';
import { restoreBackup } from '../lib/restoreBackup';
import { exportBackupFile } from '../native/backupFile';
import { formatDateLong, formatTime } from '../lib/format';
import { logEvent } from '../lib/eventLog';
import { WATCHED_DEVICE_ADDRESS_SETTING, WATCHED_DEVICE_NAME_SETTING } from '../lib/transitSettings';
import {
  clearWatchedDevice,
  ensureBluetoothPermission,
  getBondedDevices,
  setWatchedDevice,
  type BondedDevice,
} from '../native/bluetooth';
import { carChooserMessage } from '../lib/transit';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, checkForUpdate, parseAvailableUpdate } from '../lib/updateCheck';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

// Focus sound increment (0.33.0) chip options — same three-fixed-choices
// chip shape as ExamSetup's STUDY_BLOCK_LENGTHS, just strings instead of
// minute counts.
const FOCUS_SOUND_KIND_OPTIONS: { value: FocusSoundKind; label: string }[] = [
  { value: 'brown', label: 'Brown' },
  { value: 'pink', label: 'Pink' },
  { value: 'white', label: 'White' },
];

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

  // Calendar increment (E1). Home's own lazy-enable TextAction is the FIRST
  // ask; this checkbox is the re-enable path for after a decline (or a
  // deliberate turn-off) — same settings row, 'calendarEnabled', read the
  // same way. Turning ON re-runs the permission request rather than
  // assuming a prior 'false' means the OS permission itself is still
  // denied: Android returns GRANTED immediately, with no dialog, when the
  // permission is already held (e.g. Deepak turned this off in-app once
  // but never revoked it at the OS level) — see requestCalendarAccess's own
  // doc comment. Turning OFF never revokes the OS permission (Android has
  // no API for an app to do that to itself); it only stops Home from
  // reading it.
  const calendarEnabledSetting = useLiveQuery(() => db.settings.get(CALENDAR_ENABLED_SETTING), []);
  const calendarEnabled = calendarEnabledSetting?.value === 'true';

  async function toggleCalendar() {
    if (calendarEnabled) {
      await db.settings.put({ key: CALENDAR_ENABLED_SETTING, value: 'false' });
      return;
    }
    const granted = await requestCalendarAccess();
    await db.settings.put({ key: CALENDAR_ENABLED_SETTING, value: granted ? 'true' : 'false' });
  }

  // Day-gauge increment (0.31.0). Same settings-row shape as
  // CALENDAR_ENABLED_SETTING above, but deliberately does NOT gate the
  // stored value on whether the permission prompt was actually granted the
  // way toggleCalendar does above: a denied calendar permission leaves
  // literally nothing for that feature to show, so falling back to 'false'
  // is the only honest state. A denied notification permission is
  // different — DayGaugePlugin.java's own comment on this — the gauge just
  // silently doesn't render; the toggle still means "Deepak wants this on",
  // and if he grants the permission later (Android Settings), the very next
  // refreshDayGauge() call (next app open, or any write-site trigger) picks
  // it back up with no need to revisit this screen and flip the toggle
  // again.
  const dayGaugeEnabledSetting = useLiveQuery(() => db.settings.get(DAY_GAUGE_ENABLED_SETTING), []);
  const dayGaugeEnabled = dayGaugeEnabledSetting?.value === 'true';

  async function toggleDayGauge() {
    if (dayGaugeEnabled) {
      await db.settings.put({ key: DAY_GAUGE_ENABLED_SETTING, value: 'false' });
      // Turning off must take effect immediately, not just on the next
      // refresh trigger — an ongoing notification left on the shade after
      // its own toggle is switched off would read as broken, not silent.
      await hideDayGauge();
      return;
    }
    // Reuses the app's one existing notification-permission flow
    // (notifications.ts's ensurePermissions) rather than a second path —
    // best-effort; its result isn't checked here, see the comment above.
    await ensurePermissions();
    await db.settings.put({ key: DAY_GAUGE_ENABLED_SETTING, value: 'true' });
    void refreshDayGauge();
  }

  // Focus sound increment (0.33.0). Kind and volume live here; the on/off
  // decision deliberately does NOT — see the "Focus sound" section's own
  // JSX comment below for why that split exists. Both settings default via
  // plain `??`/fallback checks rather than readFocusSoundConfig (that
  // helper is async and Dexie-shaped for the live screens' mount effects;
  // this component already has the two rows loaded through useLiveQuery,
  // so re-deriving the same two defaults inline avoids an extra query).
  const focusSoundKindSetting = useLiveQuery(() => db.settings.get(FOCUS_SOUND_KIND_SETTING), []);
  const focusSoundVolumeSetting = useLiveQuery(() => db.settings.get(FOCUS_SOUND_VOLUME_SETTING), []);
  const focusSoundKind: FocusSoundKind =
    focusSoundKindSetting?.value === 'pink' || focusSoundKindSetting?.value === 'white'
      ? focusSoundKindSetting.value
      : 'brown';
  const focusSoundVolumePercent = Number(focusSoundVolumeSetting?.value ?? '40');

  async function setFocusSoundKind(kind: FocusSoundKind) {
    await db.settings.put({ key: FOCUS_SOUND_KIND_SETTING, value: kind });
    // Retune in place ONLY if a sprint or task left running elsewhere is
    // actually making sound right now — isFocusSoundPlaying is the guard
    // that keeps this from being a backdoor way to START the engine from a
    // screen that has no enable toggle of its own.
    if (isFocusSoundPlaying()) startFocusSound(kind, focusSoundVolumePercent / 100);
  }

  async function setFocusSoundVolume(percent: number) {
    await db.settings.put({ key: FOCUS_SOUND_VOLUME_SETTING, value: String(percent) });
    if (isFocusSoundPlaying()) startFocusSound(focusSoundKind, percent / 100);
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

  // Quick-capture increment (E2): a single Gemini API key, same
  // save/clear/local-draft shape as the Routes API key above — half-typed
  // key material shouldn't take effect character by character here either.
  // No separate enable toggle: readCaptureConfig treats a present key as
  // the enable switch, and Home's capture box only renders once one exists
  // (see Home.tsx) — an on/off checkbox next to it would just be a second,
  // redundant way to say the same thing the Clear button already says.
  const geminiApiKeySetting = useLiveQuery(() => db.settings.get(GEMINI_API_KEY_SETTING), []);
  const savedGeminiApiKey = geminiApiKeySetting?.value ?? '';
  const hasGeminiApiKey = savedGeminiApiKey !== '';

  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState('');
  useEffect(() => {
    if (geminiApiKeySetting !== undefined) setGeminiApiKeyDraft(savedGeminiApiKey);
  }, [geminiApiKeySetting, savedGeminiApiKey]);

  async function saveGeminiApiKey() {
    await db.settings.put({ key: GEMINI_API_KEY_SETTING, value: geminiApiKeyDraft.trim() });
  }

  async function clearGeminiApiKey() {
    await db.settings.put({ key: GEMINI_API_KEY_SETTING, value: '' });
    setGeminiApiKeyDraft('');
  }

  // Backup increment: manual export/import of the whole database as one
  // JSON file — see src/lib/backup.ts (what a backup IS), restoreBackup.ts
  // (the replace-everything import), and native/backupFile.ts (the
  // file/share-sheet plumbing) for the rest of this feature.
  const lastBackupAtSetting = useLiveQuery(() => db.settings.get(LAST_BACKUP_AT_SETTING), []);
  const lastBackupAt = lastBackupAtSetting ? new Date(lastBackupAtSetting.value) : null;

  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupRestored, setBackupRestored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExportBackup() {
    setBackupError(null);
    setBackupRestored(false);
    const [departures, templates, settings, exams, topics, sprints, milestones, fieldReports, tasks, events] =
      await Promise.all([
        db.departures.toArray(),
        db.templates.toArray(),
        db.settings.toArray(),
        db.exams.toArray(),
        db.topics.toArray(),
        db.sprints.toArray(),
        db.milestones.toArray(),
        db.fieldReports.toArray(),
        db.tasks.toArray(),
        db.events.toArray(),
      ]);
    const now = new Date();
    const backup = buildBackup(
      { departures, templates, settings, exams, topics, sprints, milestones, fieldReports, tasks, events },
      db.verno,
      now,
    );
    // Pretty-printed: this is a personal-scale backup (one phone's worth of
    // data), not a payload where a couple of KB of whitespace matters, and a
    // readable file is worth it the one time Deepak opens it in a text
    // editor to sanity-check what's actually in there.
    try {
      await exportBackupFile(JSON.stringify(backup, null, 2), backupFilename(now));
    } catch (err) {
      // On Android, @capacitor/share REJECTS when the share sheet is
      // dismissed without picking a target ("Share canceled") — that's a
      // decision, not a failure: nothing was saved anywhere, so
      // lastBackupAt must NOT advance (a backup that went nowhere isn't a
      // backup). Anything else is a real error worth a visible line.
      const message = err instanceof Error ? err.message : String(err);
      if (!/cancel/i.test(message)) setBackupError('Could not export the backup.');
      return;
    }
    // Written only AFTER exportBackupFile resolves: on native, after Deepak
    // picked a share target (dismissal rejects — see the catch above); on
    // web, after the download was triggered (the browser doesn't report
    // what happened past the click, so triggering is the best truth
    // available there).
    await db.settings.put({ key: LAST_BACKUP_AT_SETTING, value: now.toISOString() });
    void logEvent('backup', 'Backup exported.');
  }

  function handleImportClick() {
    setBackupError(null);
    setBackupRestored(false);
    fileInputRef.current?.click();
  }

  async function handleBackupFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clears the input's value so picking the SAME file again later (e.g.
    // after fixing whatever made an earlier attempt fail) still fires this
    // handler — a browser file input doesn't fire 'change' a second time for
    // an unchanged selection otherwise.
    event.target.value = '';
    if (!file) return;

    setBackupError(null);
    setBackupRestored(false);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setBackupError('That file is not a Runway backup.');
      return;
    }

    const result = validateBackup(parsed, db.verno);
    if (!result.ok) {
      setBackupError(result.reason);
      return;
    }

    // Native confirm(), same shortcut this app already uses for every other
    // "this cannot be undone" moment (Home's removeDeparture, TemplateEdit's
    // handleDelete, ...) — see this function's own comment there for why a
    // custom dialog component isn't worth building for a single confirmation
    // step.
    const exportedAtLabel = formatDateLong(new Date(result.backup.exportedAt));
    const confirmed = window.confirm(
      `Replace everything in Runway with this backup from ${exportedAtLabel}? Current data on this phone is erased.`,
    );
    if (!confirmed) return;

    await restoreBackup(result.backup);
    setBackupRestored(true);
  }

  // Car Bluetooth transit increment (0.36.0). Watched-device address/name
  // live in Dexie's settings table (src/lib/transitSettings.ts) so this
  // screen (and anywhere else that ever needs "is a car configured") reads
  // through useLiveQuery like every other settings row here, rather than a
  // native round-trip on every render — see transitSettings.ts's own
  // comment for why the address is ALSO mirrored into native
  // SharedPreferences (that copy is what BluetoothTransitReceiver.java
  // actually compares against; this one is read-only for the UI).
  const watchedAddressSetting = useLiveQuery(() => db.settings.get(WATCHED_DEVICE_ADDRESS_SETTING), []);
  const watchedNameSetting = useLiveQuery(() => db.settings.get(WATCHED_DEVICE_NAME_SETTING), []);
  const watchedDeviceAddress = watchedAddressSetting?.value ?? '';
  const watchedDeviceName = watchedNameSetting?.value ?? '';
  const hasWatchedDevice = watchedDeviceAddress !== '';

  // Chooser is local, transient UI state — not persisted, not shown again
  // once a car is chosen or the flow is cancelled. `carChooserError` now
  // holds one of FOUR distinct messages (see carChooserMessage in
  // src/lib/transit.ts for why this used to be one wrong sentence covering
  // all four, and which field bug that caused) rather than a single
  // catch-all string — the message text itself still decides what Deepak
  // sees; this state just stopped hard-coding which text that is.
  const [carChooserOpen, setCarChooserOpen] = useState(false);
  const [bondedDevices, setBondedDevices] = useState<BondedDevice[]>([]);
  const [carChooserError, setCarChooserError] = useState<string | null>(null);

  async function openCarChooser() {
    setCarChooserError(null);
    const granted = await ensureBluetoothPermission();
    const { devices, permitted, radio } = await getBondedDevices();
    void logEvent('transit', `Car chooser: permitted=${permitted}, radio=${radio}, ${devices.length} devices.`);

    const message = carChooserMessage(granted, permitted, radio, devices.length);
    if (message) {
      setCarChooserError(message);
      return;
    }
    setBondedDevices(devices);
    setCarChooserOpen(true);
  }

  async function chooseCar(device: BondedDevice) {
    // Native first (BluetoothTransitReceiver.java's own copy of the watched
    // address, and the ring clear that goes with it — see
    // BluetoothBridgePlugin.setWatchedDevice's own comment for why a car
    // switch must never let the old car's drives blend into the new one's),
    // then the two Dexie mirror rows the UI itself reads.
    await setWatchedDevice(device.address);
    await db.settings.put({ key: WATCHED_DEVICE_ADDRESS_SETTING, value: device.address });
    await db.settings.put({ key: WATCHED_DEVICE_NAME_SETTING, value: device.name || device.address });
    setCarChooserOpen(false);
    // Exact text per 0.36.1's field-bug fix spec — was "Car Bluetooth
    // watching enabled: {name}." One line per choose, not two: this same
    // event doesn't need a second, differently-worded log line.
    void logEvent('transit', `Watching car: ${device.name || device.address}.`);
  }

  async function stopWatchingCar() {
    await clearWatchedDevice();
    await db.settings.put({ key: WATCHED_DEVICE_ADDRESS_SETTING, value: '' });
    await db.settings.put({ key: WATCHED_DEVICE_NAME_SETTING, value: '' });
    void logEvent('transit', 'Car Bluetooth watching stopped.');
  }

  // Update-check increment (0.42.0). `availableUpdate` is read the same way
  // Home.tsx reads it (useLiveQuery + parseAvailableUpdate) so this section
  // can name the pending version in its "Update available" feedback line
  // without re-deriving that JSON parse a third time. `updateCheckOutcome`
  // is purely local, transient UI state — not persisted — because it only
  // describes THIS tap's result; the underlying `availableUpdate` row (and
  // Home's card) is the durable record of whether an update is pending.
  const availableUpdateSetting = useLiveQuery(() => db.settings.get(AVAILABLE_UPDATE_SETTING), []);
  const availableUpdate = parseAvailableUpdate(availableUpdateSetting?.value);
  const [updateCheckOutcome, setUpdateCheckOutcome] = useState<
    'idle' | 'checking' | 'upToDate' | 'available' | 'error'
  >('idle');

  async function handleCheckForUpdates() {
    setUpdateCheckOutcome('checking');
    // `force: true` — an explicit tap here is exactly what the throttle's
    // `force` param exists for (see updateCheck.ts's own doc comment): a
    // person who just asked "check now" should never get a silent no-op
    // because the last background check happened 20 minutes ago.
    const outcome = await checkForUpdate(true);
    // 'throttled' can't actually happen with force:true, but the return
    // type includes it for main.tsx's unforced startup call — mapped to
    // 'upToDate' here defensively rather than left to fall through to
    // nothing rendering, which would read as this button silently doing
    // nothing.
    setUpdateCheckOutcome(outcome === 'throttled' ? 'upToDate' : outcome);
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

      <section className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-surface p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={calendarEnabled}
            onChange={() => void toggleCalendar()}
            className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          />
          <span className="flex-1 text-slate-100">Show calendar appointments on Home</span>
        </label>
        <p className="text-sm text-slate-500">
          Reads your device calendar to suggest departures for upcoming appointments. Runway never
          writes to your calendar.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Day gauge</h2>
        <label className="flex items-center gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
          <input
            type="checkbox"
            checked={dayGaugeEnabled}
            onChange={() => void toggleDayGauge()}
            className="size-6 shrink-0 rounded-md accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          />
          <span className="flex-1 text-slate-100">Show a live countdown to your next commitment</span>
        </label>
        <p className="text-sm text-slate-500">
          A silent, persistent notification counting down to your next commitment. Updates when you
          open Runway or anything changes.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Focus sound</h2>
        <div className="flex gap-3">
          {FOCUS_SOUND_KIND_OPTIONS.map(({ value, label }) => {
            const selected = focusSoundKind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => void setFocusSoundKind(value)}
                className={`flex min-h-12 flex-1 items-center justify-center rounded-xl border py-3 text-base font-medium transition-colors ${
                  selected
                    ? 'border-sky-500 bg-sky-500 text-slate-950'
                    : 'border-slate-800/60 bg-surface text-slate-100 hover:border-slate-700'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-slate-300">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={focusSoundVolumePercent}
            onChange={(e) => void setFocusSoundVolume(Number(e.target.value))}
            className="accent-sky-500"
          />
        </label>
        {/* No enable toggle in this section, unlike Day gauge above — a
            deliberate split. Settings configures WHAT the sound is (kind,
            volume); it is never where Deepak decides whether to make noise
            right now — that decision belongs on the live screen, at the
            moment work actually starts (Sprint.tsx's and TaskRun.tsx's own
            "Focus sound: on/off" row), the same way the unwatched video was
            never something he pre-armed from a settings menu. */}
        <p className="text-sm text-slate-500">
          Steady noise under sprints and tasks. Moderate background stimulation makes boring work
          easier to hold — the job the unwatched video was doing, without the feed.
        </p>
      </section>

      {/* Car Bluetooth transit increment (0.36.0). The user's own framing:
          the car's Bluetooth session IS the transit time, start to finish —
          no estimating involved. Three states, same shape as the Backup
          section's export/import pair above: nothing chosen yet (a single
          "Choose car" TextAction), the chooser open (a list of paired
          devices to tap), or a car already watched (the "Watching: {name}."
          line and "Stop watching"). */}
      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Car Bluetooth</h2>

        {hasWatchedDevice && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-surface p-4">
            <p className="text-slate-100">Watching: {watchedDeviceName || watchedDeviceAddress}.</p>
            <TextAction onClick={() => void stopWatchingCar()} className="self-start">
              Stop watching
            </TextAction>
          </div>
        )}

        {!hasWatchedDevice && carChooserOpen && (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800/60 bg-surface p-4">
            <p className="text-sm text-slate-400">Choose your car.</p>
            <div className="flex flex-col gap-2">
              {bondedDevices.map((device) => (
                <button
                  key={device.address}
                  type="button"
                  onClick={() => void chooseCar(device)}
                  className="min-h-12 rounded-lg border border-slate-800/60 bg-raised px-3 py-2 text-left text-slate-100 transition-colors hover:border-slate-700"
                >
                  {device.name || device.address}
                </button>
              ))}
            </div>
            <TextAction onClick={() => setCarChooserOpen(false)} className="self-start">
              Cancel
            </TextAction>
          </div>
        )}

        {!hasWatchedDevice && !carChooserOpen && !carChooserError && (
          <TextAction onClick={() => void openCarChooser()} className="self-start">
            Choose car
          </TextAction>
        )}

        {/* One of four distinct messages (src/lib/transit.ts's
            carChooserMessage) rather than the single wrong catch-all this
            replaced — see that function's doc comment for the field bug.
            "Try again" re-runs the whole openCarChooser flow (permission +
            radio + device read again, since any of those three could have
            changed); "Cancel" just dismisses the message back to the plain
            "Choose car" prompt without retrying anything. */}
        {!hasWatchedDevice && carChooserError && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-amber-400">{carChooserError}</p>
            <div className="flex gap-4">
              <TextAction onClick={() => void openCarChooser()}>Try again</TextAction>
              <TextAction onClick={() => setCarChooserError(null)}>Cancel</TextAction>
            </div>
          </div>
        )}

        {/* Car-disconnect arrival increment (0.44.0): rewritten to name what
            "Choose car" now does beyond drive timing — the disconnect is
            also the arrival anchor. Discoverability fix per the field
            report ("I don't see the option at all to say which bluetooth
            belongs to the car"): the "Choose car" action above is unchanged
            in position, this caption is what now explains its full effect. */}
        <p className="text-sm text-slate-500">
          Your car&apos;s Bluetooth connect-to-disconnect measures each drive AND marks your
          arrival — the disconnect (you parked and got out) is when the walk-in begins, more
          accurate than Wi-Fi in the car park. Samsung may stop delivering Bluetooth events to
          apps it puts to sleep — exclude Runway from battery optimization if this stops working.
        </p>
      </section>

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

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Quick capture</h2>

        <TextField
          label="Gemini API key"
          type="password"
          autoComplete="off"
          value={geminiApiKeyDraft}
          onChange={(e) => setGeminiApiKeyDraft(e.target.value)}
          hint="A Google AI Studio key (aistudio.google.com/apikey). Stored only on this device. One dictated sentence becomes a draft departure — nothing is saved without your confirmation."
        />
        <div className="flex gap-2">
          <Button onClick={() => void saveGeminiApiKey()} className="flex-1">
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => void clearGeminiApiKey()}
            className="flex-1"
            disabled={!hasGeminiApiKey}
          >
            Clear
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Backup</h2>

        <p className="text-sm text-slate-500">
          {lastBackupAt ? `Last backup: ${formatDateLong(lastBackupAt)} ${formatTime(lastBackupAt)}` : 'Never backed up.'}
        </p>

        <div className="flex gap-2">
          <Button onClick={() => void handleExportBackup()} className="flex-1">
            Export backup
          </Button>
          <Button variant="secondary" onClick={handleImportClick} className="flex-1">
            Import backup
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => void handleBackupFileSelected(e)}
        />

        {backupError && <p className="text-sm text-red-400">{backupError}</p>}
        {backupRestored && <p className="text-sm text-emerald-300">Backup restored.</p>}

        <p className="text-sm text-slate-500">
          Everything Runway has learned, as one file. API keys are not included — they stay on this
          device.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Activity log</h2>
        <p className="text-sm text-slate-500">
          What the app did and when, kept on this phone. The newest 2000 events are retained.
        </p>
        <TextAction onClick={() => onNavigate({ name: 'activityLog' })} className="self-start">
          View activity log
        </TextAction>
      </section>

      {/* Update-check increment (0.42.0). Last section — an about/version
          line, same "trailing, low-stakes" position Activity log already
          occupies just above it. */}
      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Updates</h2>
        <p className="text-sm text-slate-500">
          Version {APP_VERSION} ({APP_VERSION_CODE}).
        </p>
        <TextAction
          onClick={() => void handleCheckForUpdates()}
          disabled={updateCheckOutcome === 'checking'}
          className="self-start disabled:opacity-40"
        >
          {updateCheckOutcome === 'checking' ? 'Checking.' : 'Check for updates'}
        </TextAction>
        {updateCheckOutcome === 'upToDate' && <p className="text-sm text-slate-500">Up to date.</p>}
        {updateCheckOutcome === 'available' && availableUpdate && (
          <p className="text-sm text-slate-500">Update available: v{availableUpdate.version} — see Home.</p>
        )}
        {updateCheckOutcome === 'error' && (
          <p className="text-sm text-amber-400">Could not check. Try again later.</p>
        )}
      </section>
    </div>
  );
}
