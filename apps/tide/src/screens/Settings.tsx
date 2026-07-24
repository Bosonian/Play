import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { TextField } from '../ui/TextField';
import { Button } from '../ui/Button';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, checkForUpdate, parseAvailableUpdate } from '../lib/updateCheck';
import {
  HEALTH_CONNECT_ENABLED_SETTING,
  HEALTH_LAST_SYNC_AT_SETTING,
  MOVEMENT_STEP_SOURCES_SETTING,
  parseStepSourcesValue,
  stepSourceLabel,
  writeSelectedStepSources,
} from '../lib/healthSettings';
import { isHealthConnectAvailable, readStepSources, requestHealthPermissions, type StepSourceJs } from '../native/healthConnect';
import { syncHealthData } from '../lib/healthSync';
import { parseDailyShapeTarget, type DailyShapeTarget } from '../lib/dailyShape';
import { clearDailyShapeTarget, DAILY_SHAPE_TARGET_SETTING, writeDailyShapeTarget } from '../lib/dailyShapeSettings';
import { logEvent } from '../lib/eventLog';
import { DEFAULT_FEEDBACK_REPO, FEEDBACK_REPO_SETTING, FEEDBACK_TOKEN_SETTING } from '../lib/reportSettings';
import { backupFilename, buildBackup, LAST_BACKUP_AT_SETTING, validateBackup } from '../lib/backup';
import { restoreBackup } from '../lib/restoreBackup';
import { exportBackupFile } from '../native/backupFile';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

/** What the "Connect health data" tap has produced so far, purely for THIS
 * screen's own inline feedback — not persisted (the durable record is the
 * `HEALTH_CONNECT_ENABLED_SETTING` row itself). Mirrors the Updates
 * section's own `updateCheckOutcome` state shape below. */
type ConnectOutcome = 'idle' | 'checking' | 'notInstalled' | 'unsupported' | 'declined' | 'connected';

/** Pre-filled into the daily-shape drafts when no target is set yet —
 * TIDE_PLAN.md §2's own example ("3 honest check-ins") is also this app's
 * suggested starting point, and 6000 steps is a commonly-cited
 * "not sedentary" floor, not a clinical prescription (Tide sets no medical
 * targets — TIDE_PLAN.md §1). Module-level, not component-local, since it's
 * a fixed constant rather than anything derived from props/state — same
 * placement as `PLAUSIBLE_WEIGHT_KG` in WeighInEntry.tsx. */
const SUGGESTED_DAILY_SHAPE_TARGET: DailyShapeTarget = { checkIns: 3, steps: 6000 };

/**
 * Backup/restore (increment 6, ported from Runway) is real as of this
 * increment — see this component's own Backup section below and
 * src/lib/backup.ts/restoreBackup.ts/native/backupFile.ts for the rest of
 * that feature. Health Connect has been real since increment 3; Updates
 * since increment 2.
 */
