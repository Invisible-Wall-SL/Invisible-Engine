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
- **Ports: `HTTP 8189` + `TCP 8188`. Both, exactly like that.** RunPod refuses to give
  one container port both, and we need both:
  - **TCP `8188`** → a direct `http://<ip>:<port>` the launcher can LINK to. The proxy
    **403s any clicked link** (see `docs/INFRA.md`), so without this the *Open ComfyUI*
    button cannot work and the card marks the pod *⚠ not reachable*. RunPod assigns the
    external port at each start, so it changes every time — the card reads it live.
  - **HTTP `8189`** → the proxy hostname, which is what the launcher's readiness probe
    and a pasted url use. The pod image forwards `8189 → 8188`
    (`services/atlas-comfy-pod/tools/port-forward.py`) so ComfyUI answers on both.

  ⚠ **Do not put 8188 in the HTTP box.** Exposing 8188 as TCP *removes* its HTTP proxy —
  that hostname starts answering 404 — so a pod configured `HTTP 8188 + TCP 8188` (or
  TCP-only) ends up unreachable by every route at once while ComfyUI is running fine.

> ### ⚠ `raw.githubusercontent.com` 404s — THIS REPO IS PRIVATE
> Every `curl … raw.githubusercontent.com/Invisible-Wall-SL/Invisible-Engine/…` below
> returns **404** without credentials. GitHub answers 404 (not 401) for a private repo,
> so it reads as "file missing" when it is really "no access" — the file is on `main`.
>
> Two ways through, from the pod's terminal:
>
> **A. Paste it.** Works with no credentials on the pod. On your machine:
>
> ```bash
> gzip -9c services/atlas-tool/runpod/<file> | base64 -w0
> ```
>
> then paste into the pod:
>
> ```bash
> echo '<the base64>' | base64 -d | gunzip > /workspace/<file>
> ```
>
> **B. Token.** A fine-grained PAT with read-only Contents on this repo:
>
> ```bash
> curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
>   https://raw.githubusercontent.com/Invisible-Wall-SL/Invisible-Engine/main/services/atlas-tool/runpod/<file> -o /workspace/<file>
> ```
>
> Prefer **A** on a shared pod — a token in a shell history on a machine several people
> reach is a credential leak, and this one can read the whole repo.

## 3. Provision (once per fresh volume)

Open the pod's web terminal and run:

```bash
cd /workspace
# 404s unless you add a token — see the box above; pasting the file also works.
curl -fsSL -H "Authorization: Bearer $GH_TOKEN" https://raw.githubusercontent.com/Invisible-Wall-SL/Invisible-Engine/main/services/atlas-tool/runpod/provision.sh -o provision.sh
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

## 3b. Optional: fetch an upstream model set (FLUX.2 / Qwen-Image)

`pull-models.py` mirrors **our** curated R2 set. For a big public set there's no reason
to route it through R2 — `fetch-models.py` pulls it from Hugging Face straight onto the
volume instead (idempotent, and resumable via HTTP Range, which matters when a pod web
terminal drops in the middle of a 35 GB file):

**`fetch-models.py` is BAKED into the pod image at `/fetch-models.py`** — nothing to
download, no token, none of the private-repo problem above. It lives in the image's
build context at `services/atlas-comfy-pod/tools/` (Docker `COPY` cannot escape the
context, and duplicating it is how a vendored copy drifts). `--dest` defaults to the
volume, so on a baked-image pod:

```bash
python /fetch-models.py --list
```

```bash
python /fetch-models.py --set flux2-klein
```

> A pod predating this image won't have the file — rebuild the image and redeploy the
> pod, or paste it in with method **A** above.

FLUX.2 needs **no custom node** — it is native in ComfyUI core from the `v0.33.1` pin
(`comfy/ldm/flux` plus the built-in `Flux.2 …` blueprints). Only the weights are missing.

| Set | Size | Licence | Fits our fleet? |
|---|---|---|---|
| `flux2-klein` | 12.5 GB | **apache-2.0** (model + Qwen3 encoder) | Yes — comfortable on a 24 GB card |
| `flux2-dev` | 53.8 GB | **non-commercial** (BFL FLUX.2 [dev]) | Not really — 35 GB of weights vs a 32 GB max card, so CPU offload |
| `flux2-dev-turbo` | 2.8 GB | inherits dev's non-commercial terms | Add-on for `flux2-dev` |
| `qwen-image` | 30.1 GB | **apache-2.0** (model + encoder + VAE) | Yes — loads in sequence, so peak VRAM ~20 GB |
| `qwen-toon` | 0.6 GB | **apache-2.0** | Add-on for `qwen-image` |

**Start with `flux2-klein`.** It is the only FLUX.2 variant that is both Apache-2.0 (so it
could ever ship in a game, unlike FLUX.1-dev/PuLID which are R&D-only) and small enough to
run without offload on the cards in the fleet. `flux2-dev` is for quality comparison only —
check the Network Volume has ~54 GB spare first; it was sized for SDXL/FLUX.1.

**`qwen-image` is the base the cartoon-character pipeline sits on** (ComfyUI's built-in
"Text to Image (Qwen-Image 2512)" blueprint), and `qwen-toon` is renderartist's Toon-Tacular
style LoRA for it. Both Apache-2.0, so unlike the FLUX.1-dev/PuLID path they stay
licence-clean end to end. Running `qwen-image` against a volume that already has those files
is a no-op — the size check skips whatever is current.

> **A LoRA binds to ONE base architecture.** `qwen-toon` declares
> `base_model: Qwen/Qwen-Image-2512`, so it loads onto `qwen-image` and **not** onto FLUX.2
> or FLUX.1 — the weights are shaped to Qwen-Image's layers. Likewise `flux2-dev-turbo` is
> FLUX.2-only. Pairing a LoRA with the wrong base either errors on load or produces noise.

> One caveat the script also prints: the `flux2-vae` file both FLUX.2 sets use is served from
> the `Comfy-Org/flux2-dev` repo, which is licensed `other`, not apache-2.0. Confirm the
> VAE's terms yourself before anything from klein ships commercially.

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
