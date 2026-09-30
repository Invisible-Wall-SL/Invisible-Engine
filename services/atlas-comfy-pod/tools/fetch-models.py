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

CHECKSUMMED where a set pins them: a file with a `sha256` is hashed before it is ever
renamed into place, a mismatch deletes the `.part` and fails loudly, and a file already
present is skipped only if it hashes right — otherwise it is re-downloaded. A download
never writes the real filename until it is whole and verified, because a torn file
under a SHARED folder is what failed every video cutout for 14 hours (2026-09-04). Each
verified file is recorded in `<dest>/.fetch-models/verified.json` (sha256, size),
which is what `--verify` trusts for the big files instead of re-hashing gigabytes on
every worker boot.

`--verify` checks sets offline (small files hashed in full, big ones against that
record) and exits 1 naming every problem; `--stage DIR` mirrors every file that
verified into a worker-LOCAL models dir — small files copied, weights symlinked — and
leaves out the rest, so a node that rewrites or downloads beside its weights only ever
touches its own container's copy.
The serverless worker and the R&D pod both run it at boot (see their start.sh).

BAKED into the R&D pod image at `/fetch-models.py`, so there is nothing to download
first — the runbook's old `curl … raw.githubusercontent.com` silently 404s (private
repo; GitHub answers 404, not 401). `--dest` already defaults to the volume.

Usage (on the pod):
    python /fetch-models.py --list
    python /fetch-models.py --set flux2-klein
    python /fetch-models.py --set flux2-dev --dry-run
    python /fetch-models.py --set rmbg --set birefnet
    python /fetch-models.py --verify --set rmbg --set birefnet --stage /ComfyUI/models

Env:
    HF_TOKEN  optional; only needed if a set's repo is gated (none are today).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

HF = "https://huggingface.co"
# The Hugging Face commits the ComfyUI-RMBG sets are pinned to — `resolve/<commit>`, never
# `resolve/main`, so a re-upload upstream cannot change what a fetch writes. Read off the
# HF API on 2026-09-30; every file's git blob id there matches the bytes hashed below.
RMBG2_REV = "1cd4787601caeb4c8e826dba7ea8e2163b5208df"  # pragma: allowlist secret
BIREFNET_REV = "4d000788a9698c7f8d67c8c6ce2b40c768f5b909"  # pragma: allowlist secret
# Files at or under this size are hashed in full by --verify on every call; bigger ones
# are checked against the record a verified fetch left. The .py/.json files — the ones
# that tore on 2026-09-04 — are a few KB, so the boot check stays well under a second.
FULL_HASH_MAX = 16 << 20
VERIFIED_RECORD = Path(".fetch-models") / "verified.json"

