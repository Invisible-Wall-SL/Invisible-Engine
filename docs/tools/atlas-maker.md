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
6. **🖼 View atlas** — check the composed page in the **Region Overlay
   Inspector** (below) before you deploy it.
7. **Deploy** — `/deployatlas` copies the finished result to R2.

## 🖼 View atlas — the Region Overlay Inspector

`🖼 View atlas` opens `/atlasview`: the composed page with its region geometry
drawn on top. It exists to answer *"the region looked right in the card, so why
does it look different in the atlas?"* — and to make that answer
screenshottable.

Per region it draws three layers (each toggleable), all in page pixels:

| Layer | Colour | What it is |
|---|---|---|
| **Region rect** | blue | the `bounds:` x/y/w/h from the **current** manifest (the `.atlas`-merged geometry the cards use), labelled `name w×h` |
| **Art alpha bbox** | amber | the art's **actual** opaque bounds, re-measured client-side from the composed page's pixels (`getImageData`, alpha > 0 — the same test PIL's `getbbox()` applies) |
| **Untrimmed frame** | mint | only for regions carrying `off_x/off_y/orig_w/orig_h`. Drawn in the manifest's own **TexturePacker Y-DOWN-from-top** convention (*not* Spine's Y-up) — as stored, uncorrected |

### Reading the verdict

The art bbox vs the rect is the diagnostic. Each region gets a fill ratio and a
verdict, reported in its **unrotated (authored)** axes:

- **FILLS** — the bbox reaches the rect edge on both axes (≥98%). The art was
  cropped to its ink, the canvas discarded, and the ink scaled to the slot with
  no never-upscale clamp.
- **INSET n%** — the bbox covers only n% of the rect's smaller axis, centred
  with a margin. The art was fitted **whole-canvas** and clamped so it could
  never upscale.
- **EMPTY** — no opaque pixel in the rect; nothing was composed there.

The summary line counts each. **A page with both FILLS and INSET regions was
written by two composers with different rect conventions** — that alone is the
finding. (See `docs/status/atlas-maker.md` for the current known instance:
`sheet-tool/packer.py` `compose` uses `min(rw/nw, rh/nh, 1.0)` against the full
art canvas; `atlas-tool/batch_atlas.py` `fit_to_region` alpha-crops to ink and
fills the rect with no clamp. Same `bounds:`, art up to ~2.5× bigger and its
origin shifted from the centred inset to the rect's corner. `fit_mode:"contain"`
stops the distortion but not the upscale — those regions read as INSET with one
axis pinned at 100%, which the per-axis `fill W%×H%` readout shows.)

Two caveats when reading the numbers:

- The bbox is the **rendered** one, so LANCZOS resampling rings the alpha out
  ~3px each side (+6px total, scale-independent). Small rects therefore read a
  few points above their geometric fill. It never flips a verdict in practice.
- **Rotated** regions occupy an `(h × w)` footprint on the page (both composers
  `rotate(-90, expand=True)` after fitting upright). The inspector reads the
  page in that footprint and reports fill/margins back in the unrotated axes, so
  the numbers line up with the `w×h` label.

**Controls:** wheel = zoom to cursor · drag = pan · **Fit** resets to the whole
page · click a region (canvas or sidebar) to select it · the sidebar filters by
name and lists each region's rect, fill %, and margins.

## Blueprints: resolved-workflow export (debugging)

When the active pipeline is a **blueprint** (a shareable ComfyUI graph + role
bindings, not a built-in `sdxl`/`flux`/`gpt_image` builder), the Settings
panel's **🎛 Blueprint settings** section gains a region picker plus a **⤓
Resolved workflow (as the pipeline sends it)** button. It answers the question
"what does the pipeline actually send to ComfyUI?" — because copying your
blueprint's params into ComfyUI by hand does **not** reproduce a run. The
generic runner deep-copies the baked graph and overwrites:

- **positive / negative** — composed from the style prefix/suffix + the region's
  prompt (and replace flags);
- **seed** — the region's locked seed, else a fresh random one each run;
- **width / height** — this **manifest's configured gen size** (its
  `settings.gen_width/height`), not the graph's baked latent size and not the
  process default;
- **style_ref / shape_ref** — the region's reference image paths;
- each declared **param** — coerced to its type and clamped to min/max (a saved
  per-atlas override, else the param's baked default);
- the SaveImage **filename_prefix** — this project's output prefix.

The button fetches `GET /blueprintresolved?manifest=<name>&blueprint=<id>&region=<name>`
and shows:

- a **changes table** (Node / Field / Baked → Pipeline value / Source) — the
  at-a-glance diff of what the pipeline changed versus your blueprint;
- the concrete **seed** baked into the export (with a note when the region is
  unpinned, since a real run draws a new random seed each time);
- a **Download workflow.json** button.

The downloaded JSON is ComfyUI **API/prompt** format: POST it to ComfyUI's
`/prompt` and it runs identically to the pipeline. Loading it back onto the
canvas needs ComfyUI's API-format loader (it is not the editor's
save/drag-drop format).

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
