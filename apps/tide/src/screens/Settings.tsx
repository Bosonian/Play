import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { Button } from '../ui/Button';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, checkForUpdate, parseAvailableUpdate } from '../lib/updateCheck';
import { HEALTH_CONNECT_ENABLED_SETTING, HEALTH_LAST_SYNC_AT_SETTING } from '../lib/healthSettings';
import { isHealthConnectAvailable, requestHealthPermissions } from '../native/healthConnect';
import { syncHealthData } from '../lib/healthSync';
import { logEvent } from '../lib/eventLog';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

/** What the "Connect health data" tap has produced so far, purely for THIS
 * screen's own inline feedback — not persisted (the durable record is the
 * `HEALTH_CONNECT_ENABLED_SETTING` row itself). Mirrors the Updates
 * section's own `updateCheckOutcome` state shape below. */
type ConnectOutcome = 'idle' | 'checking' | 'notInstalled' | 'unsupported' | 'declined' | 'connected';

/**
 * Backup/restore (a later increment, ported from Runway) is still a stub —
 * TIDE_PLAN.md's roadmap puts it after this one. Health Connect is real as
 * of increment 3 (this one); Updates has been real since increment 2.
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
   * to default to it), no year (a sync happened today or very recently in
   * every realistic case — the year would be pure clutter). */
  function formatLastSync(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
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
              Connected. {lastSyncSetting?.value ? `Last sync: ${formatLastSync(lastSyncSetting.value)}.` : 'No sync yet.'}
            </p>
            <div className="flex items-center gap-4">
              <TextAction onClick={() => void handleSyncNow()} disabled={syncing} className="disabled:opacity-40">
                {syncing ? 'Syncing.' : 'Sync now'}
              </TextAction>
              <TextAction onClick={() => void handleDisconnect()}>Disconnect</TextAction>
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

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Backup</h2>
        <p className="text-sm text-slate-500">
          Coming in a later increment, ported from Runway: export and restore everything Tide has
          recorded as one file.
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
