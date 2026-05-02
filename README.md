# PlayDHD

Personal app for protecting time for play. See `PLAYDHD_APP_BRIEF_v2.md` for the build brief and `CLAUDE.md` for project context.

## Install on Android (Samsung S25 Ultra)

1. Open <https://bosonian.github.io/Play/> in Chrome on your phone.
2. Tap the three-dot menu (top-right) → **Install app**.
3. The icon appears on your home screen; tap to open in standalone mode (no browser chrome).

To uninstall: long-press the icon → Uninstall. All your data is local to the browser, so uninstalling Chrome OR clearing site data also clears the app's data.

## Use on Mac

Open <https://bosonian.github.io/Play/> in any browser. No install needed; everything works from the page. Note: the Mac browser and the phone are independent stores — data does not sync between them.

## Dev

```bash
npm install
npm run dev              # local dev on http://localhost:5173
npm run dev -- --host    # expose on LAN for phone testing (UI only — LAN dev isn't HTTPS, so no PWA install)
npm run build            # typecheck + production build to dist/
```

## Deploy

Push to `main` → GitHub Actions builds and deploys to <https://bosonian.github.io/Play/>. ~60s end-to-end.
