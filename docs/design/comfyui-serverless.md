# ComfyUI on RunPod Serverless — the Atlas Maker generation backend

Status: **in progress** (2026-08-13). Supersedes the on-demand **pod** backend
(`docs/design/runpod-comfyui-backend.md`) for the Atlas Maker, after on-demand
pods proved unreliable for the stop/start cost model (see "Why not a pod" below).

## Goal

Run the Atlas Maker's ComfyUI generations (SDXL + the FLUX/PuLID blueprints) on a
backend that:

- **costs ~nothing when idle** (scales to zero), pays per-second only while generating;
- is **reliable to start** (no "GPU no longer available" migration dance);
- **needs no image rebuild for the daily work** — new *blueprints* and new *models*
  must not require a rebuild (only a genuinely new custom *node* does, which is rare).

## Why not a pod (what we learned the hard way)

On-demand RunPod **pods** do NOT reserve the GPU while stopped. Every stop→start is a
gamble on free stock: on a scarce GPU (RTX 5090) it forced a volume **migration**
almost every restart; even a 4090 in the thin **EU-RO-1** region kept coming back
"GPU no longer available". The only reliable pod is an **always-on** one (~$500/mo),
which defeats the pay-per-use goal. Plus a bare CUDA base image meant per-boot
dependency hell (missing deps → broken DNS → torch-too-old → disk-full). Serverless
is the correct RunPod primitive for bursty, pay-per-use GPU inference.

## Architecture

```
Atlas Maker (Railway, services/atlas-tool)
   │  batch_atlas.py builds the ComfyUI API-workflow + collects ref images
   │
   │  POST https://api.runpod.ai/v2/<ENDPOINT_ID>/run
   │       { input: { workflow: <api.json>, images: [ {name, image:<b64>} ] } }
   │  GET  .../status/<jobId>   (poll)
   ▼
RunPod Serverless Endpoint  (scales 0→N, FlashBoot)
   │  worker image = ghcr.io/invisible-wall-sl/atlas-comfy-worker
   │     ComfyUI (pinned) + torch (matched) + custom nodes (PuLID…) + handler
   │  Network Volume (models) attached at /runpod-volume  → ComfyUI models dir
   ▼
   returns generated image(s) as base64 → pipeline saves to staging + R2
```

### Three layers, and which ones ever require an image rebuild

| Layer | Where it lives | Rebuild image? |
|---|---|---|
| **Blueprints / workflows** | sent per-request as the job `input.workflow` | **never** |
| **Models** (checkpoints, LoRAs, PuLID/InsightFace weights) | **Network Volume** (mirrored in R2) | **never** — drop on volume / R2-pull |
| **Custom nodes** (PuLID, controlnet_aux…) | **baked in the image** (cloned from GitHub + pip deps) | only when adding a *new* node (rare) → CI rebuild |

This split is the whole point: the daily churn (blueprints + models) is rebuild-free.
Custom nodes are cloned **from their GitHub repos at build time** — the build never
needs the node present on anyone's local machine.

## The worker image (`services/atlas-serverless/`)

- Base: a CUDA image whose **torch is new enough** for the current ComfyUI
  (`comfy_kitchen`/`quant_ops` need torch that supports PEP-585 `list[int]` in
  `torch.library.custom_op` → torch ≥ ~2.6). Pin ComfyUI to the commit the working
  volume uses (snapshot at build time), and pin torch to match.
- Custom nodes cloned + their `requirements.txt` installed at build (PuLID + the
  SDXL/FLUX blueprint nodes: `comfyui_controlnet_aux`, `ComfyUI_IPAdapter_plus`,
  `ComfyUI-RMBG`).
- Handler contract = `runpod-worker-comfy`-style: `input.workflow` (ComfyUI API
  JSON) + `input.images[]` (name + base64) → uploads images, queues the prompt,
  polls history, returns output image(s).
- Models are NOT baked. ComfyUI reads them from the attached volume via
  `extra_model_paths.yaml` (or the volume mounted at the models dir).
- Built + pushed by **GitHub Actions → GHCR**. The package is **private**: the endpoint
  needs a Container Registry Auth credential (a GitHub PAT with `read:packages`), and
  GHCR grants that access PER PACKAGE — see `docs/INFRA.md`.

## Pipeline changes (`services/atlas-tool/batch_atlas.py`)

Today `batch_atlas` talks to a live ComfyUI over HTTP (`/upload/image`, `/prompt`,
`/history`, `/view`). Add a **transport** switch:

- `COMFY_TRANSPORT=serverless` → build `{workflow, images}` and POST to the RunPod
  endpoint (`/run` + poll `/status`, or `/runsync`), decode returned base64 images.
- default (`http`) → the existing direct-ComfyUI path (kept for local/pod use).

Refs that today upload via `/upload/image` become `input.images[]` (base64) with the
same filenames the workflow's `LoadImage` nodes reference — the role-routing logic in
`_upload_workflow_refs` is reused to decide names.

Env (Railway `atlas-tool`): `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`,
`COMFY_TRANSPORT=serverless`. The old pod vars (`RUNPOD_POD_ID`, `COMFY_URL`) and
`runpod_control.py` (pod resume/stop) are unused in serverless and can be retired.

## Region / capacity note

A serverless endpoint with a Network Volume is **pinned to the volume's region**. The
existing volume is in **EU-RO-1** (thin stock). Serverless spreads wider than a single
pod, so EU may be fine — but if workers are slow to allocate, move the volume to a US
region. Because the models are mirrored in **R2**, that's an automated re-pull
(`runpod/pull-models.py`) into a fresh US volume, not a manual re-upload.

## Build plan (ordered)

1. **[me]** Scaffold `services/atlas-serverless/` — Dockerfile, handler, node list,
   `extra_model_paths.yaml`, `.github/workflows/atlas-comfy-worker.yml` (build→GHCR).
   Pin ComfyUI + torch + the PuLID repo (folder name owed from the artist's box).
2. **[me]** Rewrite `batch_atlas` transport (`serverless` path) behind `COMFY_TRANSPORT`.
3. **[you]** Create the serverless endpoint (image, GPU, volume, scale-to-zero) → Endpoint ID.
4. **[both]** Set Railway env + test a real blueprint generation end-to-end.
5. Retire the pod path (`runpod_control.py`, pod env) once serverless is confirmed.

## Cold starts

Scale-to-zero means the first request after idle spins a worker + loads models to
VRAM (~30s–2min; FlashBoot keeps recently-used workers warm). Acceptable for image
gen. Keep `Active workers = 0` for cost; raise to 1 only if warm-always is worth it.
