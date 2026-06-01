"""Build the Invisible Launcher desktop app into a single Windows .exe and
optionally upload it to R2 so the web launcher's /download/launcher route can
serve it.

The launcher source lives OUTSIDE this repo (it manages the local ComfyUI), so
this script points at it by absolute path. It:
  1. ensures PyInstaller + Pillow + py7zr + customtkinter are installed,
  2. renders an .ico from the IW emblem PNG,
  3. runs PyInstaller --onefile (no console window), bundling the emblem +
     customtkinter assets + py7zr,
  4. with --upload, pushes the .exe to R2 at
     tools/invisible-launcher/Invisible_Launcher.exe (needs R2_* env vars).

The .exe is a build artifact — it is NOT committed; it lives only in R2.

Usage (this box uses the `py` launcher):
    py scripts/build-launcher-exe.py            # build only
    py scripts/build-launcher-exe.py --upload   # build + upload to R2
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_LAUNCHER = r"C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py"
DEFAULT_EMBLEM = r"C:\Invisible Wall SL\ComfyUI\iw-emblem-square.png"
R2_KEY = "tools/invisible-launcher/Invisible_Launcher.exe"
R2_MANIFEST_KEY = "tools/invisible-launcher/latest.json"
EXE_CONTENT_TYPE = "application/vnd.microsoft.portable-executable"


def read_version(launcher: Path) -> str:
    """Pull LAUNCHER_VERSION out of the launcher source so the published manifest
    matches the embedded version."""
    import re

    m = re.search(r'^LAUNCHER_VERSION\s*=\s*["\']([^"\']+)["\']',
                  launcher.read_text(encoding="utf-8"), re.MULTILINE)
    if not m:
        raise SystemExit("Could not find LAUNCHER_VERSION in the launcher source.")
    return m.group(1)


def _sha256(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _pip(*pkgs: str) -> None:
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet",
         "--disable-pip-version-check", *pkgs]
    )


def build(launcher: Path, emblem: Path, work: Path) -> Path:
    dist = work / "dist"
    print("== Ensuring PyInstaller + Pillow + customtkinter + boto3 ==")
    # boto3 powers the owner "Publish to cloud" upload; PyInstaller's bundled
    # hooks collect botocore's data files once boto3 is importable at build time.
    _pip("pyinstaller", "pillow", "customtkinter", "boto3")

    args = [
        "--onefile",
        "--noconsole",
        "--name", "Invisible_Launcher",
        "--distpath", str(dist),
        "--workpath", str(work / "build"),
        "--specpath", str(work),
        "--collect-all", "customtkinter",
        # boto3/botocore load service models + endpoints.json as DATA at runtime;
        # collect-all grabs those + metadata so the frozen exe can do S3 PUTs
        # (collect-submodules alone misses the data files → DataNotFoundError).
        "--collect-all", "boto3",
        "--collect-all", "botocore",
        "--noconfirm",
    ]

    if emblem.exists():
        print("== Rendering app icon ==")
        from PIL import Image

        ico = work / "Invisible_Launcher.ico"
        Image.open(emblem).convert("RGBA").save(
            ico, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
        )
        args += ["--icon", str(ico), "--add-data", f"{emblem};."]
    else:
        print(f"Emblem not found ({emblem}) — building without a custom icon.")

    args.append(str(launcher))

    print("== Building one-file .exe (this takes a few minutes) ==")
    import PyInstaller.__main__

    PyInstaller.__main__.run(args)

    exe = dist / "Invisible_Launcher.exe"
    if not exe.exists():
        raise SystemExit("Build failed: Invisible_Launcher.exe was not produced.")
    print(f"== Built: {exe} ({exe.stat().st_size / 1e6:.1f} MB) ==")
    return exe


def upload(exe: Path, version: str, notes: str) -> None:
    import json

    missing = [v for v in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID",
                           "R2_SECRET_ACCESS_KEY") if not os.environ.get(v)]
    if missing:
        raise SystemExit(f"Missing env var(s) {', '.join(missing)} — set R2 creds before --upload.")
    _pip("boto3")
    import boto3

    bucket = os.environ["R2_BUCKET"]
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    print(f"== Uploading exe to R2 ({bucket}/{R2_KEY}) ==")
    s3.upload_file(str(exe), bucket, R2_KEY, ExtraArgs={"ContentType": EXE_CONTENT_TYPE})

    manifest = {
        "version": version,
        "size": exe.stat().st_size,
        "sha256": _sha256(exe),
        "notes": notes,
    }
    print(f"== Uploading manifest ({bucket}/{R2_MANIFEST_KEY}) v{version} ==")
    s3.put_object(Bucket=bucket, Key=R2_MANIFEST_KEY,
                  Body=json.dumps(manifest, indent=2).encode("utf-8"),
                  ContentType="application/json")
    print("== Upload complete ==")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build (and optionally upload) the Invisible Launcher .exe")
    ap.add_argument("--launcher", default=DEFAULT_LAUNCHER, help="path to Invisible_Launcher.py")
    ap.add_argument("--emblem", default=DEFAULT_EMBLEM, help="path to the IW emblem PNG (for the icon)")
    ap.add_argument("--upload", action="store_true", help="upload the built .exe + manifest to R2")
    ap.add_argument("--notes", default="", help="release notes shown in the update prompt")
    args = ap.parse_args()

    launcher = Path(args.launcher)
    if not launcher.exists():
        raise SystemExit(f"Launcher source not found: {launcher}")

    version = read_version(launcher)
    print(f"== Launcher version: v{version} ==")

    work = Path(tempfile.gettempdir()) / "iw-launcher-build"
    work.mkdir(parents=True, exist_ok=True)

    exe = build(launcher, Path(args.emblem), work)
    if args.upload:
        upload(exe, version, args.notes)
    else:
        print("Skipping upload (pass --upload with R2_* env vars set to publish).")


if __name__ == "__main__":
    main()
