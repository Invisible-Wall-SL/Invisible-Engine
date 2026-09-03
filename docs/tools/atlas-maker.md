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
   game's atlas, or are authored by the Invisible Sheet Maker.) Or start one from
   scratch with **＋ New atlas**: a dialog asks for the name first and shows the
   slug it will be stored under; a name that already exists is flagged, and
   **Create** then asks before replacing that atlas with an empty one (Cancel,
   Esc or a blank name change nothing).
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

## ⚙ Settings — and where the dropdowns get their values

Three collapsible panels sit above the region grid:

- **⚙ Global settings** — the shared defaults in `atlas_config.json`.
- **🧩 Atlas settings** — per-atlas overrides (blank = inherit the global) plus
  this atlas's geometry (`atlas_file`, width/height, cell size, **Atlas format**,
  source image, deploy prefix/basename).
- **📝 Atlas style** — the positive prefix/suffix and negative for this atlas.

### Run generation on — RunPod or my computer

The first field in **⚙ Global settings** picks the machine that renders:

| Choice | What happens |
|---|---|
| *(service default: …)* — blank | whatever the service is configured for (`COMFY_TRANSPORT`; production = RunPod). An untouched project keeps today's behaviour. |
| **RunPod — cloud GPU** | the serverless endpoint: pay per job, nothing to start; the models are whatever is installed on the pod's Network Volume. |
| **My computer — my own ComfyUI over the tunnel** | your GPU, your installed models, no per-job cost. Needs ComfyUI running and the desktop launcher's tunnel up — if nothing answers, the render stops with one sentence saying so instead of failing half-way through. Never wakes a pod. |

The model dropdowns below follow this choice: they list the files of the machine
that will actually load them, which is why the two machines keep separate
catalogs (next section).

**Model and enum fields are dropdowns, not free text.** Two kinds:

- **Installed-file lists** — checkpoint, LoRA, ControlNet, RMBG model, and the
  FLUX unet / dual-CLIP / VAE / LoRA / ControlNet / Redux style model /
  CLIP-Vision. These are whatever files the ComfyUI you generate on actually has,
  so they are read from ComfyUI's `/object_info`.
- **Fixed enums** — FLUX weight dtype / sampler / scheduler, IPAdapter weight
  type, the five `gpt_image_*` fields and **Atlas format**. Their valid values are
  known offline, so these stay dropdowns no matter what ComfyUI is doing.

Whatever the source, **a value you already have configured is never dropped**:
if it isn't in the offered list it stays in the dropdown, selected, marked
`(not in ComfyUI)` (installed-file list) or `(custom)` (fixed enum). Saving the
panel cannot silently rewrite a setting. The blank choice is still there too —
in Atlas settings it means *inherit the global*, in Global settings it means
*empty* (e.g. clear `flux_controlnet` so the optional node is skipped).

### The status line + ⟳ Refresh model lists

At the top of **⚙ Global settings** a coloured strip names the selected machine
(*RunPod ·* / *My computer ·*) and says where this page's model lists came from:

| Colour | Means |
|---|---|
| green — *My computer · Model lists: live from your ComfyUI (url)* | your ComfyUI answered this page load; the lists are current. Only *My computer* can be live — a serverless worker exists only while a job runs. |
| amber — *… Model lists: cached … from …* | the lists come from that machine's stored catalog (accurate as of that time). |
| red — *… Model lists unavailable* | nothing has ever been read for that machine; the installed-file fields fall back to free text, and the strip says what to start (*My computer*) or set (`COMFY_CATALOG_URL`, RunPod). The fixed enums are unaffected. |

**⟳ Refresh model lists** re-probes the selected machine and stores what it finds
in R2 — `_shared/comfy/catalog.json` for *My computer* (read live over the
tunnel), `_shared/comfy/catalog-pod.json` for RunPod. For RunPod there is
**nothing to configure**: ⟳ asks the RunPod API which pods are running and reads
the first that answers. Any running pod will do — the fleet shares the Network
Volume the serverless workers mount, so its model list is exactly what a render
will load. Start a pod on **/comfyui**, press ⟳, and you can stop it again; the
catalog persists. One catalog per machine, shared by every project, because what's
installed is a property of the install, not of a project — and never substituted
for each other: the RunPod target never reads the tunnel, *My computer* never
reads `COMFY_CATALOG_URL`. It reports the source and how many lists/values it
read, then reloads the page.

