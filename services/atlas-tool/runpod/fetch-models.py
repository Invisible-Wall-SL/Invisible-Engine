"""Fetch a named model set from its UPSTREAM source straight onto a pod volume.

Companion to `pull-models.py`, not a replacement — they solve different problems:

  * `pull-models.py` mirrors OUR R2 model set (the manifest `seed-comfyui-models.py`
    writes from the owner's local `Shared/Models`). Use it for models we curate.
  * `fetch-models.py` (this) downloads a public model set DIRECTLY from Hugging Face
    onto the volume. Use it for a big upstream set we have no reason to curate —
    routing 50 GB of FLUX.2 through a home uplink into R2 and back out again costs
    two transfers and buys nothing.

Idempotent + resumable: a file already on disk at the remote's size is skipped, and a
half-finished `.part` continues with an HTTP Range request (these are 4-35 GB files and
a pod web terminal WILL drop before one finishes).

Usage (on the pod):
    py fetch-models.py --list
    py fetch-models.py --set flux2-klein --dest /workspace/ComfyUI/models
    py fetch-models.py --set flux2-dev --dry-run

Env:
    HF_TOKEN  optional; only needed if a set's repo is gated (none are today).
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

HF = "https://huggingface.co"

# `size` is informational only — used for --list and the free-space preflight. The
# skip/resume decision always re-reads the real Content-Length at download time, so a
# stale number here can never cause a corrupt file to be treated as complete.
MODEL_SETS: dict[str, dict] = {
	"flux2-klein": {
		"title": "FLUX.2 [klein] 4B (fp8)",
		"license": "apache-2.0 — the diffusion model AND its Qwen3 text encoder",
		"note": (
			"The practical R&D target on our fleet: ~12.5 GB of weights, peak VRAM well "
			"inside a 24 GB card. Mirrors ComfyUI's built-in blueprint "
			"'Image Edit (Flux.2 Klein 4B)'. NOTE: flux2-vae is served from the "
			"Comfy-Org/flux2-dev repo (licensed 'other'), so confirm the VAE's terms "
			"yourself before anything commercial ships."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "flux-2-klein-base-4b-fp8.safetensors",
				"url": f"{HF}/black-forest-labs/FLUX.2-klein-base-4b-fp8/resolve/main/flux-2-klein-base-4b-fp8.safetensors",
				"size": 4_090_000_000,
			},
			{
				"dir": "text_encoders",
				"name": "qwen_3_4b.safetensors",
				"url": f"{HF}/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
				"size": 8_040_000_000,
			},
			{
				"dir": "vae",
				"name": "flux2-vae.safetensors",
				"url": f"{HF}/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors",
				"size": 340_000_000,
			},
		],
	},
	"flux2-dev": {
		"title": "FLUX.2 [dev] 32B (fp8mixed)",
		"license": "NON-COMMERCIAL (BFL FLUX.2 [dev] licence) — R&D only, never in a shipped game",
		"note": (
			"~54 GB on disk and ~35 GB of diffusion weights, so peak VRAM exceeds every "
			"card in the fleet today (largest is the 32 GB RTX PRO 4500). ComfyUI will "
			"fall back to CPU offload: it runs, slowly. Check the Network Volume has room "
			"before pulling — the volume was sized for SDXL/FLUX.1, not for this."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "flux2_dev_fp8mixed.safetensors",
				"url": f"{HF}/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors",
				"size": 35_460_000_000,
			},
			{
				# fp8 rather than the blueprint's bf16 encoder: same encoder, 18 GB
				# instead of 35.6 GB, which is the difference between "offloads" and
				# "thrashes" on our cards.
				"dir": "text_encoders",
				"name": "mistral_3_small_flux2_fp8.safetensors",
				"url": f"{HF}/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors",
				"size": 18_030_000_000,
			},
			{
				"dir": "vae",
				"name": "flux2-vae.safetensors",
				"url": f"{HF}/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors",
				"size": 340_000_000,
			},
		],
	},
	"flux2-dev-turbo": {
		"title": "FLUX.2 [dev] Turbo LoRA (few-step)",
		"license": "inherits the non-commercial FLUX.2 [dev] terms — R&D only",
		"note": "Add-on for flux2-dev; pull that set too or the LoRA has nothing to bind to.",
		"files": [
			{
				"dir": "loras",
				"name": "Flux_2-Turbo-LoRA_comfyui.safetensors",
				"url": f"{HF}/Comfy-Org/flux2-dev/resolve/main/split_files/loras/Flux_2-Turbo-LoRA_comfyui.safetensors",
				"size": 2_760_000_000,
			},
		],
	},
	"qwen-image": {
		"title": "Qwen-Image 2512 (fp8)",
		"license": "apache-2.0 — model, Qwen2.5-VL encoder and VAE alike",
		"note": (
			"The base the cartoon-character pipeline is built on. ~30 GB on disk, but the "
			"encoder and the diffusion model load in sequence, so peak VRAM is ~20 GB — "
			"inside a 24 GB card. Matches ComfyUI's built-in 'Text to Image (Qwen-Image "
			"2512)' blueprint. Safe to run if the volume already has these: the size check "
			"skips whatever is current."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "qwen_image_2512_fp8_e4m3fn.safetensors",
				"url": f"{HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors",
				"size": 20_430_000_000,
			},
			{
				"dir": "text_encoders",
				"name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
				"size": 9_380_000_000,
			},
			{
				"dir": "vae",
				"name": "qwen_image_vae.safetensors",
				"url": f"{HF}/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors",
				"size": 250_000_000,
			},
		],
	},
	"qwen-toon": {
		"title": "Toon-Tacular LoRA for Qwen-Image (renderartist)",
		"license": "apache-2.0 — clean for a shipped game, like its base",
		"note": (
			"Cartoon/toon style LoRA. Its declared base is Qwen/Qwen-Image-2512, so it binds "
			"to the `qwen-image` set ONLY — a LoRA's weights are shaped to one base "
			"architecture, and it will not load onto FLUX.2 (or FLUX.1). Pull `qwen-image` "
			"too, or it has nothing to bind to."
		),
		"files": [
			{
				"dir": "loras",
				"name": "Toon_Tacular_Qwen_renderartist_3750_v1.safetensors",
				"url": f"{HF}/renderartist/Toon-Tacular-Qwen-LoRA/resolve/main/Toon_Tacular_Qwen_renderartist_3750_v1.safetensors",
				"size": 590_000_000,
			},
		],
	},
}


def _gb(n: float) -> str:
	return f"{n / 1e9:.2f} GB"


def _request(url: str, headers: dict[str, str], method: str = "GET") -> urllib.request.Request:
	token = os.environ.get("HF_TOKEN")
	if token:
		headers = {**headers, "Authorization": f"Bearer {token}"}
	return urllib.request.Request(url, headers=headers, method=method)


def _remote_size(url: str) -> int | None:
	"""Content-Length after redirects. None if the server won't say."""
	try:
		req = _request(url, {"Accept-Encoding": "identity"}, method="HEAD")
		with urllib.request.urlopen(req, timeout=60) as r:
			n = r.headers.get("Content-Length")
			return int(n) if n else None
	except urllib.error.HTTPError as e:
		if e.code in (401, 403):
			raise SystemExit(
				f"HTTP {e.code} on {url}\n"
				"That repo is gated — accept its licence on Hugging Face, then set HF_TOKEN."
			)
		raise


