"""Install Rhubarb Lip Sync into the image (Dockerfile step), pinned by version and SHA-256.

Keeps only what `lipsync.py` runs: the binary, its `res/` (the CMU Sphinx models) and its licence
file, whose notices the BSD-style components require to travel with the binary.

Run:  python rhubarb_install.py /opt/rhubarb
"""
from __future__ import annotations

import hashlib
import io
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

VERSION = "1.14.0"
SHA256 = "a9a9074862cff47b2d59b8bf399a678a3b0b74f9452ad6ad94cb292913dd8667"  # pragma: allowlist secret (a public checksum)
URL = (
    "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/"
    f"v{VERSION}/Rhubarb-Lip-Sync-{VERSION}-Linux.zip"
)
KEEP = ("rhubarb", "res/", "LICENSE.md")


def main(dest: str) -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "InvisibleAtlas/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        blob = r.read()
    got = hashlib.sha256(blob).hexdigest()
    if got != SHA256:
        sys.exit(f"Rhubarb {VERSION}: SHA-256 {got} is not the pinned {SHA256}")
    root = f"Rhubarb-Lip-Sync-{VERSION}-Linux/"
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for info in z.infolist():
            rel = info.filename[len(root):] if info.filename.startswith(root) else ""
            if not rel or info.is_dir() or not rel.startswith(KEEP) or ".." in rel:
                continue
            target = out / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
    (out / "rhubarb").chmod(0o755)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/opt/rhubarb")