This matters because production defaults to RunPod: the serverless endpoint is a
job queue, not a ComfyUI HTTP server — a worker has no address and exists only
while a job runs — so there is nothing live to ask for that machine. A running
pod stands in for it. (`COMFY_CATALOG_URL` still exists as an override to pin one
specific reader; see `docs/INFRA.md`.) *My computer* needs nothing — it is live
whenever your ComfyUI is up. A page load never writes to R2; only ⟳ (and one
opportunistic write when a live local probe genuinely finds a changed list) does.

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

The inspector gives three **separate** readings per region, deliberately not
blended — they know different amounts. Read them in this order.

### 1. Sheet parity — the decisive test

Press **▶ Run sheet-parity scan**. For every region the server re-composes the
tile from the region's **source art** (the same `output_override` → picked
variant resolution `Create Atlas` uses) through the real `packer.compose` replay
(`_packer_compose_tile`) and diffs it against the page's actual rect pixels:

- **MATCHES SHEET** — the page pixels *are* `packer.compose`'s output for this
  art. Re-running **Create Atlas** would not move the region.
- **DIFFERS** — something else placed this rect. The delta reports how far off:
  ink-bbox scale ratio + origin shift, e.g. `2.73x, origin (38,38)→(0,0)`.
- **NO SOURCE** — no committed image and no generated variant, so the region's
  pixels can't be predicted (not a fault; just no evidence).

This is the only reading here that is **evidence** of how a region was placed,
and the only one that predicts what a rebuild will do. The tolerance is `max Δ 2`
per channel, and it is pure slack: the test is deterministic (same LANCZOS
resize, lossless PNG), so a genuinely sheet-composed region recomposes
**byte-identically** — measured `max Δ 0`. A real placement difference moves ink
by whole pixels and reads `max Δ 255`. The scan opens every source image, so it
runs on demand rather than on load.

### 2. Placement mode — will the parity fix do anything here?

Read from the manifest (not the pixels): which branch of `fit_to_region` the
**next** compose will take.

| Mode | Meaning |
|---|---|
| **contain (explicit) → sheet parity** | replays `packer.compose` verbatim — a Sheet-Maker cell recomposes byte-identically to its sheet |
| **fill (spine-slot default)** | crop to the alpha bbox, stretch to the slot exactly |
| **contain (cell-grid default)** | crop to the alpha bbox, uniform-scale to fit, letterbox |
| **cover (explicit)** / **fill (explicit)** | as set on the region's ⚙ Advanced panel |

Only an **explicit `fit_mode:"contain"`** reaches the sheet-parity path, and
only the **Sheet Maker** writes that field (on every cell it emits). A manifest
built by importing a `.atlas`/TexturePacker JSON into the Atlas Maker carries
trim geometry but **no `fit_mode`**, so its regions default to `fill` and the
parity path is unreachable — the summary says so outright. That single line
answers "is this page a Sheet-Maker page or not?".

**If a Sheet-Maker page reads `fill` here, it is repaired automatically.** Until
2026-09-01 both import routes lost that field on the way in, so a sheet opened in
the Atlas Maker would compose every cell through the alpha-crop-and-rescale
default: the region rectangles stayed exactly right while the art inside them was
stretched and rescaled — which reads as a packing bug rather than a placement one.
Manifests written by those builds are still stripped on disk, so the tool now
restores the value from the Sheet-Maker manifest that authored the page, both when
the manifest becomes active and again just before Create Atlas. Create Atlas says
what it repaired. Pages with no authoring sheet manifest (a rig's `.atlas`, a
from-scratch atlas) are left alone, so `fill` stays the default where a slot really
is a rig's footprint. **Nothing to do by hand** — but if this row still reads `fill`
for a sheet you recognise, the page and the sheet manifest have drifted apart and
the join on the page filename is failing.

### 3. Ink coverage — a measurement, not a verdict

How much of the rect the art's alpha bbox covers, in the region's **unrotated
(authored)** axes:

- **FILLS** — the bbox reaches the rect edge on both axes (≥98%).
- **INSET n%** — the bbox covers n% of the rect's smaller axis.
- **EMPTY** — no opaque pixel in the rect; nothing was composed there.

⚠️ **Coverage does not identify the producer.** An earlier version of this page
claimed FILLS ⇒ "written by a fill-the-slot composer" and a mixed page ⇒ "one
page, two producers". That inference is unsound and has been removed. Both
composers can produce either reading:

- Full-bleed icon art (`T_UI_Min`/`_Plus`/`_Turbo`, margins `0,0,0,0`) renders
  edge-to-edge under the **sheet** packer too — its scale clamps at 1.0 and the
  canvas already equals the rect. FILLS, sheet-composed.
- An FX halo blooms to its canvas edge: `T_UI_Spin_Edge` reads INSET 88% while
  `T_UI_Spin_Edge_glow` reads FILLS 100% — **same art, same placement**, just
  more ink.
