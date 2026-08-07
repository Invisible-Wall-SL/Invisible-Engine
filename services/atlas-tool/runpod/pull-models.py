"""Mirror the R2 ComfyUI model set onto a RunPod Network Volume.

Reads the manifest that `scripts/seed-comfyui-models.py` writes
(`tools/invisible-launcher/models-manifest.json`) and downloads every model to
`<dest>/<dir>/<name>` — i.e. the exact `ComfyUI/models/<subfolder>/<file>`
layout. Idempotent: a file already on disk at the manifest's size is skipped, so
re-running only fetches what's new or changed.

Env (same R2 creds the other services use):
    R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

Usage (on the pod):
    python pull-models.py --dest /workspace/ComfyUI/models
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

MANIFEST_KEY = "tools/invisible-launcher/models-manifest.json"


def main() -> None:
	ap = argparse.ArgumentParser(description="Pull ComfyUI models from R2")
	ap.add_argument("--dest", required=True, help="ComfyUI/models dir on the volume")
	ap.add_argument("--force", action="store_true", help="re-download even if size matches")
	args = ap.parse_args()

	missing = [v for v in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID",
	                       "R2_SECRET_ACCESS_KEY") if not os.environ.get(v)]
	if missing:
		raise SystemExit(f"Missing env var(s) {', '.join(missing)} — set R2 creds first.")

	try:
		import boto3
	except ImportError:
		raise SystemExit("boto3 not installed — run: pip install boto3")

	bucket = os.environ["R2_BUCKET"]
	s3 = boto3.client(
		"s3",
		endpoint_url=os.environ["R2_ENDPOINT"],
		aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
		aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
		region_name="auto",
	)

	body = s3.get_object(Bucket=bucket, Key=MANIFEST_KEY)["Body"].read()
	models = json.loads(body).get("models", [])
	dest_root = Path(args.dest)

	total = len(models)
	pulled = 0
	for i, m in enumerate(models, 1):
		key = m["key"]
		out = dest_root / m["dir"] / m["name"]
		size = int(m.get("size", 0))
		if not args.force and out.is_file() and out.stat().st_size == size:
			print(f"  [{i}/{total}] skip  {m['dir']}/{m['name']}")
			continue
		out.parent.mkdir(parents=True, exist_ok=True)
		print(f"  [{i}/{total}] pull  {m['dir']}/{m['name']} ({size / 1e9:.2f} GB)…")
		s3.download_file(bucket, key, str(out))
		pulled += 1

	print(f"\n== Done. {pulled} downloaded, {total - pulled} already present. ==")


if __name__ == "__main__":
	main()