export function Settings({ onNavigate }: SettingsProps) {
  // Same read-and-derive pattern as Home.tsx's own update card — see that
  // file's comment for why the versionCode is re-checked at render rather
  // than trusting the settings row alone.
  const availableUpdateSetting = useLiveQuery(() => db.settings.get(AVAILABLE_UPDATE_SETTING), []);
  const availableUpdate = parseAvailableUpdate(availableUpdateSetting?.value);
  // Purely local, transient UI state — not persisted — because it only
  // describes THIS tap's result; the underlying `availableUpdate` row (and
  // Home's card) is the durable record of whether an update is pending.
  // Same shape as Runway's own Settings.tsx.
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
    // 'upToDate' here defensively, same as Runway's own handleCheckForUpdates.
    setUpdateCheckOutcome(outcome === 'throttled' ? 'upToDate' : outcome);
  }

  // Health Connect (increment 3). `enabledSetting` is the durable record
  // (read reactively — a "Sync now" or the initial connect both write it,
  // and this screen should reflect that the instant Dexie commits, same
  // liveQuery pattern the Updates section above already uses). `showConnected`
  // ORs the durable flag with the just-connected optimistic outcome so the
  // UI flips to "Connected." the instant handleConnect resolves, rather than
  // waiting on the liveQuery's own (normally near-instant, but not
  // synchronous) round trip.
  const enabledSetting = useLiveQuery(() => db.settings.get(HEALTH_CONNECT_ENABLED_SETTING), []);
  const isConnected = enabledSetting?.value === 'true';
  const lastSyncSetting = useLiveQuery(() => db.settings.get(HEALTH_LAST_SYNC_AT_SETTING), []);
  const [connectOutcome, setConnectOutcome] = useState<ConnectOutcome>('idle');
  const [syncing, setSyncing] = useState(false);
  const showConnected = isConnected || connectOutcome === 'connected';

  // Step source picker (issue #20 — see HealthConnectPlugin.kt's readSteps
  // doc comment for the bug: Health Connect can hold independent step
  // streams from more than one source, and summing them double-counts a
  // walk). This screen deliberately does NOT try to guess which origin is
  // "the real one" (e.g. always preferring a known Samsung Health package) —
  // a device's actual mix of sources (watch app, phone pedometer, Health
  // Connect's own app...) isn't something this codebase can know ahead of
  // time, and a wrong guess would silently under- or over-count in a way
  // that's harder to notice than today's obviously-too-high total. Showing
  // the real, named sources with their real numbers and letting the user
  // pick is the honest alternative. `stepSources` is `null` before the
  // first fetch resolves (loading) vs `[]` once it has (genuinely nothing
  // found today) — the empty-state copy below depends on telling those two
  // states apart.
  const stepSourcesSetting = useLiveQuery(() => db.settings.get(MOVEMENT_STEP_SOURCES_SETTING), []);
  const selectedStepSources = parseStepSourcesValue(stepSourcesSetting?.value);
  const [stepSources, setStepSources] = useState<StepSourceJs[] | null>(null);
  const [stepSourcesLoading, setStepSourcesLoading] = useState(false);
  // Chosen sources that wrote NOTHING today, so don't appear in the
  // discovered list (review fix, 0.6.1). These still need a row: the filter
  // is live, Home's movement line has gone quiet because of it, and without
  // a row there would be nothing selected on screen and no visible reason
  // why. See the rows this drives, further down.
  const missingSelectedSources = selectedStepSources.filter(
    (packageName) => !(stepSources ?? []).some((source) => source.packageName === packageName),
  );

  async function refreshStepSources() {
    setStepSourcesLoading(true);
    setStepSources(await readStepSources());
    setStepSourcesLoading(false);
  }

  // Fetch once as soon as the Health Connect section shows as connected —
  // covers both "already connected on a fresh Settings visit" and "just
  // connected this tap" (handleConnect's own effect only calls
  // syncHealthData, not this). Not re-run on every render: `showConnected`
  // only flips false->true once per screen visit under normal use.
  useEffect(() => {
    if (showConnected) void refreshStepSources();
  }, [showConnected]);

  /** Selecting "All sources" writes an empty selection (see
   * MOVEMENT_STEP_SOURCES_SETTING's own doc comment on why empty means "all
   * sources", not "nothing chosen yet"); selecting a specific row replaces
   * the whole selection with that one package name — single-select, not
   * additive, so the picker's own state always matches exactly what's
   * highlighted. Either way, `syncHealthData()` re-runs immediately so
   * Home's step count reflects the new choice without a separate "Sync now"
   * tap. */
  async function selectStepSource(packageName: string | null) {
    await writeSelectedStepSources(packageName === null ? [] : [packageName]);
    await syncHealthData();
  }

  /**
   * "Connect health data" — the ONE place this app ever requests a Health
   * Connect permission, from an explicit tap (CLAUDE.md's no-ambush rule).
   * `isHealthConnectAvailable` first, since asking for permissions Health
   * Connect itself can't even honor (not installed / unsupported) would be
   * a confusing dead-end dialog. A grant of ANY scope (not necessarily all
   * four) is treated as "connected" — even steps-only access is real,
   * useful passive data; gating the whole feature behind an all-or-nothing
   * grant would throw away a partial win for no real benefit (see
   * native/healthConnect.ts's `HealthPermissionResult.granted` if the
   * all-four case specifically is ever needed elsewhere).
   */
  async function handleConnect() {
    setConnectOutcome('checking');
    const availability = await isHealthConnectAvailable();
    if (availability === 'not_installed') {
      setConnectOutcome('notInstalled');
      return;
    }
    if (availability === 'unsupported') {
      setConnectOutcome('unsupported');
      return;
    }

    const result = await requestHealthPermissions();
    if (result.grantedScopes.length === 0) {
      setConnectOutcome('declined');
      return;
    }

    await db.settings.put({ key: HEALTH_CONNECT_ENABLED_SETTING, value: 'true' });
    void logEvent('health', `Health Connect connected (${result.grantedScopes.length} of 4 scopes granted).`);
    setConnectOutcome('connected');
    await syncHealthData();
  }

  async function handleSyncNow() {
    setSyncing(true);
    await syncHealthData();
    setSyncing(false);
  }

  /** Clears the app-side enabled flag only — the OS-level Health Connect
   * grant itself is NOT revoked (Android has no API for an app to revoke
   * its own already-granted permission; only the user, from Health
   * Connect's own settings, or Health Connect itself can do that). Stated
   * in the UI copy below, not left implicit — CLAUDE.md's "truth over
   * reassurance" rule: "Disconnect" here means "Tide stops reading", not
   * "Tide's access is gone". */
  async function handleDisconnect() {
    await db.settings.put({ key: HEALTH_CONNECT_ENABLED_SETTING, value: 'false' });
    void logEvent('health', 'Health Connect disconnected (app-side only — the OS permission is not revoked).');
    setConnectOutcome('idle');
  }

  /** "24 Jul, 14:32" — 24h time (CLAUDE.md's European-time-format rule,
   * enforced with `hour12: false` rather than trusting the ambient locale
   * to default to it), no year (this always describes something that
   * happened today or very recently — the year would be pure clutter).
   * Shared by the Health Connect section's "Last sync" line below and the
   * Backup section's "Last export" line (increment 6) — same shape, same
   * function, named generically rather than after either call site. */
  function formatDateTime(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // Daily shape (increment 7, TIDE_PLAN.md §5's signal 5) — a day-sized
  // target of check-ins + steps, stored as one settings row. Read reactively
  // (same liveQuery pattern as the Health Connect flags above) so Home's own
  // block reflects a Save/Remove here the instant Dexie commits it.
  const dailyShapeSetting = useLiveQuery(() => db.settings.get(DAILY_SHAPE_TARGET_SETTING), []);
  const savedDailyShapeTarget = parseDailyShapeTarget(dailyShapeSetting?.value);

  const [checkInsDraft, setCheckInsDraft] = useState('');
  const [stepsDraft, setStepsDraft] = useState('');
  const [dailyShapeError, setDailyShapeError] = useState<string | null>(null);

  // Mirrors the feedback-token draft effect below: re-initialises the drafts
  // whenever the underlying settings ROW changes (first load, or right after
  // a Save/Remove elsewhere) — not on every keystroke, since `checkInsDraft`/
  // `stepsDraft` are this effect's own outputs, not its inputs.
  useEffect(() => {
    if (dailyShapeSetting === undefined) return;
    if (savedDailyShapeTarget) {
      setCheckInsDraft(String(savedDailyShapeTarget.checkIns));
      setStepsDraft(String(savedDailyShapeTarget.steps));
    } else {
      setCheckInsDraft(String(SUGGESTED_DAILY_SHAPE_TARGET.checkIns));
      setStepsDraft(String(SUGGESTED_DAILY_SHAPE_TARGET.steps));
    }
    // SUGGESTED_DAILY_SHAPE_TARGET is a fixed literal (redeclared each
    // render but always the same values), not state — deliberately excluded
    // from these deps, same as any other render-local constant this file's
    // other effects don't list either.
  }, [dailyShapeSetting, savedDailyShapeTarget?.checkIns, savedDailyShapeTarget?.steps]);

  /** A whole number, 0 or higher — `null` for anything else (blank,
   * non-numeric, negative, or a decimal from a stray dictation artifact),
   * same "defensive parse, never a NaN-bearing value" discipline as
   * dailyShape.ts's own `parseDailyShapeTarget`. Kept local to this
   * component rather than reused from that file: this parses free-typed
   * DRAFT text (one field at a time, for inline validation messages), not
   * the settings row's own serialised `"checkIns,steps"` format. */
  function parseNonNegativeIntDraft(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  async function handleSaveDailyShape() {
    const checkIns = parseNonNegativeIntDraft(checkInsDraft);
    const steps = parseNonNegativeIntDraft(stepsDraft);
    if (checkIns === null || steps === null) {
      setDailyShapeError('Enter a whole number, 0 or higher, for both check-ins and steps.');
      return;
    }
    // Both zero isn't a small target, it's no target at all — dailyShape.ts's
    // own `dailyShapeProgress` treats a 0 component as "not part of the
    // shape", so a 0/0 target would render nothing on Home despite claiming
    // to be set. Naming that here, precisely, rather than silently saving a
    // target that would then show an empty card.
    if (checkIns === 0 && steps === 0) {
      setDailyShapeError('Both zero is no target — use Remove instead.');
      return;
    }
    setDailyShapeError(null);
    await writeDailyShapeTarget({ checkIns, steps });
    void logEvent(
      'dailyShape',
      `Daily shape target set: ${checkIns} check-in${checkIns === 1 ? '' : 's'}, ${steps.toLocaleString('en-US')} steps.`,
    );
  }

  /** Plain and unceremonious — no confirm dialog (CLAUDE.md's no-shame rule:
   * a day you miss says nothing, and removing the target you set says even
   * less; a "are you sure?" here would treat turning a to-do list off as a
   * bigger deal than it is). */
  async function handleRemoveDailyShape() {
    await clearDailyShapeTarget();
    setDailyShapeError(null);
    void logEvent('dailyShape', 'Daily shape target removed.');
  }

  // Field-reports increment (increment 5, ported from Runway): the GitHub
  // token/repo rows live in the existing key-value `settings` table (same
  // table Health Connect's own flags above already use), and the same
  // local-draft-until-Save pattern as everywhere else in this screen —
  // half-typed token material shouldn't take effect character by
  // character.
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

  // Backup increment (6): manual export/import of the whole database as one
  // JSON file — see src/lib/backup.ts (what a backup IS), restoreBackup.ts
  // (the replace-everything import), and native/backupFile.ts (the
  // file-write half, and its own header comment on why it differs from
  // Runway's native share-sheet mechanism) for the rest of this feature.
  const lastBackupAtSetting = useLiveQuery(() => db.settings.get(LAST_BACKUP_AT_SETTING), []);

  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupRestored, setBackupRestored] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  async function handleExportBackup() {
    setBackupError(null);
    setBackupRestored(false);
    const [weighIns, meals, movement, settings, events] = await Promise.all([
      db.weighIns.toArray(),
      db.meals.toArray(),
      db.movement.toArray(),
      db.settings.toArray(),
      db.events.toArray(),
    ]);
    const now = new Date();
    const backup = buildBackup({ weighIns, meals, movement, settings, events }, db.verno, now);
    // Pretty-printed: this is a personal-scale backup (one phone's worth of
    // data), not a payload where a couple of KB of whitespace matters, and a
    // readable file is worth it the one time Deepak opens it in a text
    // editor to sanity-check what's actually in there.
    try {
      await exportBackupFile(JSON.stringify(backup, null, 2), backupFilename(now));
    } catch (err) {
      // Backing out of the Android share sheet REJECTS — @capacitor/share
      // throws "Share canceled" — so without this check a deliberate
      // decision to cancel would show a red failure line (review fix,
      // 0.7.1: the port dropped Runway's own cancel sniff back when this
      // export was a Blob download with no sheet to dismiss; it has one
      // now). A cancel is not an error and gets no message — but it also
      // must not advance `lastBackupAt` below, since no backup was saved,
      // which the early return preserves.
      const message = err instanceof Error ? err.message : '';
      if (!/cancel/i.test(message)) setBackupError('Could not export the backup.');
      return;
    }
    // Written only AFTER exportBackupFile resolves — a download that never
    // triggered must not claim a backup happened.
    await db.settings.put({ key: LAST_BACKUP_AT_SETTING, value: now.toISOString() });
    void logEvent('backup', 'Backup exported.');
  }

  function handleImportClick() {
    setBackupError(null);
    setBackupRestored(false);
    backupFileInputRef.current?.click();
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
      setBackupError('That file is not a Tide backup.');
      return;
    }

    const result = validateBackup(parsed, db.verno);
    if (!result.ok) {
      setBackupError(result.reason);
      return;
    }

    // Native confirm(), same shortcut Runway's own Settings.tsx uses for
    // its identical "this cannot be undone" restore moment — a custom
    // dialog component isn't worth building for a single confirmation step
    // this rare.
    //
    // WITH THE YEAR, and with row counts (review fix, 0.7.1). `formatDateTime`
    // is deliberately year-less for the two "happened today or very
    // recently" call sites above, but a backup file can be arbitrarily old —
    // "24 Jul, 14:32" is ambiguous by a year for exactly the stale file this
    // confirm exists to catch. The counts matter more still: they are what
    // makes an accidental restore of a structurally-valid-but-empty file
    // visible BEFORE it replaces everything, rather than after.
    const exportedAt = new Date(result.backup.exportedAt);
    const exportedAtLabel = exportedAt.toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const tables = result.backup.tables;
    const contents = `${tables.weighIns.length} weigh-ins, ${tables.meals.length} check-ins`;
    const confirmed = window.confirm(
      `Replace everything in Tide with this backup from ${exportedAtLabel}? It contains ${contents}. Current data on this phone is erased.`,
    );
    if (!confirmed) return;

    // A failed restore must not be silent (review fix, 0.7.1). restoreBackup
    // runs every clear and every write inside ONE Dexie transaction, so a
    // rejection means the transaction aborted and nothing changed — which is
    // precisely the reassurance to give, and precisely what an unhandled
    // rejection failed to give at the one moment (recovering a lost phone)
    // it matters most.
    try {
      await restoreBackup(result.backup);
    } catch {
      setBackupError('Could not restore that backup. Nothing on this phone was changed.');
      return;
    }
    setBackupRestored(true);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Settings" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Health Connect</h2>
        <p className="text-sm text-slate-500">
          Weight and body-fat from your scale, steps and active energy from your watch — read from Health
          Connect, on your device only. In Samsung Health, allow syncing to Health Connect, and connect
          your Renpho scale once.
        </p>

        {showConnected ? (
          <>
            <p className="text-sm text-slate-400">
              Connected. {lastSyncSetting?.value ? `Last sync: ${formatDateTime(lastSyncSetting.value)}.` : 'No sync yet.'}
            </p>
            <div className="flex items-center gap-4">
              <TextAction onClick={() => void handleSyncNow()} disabled={syncing} className="disabled:opacity-40">
                {syncing ? 'Syncing.' : 'Sync now'}
              </TextAction>
              <TextAction onClick={() => void handleDisconnect()}>Disconnect</TextAction>
            </div>

            {/* Step source picker (issue #20) — quiet sub-block, only shown
                once connected, since it has nothing to show before then. */}
            <div className="flex flex-col gap-2 border-t border-slate-800/60 pt-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-slate-500">Step source</h3>
                <TextAction
                  onClick={() => void refreshStepSources()}
                  disabled={stepSourcesLoading}
                  className="min-h-0 py-0 text-xs disabled:opacity-40"
                >
                  {stepSourcesLoading ? 'Loading.' : 'Refresh'}
                </TextAction>
              </div>
              {/* Copy names active energy too (review fix, 0.6.1): the chosen
                  source filters BOTH native reads (healthSync.ts passes it to
                  readSteps and readActiveEnergy alike — the same double-count
                  risk applies to energy). Filtering both is the right call;
                  saying only "steps" while silently governing energy was not,
                  per CLAUDE.md's exact-copy rule. */}
              <p className="text-sm text-slate-500">
                Health Connect may hold steps from more than one source. Counting all of them adds the same
                walk twice. The source chosen here is used for steps and active energy.
              </p>

              {stepSources === null && stepSourcesLoading && (
                <p className="text-sm text-slate-500">Loading today&apos;s sources.</p>
              )}

              {stepSources !== null && stepSources.length === 0 && missingSelectedSources.length === 0 && (
                // No "yet" (review fix, 0.6.1): "yet" implies waiting will
                // help, and the most likely cause is a declined steps
                // permission, which waiting never fixes. State both honestly.
                <p className="text-sm text-slate-500">
                  No step sources found for today. Health Connect returns nothing here if the steps
                  permission was declined.
                </p>
              )}

              {stepSources !== null && (stepSources.length > 0 || missingSelectedSources.length > 0) && (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    aria-pressed={selectedStepSources.length === 0}
                    variant={selectedStepSources.length === 0 ? 'primary' : 'secondary'}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    onClick={() => void selectStepSource(null)}
                  >
                    <span>All sources</span>
                    <span>{stepSources.reduce((sum, source) => sum + source.steps, 0).toLocaleString('en-US')} today</span>
                  </Button>
                  {stepSources.map((source) => {
                    const pressed = selectedStepSources.length === 1 && selectedStepSources[0] === source.packageName;
                    return (
                      <Button
                        key={source.packageName}
                        type="button"
                        aria-pressed={pressed}
                        variant={pressed ? 'primary' : 'secondary'}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                        onClick={() => void selectStepSource(source.packageName)}
                      >
                        <span>{stepSourceLabel(source.packageName)}</span>
                        <span>{source.steps.toLocaleString('en-US')} today</span>
                      </Button>
                    );
                  })}
                  {/* A chosen source that wrote nothing today (review fix,
                      0.6.1). Without this row it would simply VANISH from the
                      list — leaving nothing highlighted, no hint that a filter
                      is still active, and a movement line that silently
                      disappeared from Home. Rendering it selected, with an
                      honest "nothing today", is what makes the situation
                      legible and one tap recoverable. */}
                  {missingSelectedSources.map((packageName) => (
                    <Button
                      key={packageName}
                      type="button"
                      aria-pressed
                      variant="primary"
                      className="flex items-center justify-between px-3 py-2 text-sm"
                      onClick={() => void selectStepSource(packageName)}
                    >
                      <span>{stepSourceLabel(packageName)}</span>
                      <span>nothing today</span>
                    </Button>
                  ))}
                  {/* Describes the DEFAULT without equating its number to the
                      sum above (review fix, 0.6.1): the sum is a client-side
                      addition of per-source aggregates, while the unfiltered
                      read Tide actually performs is Health Connect's own
                      cross-source aggregate, which may dedup slightly below
                      that sum. Claiming they are the same figure would be a
                      small, avoidable inaccuracy. */}
                  <p className="text-xs text-slate-500">
                    With &quot;All sources&quot; chosen, Tide counts every source Health Connect holds. The
                    figure beside it adds the rows above together, which can differ slightly from the
                    combined total Health Connect reports.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => void handleConnect()}
              disabled={connectOutcome === 'checking'}
              className="self-start disabled:opacity-40"
            >
              {connectOutcome === 'checking' ? 'Checking.' : 'Connect health data'}
            </Button>
            {connectOutcome === 'notInstalled' && (
              <p className="text-sm text-amber-400">
                Health Connect isn't set up on this device yet. Install or update the Health Connect app,
                then try again.
              </p>
            )}
            {connectOutcome === 'unsupported' && (
              <p className="text-sm text-amber-400">Health Connect isn't supported on this device.</p>
            )}
            {connectOutcome === 'declined' && (
              <p className="text-sm text-amber-400">No permissions were granted. Try again when ready.</p>
            )}
          </>
        )}
      </section>

      {/* Daily shape (increment 7) — placed here, directly after Health
          Connect and before Backup, matching this increment's own
          instructions: it reads Health Connect's own steps below the fold
          of that section, so keeping the two adjacent reads naturally. */}
      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Daily shape</h2>
        <p className="text-sm text-slate-500">
          A day-sized target, small enough to actually do. It sits below the weight trend and never scores
          you — a day you miss says nothing.
        </p>

        <div className="flex gap-2">
          <TextField
            label="Check-ins"
            type="text"
            inputMode="numeric"
            value={checkInsDraft}
            onChange={(e) => setCheckInsDraft(e.target.value)}
            hint={`Suggested: ${SUGGESTED_DAILY_SHAPE_TARGET.checkIns}`}
            containerClassName="flex-1"
          />
          <TextField
            label="Steps"
            type="text"
            inputMode="numeric"
            value={stepsDraft}
            onChange={(e) => setStepsDraft(e.target.value)}
            hint={`Suggested: ${SUGGESTED_DAILY_SHAPE_TARGET.steps.toLocaleString('en-US')}`}
            containerClassName="flex-1"
          />
        </div>

        {dailyShapeError && <p className="text-sm text-red-400">{dailyShapeError}</p>}

        <div className="flex items-center gap-4">
          <Button onClick={() => void handleSaveDailyShape()} className="flex-1">
            Save
          </Button>
          {/* Only once a target actually exists — removing a target that
              isn't set would be a no-op button with nothing to explain
              itself. Plain TextAction, no confirm dialog (see
              `handleRemoveDailyShape`'s own comment). */}
          {savedDailyShapeTarget && (
            <TextAction onClick={() => void handleRemoveDailyShape()}>Remove</TextAction>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Backup</h2>

        <p className="text-sm text-slate-500">
          {lastBackupAtSetting?.value ? `Last export: ${formatDateTime(lastBackupAtSetting.value)}.` : 'Never exported.'}
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
          ref={backupFileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => void handleBackupFileSelected(e)}
        />

        {backupError && <p className="text-sm text-red-400">{backupError}</p>}
        {backupRestored && <p className="text-sm text-emerald-300">Backup restored.</p>}

        <p className="text-sm text-slate-500">
          Weigh-ins, plates, movement, settings, and the activity log —
          as one file. The GitHub token above is not included; it stays on this device.
        </p>
      </section>

      {/* Field-reports increment (increment 5, ported from Runway):
          "Diagnostics" folds together what Runway splits into two sections
          (Feedback, Activity log) — Tide has fewer settings screens overall,
          so one calm heading covering "trace and report a problem" reads
          better here than two thin sections back to back. */}
      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Diagnostics</h2>

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
            Save token
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
          placeholder={DEFAULT_FEEDBACK_REPO}
          hint="Reports filed to a public repository are publicly visible — including screenshots. A private repository keeps them between you and the reviewer."
        />
        <Button onClick={() => void saveFeedbackRepo()} className="w-full">
          Save repo
        </Button>

        <p className="text-sm text-slate-500">
          Left blank, reports file to {DEFAULT_FEEDBACK_REPO}. Reports are saved on this device the
          moment you file them, token or no token — they sync to GitHub Issues in the background
          whenever a token is set and the device is online.
        </p>

        <div className="flex items-center gap-4">
          <TextAction onClick={() => onNavigate({ name: 'reportProblem', fromScreen: 'settings' })}>
            Report a problem
          </TextAction>
          <TextAction onClick={() => onNavigate({ name: 'activityLog' })}>View activity log</TextAction>
        </div>
        <p className="text-sm text-slate-500">
          The activity log records what the app did and when, kept on this phone. The newest 2000
          events are retained.
        </p>
      </section>

      {/* Last section — an about/version line, same trailing, low-stakes
          position Runway's own Settings gives it. */}
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