def _download(url: str, out: Path, expect: int | None) -> None:
	"""Stream to `out`, resuming a partial `.part` when the server allows it."""
	part = out.with_suffix(out.suffix + ".part")
	have = part.stat().st_size if part.is_file() else 0
	headers = {"Accept-Encoding": "identity"}
	if have and expect and have < expect:
		headers["Range"] = f"bytes={have}-"

	req = _request(url, headers)
	with urllib.request.urlopen(req, timeout=120) as r:
		resuming = r.status == 206
		if have and not resuming:
			have = 0  # server ignored Range — start over
		mode = "ab" if resuming else "wb"
		total = expect or 0
		done = have
		with open(part, mode) as fh:
			while True:
				chunk = r.read(1 << 22)  # 4 MiB
				if not chunk:
					break
				fh.write(chunk)
				done += len(chunk)
				if total:
					pct = 100.0 * done / total
					print(f"\r    {_gb(done)} / {_gb(total)}  ({pct:5.1f}%)", end="", flush=True)
		print()

	if expect and part.stat().st_size != expect:
		raise SystemExit(
			f"size mismatch for {out.name}: got {part.stat().st_size}, expected {expect}. "
			"Left the .part in place — re-run to resume."
		)
	part.replace(out)


def main() -> None:
	ap = argparse.ArgumentParser(description="Fetch a model set from Hugging Face onto a pod volume")
	ap.add_argument("--set", dest="sets", action="append", metavar="NAME",
	                help="model set to fetch (repeatable); see --list")
	ap.add_argument("--dest", default="/workspace/ComfyUI/models",
	                help="ComfyUI/models dir on the volume")
	ap.add_argument("--list", action="store_true", help="show the available sets and exit")
	ap.add_argument("--dry-run", action="store_true", help="report what would be fetched, download nothing")
	ap.add_argument("--force", action="store_true", help="re-download even if the size already matches")
	args = ap.parse_args()

	if args.list or not args.sets:
		print("Model sets:\n")
		for key, spec in MODEL_SETS.items():
			total = sum(f["size"] for f in spec["files"])
			print(f"  {key}  —  {spec['title']}  ({_gb(total)})")
			print(f"      licence: {spec['license']}")
			print(f"      {spec['note']}\n")
		if not args.sets:
			print("Nothing fetched — pass --set NAME (repeatable).")
		return

	unknown = [s for s in args.sets if s not in MODEL_SETS]
	if unknown:
		raise SystemExit(f"Unknown set(s): {', '.join(unknown)}. Run --list.")

	dest_root = Path(args.dest)
	if not args.dry_run and not dest_root.is_dir():
		raise SystemExit(f"Dest not found: {dest_root} (is the Network Volume mounted?)")

	# The VAE is shared by the klein and dev sets — fetch it once.
	files: list[dict] = []
	seen: set[tuple[str, str]] = set()
	for s in args.sets:
		for f in MODEL_SETS[s]["files"]:
			key = (f["dir"], f["name"])
			if key not in seen:
				seen.add(key)
				files.append(f)

	for s in args.sets:
		print(f"== {s}: {MODEL_SETS[s]['title']}")
		print(f"   licence: {MODEL_SETS[s]['license']}")

	planned = sum(f["size"] for f in files
	              if args.force or not (dest_root / f["dir"] / f["name"]).is_file())
	if planned and not args.dry_run:
		free = shutil.disk_usage(dest_root).free
		print(f"\n== ~{_gb(planned)} to fetch; {_gb(free)} free on {dest_root}")
		if free < planned * 1.05:
			raise SystemExit("Not enough free space on the volume — resize it or drop a set.")

	for i, f in enumerate(files, 1):
		out = dest_root / f["dir"] / f["name"]
		label = f"[{i}/{len(files)}] {f['dir']}/{f['name']}"

		if args.dry_run:
			state = "present" if out.is_file() else "MISSING"
			print(f"{label} — {_gb(f['size'])} — {state}")
			continue

		size = _remote_size(f["url"]) or f["size"]
		if not args.force and out.is_file() and out.stat().st_size == size:
			print(f"{label} — already current, skipped")
			continue

		print(f"{label} — {_gb(size)}")
		out.parent.mkdir(parents=True, exist_ok=True)
		_download(f["url"], out, size)

	if args.dry_run:
		print("\n(dry run — nothing downloaded)")
	else:
		print("\n== Done. Restart ComfyUI so it re-scans models/.")


if __name__ == "__main__":
	try:
		main()
	except KeyboardInterrupt:
		print("\nInterrupted — re-run to resume from the .part file.", file=sys.stderr)
		sys.exit(130)
