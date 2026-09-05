# Doctor PWA and medication-photo import plan

Status: architecture decision for the next product stages. This document does not claim that the current local Doctor mode is safe for multiple patients or that cloud image processing is enabled.

## Product decision

Build a separate responsive doctor workspace as an installable PWA and deploy its web and API layers on Vercel. Keep the Android patient experience bound to one immutable device patient. A doctor may select among many authorized patient records in the web workspace, but that selection must never change which patient the Android device logs for.

Use Gemini only to convert a medicine-list image into an untrusted structured draft. The model never prescribes, fills missing directions, chooses an equivalent medicine, or writes to a regimen. The doctor compares every extracted field with the source image and explicitly applies reviewed rows.

The production preference is Gemini through Vertex AI in a configured European location because Google Cloud documents regional data-location and security controls for supported Generative AI services. A paid Gemini Developer API project can support a prototype only after its data-processing and retention configuration has passed the same review. A paid plan's no-training commitment is useful, but it is not the same as zero retention or EU-only processing.

## Target architecture

```text
Patient Android app ── paired, idempotent sync ──┐
                                                  │
Doctor browser/PWA ── authenticated session ── Vercel API (fra1)
                                                  │
                     ┌────────────────────────────┼──────────────────────────┐
                     │                            │                          │
              EU relational database       immutable audit log     Gemini/Vertex adapter
              tenant + patient scoped      tenant + patient scoped  transient inline image
                                                                         │
                                                               structured draft only
```

Vercel's `fra1` setting controls Function execution location. It does not by itself guarantee that every processor, log, failover path, or transfer stays in Germany or the EU. The release review must include the current Vercel DPA and subprocessors, the database provider, Google Cloud/Gemini terms, backups, operational logs, support access, and deletion behavior.

## Identity and patient isolation first

The current Companion implementation is single-patient:

- `ensureLocalPatient()` selects the first local patient record.
- Patient and Doctor mode use the same `usePatient()` hook.
- Activity-log and report paths are not consistently patient-owned.

A safe dashboard cannot be a dropdown added to that model. Add these separate identities:

- `devicePatientId`: immutable binding used by the patient's Android installation.
- `tenantId`: clinic or practice boundary.
- `userId`: authenticated doctor or authorized staff member.
- `doctorSelectedPatientId`: workspace navigation state only.
- `patientCode`: a clinic-visible, de-identified label; names and direct identifiers remain outside Companion unless a later, explicit policy changes that decision.

Every patient-owned row carries `tenantId` and `patientId`. Authorization occurs on the server for every read and write; a patient ID from the browser is never sufficient authority. All detail reads, writes, exports, reports, drafts, undo records, sync bundles, and audit records verify both ownership fields.

Switching patients must key and unmount patient-specific screens. A pending save or extraction remains bound to the patient that started it, and the UI blocks applying it after the selected patient changes until the doctor returns to the original record.

Use production authentication with individual accounts, MFA or passkeys, short-lived sessions, revocation, and role checks. The local Doctor-mode passcode of at least six characters is not web authentication.

## Responsive doctor workspace

The first PWA dashboard should show operational facts that are already recorded, without clinical inference:

- searchable patient code and optional non-identifying label;
- last successful device sync;
- active observation period and collection progress;
- latest self-report and tapping-session timestamp;
- count of unreviewed imported drafts;
- direct actions for patient detail, regimen, observation history, and import.

Desktop uses a patient list beside the selected patient detail. Mobile uses the same routes as a stacked list and detail flow with a persistent patient-code header. Both layouts must expose the selected patient code at every write screen.

Avoid severity rankings, red/green treatment judgements, inferred ON/OFF labels, or medication recommendations until their clinical rules and intended use have been separately validated.

The PWA requires a web manifest, icons, install metadata, an offline shell, and an update strategy. Patient data, regimen drafts, and medicine images must not be placed in a general service-worker cache. Authenticated data requests use `Cache-Control: no-store`. Offline clinical writes need an explicit encrypted queue and conflict design; until then, show read-only cached shell behavior and require a connection to save.

## Medication-photo workflow

1. From an already selected patient, the doctor chooses Camera or Photo library.
2. The browser shows crop/rotate controls and asks the doctor to exclude names, addresses, barcodes, and unrelated pages where practical.
3. The client accepts only JPEG, PNG, or WebP, enforces pixel and byte limits, removes image metadata, and sends the normalized image to an authenticated patient-bound endpoint.
4. The endpoint checks tenant membership, content type, decoded image dimensions, request size, rate limit, and a single-use request ID.
5. The server sends inline image bytes to the configured Gemini adapter. It does not use Search grounding, the Gemini File API, Vercel Blob, analytics payload capture, request-body logging, or response caching.
6. Gemini returns JSON constrained by a versioned response schema. The server validates it independently and maps unknown or invalid values to blank fields.
7. The review screen keeps the source image visible beside editable draft rows. Each row shows its source text/crop and unresolved fields.
8. The doctor explicitly confirms or excludes every row, then chooses **Apply reviewed medicines**.
9. One transaction creates or updates the confirmed regimen rows and writes an immutable audit record. Retry uses stable import and row IDs, so it cannot duplicate medicines.
10. Image bytes are discarded after the response/review session according to the approved retention design. The durable record contains the request ID, image hash, model/schema versions, extracted draft, doctor-confirmed values, actor, patient, timestamps, and transaction result; it does not contain the image by default.

