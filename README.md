# Head-in

A game for learning the anatomy of the brain and spinal cord — in depth, from
orientation to expert clinical localization — by travelling the neuraxis the way
a signal does. Offline-first PWA.

See `docs/NEURAXIS_DESIGN.md` for the full design (curriculum, the five game
modes, the retention engine, the UX architecture, and the incremental build
plan) and `CLAUDE.md` for project context.

> Note: this repository previously hosted the PlayDHD app. Head-in replaces it
> as the app on this branch; the PlayDHD source remains in git history.

## Install on Android (Samsung S25 Ultra)

1. Open <https://bosonian.github.io/Play/> in Chrome on your phone.
2. Tap the three-dot menu (top-right) → **Install app**.
3. The icon appears on your home screen; tap to open in standalone mode.

To uninstall: long-press the icon → Uninstall. All data is local to the browser,
so clearing site data also clears the app's data.

## Use on Mac

Open <https://bosonian.github.io/Play/> in any browser. No install needed. Note:
the Mac browser and the phone are independent local stores — data does not sync.

## Dev

```bash
npm install
npm run dev              # local dev on http://localhost:5173/Play/
npm run dev -- --host    # expose on LAN for phone testing (UI only — no PWA install without HTTPS)
npm run build            # typecheck + production build to dist/
```

## Deploy

Push to `main` → GitHub Actions builds and deploys to
<https://bosonian.github.io/Play/>. (This game lives on a feature branch and
won't deploy until merged to `main`.)
