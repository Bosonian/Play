# PlayDHD

Personal app for protecting time for play. See `PLAYDHD_APP_BRIEF_v2.md` for the build brief and `CLAUDE.md` for project context.

## Dev

```bash
npm install
npm run dev              # local dev on http://localhost:5173
npm run dev -- --host    # expose on LAN for phone testing (UI only — LAN dev isn't HTTPS, so no PWA install)
npm run build            # typecheck + production build to dist/
```

## Deploy

Push to `main` → GitHub Actions builds and deploys to https://bosonian.github.io/Play/.