- Conversely an atlas-composed `fit_mode:"contain"` region reads INSET even
  though it was upscaled.

Coverage is still worth showing: it is how you *see* an element sitting small in
its slot. Use **sheet parity** for provenance.

Two caveats when reading the coverage numbers:

- The bbox is the **rendered** one, so LANCZOS resampling rings the alpha out
  ~3px each side (+6px total, scale-independent). Small rects therefore read a
  few points above their geometric fill.
- **Rotated** regions occupy an `(h × w)` footprint on the page (both composers
  `rotate(-90, expand=True)` after fitting upright). The inspector reads the
  page in that footprint and reports fill/margins back in the unrotated axes, so
  the numbers line up with the `w×h` label.

**Controls:** wheel = zoom to cursor · drag = pan · **Fit** resets to the whole
page · click a region (canvas or sidebar) to select it · the sidebar filters by
name and lists each region's parity verdict, placement mode, rect, fill %, and
margins.

## Blueprints: publishing one

**＋ New blueprint** takes a ComfyUI **API-format** export (Settings → “Save (API Format)” — the
editor's own `workflow.json` is the wrong file) and publishes it to the shared library. You then
point each **role** at a node input: `positive`, `negative`, `seed`, `width`/`height`, the
reference images (`style_ref` / `shape_ref`), and `output` (the save node).

- **Suggested is a ranking, not a shortlist.** Every input in the graph is listed under **All node
  inputs** beneath it, so a role is never cornered by a heuristic that did not anticipate your
  network. Wired inputs are listed too, marked `(wired)`.
- **Knobs pulled out into `Primitive` nodes are followed through the wire.** Most reusable graphs
  convert their widgets to inputs, so `CLIPTextEncode.text` is a wire and the actual prompt lives
  on a `PrimitiveString` upstream — the suggestion points at that primitive, because writing over
  the wire would cut every other consumer of that value off from it.
- **Unambiguous roles are filled in for you**, and a genuine choice is not guessed at: a graph with
  two positive prompts leaves `positive` empty for you to pick. Publishing tells you which required
  roles are still unbound rather than quietly binding one.

**Exposed settings** become the knobs in **🎛 Blueprint settings**. Pick the node input first — the
key (named after the node), the type and the default are read straight off the graph's own baked
value, and they follow the node if you re-point the row, leaving anything you typed alone. The
**label is what the settings panel shows**, and it follows the key until you type a label of your
own — renaming the key is enough. A `text`
setting holding prose gets **prompt-sized box** ticked automatically and renders as a full-width
textarea; a `#222222` or a `ComfyUI` stays a narrow field. A node input can be driven by a role or
by a setting, never both — an input a role holds is not offered to a setting.

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

**The hosted Atlas Maker needs nothing installed on your machine.** It generates on
a **RunPod Serverless endpoint** (`COMFY_TRANSPORT=serverless`, live since
2026-08-18): the worker image bakes the custom nodes and the volume carries the
models, so no local ComfyUI, no tunnel, nothing to keep running. Every pipeline —
SDXL, FLUX including the **ref/ControlNet** path, and **gpt_image** — is proven
there. If a generation fails, it's the endpoint (cold start, quota, a node missing
from the worker image), not your setup.

The older **`http`** transport still exists for anyone running the tool against a
**local ComfyUI** over the tunnel. It is not what the hosted tool uses, and it is
the only case where these local prerequisites apply — ComfyUI running and
reachable, with the models the chosen pipeline names installed **on that machine**:
- **SDXL** path — verified end-to-end.
- **FLUX** — needs `flux1-dev` + `t5xxl` + `clip_l` + `ae` (or an FP8 all-in-one)
  + Redux (`flux1-redux-dev` + `sigclip_vision`); on the 8GB RTX 4070 use fp8/GGUF
  to avoid OOM. Only SDXL ControlNets are installed on that GPU, so the shape_ref /
  ControlNet path needs the serverless backend.
- **gpt_image** — needs `COMFY_ORG_API_KEY` (comfy.org credit) and the
  `OpenAIGPTImage1` + `Images to RGB` nodes present locally.

If a pipeline that works for someone else fails for you, check which transport
you are on before hunting for a missing model.

## Config / env (names only)

`COMFY_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`COMFY_ORG_API_KEY` (optional, gpt_image), `ATLAS_PROJECT`,
`ATLAS_OUTPUT_PREFIX`, `ATLAS_STAGING`, `ATLAS_TOOL_SECRET` (optional access
gate; unset = open on its URL), `COMFY_CATALOG_URL` (optional; an always-on
ComfyUI to read the Settings model lists from — see [INFRA](../INFRA.md)).

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
