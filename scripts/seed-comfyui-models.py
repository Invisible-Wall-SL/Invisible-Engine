"""Mirror the local ComfyUI shared models library to R2 so the desktop Invisible
Launcher can sync it onto a fresh machine (authenticated, owner-only, via
presigned URLs from GET /api/launcher/models-manifest).

Walks the local Shared/Models tree, uploads each model file to R2 under
`comfyui-models/<relpath>` (multipart, automatic for big files), and writes a
manifest at `tools/invisible-launcher/models-manifest.json` shaped:

    { "version": 1, "base_prefix": "comfyui-models",
      "models": [ { "key", "dir", "name", "size", "sha256" }, ... ] }

The OWNER runs this locally with R2_* env set. It is idempotent: a file already
in R2 with the same size is skipped (and its sha is reused from the prior
manifest when available, so unchanged multi-GB files aren't re-hashed).

Usage (this box uses the `py` launcher):
    py scripts/seed-comfyui-models.py
    py scripts/seed-comfyui-models.py --models-dir "C:\\Invisible Wall SL\\ComfyUI\\Shared\\Models"
    py scripts/seed-comfyui-models.py --force        # re-upload everything
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

DEFAULT_MODELS_DIR = r"C:\Invisible Wall SL\ComfyUI\Shared\Models"
DEFAULT_PREFIX = "comfyui-models"
MANIFEST_KEY = "tools/invisible-launcher/models-manifest.json"
# Files ComfyUI ships as folder placeholders — never real models.
SKIP_NAMES = {"put_checkpoints_here", "put_loras_here"}
MODEL_EXTS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".gguf", ".sft"}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _iter_models(root: Path):
    """Yield (abs_path, relposix) for every real model file under root."""
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.name in SKIP_NAMES or p.stat().st_size == 0:
            continue
        if p.suffix.lower() not in MODEL_EXTS:
            continue
        yield p, p.relative_to(root).as_posix()


def main() -> None:
    ap = argparse.ArgumentParser(description="Mirror ComfyUI shared models to R2")
    ap.add_argument("--models-dir", default=DEFAULT_MODELS_DIR)
    ap.add_argument("--prefix", default=DEFAULT_PREFIX, help="R2 key prefix for models")
    ap.add_argument("--force", action="store_true", help="re-upload even if size matches")
    args = ap.parse_args()

    root = Path(args.models_dir)
    if not root.is_dir():
        raise SystemExit(f"Models dir not found: {root}")

    missing = [v for v in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID",
                           "R2_SECRET_ACCESS_KEY") if not os.environ.get(v)]
    if missing:
        raise SystemExit(f"Missing env var(s) {', '.join(missing)} — set R2 creds first.")

    try:
        import boto3
    except ImportError:
        raise SystemExit("boto3 not installed — run: py -m pip install boto3")

    bucket = os.environ["R2_BUCKET"]
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    # Reuse sha256 from a prior manifest for files whose size is unchanged, so we
    # don't re-hash tens of GB on every run.
    prior: dict[str, dict] = {}
    try:
        body = s3.get_object(Bucket=bucket, Key=MANIFEST_KEY)["Body"].read()
        for m in json.loads(body).get("models", []):
            prior[m["key"]] = m
    except Exception:
        pass

    models: list[dict] = []
    seen_keys: set[str] = set()
    for path, rel in _iter_models(root):
        key = f"{args.prefix}/{rel}"
        size = path.stat().st_size
        rel_dir = os.path.dirname(rel)  # posix; "" for a file at the root

        # Is it already in R2 at the same size?
        in_r2 = False
        if not args.force:
            try:
                head = s3.head_object(Bucket=bucket, Key=key)
                in_r2 = int(head["ContentLength"]) == size
            except Exception:
                in_r2 = False

        prev = prior.get(key)
        sha = prev["sha256"] if (in_r2 and prev and prev.get("size") == size) else None
        if sha is None:
            print(f"  hashing {rel} ({size / 1e9:.2f} GB)…")
            sha = _sha256(path)

        if in_r2:
            print(f"  skip (in R2)  {rel}")
        else:
            print(f"  upload        {rel} ({size / 1e9:.2f} GB)…")
            s3.upload_file(str(path), bucket, key,
                           ExtraArgs={"ContentType": "application/octet-stream"})

        models.append({"key": key, "dir": rel_dir, "name": path.name,
                       "size": size, "sha256": sha})
        seen_keys.add(key)

    # MERGE, don't replace: keep every model from the PRIOR manifest that this
    # machine doesn't have locally, so seeding from a second box (e.g. the
    # artist's models) ADDS to the shared mirror instead of wiping the owner's.
    # Those files already live in R2 (uploads are additive), so their manifest
    # entries stay valid; the pod's pull-models.py then fetches everyone's set.
    kept = 0
    for k, m in prior.items():
        if k not in seen_keys:
            models.append(m)
            kept += 1
    if kept:
        print(f"  (kept {kept} model(s) from other machines' seeds)")

    manifest = {"version": 1, "base_prefix": args.prefix, "models": models}
    total = sum(m["size"] for m in models)
    print(f"\n== Writing manifest ({bucket}/{MANIFEST_KEY}) — "
          f"{len(models)} files, {total / 1e9:.1f} GB ==")
    s3.put_object(Bucket=bucket, Key=MANIFEST_KEY,
                  Body=json.dumps(manifest, indent=2).encode("utf-8"),
                  ContentType="application/json")
    print("== Done ==")


if __name__ == "__main__":
    main()
