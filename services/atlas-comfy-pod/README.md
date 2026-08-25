# atlas-comfy-pod — interactive ComfyUI R&D pod image

A **baked Docker image** for the RunPod **interactive ComfyUI web UI** the artist uses
for R&D (building/tuning a workflow that later becomes an Atlas Maker blueprint). Deploy a
pod FROM this image and everything Python is already present — **no hand-installed deps,
and it survives RunPod recreating the container on resume.**

Why baked: installing deps inside a running pod does **not** survive RunPod recreating the
container (the container id changes on resume → `tqdm`/`torch`/etc. get wiped →
ComfyUI crash-loops). Models are safe (they live on the Network Volume); only the
container's site-packages are lost. Baking every dep into the image fixes this for good.

This is the **interactive** sibling of [`services/atlas-serverless`](../atlas-serverless/)
(the headless serverless worker that runs baked blueprints). No RunPod handler here —
ComfyUI just auto-starts on port **8188**.

## What's in the image

- **ComfyUI** pinned to **v0.33.1** (must stay equal to the serverless worker's
  `COMFYUI_REF` — bump both in ONE PR; see the Dockerfile for why the old v0.3.66 pin was
  held and why it expired). Do **not** let ComfyUI-Manager "Update ComfyUI": it patches the
  ephemeral container layer only, so it silently reverts on the next container recreate.
- **torch cu128** (`--index-url .../cu128`) — **mandatory for Blackwell** (RTX PRO 4000/4500,
  `sm_120`). A cu124 build throws "no kernel image is available". Installed as the **first**
  pip step, and held there by [`constraints.txt`](constraints.txt) rather than by ordering
  (see below). **To bump torch, edit `constraints.txt`** — the install step names no versions.
- **[`constraints.txt`](constraints.txt)** — exported as `PIP_CONSTRAINT`, so it binds every
  pip install in the image **and every pip install on a live pod**, including ComfyUI-Manager's
  "install node" button. It pins torch and floors `numpy` / `ml_dtypes` / `onnx`, so a node's
  stale pin fails **its own** install instead of quietly rewriting a package the rest of the
  image shares. That is what freed the custom nodes to move to the bottom of the Dockerfile:
  the cheap-and-stable layers now sit above them, so **adding a node no longer reinstalls
  torch and the face stack**.
- **Custom nodes** baked in:
  - stock, cloned from GitHub **at pinned commit SHAs** (the `*_REF` ARGs — bump one
    deliberately, the same way `COMFYUI_REF` is bumped): `ComfyUI_IPAdapter_plus`,
    `ComfyUI-RMBG`, `comfyui_controlnet_aux`, `PuLID_ComfyUI` (the SDXL `Pulid*` nodes),
    `ComfyUI-PuLID-Flux2` (FLUX.2 face ID — R&D only, see the Dockerfile licence note),
    **`ComfyUI-VideoHelperSuite`** (video load / combine / preview — upstream ships no
    tags, so `VHS_REF` is a master SHA), **ComfyUI-Manager** (security level `middle`,
    so artists can add nodes from the web UI).
  - **vendored** (artist's modified copy): `ComfyUI-PuLID-Flux` → see
    [`custom_nodes/README.md`](custom_nodes/README.md) (duplicated from the serverless copy
    because Docker `COPY` can't escape the build context).
- **Face stack**: `insightface onnxruntime-gpu facexlib timm ftfy open-clip-torch`.
- **ffmpeg** (apt) for VideoHelperSuite. Its `imageio-ffmpeg` dep bundles a reduced
  binary; the pack's h265 / ProRes / av1-webm / NVENC presets want a full encoder set,
  and VHS scores both and takes the better one.
- **Qwen-Image** needs no custom node (native in ComfyUI) — the core deps cover it.

**Models are NOT in the image.** They come from the attached Network Volume via
[`extra_model_paths.yaml`](extra_model_paths.yaml), which points ComfyUI at
`/workspace/ComfyUI/models` (where the artist already keeps Qwen etc.). Add a model = drop
it on the volume, no rebuild. Only a genuinely new custom **node** needs a rebuild — and since the node section is the last thing in the Dockerfile, that rebuild reuses every layer above it. A change to the apt line or to `constraints.txt` is still a full rebuild, which is the right trade for two things that move about once a year.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | builds the interactive pod image — ordered stable-first, **custom nodes last** |
| `constraints.txt` | version rules for every pip step (and every pip on a live pod); **where torch is pinned** |
| `start.sh` | **CMD** — starts ComfyUI in the background + `sleep infinity` (crash-safe) |
| `extra_model_paths.yaml` | points ComfyUI at `/workspace/ComfyUI/models` on the volume |
| `custom_nodes/ComfyUI-PuLID-Flux/` | the artist's vendored, modified PuLID-Flux node |

## Build

Automated: pushing changes under `services/atlas-comfy-pod/**` triggers
[`.github/workflows/atlas-comfy-pod.yml`](../../.github/workflows/atlas-comfy-pod.yml),
which builds and pushes **`ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest`**. No local
Docker needed.

One-time: make the GHCR package **public** (GitHub → org Packages → this package →
Package settings → Change visibility) so RunPod can pull it without credentials.

## Deploy a RunPod pod from this image

1. RunPod → **Pods** → **Deploy** → **Custom / GHCR image**:
   `ghcr.io/invisible-wall-sl/atlas-comfy-pod:latest`.
2. Pick a Blackwell GPU (RTX PRO 4000/4500).
3. **Attach the Network Volume** `Invisible_RunPod_Storage`, mounted at **`/workspace`**
   (this is where models + `/workspace/comfyui.log` live).
4. Expose HTTP port **8188**.
5. **No "Container Start Command" is needed** — the image's CMD auto-starts ComfyUI on 8188
   and keeps the container alive on `sleep infinity`, so a ComfyUI crash never locks you out
   of the terminal. Watch startup with `tail -f /workspace/comfyui.log`.
6. Reach the UI at `https://<podId>-8188.proxy.runpod.net`. The launcher `/comfyui` fleet
   card starts/stops it (see `docs/status/comfyui.md`).

Because everything Python is baked, a resume that recreates the container comes back
fully working — no re-install runbook.

## Pod tools baked into the image

- **`/fetch-models.py`** (from `tools/fetch-models.py`) — pulls a named model set from
  Hugging Face straight onto the Network Volume. Baked because the old runbook told you
  to `curl` it from `raw.githubusercontent.com`, which **silently 404s**: this repo is
  private and GitHub answers 404 rather than 401, so it reads as "file missing".

  ```bash
  python /fetch-models.py --list
  python /fetch-models.py --set flux2-klein
  ```

  Sets, sizes and licences are in `services/atlas-tool/runpod/README.md` §3b. Models are
  NOT baked — they live on the volume, so a new model never needs an image rebuild.

- **`/port-forward.py`** (from `tools/port-forward.py`) — forwards **8189 → 8188** so
  ComfyUI answers on two ports. Started automatically by `start.sh`; logs to
  `/workspace/port-forward.log`.

  It exists because RunPod will not expose one container port as both HTTP and TCP, and
  a pod needs both: **TCP 8188** for the direct link the launcher can click (the HTTP
  proxy 403s clicked links), and **HTTP 8189** for the proxy hostname the launcher probes
  and a human pastes. Configure the pod as **HTTP 8189 + TCP 8188**.

  Raw TCP relay, so ComfyUI's `/ws` progress socket passes through untouched. Stdlib
  only — `socat` is not in this image and an apt package for forty lines is a worse trade.
