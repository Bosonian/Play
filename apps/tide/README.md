# Tide

Tide is the second app in this monorepo, sibling to Runway — same person,
different domain of his life. Where Runway keeps Deepak out the door on
time, Tide owns the behaviour between medical visits that moves the number
his physician actually cares about: weight, on a trend, measured honestly.
Tide is not a medical device and does not set targets — the target (and the
workup: LFTs, FibroScan) belongs to Deepak and his physician. See
`docs/TIDE_PLAN.md` at the monorepo root for the full plan, and the root
`CLAUDE.md` for the tone/copy/defaults contract both apps share.

## Increment 1 scope (this one)

A runnable web app — Vite dev server, Vitest — with no native layer yet:

- A Dexie database (`weighIns`, `meals`, `movement`, `settings`) — only
  `weighIns` has a screen this increment; the others are schema defined
  ahead of the increments that use them (TIDE_PLAN.md §7).
- The trend engine (`src/lib/trend.ts`): EMA-smoothed weight trend + slope,
  evidence-floored, pure and heavily tested. This is the app's heart.
- Four screens: Home (the trend headline), Add weigh-in (manual entry),
  History (most recent first), Settings (a stub — Health Connect and
  backup both land in later increments).

Design system primitives (`src/ui/`) are copied verbatim from
`apps/runway/src/ui/` rather than shared through a package — see each
file's header comment. A shared `ui` package across apps is a future
cleanup, not a one-increment job.

## Running it

```
npm install
npm run dev        # Vite dev server
npm run test       # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # tsc -b && vite build
```

Web-only until increment 2 adds Capacitor, mirroring Runway's own
signed-APK CI workflow, self-update checker, activity log, and
backup/restore.
