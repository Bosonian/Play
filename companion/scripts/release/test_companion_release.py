import importlib.util
import argparse
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("companion_release.py")
SPEC = importlib.util.spec_from_file_location("companion_release", MODULE_PATH)
release = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(release)


def record(asset: str, code: int = 20) -> dict[str, object]:
    return {
        "signerSha256": "a" * 64,
        "versionCode": code,
        "versionName": "0.16.1",
        "assetName": asset,
        "apkUrl": f"https://github.com/Bosonian/Play/releases/download/companion-build-{code}/{asset}",
        "sha256": "b" * 64,
        "sizeBytes": 123,
    }


class CompanionReleaseTests(unittest.TestCase):
    def test_next_code_starts_at_twenty_and_ignores_unrelated_tags(self) -> None:
        self.assertEqual(release.next_code(["other", "companion-build-x"]), 20)
        self.assertEqual(release.next_code(["companion-build-20", "companion-build-24"]), 25)

    def test_manifest_participates_in_monotonic_allocation(self) -> None:
        manifest = {
            "schemaVersion": 1,
            "packageName": release.PACKAGE_NAME,
            "releases": [record("companion.apk", 27), record("companion-legacy.apk", 27)],
        }
        self.assertEqual(release.next_code(["companion-build-25"], manifest=manifest), 28)

    def test_release_body_contains_one_strict_round_trippable_manifest(self) -> None:
        records = [record("companion.apk"), record("companion-legacy.apk")]
        body = release.release_body("0.16.1", 20, "deadbeef", records)
        self.assertEqual(body.count("<!-- companion-update-manifest:v1\n"), 1)
        self.assertEqual(release.parse_update_manifest(body)["releases"], records)

    def test_latest_manifest_is_not_edited_when_download_verification_fails(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            temp = Path(raw)
            release_apk = temp / "companion.apk"
            legacy_apk = temp / "companion-legacy.apk"
            release_apk.write_bytes(b"release")
            legacy_apk.write_bytes(b"legacy")
            body_file = temp / "body.md"
            body_file.write_text("body")
            args = argparse.Namespace(
                repo="Bosonian/Play", commit="deadbeef", code=20, version="0.16.1",
                release_apk=release_apk, legacy_apk=legacy_apk,
                release_cert="a" * 64, legacy_cert="b" * 64,
                apksigner="apksigner", aapt="aapt",
            )
            commands: list[tuple[str, ...]] = []
            def fake_run(*parts: str, **_kwargs: object):
                commands.append(parts)
                return None
            with patch.object(release, "release_exists", return_value=True), \
                patch.object(release, "run", side_effect=fake_run), \
                patch.object(release, "verify_downloaded", side_effect=SystemExit("bad asset")):
                with self.assertRaises(SystemExit):
                    release.update_latest(args, temp, body_file)
            self.assertFalse(any(parts[:3] == ("gh", "release", "edit") for parts in commands))
            self.assertFalse(any(parts[:3] == ("gh", "api", "--method") for parts in commands))

    def test_manifest_rejects_mutable_urls_and_old_legacy_bootstrap(self) -> None:
        records = [record("companion.apk"), record("companion-legacy.apk", 18)]
        body = release.release_body("0.16.1", 20, "deadbeef", records)
        with self.assertRaises(SystemExit):
            release.parse_update_manifest(body)
        records = [record("companion.apk"), record("companion-legacy.apk")]
        records[0]["apkUrl"] = "https://example.test/companion-latest/companion.apk"
        with self.assertRaises(SystemExit):
            release.parse_update_manifest(release.release_body("0.16.1", 20, "deadbeef", records))


if __name__ == "__main__":
    unittest.main()
