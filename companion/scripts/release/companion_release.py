#!/usr/bin/env python3
"""Verify and publish dual-signed Companion APK releases without exposing signing material."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

PACKAGE_NAME = "app.dosing.companion"
MANIFEST_MARKER = "companion-update-manifest:v1"
BUILD_TAG = re.compile(r"^companion-build-(\d+)$")
PACKAGE_LINE = re.compile(
    r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'"
)
CERT_LINE = re.compile(r"Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F:]+)")


def run(*args: str, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def parse_update_manifest(body: str) -> dict[str, object] | None:
    opening = f"<!-- {MANIFEST_MARKER}\n"
    if opening not in body:
        return None
    if body.count(opening) != 1:
        raise SystemExit("Release body contains multiple update manifests")
    encoded, separator, _tail = body.split(opening, 1)[1].partition("\n-->")
    if not separator:
        raise SystemExit("Release body has an unterminated update manifest")
    try:
        manifest = json.loads(encoded)
    except json.JSONDecodeError as error:
        raise SystemExit(f"Release body update manifest is invalid JSON: {error}") from error
    if not isinstance(manifest, dict) or set(manifest) != {"schemaVersion", "packageName", "releases"} \
        or manifest.get("schemaVersion") != 1 or manifest.get("packageName") != PACKAGE_NAME \
        or not isinstance(manifest.get("releases"), list):
        raise SystemExit("Release body update manifest has an invalid envelope")
    releases = manifest["releases"]
    required = {"signerSha256", "versionCode", "versionName", "assetName", "apkUrl", "sha256", "sizeBytes"}
    if len(releases) != 2 or any(not isinstance(item, dict) or set(item) != required for item in releases):
        raise SystemExit("Release body must describe exactly two complete APK records")
    by_asset = {item["assetName"]: item for item in releases}
    if set(by_asset) != {"companion.apk", "companion-legacy.apk"}:
        raise SystemExit("Release body APK asset names are invalid")
    for asset, item in by_asset.items():
        code = item["versionCode"]
        if isinstance(code, bool) or not isinstance(code, int) or code < 1 \
            or isinstance(item["sizeBytes"], bool) or not isinstance(item["sizeBytes"], int) or item["sizeBytes"] < 1:
            raise SystemExit("Release body APK numeric metadata is invalid")
        expected_url_suffix = f"/companion-build-{code}/{asset}"
        if not isinstance(item["apkUrl"], str) or not re.fullmatch(\
            rf"https://github\.com/[^/]+/[^/]+/releases/download{re.escape(expected_url_suffix)}", item["apkUrl"]\
        ):
            raise SystemExit("Release body APK URL is not immutable")
        if not isinstance(item["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise SystemExit("Release body APK hash is invalid")
        if not isinstance(item["signerSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", item["signerSha256"]):
            raise SystemExit("Release body signer hash is invalid")
    if by_asset["companion-legacy.apk"]["versionCode"] < 19:
        raise SystemExit("Latest legacy bootstrap build is older than version code 19")
    return manifest


def next_code(tags: list[str], floor: int = 19, manifest: dict[str, object] | None = None) -> int:
    codes = [int(match.group(1)) for tag in tags if (match := BUILD_TAG.fullmatch(tag))]
    if manifest:
        codes.extend(item["versionCode"] for item in manifest["releases"])
    return max([floor, *codes]) + 1


def published_tags(repo: str) -> list[str]:
    result = run(
        "gh", "api", "--paginate", f"repos/{repo}/releases",
        "--jq", ".[].tag_name", capture=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def is_not_found(result: subprocess.CompletedProcess[str]) -> bool:
    message = (result.stdout + result.stderr).lower()
    return "http 404" in message or "release not found" in message or "not found" in message


def latest_body(repo: str) -> str | None:
    result = run(
        "gh", "release", "view", "companion-latest", "--repo", repo,
        "--json", "body", "--jq", ".body", capture=True, check=False,
    )
    if result.returncode == 0:
        return result.stdout
    if is_not_found(result):
        return None
    raise SystemExit(f"Could not inspect companion-latest: {result.stderr.strip()}")


def latest_manifest(repo: str) -> dict[str, object] | None:
    body = latest_body(repo)
    return parse_update_manifest(body) if body is not None else None


def legacy_body_code(body: str | None) -> int | None:
    if body is None:
        return None
    values = [int(value) for value in re.findall(r"\bbuild\s+(\d+)\b", body, re.IGNORECASE)]
    return max(values) if values else None


def inspect_apk(
    apk: Path,
    *,
    apksigner: str,
    aapt: str,
    expected_package: str,
    expected_code: int,
    expected_name: str,
    expected_cert: str,
    asset_name: str,
    apk_url: str,
) -> dict[str, object]:
    cert_output = run(apksigner, "verify", "--print-certs", str(apk), capture=True).stdout
    cert_match = CERT_LINE.search(cert_output)
    if not cert_match:
        raise SystemExit(f"Could not read signer certificate from {apk}")
    cert = cert_match.group(1).replace(":", "").lower()
    if cert != expected_cert.lower():
        raise SystemExit(f"Unexpected signer for {apk}: {cert}")

    badging = run(aapt, "dump", "badging", str(apk), capture=True).stdout
    package_match = PACKAGE_LINE.search(badging)
    if not package_match:
        raise SystemExit(f"Could not read package metadata from {apk}")
    package, code, name = package_match.groups()
    if package != expected_package or int(code) != expected_code or name != expected_name:
        raise SystemExit(
            f"Unexpected APK identity for {apk}: package={package} code={code} name={name}"
        )
    if "application-debuggable" in badging:
        raise SystemExit(f"{apk} is debuggable")
    if "Signer #2 certificate" in cert_output or cert_output.count("certificate SHA-256 digest:") != 1:
        raise SystemExit(f"{apk} must have exactly one current signer")

    payload = apk.read_bytes()
    return {
        "signerSha256": cert,
        "versionCode": expected_code,
        "versionName": expected_name,
        "assetName": asset_name,
        "apkUrl": apk_url,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "sizeBytes": len(payload),
    }


def release_body(version: str, code: int, commit: str, releases: list[dict[str, object]]) -> str:
    manifest = {
        "schemaVersion": 1,
        "packageName": PACKAGE_NAME,
        "releases": releases,
    }
    encoded = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False)
    return (
        f"Version {version} (build {code}). Built from commit {commit}.\n\n"
        "Use **companion.apk** for current installations signed with the release key. "
        "Use **companion-legacy.apk** only to bootstrap an installation signed with the "
        "known local legacy key. The older app-debug.apk signer is not compatible.\n\n"
        f"<!-- {MANIFEST_MARKER}\n{encoded}\n-->\n"
    )


def release_exists(repo: str, tag: str) -> bool:
    result = run("gh", "release", "view", tag, "--repo", repo, capture=True, check=False)
    if result.returncode == 0:
        return True
    if is_not_found(result):
        return False
    raise SystemExit(f"Could not inspect release {tag}: {result.stderr.strip()}")


def remote_tag_exists(repo: str, tag: str) -> bool:
    result = run("gh", "api", f"repos/{repo}/git/ref/tags/{tag}", capture=True, check=False)
    if result.returncode == 0:
        return True
    if is_not_found(result):
        return False
    raise SystemExit(f"Could not inspect tag {tag}: {result.stderr.strip()}")


def verify_downloaded(
    directory: Path,
    *,
    release_apk: Path,
    legacy_apk: Path,
    apksigner: str,
    aapt: str,
    code: int,
    version: str,
    release_cert: str,
    legacy_cert: str,
) -> None:
    expected = {
        "companion.apk": hashlib.sha256(release_apk.read_bytes()).hexdigest(),
        "companion-legacy.apk": hashlib.sha256(legacy_apk.read_bytes()).hexdigest(),
    }
    for name, cert in (("companion.apk", release_cert), ("companion-legacy.apk", legacy_cert)):
        downloaded = directory / name
        metadata = inspect_apk(
            downloaded,
            apksigner=apksigner,
            aapt=aapt,
            expected_package=PACKAGE_NAME,
            expected_code=code,
            expected_name=version,
            expected_cert=cert,
            asset_name=name,
            apk_url="verified-download",
        )
        if metadata["sha256"] != expected[name]:
            raise SystemExit(f"Published {name} does not match the staged APK")


def update_latest(args: argparse.Namespace, temp: Path, body_file: Path) -> None:
    latest = "companion-latest"
    if not release_exists(args.repo, latest):
        run("gh", "release", "create", latest, "--repo", args.repo,
            "--target", args.commit, "--title", "Companion (latest APK)",
            "--prerelease", "--notes", "Publication in progress.")
    run(
        "gh", "release", "upload", latest,
        str(args.release_apk) + "#companion.apk",
        str(args.legacy_apk) + "#companion-legacy.apk",
        "--repo", args.repo, "--clobber",
    )
    latest_download = temp / "latest"
    latest_download.mkdir()
    run("gh", "release", "download", latest, "--repo", args.repo,
        "--pattern", "companion.apk", "--pattern", "companion-legacy.apk",
        "--dir", str(latest_download))
    verify_downloaded(
        latest_download, release_apk=args.release_apk, legacy_apk=args.legacy_apk,
        apksigner=args.apksigner, aapt=args.aapt, code=args.code, version=args.version,
        release_cert=args.release_cert, legacy_cert=args.legacy_cert,
    )
    run("gh", "api", "--method", "PATCH",
        f"repos/{args.repo}/git/refs/tags/{latest}",
        "-f", f"sha={args.commit}", "-F", "force=true")
    # Body/manifest is deliberately last: clients never see metadata for
    # assets that have not already been uploaded and verified.
    run("gh", "release", "edit", latest, "--repo", args.repo,
        "--title", "Companion (latest APK)", "--prerelease",
        "--notes-file", str(body_file))


def publish(args: argparse.Namespace) -> None:
    tag = f"companion-build-{args.code}"
    body = latest_body(args.repo)
    manifest = parse_update_manifest(body) if body is not None else None
    minimum = next_code(published_tags(args.repo), 19, manifest)
    legacy = legacy_body_code(body)
    if legacy is not None:
        minimum = max(minimum, legacy + 1)
    if args.code < minimum:
        raise SystemExit(f"Version code {args.code} is not newer than published code {minimum - 1}")
    if release_exists(args.repo, tag) or remote_tag_exists(args.repo, tag):
        raise SystemExit(f"Refusing to overwrite immutable tag {tag}")
    if args.release_apk.name != "companion.apk" or args.legacy_apk.name != "companion-legacy.apk":
        raise SystemExit("Staged APK basenames must be companion.apk and companion-legacy.apk")

    base = f"https://github.com/{args.repo}/releases/download/{tag}"
    releases = [
        inspect_apk(
            args.release_apk, apksigner=args.apksigner, aapt=args.aapt,
            expected_package=PACKAGE_NAME, expected_code=args.code,
            expected_name=args.version, expected_cert=args.release_cert,
            asset_name="companion.apk", apk_url=f"{base}/companion.apk",
        ),
        inspect_apk(
            args.legacy_apk, apksigner=args.apksigner, aapt=args.aapt,
            expected_package=PACKAGE_NAME, expected_code=args.code,
            expected_name=args.version, expected_cert=args.legacy_cert,
            asset_name="companion-legacy.apk", apk_url=f"{base}/companion-legacy.apk",
        ),
    ]
    body = release_body(args.version, args.code, args.commit, releases)

    with tempfile.TemporaryDirectory(prefix="companion-release-") as raw_temp:
        temp = Path(raw_temp)
        body_file = temp / "body.md"
        body_file.write_text(body)
        run(
            "gh", "release", "create", tag,
            str(args.release_apk) + "#companion.apk",
            str(args.legacy_apk) + "#companion-legacy.apk",
            "--repo", args.repo, "--target", args.commit,
            "--title", f"Companion {args.version} (build {args.code})",
            "--prerelease", "--notes-file", str(body_file),
        )

        immutable_download = temp / "immutable"
        immutable_download.mkdir()
        run("gh", "release", "download", tag, "--repo", args.repo,
            "--pattern", "companion.apk", "--pattern", "companion-legacy.apk",
            "--dir", str(immutable_download))
        verify_downloaded(
            immutable_download, release_apk=args.release_apk, legacy_apk=args.legacy_apk,
            apksigner=args.apksigner, aapt=args.aapt, code=args.code, version=args.version,
            release_cert=args.release_cert, legacy_cert=args.legacy_cert,
        )

        update_latest(args, temp, body_file)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    next_parser = commands.add_parser("next-code")
    next_parser.add_argument("--repo", required=True)
    next_parser.add_argument("--floor", type=int, default=19)

    inspect_parser = commands.add_parser("inspect")
    inspect_parser.add_argument("--apk", type=Path, required=True)
    inspect_parser.add_argument("--apksigner", required=True)
    inspect_parser.add_argument("--aapt", required=True)
    inspect_parser.add_argument("--code", type=int, required=True)
    inspect_parser.add_argument("--version", required=True)
    inspect_parser.add_argument("--cert", required=True)
    inspect_parser.add_argument("--asset-name", required=True)
    inspect_parser.add_argument("--apk-url", default="local")

    publish_parser = commands.add_parser("publish")
    publish_parser.add_argument("--repo", required=True)
    publish_parser.add_argument("--commit", required=True)
    publish_parser.add_argument("--code", type=int, required=True)
    publish_parser.add_argument("--version", required=True)
    publish_parser.add_argument("--release-apk", type=Path, required=True)
    publish_parser.add_argument("--legacy-apk", type=Path, required=True)
    publish_parser.add_argument("--release-cert", required=True)
    publish_parser.add_argument("--legacy-cert", required=True)
    publish_parser.add_argument("--apksigner", required=True)
    publish_parser.add_argument("--aapt", required=True)
    return root


def main() -> None:
    args = parser().parse_args()
    if args.command == "next-code":
        body = latest_body(args.repo)
        manifest = parse_update_manifest(body) if body is not None else None
        code = next_code(published_tags(args.repo), args.floor, manifest)
        legacy = legacy_body_code(body)
        print(max(code, legacy + 1 if legacy is not None else code))
    elif args.command == "inspect":
        print(json.dumps(inspect_apk(
            args.apk, apksigner=args.apksigner, aapt=args.aapt,
            expected_package=PACKAGE_NAME, expected_code=args.code,
            expected_name=args.version, expected_cert=args.cert,
            asset_name=args.asset_name, apk_url=args.apk_url,
        ), separators=(",", ":")))
    else:
        publish(args)


if __name__ == "__main__":
    main()
