import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TextAction } from '../ui/TextAction';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';
import { AVAILABLE_UPDATE_SETTING, checkForUpdate, parseAvailableUpdate } from '../lib/updateCheck';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * Health Connect (increment 3) and backup/restore (a later increment,
 * ported from Runway) are still stubs — TIDE_PLAN.md's roadmap puts both
 * after this one. The "Updates" section below is real as of increment 2,
 * mirroring Runway's own Settings.tsx section of the same name.
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

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 pb-12 pt-safe-top">
      <div className="pt-8">
        <ScreenHeader title="Settings" onBack={() => onNavigate({ name: 'home' })} />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-800/60 bg-surface p-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">Health Connect</h2>
        <p className="text-sm text-slate-500">
          Coming in a later increment: read weight and body-fat automatically from the Renpho scale via
          Samsung Health and Health Connect. Manual entry works today.
        </p>
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
