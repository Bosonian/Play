# Parkinson Companion

Start here for Parkinson Companion work. This app lives in `companion/`; the repository-root app and README describe the separate Head-in project.

Current published application: **0.16.2 / Android build 21**, source `fef3d2df1633ebb0e94a94a3b1af8189a1dd6d80`, branch `codex/observation-review`, repository `Bosonian/Play`. Documentation refreshed 2026-09-06; check Git before assuming this remains latest.

1. Read [PROJECT_HANDOVER.md](docs/PROJECT_HANDOVER.md) for shipped features, architecture, data, release commands, evidence and unresolved issues.
2. Read [NEXT_SESSION_PLAN.md](docs/NEXT_SESSION_PLAN.md) for the exact stopping point and next work.
3. Read [HAND_MOVEMENT_ARCHITECTURE_REVIEW.md](docs/HAND_MOVEMENT_ARCHITECTURE_REVIEW.md) for the complete 15-part camera proposal.

**Camera implementation is not approved yet.** The user requested architecture review first, then asked to save the plan for the next session. No camera module, model or dependency has been added. Astra plans/reviews; Sol codes only after approval.

## Run from this directory

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

Android packaging and the Termux-specific environment are documented in the handover. Do not run the root app's build/deployment instructions for Companion.

## Current downloads

- [Release-signed APK, build 21](https://github.com/Bosonian/Play/releases/download/companion-build-21/companion.apk)
- [Known local legacy-signed APK, build 21](https://github.com/Bosonian/Play/releases/download/companion-build-21/companion-legacy.apk)
- [Verified GitHub build](https://github.com/Bosonian/Play/actions/runs/34039944542)

Use the matching signer for an existing installation. The actual installed signer and successful data-preserving upgrade on the user's phone remain unconfirmed. A working download does not establish installation success.

## Documentation map

| Document | Purpose |
| --- | --- |
| [Project handover](docs/PROJECT_HANDOVER.md) | Current implementation and operational facts |
| [Next session](docs/NEXT_SESSION_PLAN.md) | Resume instructions, approval boundary and staged camera work |
| [Camera architecture review](docs/HAND_MOVEMENT_ARCHITECTURE_REVIEW.md) | Detailed proposed scientific/acquisition/storage contracts |
| [Android updates](docs/APP_UPDATES.md) | Signer-aware updates and release publication |
| [Tapping feedback](docs/TAPPING_FEEDBACK.md) | Protocol v4 feedback behavior and device acceptance |
| [OCR and doctor workspace](docs/DOCTOR_PWA_AND_IMPORT_PLAN.md) | Implemented reviewed OCR vs future remote workspace |
| [Device acceptance](docs/CHECKIN_OCR_ACCEPTANCE.md) | Outstanding installed-device tests |
| [Build roadmap](docs/BUILD_PLAN.md) | Mixed completed/future roadmap, not a shipped-feature inventory |
| [Research basis](docs/RESEARCH.md) | Historical design/scientific background, not current implementation authority |
| [Observation handoff](docs/OBSERVATION_HANDOFF.md) | Historical observation foundation |
| [0.16.0 delivery](docs/CHECKIN_OCR_DELIVERY.md) | Historical build-6 evidence |
| [Changelog](CHANGELOG.md) | Release changes |

This is an experimental local diary/measurement application, not a validated diagnostic or prescribing system.
