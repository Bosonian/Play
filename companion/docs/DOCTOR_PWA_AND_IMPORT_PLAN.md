# Doctor workspace and medicine-photo import

Current checkpoint: [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md). The tapping discussion below describes the v3 acquisition foundation; current v4 adds reactive target colour/haptic feedback, with the same fixed-target task and unchanged feature schema. Remote PWA remains future work.

Status: the single-patient Android app now contains a doctor-reviewed Google Cloud Vision
medicine-photo import. A multi-patient doctor PWA, cloud patient database, and device sync remain
future stages.

## Android implementation (device acceptance pending)

The import is available only after Doctor mode is unlocked. It remains bound to the same
de-identified patient code as the local regimen.

Google Cloud Vision performs text recognition only. Companion's versioned conservative parser
turns selected OCR lines into an untrusted draft. It does not prescribe, match a medicine
automatically, repair OCR characters, infer a missing dose or time, interpret schedules such as
`1-0-1`, promote a printed strength into a dose, convert combination strengths, or replace an
existing regimen row.

The workflow is:

1. The doctor enters a Google Cloud project ID and uses the native **Add API key** or
   **Replace API key** action. The Android bridge stores the key outside web storage. The setup
   screen shows the Android package and certificate SHA-1 needed for API-key restrictions.
2. **Test connection** verifies the configured Vision endpoint before a patient photo is used.
3. Before choosing a photo, the doctor acknowledges that the image will be sent to Google Cloud
   Vision for EU processing. The screen asks the doctor to exclude names, addresses, barcodes,
   and unrelated pages.
4. The doctor chooses an existing JPEG, PNG, or WebP image. Companion decodes it with browser
   orientation handling, bounds its dimensions, draws it to an offscreen canvas, and re-encodes a
   metadata-free JPEG used for both preview and upload. In-app camera capture is not enabled because
   the current Capacitor capture path can leave an external-files temporary image behind.
5. The native bridge sends the image to Vision `DOCUMENT_TEXT_DETECTION`. A request ID binds the
   response to the active screen. Cancelled, replaced, late, or mismatched responses are ignored.
6. The doctor selects OCR lines for one medicine. The parser keeps exact evidence substrings and
   line IDs. The review shows printed strength as text evidence only.
7. The doctor explicitly chooses a built-in medicine, a saved custom profile, or **Add as other
   medicine**. Missing formulation, dose, time, or PRN indication remains blank.
8. Three separate checks confirm identity, product/formulation, and directions against the photo.
   A reviewed medicine is staged in memory. The doctor can then select another group of lines.
9. **Add N reviewed medicines** validates every staged regimen item and applies the receipt,
   regimen rows, and any new custom profiles in one IndexedDB transaction.

The durable receipt contains the import/request ID, patient code, provider and feature,
EU-region marker, schema and parser versions, SHA-256 image hash, local doctor actor, application
time, and confirmed regimen snapshots. It contains no image bytes, preview, raw OCR text, OCR
polygons, or editable draft. Explicitly reviewed source-derived directions may be
persisted as prescription instructions; the full OCR response is not persisted.
Images, OCR responses, selected lines, and drafts are React memory
only and are dropped on cancel, navigation, or successful apply.

The receipt and regimen inserts are append-only. A retry with the same import payload is
idempotent. A changed payload using the same import ID, an occupied regimen ID, a patient mismatch,
an invalid regimen item, or an exact duplicate aborts the entire transaction. Custom medicine
profiles are reused only by their exact normalized name-plus-formulation key.

## Provider setup and limits

Create a Google Cloud project with Cloud Vision enabled and billing configured. Restrict the API
key to the Cloud Vision API and to the Android package/certificate shown by Companion. Use
**Remove API key** before transferring or retiring a device. A successful connection test confirms
credentials and reachability; it does not validate clinical extraction quality.

Photo import requires the Android build and a network connection. The web build gives a manual-entry
fallback and never asks for or handles a Vision credential. Companion does not send OCR text to a
generative model and does not use Gemini, Vertex generative models, Search grounding, the Gemini
File API, Vercel Blob, or a Companion cloud proxy in this design.

Vision can omit, split, or misread printed and handwritten text. It can confuse decimal separators,
release formulations, combination products, units, and adjacent rows. Every field therefore
requires comparison with the photo. The feature is a transcription aid, not medication
reconciliation, interaction checking, clinical decision support, or proof that a prescription is
current.

Before processing real patient documents, the deploying organization must confirm its Google Cloud
contract and regional configuration, lawful basis, controller/processor roles, retention and
deletion behavior, access controls, incident response, and any required data-protection impact
assessment. It should validate extraction against representative German and English lists,
handwriting if accepted locally, decimal comma and point, IR/ER products, patches, PRN directions,
combination strengths, crossed-out text, and unreadable fields. Dangerous substitutions and
omissions must be reviewed separately from aggregate OCR accuracy.

## Future doctor PWA

A remote multi-patient workspace cannot safely reuse the current local patient selection or
local Doctor-mode passcode. It needs separate tenant, authenticated user, immutable
device-patient, selected-patient, and de-identified patient-code identities. Every server read,
write, report, export, sync bundle, and audit event must enforce tenant and patient ownership.

The first PWA stage should be read-only: patient search, last device sync, observation progress,
latest self-report and tapping timestamp, and links to regimen and observation history. Add
individual accounts, MFA or passkeys, short-lived sessions, revocation, role checks, no-store
responses, and cross-tenant authorization tests before remote clinical writes.

Later stages can add paired idempotent device sync, reviewed regimen writes, reports, and an
encrypted offline write queue with explicit conflict handling. Patient data and medicine images
must never enter a general service-worker cache. A pending import or save stays bound to the patient
that started it and cannot follow a dashboard patient switch.

## Finger-tapping evidence boundary

Companion's protocol v3 is a ten-second, self-paced two-target, single-index-finger
touchscreen task. Both targets stay visually identical. Either side is a valid first tap;
subsequent taps alternate. Each hand is tested separately, left then right. Earlier
color-cued protocol v2 records remain distinguishable by their stored protocol version.
The patient reports ON, OFF, ON with dyskinesia, or uncertain before the bilateral session.
This removes the changing visual cue but does not isolate pure bradykinesia or establish
clinical validity. The cited study used fixed physical target geometry and three trials
per hand; this app currently uses responsive targets and one trial per hand. Safe descriptive outputs include attempts/successes per
second, interval regularity, errors, and within-person temporal rate change.

Do not present these results as an MDS-UPDRS score, movement-amplitude decrement, diagnosis,
severity class, objective ON/OFF decision, or proof of treatment effectiveness. Practice trials,
repeat trials, device and target calibration, test-retest thresholds, asymmetry interpretation,
and prospective clinical validation are required before treatment decisions rely on the measure.

Reference material:

- MDS-UPDRS item 3.4: https://www.movementdisorders.org/MDS-Files1/Resources/PDFs/MDS-UPDRS.pdf
- Ten-second smartphone alternating-target study: https://pmc.ncbi.nlm.nih.gov/articles/PMC4965104/
- Home smartphone tapping proof of concept: https://pmc.ncbi.nlm.nih.gov/articles/PMC10237522/
- Cloud Vision data locations: https://cloud.google.com/vision/docs/locations
- Google Cloud API-key restrictions: https://cloud.google.com/docs/authentication/api-keys
