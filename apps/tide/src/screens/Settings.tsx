import type { Screen } from '../App';
import { ScreenHeader } from '../ui/ScreenHeader';
import { APP_VERSION, APP_VERSION_CODE } from '../lib/appVersion';

interface SettingsProps {
  onNavigate: (screen: Screen) => void;
}

/**
 * A stub this increment — TIDE_PLAN.md's roadmap puts Health Connect
 * (increment 3) and backup/restore (increment 2, ported from Runway) both
 * later than the scaffold. Nothing here writes to `db.settings` yet; the
 * table exists (db/types.ts) waiting for the first real setting to need
 * it.
 */
export function Settings({ onNavigate }: SettingsProps) {
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

      <section className="flex flex-col gap-3 border-t border-slate-800 pt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">About</h2>
        <p className="text-sm text-slate-500">
          Version {APP_VERSION} ({APP_VERSION_CODE}).
        </p>
      </section>
    </div>
  );
}
