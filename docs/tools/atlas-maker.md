# Invisible Atlas Maker

Regenerate a game's sprite-atlas art from a manifest, region by region, using AI
image generation — then inspect, curate and deploy the results.

## What it is

The original local Python Atlas Maker, **re-hosted on Railway** (a re-host, not
a rewrite). It lists every region from the active manifest and lets you, per
region: toggle render on/off, edit the prompt, lock/unlock/change the seed, view
the latest output and shape ref, and lock the seed that produced a good output
with one click. A Settings panel edits the global `atlas_config.json`.

The actual image generation happens on **your local ComfyUI** (see
[comfyui.md](comfyui.md)) — the cloud tool drives it over the Cloudflare tunnel.

> Region names follow [the symbol naming convention](../conventions/symbol-naming.md)
> (`H1` = high-pay, `S` = scatter, …) — the name encodes the pay-class.

- **Source:** `services/atlas-tool/` (stdlib `http.server` + Pillow, no
  framework; UI is one embedded HTML page in `ui_server.py`).
- **Where it runs:** cloud — Railway project `atlas-tools`
  (`invisible-engine-production-0060.up.railway.app`). Generation runs on your
  local ComfyUI GPU; assets live in Cloudflare R2.

## How to access it

Sign in to the launcher (`app.invisiblewall.org`) and open the **Invisible
Atlas Maker** card, or go to `/atlas`. The launcher checks your role
(admin/developer/artist) and redirects you full-page to the tool, appending the
shared-secret `?k=` if one is configured. The tool also serves directly at its
Railway URL.

## Architecture (how the pieces connect)

```
Launcher /atlas ──redirect──▶ atlas-tool (Railway, Python UI)
                                   │  drives generation
                                   ▼
                       comfy.invisiblewall.org  (Cloudflare named tunnel + Access)
                                   ▼
                          your local ComfyUI :8188 (RTX 4070)
                                   │
                                   ▼
                          R2 bucket "invisibleassets"
                  atlas_maker/cloud/<project>/{manifests,input,output,deploy}/…
```

- **`cloud_paths.py`** — drop-in for the original `project_paths.py`. Points
  `input/batch/atlas/manifest` dirs at a **local staging dir** (`ATLAS_STAGING`,
  default `/data/atlas-tool`) that mirrors the R2 prefix
  `atlas_maker/cloud/<project>` 1:1, so the original pathlib/PIL code runs
  unchanged. Adds `comfy_url` + CF Access headers.
- **`storage.py`** — R2 via boto3. Staging **hydrates from R2 at startup**;
  writes mirror back through to R2 so state survives restarts.
- **`batch_atlas.py`** — the generation engine. ComfyUI is remote: refs are
  uploaded via `/upload/image`, results fetched via `/view`, then persisted to
  staging + R2. Supports SDXL, FLUX, and gpt_image pipelines.

## Typical workflow

1. **Pick a manifest** — the tool lists manifests from R2. (These come from the
   game's atlas, or are authored by the Invisible Sheet Maker.)
2. **Per region**, edit the prompt, set/lock a seed, choose style/shape refs.
   Refs can be uploaded from your machine or **picked from R2** via the
   `/fsbrowse` browser (returns R2-relative paths).
3. **Render** — the tool sends the workflow to your ComfyUI and shows live
   progress on the button; thumbnails + seeds refresh in place when done.
4. **Curate** — review variants, pick the best, lock its seed.
5. **Compose / slice** — assemble the atlas page / slice a source page into
   refs (needs the `.atlas` geometry + source image in R2, see limitations).
6. **Deploy** — `/deployatlas` copies the finished result to R2.

## Prerequisites

- Your local **ComfyUI** must be running and reachable through the tunnel.
- Models the chosen pipeline names must be installed locally:
  - **SDXL** path (default) — verified end-to-end.
  - **FLUX** — needs `flux1-dev` + `t5xxl` + `clip_l` + `ae` (or an FP8
    all-in-one) + Redux (`flux1-redux-dev` + `sigclip_vision`); on the 8GB
    RTX 4070 use fp8/GGUF to avoid OOM.
  - **gpt_image** — needs `COMFY_ORG_API_KEY` (comfy.org credit) and the
    `OpenAIGPTImage1` + `Images to RGB` nodes.

## Config / env (names only)

`COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`COMFY_ORG_API_KEY` (optional, gpt_image), `ATLAS_PROJECT`,
`ATLAS_OUTPUT_PREFIX`, `ATLAS_STAGING`, `ATLAS_TOOL_SECRET` (optional access
gate; unset = open on its URL).

## Known gotchas / limitations

- **Restart after changing R2.** Staging hydrates from R2 *only at startup*, so
  after seeding or editing R2 you must restart the service.
- **Cloudflare blocks `Python-urllib`** with 403 — every ComfyUI call sends
  `User-Agent: InvisibleAtlas/1.0` + the CF Access headers (already handled).
- **Windows trailing-dot folders** — Windows strips a trailing `.` from folder
  names; such paths resolved locally but broke in cloud R2. Normalised in the
  R2 manifests; watch for it on any Windows-sourced data.
- **`.atlas` geometry + source image for compose/slice** — some manifests still
  reference these via local Windows paths; they need uploading to R2 and the
  manifest repointed before compose/slice work in cloud. Card-side R2 upload
  (B10) is code-complete but **not yet browser-tested live**.
- **FLUX/gpt_image pipelines** are code-reviewed but a full live verify on the
  local GPU is still owed.
- **Access gate** — `ATLAS_TOOL_SECRET` is currently unset, so the tool is open
  on its URL; when set, verify the launcher's `?k=` cookie flow.
