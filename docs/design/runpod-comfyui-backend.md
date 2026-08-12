# RunPod ComfyUI backend — Design

> **Decision (owner, 2026-08-11):** run ComfyUI on a **RunPod on-demand GPU pod
> backed by a Network Volume**, and make it the backend the atlas-tool talks to.
> This SUPERSEDES the home-machine + Cloudflare-tunnel path (and the
> "local companion agent" in [invisible-blueprints.md §10](invisible-blueprints.md))
> as the way to reliably share a blueprint's **models + custom nodes**. The
> per-user tunnel work ([per-user-comfyui-routing.md](per-user-comfyui-routing.md))
> stays as a legacy/fallback but is no longer the target for blueprints.

## Why R2 + Railway alone can't do this (storage vs compute)
Three separate jobs; R2 and Railway only cover two:

| Job | Who |
| --- | --- |
| **Store** models / nodes / blueprints | R2 (object storage) ✅ already |
| **Orchestrate** (launcher, atlas-tool web apps) | Railway (CPU containers, **no GPU**) ✅ already |
| **Run ComfyUI** (GPU inference) | ❌ — a home GPU over a tunnel today |

R2 is a cloud hard drive: it holds files, it cannot *run* anything. Railway
containers have no GPU, so they cannot run ComfyUI. The only place ComfyUI runs
today is a home box reached over a Cloudflare tunnel — the fragile piece (which
ComfyUI install is on `:8188`, is the tunnel alive, is the machine on, does it
have the right nodes). **RunPod is a GPU we control**: we pull the exact models
**from R2** onto it, `git clone` the exact nodes, and run ComfyUI there — no home
machine, no tunnel. R2 stays the file store; RunPod is the GPU that reads it.

## Architecture
```
Atlas Maker (Railway, CPU)  --COMFY_URL-->  RunPod Pod (GPU, ComfyUI :8188)
        |                                        |
        |  reads/writes                          |  Network Volume /workspace
        v                                        |    ComfyUI + custom_nodes + models  (persists across stops)
      R2  <-------------------- pull models ------+
      (models, blueprints)
```
- **Network Volume** holds ComfyUI + custom nodes + models, so they **survive
  pod stop/restart and are never re-downloaded** — this is what keeps on-demand
  cold starts short.
- **Pod = a single sticky endpoint** (`https://<podId>-8188.proxy.runpod.net`)
  — NOT Serverless: the client does `POST /prompt` → poll `/history/{id}` →
  `/view`, which must all hit the same worker (see `runpod/README.md`).

## On-demand + cold start
A cold start is NOT a re-download (models persist on the volume) — it is just:
boot the pod + launch ComfyUI + first model into VRAM ≈ **1–3 min**, paid ONCE
when the pod is spun up for a session, then warm for the rest of the session.
Lifecycle options:
- **Manual:** start the pod at the start of a work session, stop it when done.
- **Automated (target):** the atlas-tool auto-starts the pod via the RunPod API
  when a render is requested and the pod is stopped (a "warming up ~2 min"
  banner), and auto-stops after an idle timeout. Needs a `RUNPOD_API_KEY`.

## What already exists (`services/atlas-tool/runpod/`)
- `provision.sh` — clones ComfyUI + ComfyUI-Manager (security **middle**, required
  for Manager model auto-install), clones the current SDXL/FLUX nodes
  (IPAdapter / RMBG / controlnet_aux — **hardcoded today**), installs deps, and
  runs `pull-models.py`.
- `pull-models.py` — mirrors the R2 model set (`tools/invisible-launcher/models-manifest.json`)
  onto `/workspace/ComfyUI/models` (idempotent by size).
- `seed-comfyui-models.py` (engine `scripts/`) — uploads local `models/**` → R2.

## Cost (no contract — pay-as-you-go)
- **Network Volume** ~250 GB: the only always-on cost, ~$0.05–0.07/GB/mo ≈
  **~$12–18/mo**, whether or not the GPU runs. Keeps models persistent.
- **On-Demand GPU pod** (RTX 4090, 24 GB): per-second while running, ≈
  **$0.35–0.70/hr**. Stop it → GPU cost stops.
- **On-Demand, NOT Spot/Interruptible** (a render must not be preempted). **No
  "Savings Plan"** (that discounts an always-on pod — the opposite of on-demand).

## Owner setup (one-time)
1. RunPod account + billing (card / prepaid credits). No plan to sign.
2. **Storage → Network Volume**, ~**250 GB**, in a region with 4090 availability.
3. **Pods → Deploy**, attach the Network Volume (mounts at `/workspace`), GPU =
   **RTX 4090**, **On-Demand**, a recent `runpod/pytorch` CUDA 12.x image, expose
   HTTP port **8188**. Note the proxy URL `https://<podId>-8188.proxy.runpod.net`.
4. In the pod's web terminal, set the `R2_*` env, then run `provision.sh` (once
   per fresh volume). Start ComfyUI: `bash /workspace/start-comfyui.sh`.
5. Set **`COMFY_URL = https://<podId>-8188.proxy.runpod.net`** on the Railway
   `atlas-tool` service (replaces the home tunnel). No CF Access headers needed
   (RunPod's proxy is the gate) — clear `CF_ACCESS_CLIENT_ID/SECRET` there.

## Build plan (phases)
1. **Point the atlas-tool at the pod** — `COMFY_URL` → pod proxy; verify a SDXL
   generate end-to-end on the pod. *(smallest first win.)*
2. **Model upload → R2** — the blueprint upload UI lets the artist attach model
   files (→ `_shared/models/<sha256>/`, presigned multipart) and declare
   `custom_nodes[]`. (Blueprint-deps Phase 2; schema already shipped.)
3. **Per-blueprint provisioning on the pod** — given a blueprint, install its
   `custom_nodes[]` (git clone/pin) + pull its `models[]` from
   `_shared/models/<sha256>/` onto the volume, restart ComfyUI. Generalizes
   `provision.sh`'s hardcoded node list + `pull-models.py`'s fixed manifest.
   Drive over ComfyUI-Manager where possible, else a tiny pod-side helper.
4. **Auto-start/stop the pod** via the RunPod API (`RUNPOD_API_KEY`) — the
   on-demand UX: warm on generate, idle-stop after N minutes.
5. **Retire the home-tunnel path** for blueprints once the pod is proven.

Phase 1 makes the pod the backend; 2–3 make a blueprint self-provision its
models+nodes on it; 4 makes on-demand hands-off.
