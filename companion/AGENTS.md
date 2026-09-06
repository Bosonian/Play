# Companion agent handover

This directory is Parkinson Companion, separate from the repository-root Head-in/PlayDHD app.

Before Companion work, read `README.md`, `docs/PROJECT_HANDOVER.md` and `docs/NEXT_SESSION_PLAN.md`; verify current branch/status and source before relying on dated facts. For camera work also read the complete `docs/HAND_MOVEMENT_ARCHITECTURE_REVIEW.md`.

Session preferences recorded 2026-09-06:

- Astra orchestrates, plans and reviews; Sol implements bounded changes after the relevant approval. Use available model/team tools honestly; do not silently claim that another model reviewed work it did not review.
- Work in small coherent loops with explicit objectives, appropriate tests, review and documented checkpoints. Avoid unrelated refactors and repeated routine permission questions within authorized work.
- The camera module remains at architecture review. Do not treat approval to document/resume the project as approval to implement it. When the user explicitly approves implementation in a subsequent session, record that checkpoint and proceed within that scope.
- Preserve React/TypeScript/Capacitor and Java Android plugin boundaries. No Kotlin/Compose rewrite.
- Keep existing data/migrations/signing identities. Never uninstall, clear app storage or replace keys as a routine update fix.
- No personal/shared Android storage access by default. Prior permission to inspect one failed-install screenshot was specific to that request, not general gallery access. Request-specific later user instructions take precedence.
- Do not read or print credentials/keystore contents. Camera landmarks must not enter the GitHub issue-report pipeline.
- VisionMD is methods-only: no copying, porting, translation or derivative implementation without exact component-license inspection, compatibility report and explicit approval.
- Update the handover after substantial work: actual commit/build, verification evidence, outstanding device checks, unresolved decisions and next action. Mark historical notes as historical.

These are project-specific reminders of the user's requests, not extra approval requirements. Current explicit user instructions take precedence over dated documentation.