# `size` is informational for sets WITHOUT checksums — used for --list and the free-space
# preflight, while the skip/resume decision re-reads the real Content-Length at download
# time, so a stale number can never cause a corrupt file to be treated as complete. For a
# file with a `sha256` it is exact: the hash decides, and the size is its companion.
MODEL_SETS: dict[str, dict] = {
	"flux2-klein": {
		"title": "FLUX.2 [klein] 4B (fp8)",
		"license": "apache-2.0 — diffusion model, Qwen3 text encoder AND vae",
		"note": (
			"The practical R&D target on our fleet: ~12.5 GB of weights, peak VRAM well "
			"inside a 24 GB card. Mirrors ComfyUI's built-in blueprint "
			"'Image Edit (Flux.2 Klein 4B)'. Encoder and vae come from the klein-purposed "
			"apache-2.0 repo, so this set is licence-clean END TO END — the one image path "
			"here that could ship in a game. (The encoder is byte-identical to the "
			"z_image_turbo copy; the vae is a DIFFERENT build from the flux2-dev one — same "
			"filename, 2 KB apart, different sha. Pulling flux2-klein and flux2-dev together "
			"therefore writes vae/flux2-vae.safetensors once, from whichever set is listed "
			"first. Re-run the set you actually mean with --force if you switch between them.) "
			"A 3.85 GB fp4 encoder exists in the same repo if VRAM ever gets tight."
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
				"url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors",
				"size": 8_040_000_000,
			},
			{
				"dir": "vae",
				"name": "flux2-vae.safetensors",
				"url": f"{HF}/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/split_files/vae/flux2-vae.safetensors",
				"size": 336_211_292,
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
	"pulid-flux2": {
		"title": "PuLID for FLUX.2 (identity adapter, klein v1 + v2)",
		"license": (
			"MIT weights + MIT node, BUT the pipeline is NON-COMMERCIAL: it needs "
			"InsightFace antelopev2 for face embedding, which is research-only"
		),
		"note": (
			"Face-identity adapter: give it a reference face and FLUX.2 keeps that identity. "
			"Needs the ComfyUI-PuLID-Flux2 custom node, which IS baked into the pod image — "
			"unlike Wan and FLUX.2 this is NOT core-native, so a pod predating that image "
			"has the weights and no nodes to load them. Binds to `flux2-klein` (the author "
			"recommends klein over dev). v1 and v2 are alternative trainings of the same "
			"shape, not a versioned upgrade path — both are listed so they can be compared; "
			"the card suggests strength 1.4. EVA-CLIP is fetched automatically by the node "
			"on first run, and antelopev2 by insightface, so neither is listed here. "
			"LICENCE: antelopev2 is non-commercial research only, so anything made through "
			"this path is R&D — it can never ship in a game, and it pulls klein (otherwise "
			"our one licence-clean image path) into non-commercial the moment a face is "
			"attached. Use `qwen-image` for anything shippable."
		),
		"files": [
			{
				"dir": "pulid",
				"name": "pulid_flux2_klein_v1.safetensors",
				"url": f"{HF}/Fayens/Pulid-Flux2/resolve/main/pulid_flux2_klein_v1.safetensors",
				"size": 1_364_389_800,
			},
			{
				"dir": "pulid",
				"name": "pulid_flux2_klein_v2.safetensors",
				"url": f"{HF}/Fayens/Pulid-Flux2/resolve/main/pulid_flux2_klein_v2.safetensors",
				"size": 1_364_389_800,
			},
		],
	},
	"wan22-t2v": {
		"title": "Wan 2.2 T2V A14B (text -> video, fp8)",
		"license": "apache-2.0 — model, umt5 encoder and VAE alike",
		"note": (
			"Native in ComfyUI core (comfy/ldm/wan) — NO custom node, and core ships the "
			"'Text to Video (Wan 2.2)' blueprint plus the video save nodes. It is a two-expert "
			"MoE: the high- and low-noise models load one at a time, so peak VRAM is ~14 GB "
			"rather than the 35.6 GB on disk. Pull `wan22-turbo` too — 4-step inference instead "
			"of 20+ is the difference between iterating and waiting."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
				"size": 14_290_000_000,
			},
			{
				"dir": "diffusion_models",
				"name": "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
				"size": 14_290_000_000,
			},
			{
				"dir": "text_encoders",
				"name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"size": 6_740_000_000,
			},
			{
				"dir": "vae",
				"name": "wan_2.1_vae.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
				"size": 250_000_000,
			},
		],
	},
	"wan22-i2v": {
		"title": "Wan 2.2 I2V A14B (image -> video, fp8)",
		"license": "apache-2.0",
		"note": (
			"Same shape as wan22-t2v, driven from a still instead of a prompt — the one that "
			"matters if you want to animate art the pipeline already produced. Shares the umt5 "
			"encoder and VAE with wan22-t2v, so pulling both costs ~14.3 GB extra, not 35.6."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
				"size": 14_290_000_000,
			},
			{
				"dir": "diffusion_models",
				"name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
				"size": 14_290_000_000,
			},
			{
				"dir": "text_encoders",
				"name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"size": 6_740_000_000,
			},
			{
				"dir": "vae",
				"name": "wan_2.1_vae.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
				"size": 250_000_000,
			},
		],
	},
	"wan22-turbo": {
		"title": "Wan 2.2 lightx2v 4-step LoRAs (t2v + i2v)",
		"license": "apache-2.0",
		"note": (
			"Add-on: cuts inference to 4 steps. Both the t2v and i2v pairs, since each expert "
			"(high/low noise) needs its own. The built-in Wan 2.2 blueprints already wire these "
			"in, so without them those blueprints load with a missing LoRA."
		),
		"files": [
			{
				"dir": "loras",
				"name": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
				"size": 1_230_000_000,
			},
			{
				"dir": "loras",
				"name": "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors",
				"size": 1_230_000_000,
			},
			{
				"dir": "loras",
				"name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
				"size": 1_230_000_000,
			},
			{
				"dir": "loras",
				"name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
				"size": 1_230_000_000,
			},
		],
	},
	"wan22-ti2v-5b": {
		"title": "Wan 2.2 TI2V 5B (text+image -> video, fp16)",
		"license": "apache-2.0",
		"note": (
			"The light one: 5B doing both t2v and i2v, ~18 GB total against ~36 GB for a 14B "
			"set. Note it needs its OWN vae (wan2.2_vae, 1.41 GB) — NOT the wan_2.1_vae the 14B "
			"models use; pairing the wrong one fails at load. ComfyUI ships no built-in "
			"blueprint for it, so expect to wire the graph by hand."
		),
		"files": [
			{
				"dir": "diffusion_models",
				"name": "wan2.2_ti2v_5B_fp16.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors",
				"size": 10_000_000_000,
			},
			{
				"dir": "text_encoders",
				"name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
				"size": 6_740_000_000,
			},
			{
				"dir": "vae",
				"name": "wan2.2_vae.safetensors",
				"url": f"{HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
				"size": 1_410_000_000,
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
	"rmbg": {
		"title": "RMBG-2.0 background removal (ComfyUI-RMBG `RMBG` node)",
		"license": "NON-COMMERCIAL (BRIA RMBG-2.0 is CC BY-NC 4.0) — see model_licences.json",
		"note": (
			"The Atlas Maker's default cutout (`rmbg_model: RMBG-2.0` on every SDXL/FLUX/GPT "
			"graph). Exactly the four files ComfyUI-RMBG @ 9edb2bec3900 downloads into "
			"models/RMBG/RMBG-2.0/ on first use, from the node's own 1038lab re-host, pinned to "
			"a commit. Fetched here and checksummed so no worker downloads them into the shared "
			"volume: the serverless worker verifies them at boot and stages each one that "
			"passes into its own disk; one that does not is downloaded there, privately."
		),
		"files": [
			{
				"dir": "RMBG/RMBG-2.0",
				"name": name,
				"url": f"{HF}/1038lab/RMBG-2.0/resolve/{RMBG2_REV}/{name}",
				"size": size,
				"sha256": sha,
			}
			for name, size, sha in (
				(
					"config.json", 405,
					"c97ea21569daf66b205491a4635147dd3bc42c7c168b89d7d75b53f67ef548ae",  # pragma: allowlist secret
				),
				(
					"BiRefNet_config.py", 298,
					"e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",  # pragma: allowlist secret
				),
				(
					"birefnet.py", 91_320,
					"8f498727f4bdb7dfaa4d66190f0ebf55392bda62c1b4f224be39f9b750a8915d",  # pragma: allowlist secret
				),
				(
					"model.safetensors", 884_878_856,
					"566ed80c3d95f87ada6864d4cbe2290a1c5eb1c7bb0b123e984f60f76b02c3a7",  # pragma: allowlist secret
				),
			)
		],
	},
	"birefnet": {
		"title": "BiRefNet, all 12 variants (ComfyUI-RMBG `BiRefNetRMBG` node)",
		"license": (
			"per variant — the ZhengPeng7 BiRefNet family is MIT; toonout and Lucida are "
			"recorded separately in model_licences.json"
		),
		"note": (
			"The Flipbook video blueprint's cutout (default BiRefNet_toonout), whose model "
			"select offers every variant — so all twelve are here, not just the default: a "
			"variant missing from the volume is one the node would download at run time. "
			"They SHARE models/RMBG/BiRefNet/ with the .py/config files, which is how one torn "
			"birefnet.py failed every cutout for 14 hours (2026-09-04). Exactly the files "
			"ComfyUI-RMBG @ 9edb2bec3900 names, pinned to a commit of 1038lab/BiRefNet. The "
			"node REWRITES its .py in place on every load (relative import made absolute, line "
			"endings normalised), so each .py also accepts that rewritten form."
		),
		"files": [
			{
				"dir": "RMBG/BiRefNet",
				"name": name,
				"url": f"{HF}/1038lab/BiRefNet/resolve/{BIREFNET_REV}/{name}",
				"size": size,
				"sha256": sha,
				**({"accept_sha256": [rewritten]} if rewritten else {}),
			}
			for name, size, sha, rewritten in (
				(
					"config.json", 402,
					"966a1f0165b072d2d1309756e71907750e535ba5c3790d8cd0e69713ff3a56cd",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_config.py", 298,
					"e7b8c2a74f6cea6a59553d517f71d47f2c1d90e670a13416af17c25fe2f3dc52",  # pragma: allowlist secret
					"",
				),
				(
					"birefnet.py", 92_068,
					"a9566611aa07a6fbb68ddb6ac8e19e62c879a428fbfc2f44efa53d233f2e302f",  # pragma: allowlist secret
					"bd2986cee78b6d649ba7464066a0ba393cc45910ba1cb413ed91ca8fbb226f86",  # pragma: allowlist secret
				),
				(
					"birefnet_lite.py", 94_257,
					"1ec7679913fe0e042a108fc31a29a5ff12e84e7d91c9fff2747d45f3166ab5eb",  # pragma: allowlist secret
					"8cfa74c242870386ffb01ee8a91238525ee6c8fce7e6c9559ac7056a2e7440ce",  # pragma: allowlist secret
				),
				(
					"BiRefNet-general.safetensors", 884_878_856,
					"77277264c0e8c74149d3ff2fade4fd8176965b7108f3c5fc3b8c9c811edb4519",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_512x512.safetensors", 444_473_596,
					"d94ae0eefb2d2020192001e984ecd6b367478118257a3132e6a484bbf18b0f41",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet-HR.safetensors", 444_473_596,
					"9d678bafec0b0019fbb073b7fd02f05ede25dc4b15254f23b2fb0be333200c0d",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet-portrait.safetensors", 884_878_856,
					"4a4eb3a5469b75f0cccaec6772c22fc30e6c12ed429c2c0ba71b43e3d8d97182",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet-matting.safetensors", 884_878_856,
					"a9875de5b1e6c8eb5fdaa8c727a82927ce442cdc87ba3abee6a77e6fa46c25bb",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet-HR-matting.safetensors", 444_473_596,
					"a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_lite.safetensors", 177_634_392,
					"4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_lite-2K.safetensors", 177_634_392,
					"aa2e4a5af5eb3904694feb40f2b39ec5dd7cd9110906590cfeb982f09a46021d",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_dynamic.safetensors", 444_473_596,
					"e3d2e4884e51ff30f0cd630edc6b1e41b06b7f23a0a2a5169f7b7cb33a711c2d",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_lite-matting.safetensors", 88_965_896,
					"ce8bcfc045e336322c0424a5863dcfb7e9ce8fed0a5fd4d1b2b20adf12d97243",  # pragma: allowlist secret
					"",
				),
				(
					"BiRefNet_toonout.safetensors", 884_878_824,
					"5ff451d2e1d15dd22a66efea05640f79e470467f89f8bdc239a81a6757f66093",  # pragma: allowlist secret
					"",
				),
				(
					"Lucida.safetensors", 884_878_856,
					"2f1aa6913426537d4b93dd5f7138ae5c6664e99abda98c95f3d5b9101283e7d5",  # pragma: allowlist secret
					"",
				),
			)
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


def _sha256(path: Path) -> str:
	h = hashlib.sha256()
	with open(path, "rb") as fh:
		for chunk in iter(lambda: fh.read(1 << 22), b""):
			h.update(chunk)
	return h.hexdigest()


def _accepted(f: dict) -> set[str]:
	"""Every sha256 that counts as this file being current. The extras are forms a node
	legitimately writes over the download (see the `birefnet` set)."""
	return {f["sha256"], *f.get("accept_sha256", [])}


def _stream(url: str, part: Path, expect: int | None) -> bool:
	"""Stream `url` into `part`, resuming an existing one when the server allows it.
	True when it resumed — the bytes already there were kept."""
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
	return resuming


def _download(url: str, out: Path, expect: int | None, sha256: str | None = None) -> None:
	"""Download to `out`'s `.part` and rename it into place only once it is whole — and,
	when `sha256` is given, only once it hashes right. The real filename therefore never
	holds a torn file. A bad hash deletes the `.part`: after a RESUME the kept bytes are
	the suspect, so it starts over once; a clean download that still mismatches fails."""
	part = out.with_suffix(out.suffix + ".part")
	while True:
		resumed = _stream(url, part, expect)
		if expect and part.stat().st_size != expect:
			raise SystemExit(
				f"size mismatch for {out.name}: got {part.stat().st_size}, expected {expect}. "
				"Left the .part in place — re-run to resume."
			)
		if sha256 is None:
			break
		got = _sha256(part)
		if got == sha256:
			break
		part.unlink()
		if not resumed:
			raise SystemExit(
				f"CHECKSUM MISMATCH for {out.name}: got {got}, pinned {sha256}. The download "
				"was deleted, and nothing was written under the real name. Upstream no longer "
				"serves the pinned bytes — do not bypass this; re-pin the set deliberately."
			)
		print(f"    checksum mismatch after resuming {part.name} — the kept bytes were bad; "
		      "starting over")
	part.replace(out)


def _load_record(dest_root: Path) -> dict:
	try:
		return json.loads((dest_root / VERIFIED_RECORD).read_text(encoding="utf-8"))
	except (OSError, ValueError):
		return {}


def _record_verified(dest_root: Path, rel: str, sha256: str) -> None:
	"""Note that `rel` hashed to `sha256` just now, at the size it has now — what
	`--verify` trusts for a file too big to re-hash on every boot. Written through a temp
	file and a rename, like the models themselves."""
	path = dest_root / VERIFIED_RECORD
	st = (dest_root / rel).stat()
	record = _load_record(dest_root)
	record[rel] = {"sha256": sha256, "size": st.st_size}
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_name(path.name + ".part")
	tmp.write_text(json.dumps(record, indent=1, sort_keys=True), encoding="utf-8")
	tmp.replace(path)


def _check_one(dest_root: Path, f: dict, record: dict, stage_root: Path | None) -> str:
	"""What is wrong with one file, or "" when it verifies — and, when staging, it is in
	`stage_root` exactly when it verifies. Nothing half-written is ever left there: a
	small file is copied to a temporary name, hashed, and only then renamed into place."""
	rel = f"{f['dir']}/{f['name']}"
	src = dest_root / rel
	dst = stage_root / rel if stage_root else None
	tmp = dst.with_name(dst.name + ".staging") if dst is not None else None
	try:
		if dst is not None:
			dst.parent.mkdir(parents=True, exist_ok=True)
			if dst.is_symlink() or dst.exists():
				dst.unlink()
		if not src.is_file():
			return f"{rel}: missing"
		size = src.stat().st_size
		if size <= FULL_HASH_MAX:
			if tmp is not None:
				shutil.copyfile(src, tmp)
			if _sha256(tmp or src) not in _accepted(f):
				return f"{rel}: checksum mismatch"
			if tmp is not None:
				tmp.replace(dst)
			return ""
		seen = record.get(rel) or {}
		if seen.get("sha256") != f["sha256"]:
			return f"{rel}: never verified by fetch-models"
		if seen.get("size") != size:
			return f"{rel}: changed since it was verified"
		if dst is not None:
			dst.symlink_to(src)
		return ""
	except OSError as e:
		if dst is not None and (dst.is_symlink() or dst.exists()):
			dst.unlink()
		return f"{rel}: could not be checked or staged ({e})"
	finally:
		if tmp is not None and tmp.exists():
			tmp.unlink()


def _check(dest_root: Path, files: list[dict], stage_root: Path | None) -> list[str]:
	"""Everything wrong with `files` under `dest_root`, offline. Empty means verified.

	A small file is hashed in full. When staging, it is hashed AFTER the copy, so what is
	verified is the exact bytes this container will load — not a shared file some other
	process may rewrite between the check and the copy. A big file must match the record
	a verified fetch left: same sha256 and size. Not mtime — the volume is written from a
	pod and read from every worker, and a boot that distrusted weights over a clock would
	throw away a good copy; only fetch-models writes these names, and only whole
	(`.part` + rename). Staged big files are symlinks to the volume.

	PER FILE: each one that verifies is staged, each one that does not is left out, so
	one bad variant costs only itself — the node downloads what is absent into the
	container's own disk, which no other worker can see."""
	record = _load_record(dest_root)
	return [p for p in (_check_one(dest_root, f, record, stage_root) for f in files) if p]


def _verify(dest_root: Path, sets: list[str], files: list[dict], stage_root: Path | None) -> int:
	"""`--verify`: 0 when every file checks out, else 1 — and then the LAST line printed
	is a one-line summary naming the fix. With `--stage` the files that did verify are
	staged either way; see `_check`."""
	unpinned = sorted({s for s in sets for f in MODEL_SETS[s]["files"] if "sha256" not in f})
	if unpinned:
		raise SystemExit(f"Set(s) with no checksums to verify: {', '.join(unpinned)}.")
	problems = _check(dest_root, files, stage_root)
	where = f", staged into {stage_root}" if stage_root else ""
	if not problems:
		print(f"== verified {len(files)} file(s) of {'+'.join(sets)} under {dest_root}{where}")
		return 0
	print(f"== verified {len(files) - len(problems)} of {len(files)} file(s) of "
	      f"{'+'.join(sets)} under {dest_root}{where}")
	for p in problems:
		print(f"   !! {p}")
	fix = " ".join(f"--set {s}" for s in sets)
	print(f"UNVERIFIED {'+'.join(sets)} under {dest_root}: {len(problems)} problem(s), first "
	      f"'{problems[0]}' — fix on a pod: python /fetch-models.py {fix}")
	return 1


def main() -> None:
	ap = argparse.ArgumentParser(description="Fetch a model set from Hugging Face onto a pod volume")
	ap.add_argument("--set", dest="sets", action="append", metavar="NAME",
	                help="model set to fetch (repeatable); see --list")
	ap.add_argument("--dest", default="/workspace/ComfyUI/models",
	                help="ComfyUI/models dir on the volume")
	ap.add_argument("--list", action="store_true", help="show the available sets and exit")
	ap.add_argument("--dry-run", action="store_true", help="report what would be fetched, download nothing")
	ap.add_argument("--force", action="store_true", help="re-download even if the size already matches")
	ap.add_argument("--verify", action="store_true",
	                help="check checksummed sets offline, download nothing; exit 1 on any problem")
	ap.add_argument("--stage", metavar="DIR",
	                help="with --verify: mirror the verified sets into DIR, a container-local models dir")
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
	if args.stage and not args.verify:
		raise SystemExit("--stage only stages what --verify has just checked; pass both.")

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

	if args.verify:
		sys.exit(_verify(dest_root, args.sets, files, Path(args.stage) if args.stage else None))

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
		rel = f"{f['dir']}/{f['name']}"
		out = dest_root / rel
		label = f"[{i}/{len(files)}] {rel}"
		sha256 = f.get("sha256")

		if args.dry_run:
			state = "present" if out.is_file() else "MISSING"
			print(f"{label} — {_gb(f['size'])} — {state}")
			continue

		if sha256:
			# A checksummed file is current only if it HASHES right — a torn file can
			# have exactly the right size. The download itself is checked the same way.
			if not args.force and out.is_file():
				got = _sha256(out)
				if got in _accepted(f):
					_record_verified(dest_root, rel, got)
					print(f"{label} — verified, skipped")
					continue
				print(f"{label} — CHECKSUM MISMATCH on disk, re-downloading")
			print(f"{label} — {_gb(f['size'])}")
			out.parent.mkdir(parents=True, exist_ok=True)
			_download(f["url"], out, f["size"], sha256)
			_record_verified(dest_root, rel, sha256)
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
