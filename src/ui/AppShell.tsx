// The app frame: a full-height column with a scrollable content area and the
// fixed bottom nav. Safe-area insets are handled here (top padding on content,
// bottom padding inside the nav) so individual screens don't have to think
// about the notch/gesture bar (design doc §8).

import type { ReactNode } from 'react';
import { BottomNav, type Tab } from './BottomNav';

export function AppShell({
  active,
  onTabChange,
  dueCount,
  children,
}: {
  active: Tab;
  onTabChange: (tab: Tab) => void;
  dueCount: number;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-bg text-fg">
      {/* Content area scrolls; the nav stays put. pt-safe-top clears the
          status bar / punch-hole on the S25. */}
      <main className="flex-1 overflow-y-auto pt-safe-top">{children}</main>
      <BottomNav active={active} onChange={onTabChange} dueCount={dueCount} />
    </div>
  );
}