### Extraction schema

Each draft row should support:

- source text and source-region coordinates;
- medicine/product name;
- active ingredients for combination products;
- formulation and release type, such as IR, dispersible, or prolonged release;
- strength with unit and the ingredient to which it applies;
- quantity per administration, preserving tablet fractions as source text;
- scheduled clock times, each with its own dose;
- PRN indication and source instructions;
- model-supplied field confidence as a review hint only;
- validation issues and unresolved fields.

The extractor must not:

- invent a dose, time, indication, maximum, or interval;
- infer a schedule from a package photo;
- silently convert salts to active moieties;
- silently convert mg, drops, patches, tablets, or fractions;
- merge immediate-release and prolonged-release products;
- replace an existing regimen row;
- calculate medication eligibility or recommend treatment.

A medicine name can be matched against the saved catalogue to suggest an identity. The doctor must confirm the match. Ambiguous matches remain custom medicines.

## API boundaries

Suggested endpoints:

- `GET /api/patients`: authorized dashboard summary.
- `GET /api/patients/:id`: patient detail with ownership check.
- `POST /api/patients/:id/imports`: create a bound import request.
- `POST /api/patients/:id/imports/:importId/extract`: transient Gemini extraction.
- `PUT /api/patients/:id/imports/:importId/draft`: save doctor edits without changing regimen.
- `POST /api/patients/:id/imports/:importId/apply`: validate confirmations and apply once transactionally.
- `POST /api/device-sync`: authenticated, paired, idempotent event exchange.

The browser never receives a Gemini credential. Vercel environment secrets are server-only and must never use the `VITE_` prefix.

## Release sequence and gates

### Stage 1: identity and read-only dashboard

- Introduce tenant, user, device-patient, and selected-patient identities.
- Make every store/API operation explicitly patient-scoped.
- Move activity/audit data to tenant and patient ownership.
- Add server authorization and a read-only responsive dashboard.
- Test direct-ID access, cross-tenant access, exports, reports, delayed queries, and A-to-B patient switching.

### Stage 2: photo to draft

- Add capture/crop UI, the server Gemini adapter, strict schema validation, and the review screen.
- Keep regimen writes disabled.
- Evaluate a de-identified fixture set covering German and English lists, handwriting where in scope, decimals using comma and point, tablet fractions, combination drugs, IR/ER distinctions, patches, drops, duplicate rows, crossed-out text, PRN conditions, and unreadable fields.
- Record per-field precision/recall and dangerous substitution/omission counts. A low aggregate error rate cannot hide a strength, formulation, schedule, or patient-assignment error.

### Stage 3: reviewed apply and patient sync

- Add explicit row confirmations, transactional apply, audit history, idempotent retry, and conflict handling.
- Test cancel/no-write, partial confirmation rejection, rollback, duplicate retry, edited extracted values, active-study snapshot behavior, and switching patients during extraction or apply.
- Add device pairing and scoped sync without changing the Android device-patient binding.

### Production gates

Before any real patient image is processed:

- execute provider data-processing agreements and review subprocessors/transfers;
- document the lawful basis, controller/processor roles, retention/deletion, access, incident response, and a data-protection impact assessment as applicable;
- choose and verify supported model and regional processing configuration;
- confirm no body/image capture in Vercel, database, monitoring, error, or AI request logs;
- complete threat modelling, dependency/security review, backup and deletion tests;
- pass extraction safety fixtures and cross-patient isolation tests;
- show the doctor the remote-processing disclosure and retain the required audit evidence.

## Evidence behind the tapping decision

Companion's current test is a ten-second, two-target, single-index-finger touchscreen task. A published validation study used the same broad ten-second alternating-target structure, while a home proof-of-concept tested each hand and found learning and time effects. This supports continued measurement, not equivalence to MDS-UPDRS.

Each hand should be tested alone, and both hands should normally be completed. Keep the current fixed left-then-right order so longitudinal records remain comparable. Record the order and use the same phone, stable surface, hand posture, and instructions. The safe outputs are tapping attempts/successes per second, interval regularity, errors, and temporal rate change within the same person and hand.

Do not present these results as an MDS-UPDRS score, movement-amplitude decrement, diagnosis, severity class, objective ON/OFF decision, or proof of treatment effectiveness. Add practice trials, repeat trials, formal device/target calibration, test-retest thresholds, asymmetry interpretation, and prospective clinical validation before using the measure for treatment decisions.

## Current source notes (checked 2026-09-05)

- MDS-UPDRS item 3.4 tests each hand separately and assesses speed, amplitude, interruptions, and decrement: https://www.movementdisorders.org/MDS-Files1/Resources/PDFs/MDS-UPDRS.pdf
- Ten-second smartphone alternating-target validation study: https://pmc.ncbi.nlm.nih.gov/articles/PMC4965104/
- Home smartphone tapping proof-of-concept, including reliability and learning effects: https://pmc.ncbi.nlm.nih.gov/articles/PMC10237522/
- Gemini Developer API paid-service and zero-data-retention details: https://ai.google.dev/gemini-api/docs/zdr
- Vertex AI zero-data-retention guidance: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention
- Google Cloud services that can be configured for data location: https://cloud.google.com/terms/data-residency
- Vercel Function default/available regions: https://vercel.com/docs/regions
- Vercel data-processing addendum: https://vercel.com/legal/dpa
