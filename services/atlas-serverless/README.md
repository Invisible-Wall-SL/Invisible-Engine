# atlas-serverless — ComfyUI RunPod Serverless worker

The Atlas Maker's ComfyUI generation backend as a **RunPod Serverless** endpoint:
scales to zero (pays only while generating), no pod stop/start availability dance.

Full design + rationale: [`docs/design/comfyui-serverless.md`](../../docs/design/comfyui-serverless.md).

## What's in the image

- **ComfyUI** + **torch 2.6** (base `pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime`).
- **Custom nodes** baked in:
  - stock, cloned from GitHub: `ComfyUI_IPAdapter_plus`, `ComfyUI-RMBG`, `comfyui_controlnet_aux`
  - **vendored** (artist's modified copy): `ComfyUI-PuLID-Flux` → see [`custom_nodes/README.md`](custom_nodes/README.md)
- **Handler** (`handler.py`) — accepts `{workflow, images[]}`, runs it, returns images.

**Models are NOT in the image.** They come from the attached Network Volume via
`extra_model_paths.yaml`. Adding a model = drop it on the volume, no rebuild.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | builds the worker image |
| `handler.py` | RunPod serverless handler (upload refs → queue prompt → poll → return images) |
| `start.sh` | launches ComfyUI in the background, then the handler |
| `extra_model_paths.yaml` | points ComfyUI at `/runpod-volume/ComfyUI/models` |
| `custom_nodes/ComfyUI-PuLID-Flux/` | the artist's vendored, modified PuLID node |

## Build

Automated: pushing changes under `services/atlas-serverless/**` triggers
`.github/workflows/atlas-comfy-worker.yml`, which builds and pushes
`ghcr.io/invisible-wall-sl/atlas-comfy-worker:latest`. No local Docker needed.

One-time: make the GHCR package **public** (GitHub → org Packages → this package →
Package settings → Change visibility) so RunPod can pull it without credentials.

## Endpoint (RunPod side)

Serverless → New Endpoint → this image, a GPU (e.g. RTX 4090), attach the
`Invisible_RunPod_Storage` volume, Active workers 0 / Max 2–3 / FlashBoot on.
Then set `RUNPOD_ENDPOINT_ID` + `RUNPOD_API_KEY` + `COMFY_TRANSPORT=serverless` on the
`atlas-tool` Railway service.
