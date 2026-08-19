# RunPod ComfyUI pod — provisioning

Runs the same ComfyUI that the Atlas Maker drives, but on a RunPod **Pod** (not
Serverless) instead of the local RTX 4070 + Cloudflare tunnel. The backend reaches
it purely through the `COMFY_URL` env var, so moving here is a config change on the
Railway services plus this one-time pod setup.

> **Why a Pod, not Serverless:** the client does `POST /prompt` → poll
> `GET /history/{prompt_id}` → `GET /view`, all of which must hit the *same*
> worker (the prompt id and the saved PNG live on one worker's disk). A Pod is a
> single sticky endpoint, so the existing code works unchanged.

## 0. One-time: seed the model mirror (owner, local box)

If the R2 model mirror isn't current, run this on the machine that has the working
ComfyUI so the pod can pull the exact same models:

```bash
py scripts/seed-comfyui-models.py
```

It uploads `Shared/Models/**` → R2 `comfyui-models/<relpath>` and writes the
manifest `tools/invisible-launcher/models-manifest.json`. Needs `R2_*` env set.

## 1. Create the Network Volume (do this FIRST)

RunPod → Storage → **Network Volume**. Region = wherever you'll rent the GPU.
Size: **150 GB** for SDXL only, **250 GB** if you also want the full FLUX set.
Everything (ComfyUI + custom nodes + models) lives on this volume so it survives
pod restarts and you never re-download the models.

## 2. Deploy the Pod

RunPod → Pods → Deploy, attach the Network Volume from step 1 (mounts at
`/workspace`).

- **GPU:** RTX 4090 (24 GB) for the current SDXL/FLUX image pipeline.
- **Template:** any recent `runpod/pytorch` CUDA 12.x image.
- **Expose HTTP port `8188`.** RunPod gives you a proxy URL
  `https://<podId>-8188.proxy.runpod.net` — that becomes `COMFY_URL`.

## 3. Provision (once per fresh volume)

Open the pod's web terminal and run:

```bash
cd /workspace
curl -fsSL https://raw.githubusercontent.com/Invisible-Wall-SL/Invisible-Engine/main/services/atlas-tool/runpod/provision.sh -o provision.sh
# (or paste the file from this repo)
bash provision.sh
```

`provision.sh`:
1. Clones ComfyUI + **ComfyUI-Manager** (security level forced to `middle` — required
   for the blueprint model auto-install; `high`/`strong` returns 403).
2. Clones the custom nodes the SDXL/FLUX blueprints need
   (`ComfyUI_IPAdapter_plus`, `ComfyUI-RMBG`, `comfyui_controlnet_aux`).
3. Installs Python deps.
4. Runs `pull-models.py` to mirror the R2 model set onto the volume.

Set your R2 creds in the pod's env before running (Pod → Edit → Environment):
`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

## 3b. Optional: fetch an upstream model set (FLUX.2)

`pull-models.py` mirrors **our** curated R2 set. For a big public set there's no reason
to route it through R2 — `fetch-models.py` pulls it from Hugging Face straight onto the
volume instead (idempotent, and resumable via HTTP Range, which matters when a pod web
terminal drops in the middle of a 35 GB file):

```bash
py services/atlas-tool/runpod/fetch-models.py --list
```

```bash
py services/atlas-tool/runpod/fetch-models.py --set flux2-klein --dest /workspace/ComfyUI/models
```

FLUX.2 needs **no custom node** — it is native in ComfyUI core from the `v0.33.1` pin
(`comfy/ldm/flux` plus the built-in `Flux.2 …` blueprints). Only the weights are missing.

| Set | Size | Licence | Fits our fleet? |
|---|---|---|---|
| `flux2-klein` | 12.5 GB | **apache-2.0** (model + Qwen3 encoder) | Yes — comfortable on a 24 GB card |
| `flux2-dev` | 53.8 GB | **non-commercial** (BFL FLUX.2 [dev]) | Not really — 35 GB of weights vs a 32 GB max card, so CPU offload |
| `flux2-dev-turbo` | 2.8 GB | inherits dev's non-commercial terms | Add-on for `flux2-dev` |

**Start with `flux2-klein`.** It is the only FLUX.2 variant that is both Apache-2.0 (so it
could ever ship in a game, unlike FLUX.1-dev/PuLID which are R&D-only) and small enough to
run without offload on the cards in the fleet. `flux2-dev` is for quality comparison only —
check the Network Volume has ~54 GB spare first; it was sized for SDXL/FLUX.1.

> One caveat the script also prints: the `flux2-vae` file both sets use is served from the
> `Comfy-Org/flux2-dev` repo, which is licensed `other`, not apache-2.0. Confirm the VAE's
> terms yourself before anything from klein ships commercially.

## 4. Start ComfyUI

```bash
bash /workspace/start-comfyui.sh
```

Verify from your laptop (should return JSON, no Cloudflare challenge):

```bash
curl -H 'User-Agent: InvisibleAtlas/1.0' https://<podId>-8188.proxy.runpod.net/system_stats
```

## 5. Point the backend at the pod

On Railway, **atlas-backend** AND **atlas-tool** services → Variables:

- Set `COMFY_URL` = `https://<podId>-8188.proxy.runpod.net`
- **Delete** `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (no Cloudflare Access
  in front of the pod — the client self-disables those headers when unset; the
  `InvisibleAtlas/1.0` User-Agent still ships unconditionally).
- Click **Apply changes / Deploy** on each (a plain redeploy does NOT apply staged vars).

Then generate a region from `/atlas` and confirm the PNG lands in R2.

## Notes / caveats

- **Security:** the RunPod proxy URL is public-but-unguessable — you lose the
  Cloudflare Access gate the tunnel had. Fine for testing; add a token gate before
  this is a standing service if that matters.
- **Concurrency:** one Pod = one ComfyUI = one job at a time (internal FIFO). Two
  artists share the queue. For true parallelism, run a second pod and route per
  artist (needs a small `COMFY_URL`-per-session change — not wired today).
- **Custom nodes:** `provision.sh` clones the nodes the built-in blueprints need. If
  your local ComfyUI has extra node packs a custom blueprint depends on, clone those
  too (compare against your local `ComfyUI/custom_nodes/`). `gpt_image` also needs an
  "Images to RGB" node pack, still unresolved locally — leave gpt_image out for now.
- **Stop the pod when idle** to control cost; the volume keeps everything, so restart
  is fast.
