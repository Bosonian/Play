# Android app updates

The 0.16.1 update fixes two independent problems: the public release was built
from an old branch, and locally installed APKs had a different signing identity
and version-number sequence from GitHub release APKs.

## Existing installations

The first upgrade from a local 0.16.0-or-earlier build needs the direct
`companion-legacy.apk` link for build 20. Install it over the existing app; do not
uninstall or clear app storage. Its signing certificate is the same as the recent
local builds. Android still requires the user to confirm installation.

Existing release-signed installations use `companion.apk`. That filename retains
its original release signer permanently. One ordinary APK cannot update both
signing identities. An old public `app-debug.apk` version 1 used a third key whose
private counterpart is not available here; compatibility with that historical
installation is not claimed.

## Updated app behavior

A native plugin reads the installed package name, Android versionCode and current
single signing certificate SHA-256. The app reads the versioned update manifest
embedded in the public companion-latest release description and selects only a
newer APK with that exact package and signer. Missing/unknown identity, malformed
metadata, duplicate signers or invalid URLs yield no update offer. There is no
fallback to the other APK. No patient data is sent by the update check.

The Download button opens an immutable build-specific GitHub APK URL in the
browser. The browser downloads it and Android handles installation; this is not
silent installation. Manifest APK hashes are release-verification metadata, not
a claim that the WebView verifies downloaded bytes. Android verifies the APK
signature during installation.

## Publishing

The maintained branch is codex/observation-review. A globally serialized workflow
builds both channels from the same source with the same monotonically increasing
versionCode and VITE_APP_BUILD. The local bootstrap is build 20, following the old
published build 19. Later publications allocate above the published maximum.

Both APKs are non-debuggable release builds. `companion.apk` uses the existing
repository test release key. `companion-legacy.apk` uses the preserved local
signing key supplied through the encrypted GitHub Actions secret
COMPANION_LEGACY_KEYSTORE_BASE64; that private key is never committed or logged.
Missing or changed signing identity must fail publishing rather than generate a
replacement key. These existing test identities are not a production Play signing
strategy.

Publish immutable companion-build-N assets first and verify public bytes,
package/version/certificate/hash. Update the moving companion-latest assets and
description only after the immutable pair is complete. New apps use immutable
URLs; old release clients continue using companion-latest/companion.apk. Remove
all obsolete instructions to uninstall for an upgrade. A failed publication must
not advertise a partially uploaded build.

## Known evidence limits

Automated verification can establish package/version/signature and update
selection behavior. It does not establish that Android installation preserves the
actual patient's records on this phone; that requires an installed-app upgrade
check. No patient data or shared Android storage was accessed for this fix.

## Validation for 0.16.1 / build 20

331 app tests passed across 36 files; the focused updater tests include 17 cases.
Publisher tests passed 5/5, including a failure that must not update the advertised
manifest. TypeScript and production web build passed. Android release unit tests,
lint and both signing variants built successfully. Astra approved the updater and
the publication gate. Both APK variants were checked for the exact package, code,
version, non-debuggable status and expected certificate; their application payloads
match. The release publisher verifies uploaded bytes again before advertising them.

Signing certificate SHA-256 values:

- Release: `f8ae5a2403c53b65fdf2ab471da67706bc58cfcb87cba3c9c04750ba15604c43`
- Recent local installation: `c3b8e9dcc82357158ba815dbf6d5c6c021a1008c5c32337bc01cf9b93af85930`

The bootstrap publication is performed locally with the reviewed publisher; its
commit skips automatic CI to prevent a concurrent release. The updated GitHub
workflow has been reviewed and its shell blocks syntax-checked, but a complete
GitHub-hosted execution of the new workflow has not yet been observed.
