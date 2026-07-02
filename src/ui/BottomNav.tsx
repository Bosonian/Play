// The four-tab bottom navigation — the app's spine (design doc §8.1).
//
// The five game *modes* are deliberately NOT here: modes launch contextually
// from a region (Map → NodeSheet) or from the daily queue, so the app answers
// "what should I do next?" instead of making the user pick a mode cold. The
// four tabs are the durable destinations.

import { MapIcon, TodayIcon, StatsIcon, MoreIcon } from './icons';

export type Tab = 'map' | 'today' | 'stats' | 'more';

const TABS: { id: Tab; label: string; Icon: typeof MapIcon }[] = [
  { id: 'map', label: 'Map', Icon: MapIcon },
  { id: 'today', label: 'Today', Icon: TodayIcon },
  { id: 'stats', label: 'Stats', Icon: StatsIcon },
  { id: 'more', label: 'More', Icon: MoreIcon },
];

export function BottomNav({
  active,
  onChange,
  dueCount,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  dueCount: number; // the app's only badge — on Today, hidden when 0 (§8.1)
}) {
  return (
    <nav
      aria-label="Primary"
      className="flex-none border-t border-line bg-surface pb-safe-bottom"
    >
      <ul className="flex">
        {TABS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          const showBadge = id === 'today' && dueCount > 0;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-current={isActive ? 'page' : undefined}
                // 56px min height keeps the whole tab a comfortable touch target.
                className={`relative flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 py-2 text-caption font-medium transition-colors ${
                  isActive ? 'text-accent' : 'text-fg-faint'
                }`}
              >
                <span className="relative">
                  <Icon className="h-6 w-6" />
                  {showBadge && (
                    <span
                      className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-accent px-1 text-[10px] leading-4 text-white"
                      aria-label={`${dueCount} due`}
                    >
                      {dueCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
