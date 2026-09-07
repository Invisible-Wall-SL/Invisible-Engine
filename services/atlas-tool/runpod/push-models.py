"""Push models from a RunPod Network Volume UP to R2 — the missing arc of the mirror.

R2 is the hub for our ComfyUI models, but until this script the models only ever
flowed ONE way:

    desktop  --scripts/seed-comfyui-models.py-->  R2  --pull-models.py-->  pod volume
                                                  R2  --launcher "Sync models"--> desktop

Nothing went **pod volume → R2**. Two consequences we hit for real:

  * A LoRA TRAINED on the pod (e.g. `comic-style-lora-000002.safetensors`) could
    never reach the artist's desktop — there was no path off the volume at all.
  * `fetch-models.py` deliberately downloads big PUBLIC sets from Hugging Face
    straight onto the volume, bypassing R2. Right on its own terms (routing 50 GB
    through a home uplink into R2 and back out "costs two transfers and buys
    nothing"), but it leaves those files invisible to the desktop and to the
    serverless worker, which only know what the manifest lists.

It is also a durability problem: a trained LoRA that exists only on a network
volume is one deletion away from gone. This is `docs/status/comfyui.md` open item
9 (node/model parity).

So the default target of THIS script is the small, private, irreplaceable
artifact — a trained LoRA — NOT a 35 GB public checkpoint anyone can re-fetch
from Hugging Face. Hence `--max-size-gb 5`: anything bigger is skipped and named,
and you opt in with `--include-large` if you really mean it.

DRY RUN BY DEFAULT — `--apply` performs it. This writes into a bucket the whole
team shares AND rewrites the manifest the launcher serves to every desktop, so
doing nothing until asked is the only safe default.

Two more guarantees, both about not destroying someone else's work:

  * **Nothing is ever deleted from R2.** There is no delete call in this file.
  * **The manifest is MERGED, never replaced.** Every entry this run didn't touch
    is preserved byte for byte (as is `base_prefix`/`version`). Dropping a
    desktop-seeded entry would silently un-publish that model from the launcher's
    Sync models, with the file still sitting in R2 — the worst kind of failure,
    because nothing errors.

Writes the same manifest `scripts/seed-comfyui-models.py` writes, at
`tools/invisible-launcher/models-manifest.json`, entries shaped
`{key, dir, name, size, sha256}` so `pull-models.py` restores each file to
`<dest>/<dir>/<name>` — i.e. the exact `ComfyUI/models/<subfolder>/<file>` layout
it came from.

Env (same R2 creds the other services use):
    R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

Usage (on the pod):
    python push-models.py                             # dry run, whole models tree
    python push-models.py --dir loras                 # dry run, just the LoRAs
    python push-models.py --dir loras --apply         # do it
    python push-models.py --include-large --apply     # include >5 GB files too
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import posixpath
from pathlib import Path, PurePosixPath

DEFAULT_SRC = "/workspace/ComfyUI/models"
DEFAULT_PREFIX = "comfyui-models"
MANIFEST_KEY = "tools/invisible-launcher/models-manifest.json"
# GB here is 1e9 bytes, matching the sizes seed/pull-models print.
DEFAULT_MAX_SIZE_GB = 5.0

MODEL_EXTS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".sft", ".gguf", ".onnx"}
# ComfyUI ships these as folder placeholders — never real models.
PLACEHOLDER_GLOB = "put_*_here*"
# A download that died mid-flight. Uploading one publishes a corrupt model.
PARTIAL_SUFFIXES = (".part", ".tmp", ".download")
SKIP_DIRS = {"__pycache__"}


def _sha256(path: Path) -> str:
	h = hashlib.sha256()
	with open(path, "rb") as f:
		for chunk in iter(lambda: f.read(1 << 20), b""):
			h.update(chunk)
	return h.hexdigest()


def classify(rel: str, size: int, max_bytes: int, include_large: bool = False) -> tuple[str, str]:
	"""Decide what a volume file is: `ok` / `large` / `junk` (+ a reason to print)."""
	parts = PurePosixPath(rel).parts
	name = parts[-1] if parts else rel
	low = name.lower()
	for part in parts[:-1]:
		if part in SKIP_DIRS or part.startswith("."):
			return "junk", f"under {part}/"
	if low.startswith("."):
		return "junk", "dotfile"
	if fnmatch.fnmatch(low, PLACEHOLDER_GLOB):
		return "junk", "ComfyUI folder placeholder"
	if low.endswith(PARTIAL_SUFFIXES):
		return "junk", "partial/temp download"
	if PurePosixPath(low).suffix not in MODEL_EXTS:
		return "junk", "not a model file"
	if size <= 0:
		return "junk", "empty file"
	if size > max_bytes and not include_large:
		return "large", f"{size / 1e9:.2f} GB — over the --max-size-gb cap"
	return "ok", ""


def r2_size_probe(s3, bucket: str):
	"""HEAD a key; returns its size in R2, or None when it isn't there."""
	def probe(key: str) -> int | None:
		try:
			return int(s3.head_object(Bucket=bucket, Key=key)["ContentLength"])
		except Exception:
			return None
	return probe


