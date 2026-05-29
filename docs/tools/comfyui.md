# ComfyUI (third-party)

The node-based image generation engine that powers the Invisible Atlas Maker.

> ComfyUI is a third-party product, so it keeps its real name. This page
> documents **how it is used in the Invisible Wall pipeline**, not how to use
> ComfyUI in general.

## Role in the pipeline

ComfyUI is the **only piece of the pipeline that runs locally**. Everything else
(launcher, Atlas Maker, atlas-backend, R2) is cloud-hosted. The cloud
[Invisible Atlas Maker](atlas-maker.md) and `atlas-backend` send generation
workflows to your local ComfyUI over a Cloudflare tunnel; ComfyUI runs them on
your GPU and the results are fetched back and stored in R2.

```
cloud Atlas Maker / atlas-backend
        │  workflow (SDXL / FLUX / gpt_image)
        ▼
comfy.invisiblewall.org   (Cloudflare named tunnel + Access service token)
        ▼
your local ComfyUI :8188  (RTX 4070, 8GB)
```

## Where it runs

- **Local**, on `localhost:8188`, on the workstation with the **RTX 4070 (8GB)**.
- It's listed in the launcher as a **local tool** (`comfyui`) for the admin,
  developer and artist roles.

## How it's exposed to the cloud

- **Tunnel:** a Cloudflare **named tunnel** `comfy-gualtiero`
  (id `1e0057ee-6787-4bbc-a1af-936d7fe7603a`), config at
  `C:\Users\gualt\.cloudflared\config.yml`, ingress
  `comfy.invisiblewall.org → http://localhost:8188`. The `comfy` DNS record is
  proxied (orange) and sits behind Cloudflare Access.
- **Auth:** **Cloudflare Access (Service Auth)** in front of the tunnel. The
  cloud backends send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers
  (client ID, non-secret: `bb044437409520caf86021625f8553e5.access`).
- **User-Agent gotcha:** Cloudflare returns **403** for the default
  `Python-urllib/x` UA, so every call to ComfyUI sends a custom UA
  (`InvisibleAtlas/1.0`) — already handled in `atlas-backend/comfy.py` and
  `atlas-tool/cloud_paths.py`.

## How calls flow

ComfyUI **cannot see the cloud's filesystem**, so the Atlas Maker:

1. uploads each `LoadImage` reference via `/upload/image`;
2. submits the workflow;
3. fetches results via `/view`;
4. persists them to staging + R2.

## Starting it (locally)

A local launcher GUI manages ComfyUI **and** the cloudflared tunnel:
`C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py` — it has been trimmed to
manage only ComfyUI + the tunnel (Start/Stop/Status for the
`comfy-gualtiero` tunnel; ComfyUI/project management). Run it once and start
ComfyUI + the tunnel before using the cloud Atlas Maker.

## Prerequisites / models

For the cloud Atlas Maker's pipelines, the corresponding models must be
installed in your local ComfyUI:

- **SDXL** — the default, verified path (SDXL + LoRA + IPAdapter + ControlNet +
  RMBG).
- **FLUX** — `flux1-dev` + `t5xxl` + `clip_l` + `ae` (or an FP8 all-in-one) +
  Redux (`flux1-redux-dev` + `sigclip_vision`). On the 8GB RTX 4070 use
  fp8/GGUF to avoid out-of-memory.
- **gpt_image** — set `COMFY_ORG_API_KEY` (comfy.org credit) and ensure the
  `OpenAIGPTImage1` + `Images to RGB` nodes exist
  (check `GET {comfy}/object_info`).

## Known limitations / TODOs

- **The tunnel is not yet a Windows service.** If the machine reboots, the
  tunnel (and thus cloud generation) is down until restarted. The local
  launcher has Start/Stop tunnel buttons, but installing cloudflared as a
  persistent service (`cloudflared service install`) is still a TODO.
- **GPU memory:** the 4070's 8GB is tight for FLUX — use quantised/fp8 models.
- **Security debt:** the CF Access service-token secret (and a committed
  `comfy_org_api_key` in the separate `Invisible_Pipeline` repo) were exposed
  during setup and should be rotated/scrubbed (backlog B9).
