# Companion — changelog

A de-identified, physician-in-the-loop Parkinson's dosing companion. Patients
log levodopa doses, motor state, and meals; the treating neurologist reviews the
patterns and adjusts the prescription. The app never prescribes.

## 0.1.0 — App skeleton, two modes, doctor passcode, CI APK

The first installable shell. No patient data is logged yet — this increment puts
the *frame* in place so features have somewhere to land, and gets an APK building
in CI from day one so there's always something real to sideload.

- **Two modes in one app.** Patient (default) and Doctor, via a header toggle.
- **Doctor mode behind a local passcode.** PBKDF2-HMAC-SHA256 (210k iterations,
  16-byte random salt); only a salted hash is stored, in `localStorage`, never
  the passcode. First entry sets it; later entries verify it. Doctor mode
  re-locks on reload *and* when switching back to patient mode — the phone is
  the patient's, so unlocked access must not ride along. Honest limitation
  (in-code): this deters casual poking on an unlocked phone, it is not a
  security boundary against someone determined with the device; the real
  ceiling is passcode entropy.
- **Reuses the tested core** (de-identified data model + levodopa PK/PD engine);
  no duplication.
- **Builds to an Android APK in GitHub Actions** (debug artifact per push). iOS
  is intentionally deferred; the code stays portable.

### Deliberately NOT in this increment
No dose/motor/meal logging, no charts, no WebRTC sync, no iOS project, no
GitHub Pages deploy, no passcode recovery/lockout/biometrics.

### Not verified in this environment
The APK **compile** happens only in CI — this sandbox has Java + Gradle but no
Android SDK and can't download it, so the first CI run is the real test of the
Android build (SDK provisioning, Gradle/AGP versions). The web build, the full
passcode flow, and the 14-test suite were all verified locally in a browser.