def plan_uploads(files, *, prefix: str, prior: dict, in_r2, max_bytes: int,
                 include_large: bool = False, force: bool = False) -> dict:
	"""Pure planner: (rel, size) pairs in, buckets of decisions out. No I/O of its
	own — `in_r2(key)` is injected so this is testable without R2 or boto3.

	Buckets:
	  upload   — not in R2 (or a different size there), or --force.
	  reindex  — already in R2 at this size but MISSING from the manifest, so it
	             is unpublished: hash it locally and add the entry, no transfer.
	  present  — in R2 at this size and already in the manifest: nothing to do,
	             and its sha256 is reused rather than re-hashed (re-hashing an
	             unchanged multi-GB file on a pod is pure cost — the seeder makes
	             the same trade).
	  large    — over the cap, skipped but NAMED.
	  junk     — placeholders, partials, dotfiles, __pycache__, non-model files.
	"""
	out: dict[str, list] = {"upload": [], "reindex": [], "present": [], "large": [], "junk": []}
	for rel, size in files:
		kind, reason = classify(rel, size, max_bytes, include_large)
		if kind == "junk":
			out["junk"].append((rel, reason))
			continue
		if kind == "large":
			out["large"].append((rel, size, reason))
			continue
		key = f"{prefix}/{rel}"
		item = {
			"rel": rel,
			"key": key,
			"dir": posixpath.dirname(rel),  # "" for a file at the tree root
			"name": posixpath.basename(rel),
			"size": size,
			"sha": None,
			"action": "upload",
		}
		if not force and in_r2(key) == size:
			prev = prior.get(key)
			if prev and int(prev.get("size", -1)) == size and prev.get("sha256"):
				item["action"] = "present"
				item["sha"] = prev["sha256"]
			else:
				item["action"] = "reindex"
		out[item["action"]].append(item)
	return out


def merge_manifest(prior_manifest: dict | None, entries: list[dict], prefix: str) -> dict:
	"""MERGE `entries` into the prior manifest — add/update by key, preserve
	everything else (order included) plus the existing version/base_prefix."""
	base = prior_manifest if isinstance(prior_manifest, dict) else {}
	models = [m for m in base.get("models", []) if isinstance(m, dict) and m.get("key")]
	by_key = {m["key"]: m for m in models}
	order = [m["key"] for m in models]
	for e in entries:
		if e["key"] not in by_key:
			order.append(e["key"])
		by_key[e["key"]] = e
	return {
		"version": base.get("version", 1),
		"base_prefix": base.get("base_prefix") or prefix,
		"models": [by_key[k] for k in order],
	}


def read_manifest(s3, bucket: str) -> dict:
	"""The manifest as it stands in R2; an absent/unreadable one starts empty."""
	try:
		body = s3.get_object(Bucket=bucket, Key=MANIFEST_KEY)["Body"].read()
		data = json.loads(body)
		return data if isinstance(data, dict) else {}
	except Exception:
		return {}


def scan_volume(src: Path, dirs: list[str] | None = None) -> list[tuple[str, int]]:
	"""Walk the models tree; returns sorted (relposix, size). `dirs` scopes it to
	named model subfolders (`--dir loras`). Filtering is the planner's job."""
	roots: list[Path] = []
	if dirs:
		for d in dirs:
			p = src / d
			if not p.is_dir():
				print(f"  ! --dir {d}: no such folder under {src} — ignored")
				continue
			roots.append(p)
	else:
		roots = [src]

	found: dict[str, int] = {}
	for root in roots:
		for p in sorted(root.rglob("*")):
			if not p.is_file():  # also drops broken symlinks
				continue
			found[p.relative_to(src).as_posix()] = p.stat().st_size
	return sorted(found.items())


def run(s3, bucket: str, *, src: str, prefix: str = DEFAULT_PREFIX,
        dirs: list[str] | None = None, max_bytes: int = int(DEFAULT_MAX_SIZE_GB * 1e9),
        include_large: bool = False, force: bool = False, apply: bool = False) -> dict:
	"""Plan, then (only under `apply`) upload + rewrite the merged manifest."""
	src_path = Path(src)
	if not src_path.is_dir():
		raise SystemExit(f"Models dir not found: {src_path}")

	prior_manifest = read_manifest(s3, bucket)
	prior = {m["key"]: m for m in prior_manifest.get("models", [])
	         if isinstance(m, dict) and m.get("key")}
	base_prefix = prior_manifest.get("base_prefix")
	if base_prefix and base_prefix != prefix:
		# The launcher only presigns keys under base_prefix and DROPS the rest, so
		# entries written outside it would never reach a desktop.
		raise SystemExit(f"Manifest base_prefix is {base_prefix!r} but --prefix is "
		                 f"{prefix!r} — the launcher would drop every key we add.")

	if not apply:
		print("== DRY RUN — nothing will be uploaded and the manifest is NOT touched. ==")
		print("== Re-run with --apply to perform it. ==\n")

	plan = plan_uploads(scan_volume(src_path, dirs), prefix=prefix, prior=prior,
	                    in_r2=r2_size_probe(s3, bucket), max_bytes=max_bytes,
	                    include_large=include_large, force=force)

	todo = sorted(plan["upload"] + plan["reindex"], key=lambda i: i["rel"])
	entries: list[dict] = []
	uploaded_bytes = 0
	for item in todo:
		path = src_path / item["rel"]
		verb = "upload" if item["action"] == "upload" else "index "
		if not apply:
			print(f"  would {verb} {item['rel']} ({item['size'] / 1e9:.2f} GB)")
			continue
		# Hashed in its own read pass: boto3's upload_file drives a threaded
		# multipart transfer that seeks around the file, so a hashing wrapper
		# would see chunks out of order. Reusing prior shas keeps the common
		# case free anyway.
		print(f"  hashing {item['rel']} ({item['size'] / 1e9:.2f} GB)…")
		sha = _sha256(path)
		if item["action"] == "upload":
			print(f"  upload  {item['rel']}…")
			s3.upload_file(str(path), bucket, item["key"],
			               ExtraArgs={"ContentType": "application/octet-stream"})
			uploaded_bytes += item["size"]
		else:
			print(f"  index   {item['rel']} (already in R2, adding to manifest)")
		entries.append({"key": item["key"], "dir": item["dir"], "name": item["name"],
		                "size": item["size"], "sha256": sha})

	manifest = merge_manifest(prior_manifest, entries, prefix)
	wrote_manifest = False
	if apply and entries:
		print(f"\n== Writing manifest ({bucket}/{MANIFEST_KEY}) — "
		      f"{len(manifest['models'])} files total ==")
		s3.put_object(Bucket=bucket, Key=MANIFEST_KEY,
		              Body=json.dumps(manifest, indent=2).encode("utf-8"),
		              ContentType="application/json")
		wrote_manifest = True
	elif apply:
		print("\n== Nothing new — manifest left exactly as it was. ==")

	summary = {
		"uploaded": len([i for i in todo if i["action"] == "upload"]),
		"reindexed": len([i for i in todo if i["action"] == "reindex"]),
		"present": len(plan["present"]),
		"large": plan["large"],
		"junk": plan["junk"],
		"uploaded_bytes": uploaded_bytes,
		"planned_bytes": sum(i["size"] for i in todo),
		"manifest": manifest,
		"wrote_manifest": wrote_manifest,
		"entries": entries,
	}
	_print_summary(summary, apply)
	return summary


def _print_summary(s: dict, apply: bool) -> None:
	did = "uploaded" if apply else "to upload"
	nbytes = s["uploaded_bytes"] if apply else s["planned_bytes"]
	print("\n== Summary ==")
	print(f"  {s['uploaded']} {did}, {nbytes / 1e9:.2f} GB")
	if s["reindexed"]:
		print(f"  {s['reindexed']} already in R2 but unpublished — manifest entry added")
	print(f"  {s['present']} already present (unchanged)")
	print(f"  {len(s['large'])} skipped as too large"
	      + (" (use --include-large):" if s["large"] else ""))
	for rel, size, _reason in s["large"]:
		print(f"      {rel} ({size / 1e9:.2f} GB)")
	print(f"  {len(s['junk'])} skipped as junk "
	      f"(placeholders, partials, dotfiles, non-model files)")
	if not apply:
		print("\n  DRY RUN — nothing was written. Re-run with --apply.")
	print("\n  Nothing was deleted from R2; the manifest keeps every other machine's entries.")
	print("  A desktop picks these up via the launcher's Sync models button;")
	print("  another volume picks them up via pull-models.py.")


def main() -> None:
	ap = argparse.ArgumentParser(description="Push ComfyUI models from a pod volume to R2")
	ap.add_argument("--src", default=DEFAULT_SRC, help="ComfyUI/models dir on the volume")
	ap.add_argument("--prefix", default=DEFAULT_PREFIX, help="R2 key prefix for models")
	ap.add_argument("--dir", action="append", dest="dirs", metavar="NAME",
	                help="only this model subfolder (repeatable), e.g. --dir loras")
	ap.add_argument("--max-size-gb", type=float, default=DEFAULT_MAX_SIZE_GB,
	                help="skip (and name) files bigger than this")
	ap.add_argument("--include-large", action="store_true", help="ignore --max-size-gb")
	ap.add_argument("--force", action="store_true", help="re-upload even if size matches")
	ap.add_argument("--apply", action="store_true",
	                help="actually upload + rewrite the manifest (default is a dry run)")
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

	run(s3, bucket, src=args.src, prefix=args.prefix, dirs=args.dirs,
	    max_bytes=int(args.max_size_gb * 1e9), include_large=args.include_large,
	    force=args.force, apply=args.apply)


if __name__ == "__main__":
	main()
