# Invisible Atlas Maker

Regenerate a game's sprite-atlas art from a manifest, region by region, using AI
image generation — then inspect, curate and deploy the results.

## What it is

The original local Python Atlas Maker, **re-hosted on Railway** (a re-host, not
a rewrite). It lists every region from the active manifest and lets you, per
region: toggle render on/off, edit the prompt, lock/unlock/change the seed, view
the latest output and shape ref, pick which generated variant the region uses,
and lock the seed that produced a good output with one click. A Settings panel
edits the global `atlas_config.json`.

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
   `/fsbrowse` browser (returns R2-relative paths). To get several pictures out
   of one source — a glow, a shadow, a second style — add a **layer** rather
   than a second atlas (see [Layers](#layers--several-pictures-from-one-source)).
3. **Render** — the tool sends the workflow to your ComfyUI and shows live
   progress on the button; thumbnails + seeds refresh in place when done.
4. **Curate** — open **▦ variants**, click the one you want. The pick is saved
   the moment you click it, and it is what **Create Atlas** composes — you do
   not have to lock it. Optionally **🔒 lock this pick** as well, which is a
   separate promise: *don't re-render this slot at all.*
5. **Compose / slice** — assemble the atlas page / slice a source page into
   refs (needs the `.atlas` geometry + source image in R2, see limitations).
6. **🖼 View atlas** — check the composed page in the **Region Overlay
   Inspector** (below) before you deploy it.
7. **Deploy** — `/deployatlas` copies the finished result to R2.

### Picking a variant vs locking a slot

Two different promises, on purpose — they used to share one field, and a pick
made without a lock was silently discarded.

| | **▦ variants → click one** | **🔒 lock this pick / the `lock` box** |
|---|---|---|
| Means | "compose THIS file" | "don't re-render this slot" |
| Saved | immediately, on click | on save, as the region's `lock` flag (+ the seed) |
| Create Atlas | uses exactly that file | unchanged — the lock is about rendering |
| Render selected | still re-renders the slot | **skips** it (and for `gpt_image`, that is what stops a second paid call) |

The card always shows the file `Create Atlas` will compose, so if you can see
it, it ships. A pick lasts until you pick again, delete that file, or
**re-render that same region** — a fresh render is newer art, so the card moves
to it and the pin goes with it. Lock the pick if you want it to outlive future
renders. Nothing is lost to a render you stopped or that failed.

**A pick belongs to the batch you made it from.** Picking #3 out of five keeps
#3 — the other four were already there, so they supersede nothing. Render that
slot again and the new file wins: every unlocked card is back on its latest
variant the moment the run finishes, with nothing to click. That is decided
from the manifest each time the page is drawn, so it holds however the render
ended — stopped, crashed, tab closed, or refreshed from another machine.

## Layers — several pictures from one source

A **layer** is a second slot that draws *with* its base rather than instead of
it: a glow over a glyph, a shadow under it, a second pass in another style. All
the layers of one element pack onto the **same page** as the base, and the game
stacks them as symbol cell layers, each with its own blend mode and draw order.

Keeping them on one page is deliberate. The engine can address a frame on any
sheet (`<sheet>::<region>`), so layers on separate sheets would work — they
would just cost a texture swap per layer instead of batching with the base, and
pay a second page's gutter. Split them only when a page genuinely overflows.

There are two kinds, and the difference is where the layer's *pixels* come from.

| | **FX layer** | **AI layer** |
|---|---|---|
| Made by | shine.py, on the CPU | the pipeline, like any other slot |
| Costs | nothing — no ComfyUI, no credits | one render per variant |
| Named | `<base>_glow`, `_shadow`, `_shine`, `_blur`, `_zoom`, `_colour` | `<base>_<whatever you choose>` |
| Created by | **＋ Add region** with that name, then pick the mode | **➕🗂** on the base's card |
| Derived from | the base's committed **pixels** | the base's **reference image** |
| When the base changes | rebuilt automatically on Create Atlas | left alone — re-render it yourself |

### FX layers — a treatment of the base's own art

Add a region named `<base>_glow` (or `_shadow` / `_shine` / `_blur` / `_zoom` /
`_colour`) and set the card's mode dropdown to match. It has no prompt: its
picture is computed from whatever the base currently shows, with the mode's
parameters on the card (blur radius, tint, threshold …).

The payoff is that it **follows its base**. Re-render the base and every FX
layer of it is rebuilt on the next Create Atlas, so a glow never goes on
haloing art you replaced. `⚙ build` re-derives one by hand after a tweak.

### AI layers — a different render of the same source

**➕🗂** on a region's card asks for a suffix and creates `<base>_<suffix>` as
an ordinary generated slot — its own prompt, seed, variants and lock. What
makes it a layer is that it **reads the base's reference image**. Re-point the
base's ref and every AI layer of it follows, with nothing to re-copy; give the
layer a ref of its own and that one wins instead.

Its prompt and pipeline are *seeded* from the base so you have something to
edit rather than a blank card. That copy is a starting point, not a link —
changing the base's prompt afterwards leaves the layer's alone. Four things are
deliberately **not** carried over: the reference images (those are inherited
live, not copied), the seed and lock, the packed rect, and the mode — a layer
of a base set to Glow is still an ordinary AI slot.

**They are packed in register, and how depends on Frame trim.**

Under **Keep the whole frame** (the default) both the base and its layers are
placed on their full canvas, so they line up by construction — every render of
an atlas comes out at the same gen width/height. Nothing to tune. The one way
to break it is to change **Gen width / height** between rendering the base and
rendering the layer, so if a layer sits wrong, check that first.

Under **Crop each frame to its visible pixels**, each frame would otherwise be
scaled to its *own* ink — and two independent renders never agree on their
silhouette, so the layer comes out a different size and off-centre. There, a
layer is cropped to **its base's** footprint instead, grown by the ratio of the
two slots: a bigger rect carries proportionally more margin (room for a halo),
the same rect lands on exactly the base's box. A layer rendered on a different
canvas from its base cannot be placed this way and falls back to cropping
itself.

Five things are refused rather than surprising you:

- **a suffix that is an FX mode** (`_glow`, …) — that name means "derived from
  the base's pixels", the opposite of a render;
- **a layer of a layer** — a layer registers against exactly one base;
- **a name that already exists**, a missing base, and a blank suffix.

Deleting a base does **not** cascade. Its layers stay and become ordinary
regions rendering on their own refs; the message names them so it is not
silent.

## ⚙ Settings — and where the dropdowns get their values

Three collapsible panels sit above the region grid:

- **⚙ Global settings** — the shared defaults in `atlas_config.json`.
- **🧩 Atlas settings** — per-atlas overrides (blank = inherit the global) plus
  this atlas's geometry (`atlas_file`, width/height, cell size, **Atlas format**,
  source image, **Frame trim**, deploy prefix/basename).
- **📝 Atlas style** — the positive prefix/suffix and negative for this atlas.

### Frame trim — why an animation drifts and how to stop it

**Frame trim** in **🧩 Atlas settings** decides *what* is placed into each region —
the art's visible ink, or the whole canvas it was drawn on. It applies on **both**
from-scratch layouts, `pack` and `grid`. It does nothing for an atlas whose geometry
comes from a bound `.atlas`, or for a legacy cell-grid one, where the placement is
the Sheet Maker's and is deliberately left alone.

| Choice | What happens |
|---|---|
| **Keep the whole frame, transparent edges included** (default) | the art keeps the canvas it was drawn on, so every frame of an animation shares one centre. Costs page area on `pack`. |
| **Crop each frame to its visible pixels** | the art is cut down to its own ink, so a `pack` page is as small as it can be. Right for symbols — each is placed on its own, so its canvas does not matter. |

**The default changed on 2026-09-17**, from cropping to keeping. Any atlas that
never chose explicitly now keeps the whole frame on its next **Create Atlas**. On a
`grid` atlas that only changes the composed pixels; **on a `pack` atlas the page is
re-measured at full canvas, so it grows and every rect moves** — around 5× the area
in a measured 25-frame case. If an atlas relies on tight symbol packing, set it to
**Crop each frame to its visible pixels** explicitly.

It takes effect on the next **Create Atlas**.

**Why it is not just a `pack` setting.** It governs the alpha crop in
`fit_to_region`, which every from-scratch compose goes through — so on a `grid`
atlas it decides whether each frame is cropped to its ink on the way into its cell.
Measured: three frames of one square walked across a canvas compose **byte-identical**
under *Crop* (the motion is gone, every frame re-centred on its own ink) and step
correctly under *Keep*.

**The symptom it exists for:** an animation whose character moves up and down
and left and right between frames that should be still. Each frame is being
anchored on its own ink rather than on a shared canvas. The deploy note says so
when it sees the signature — frames with no recorded trim *and* several
different sizes.

**What "the whole canvas" means, exactly.** Create Atlas measures each region's
**committed art** — its generated variant, or the image you bound to it — never
the sheet page it may have come from. So `Keep the full frame` keeps the canvas
*that* art is on. Rendering one atlas with one set of settings gives every
region the same canvas, which is the case the option is for. It cannot give back
a canvas the art was already cropped to, and it cannot reconcile regions whose
art disagrees (one re-rendered after a gen-size change, `gpt_image_size:
match_ref`, a hand-uploaded image). When it packs more than one canvas size the
pack note says so instead of claiming a shared centre it did not produce.

**A sheet that already shipped in the bad state cannot be repaired by switching
this setting, and there is no migration for it.** Its regions' art has already
been cut down to tight crops, and what was cut off was never recorded — not in
the manifest, not in the page, and not in the Flipbook's own descriptor, which
records the frames as untrimmed. Re-run the Flipbook video session that authored
it.

### Grid layout — an atlas whose size you decide

There are two from-scratch layouts, and they answer opposite questions.

| Layout | Who decides the page |
|---|---|
| **pack** (＋ New atlas) | **The tool.** `Create Atlas` measures each region's art, packs it as tightly as it can, and *writes the result into* Atlas width/height. Best page for the art; you do not choose it. |
| **grid** | **You.** `Create Atlas` reads **Atlas width / height** and **Default cell width / height** from 🧩 Atlas settings and lays every region out in equal cells, row by row, in manifest order. Your numbers are input, never overwritten. |

Grid is what the Flipbook's [🖼 To Atlas Maker export](flipbook.md) creates, because
a regenerated frame sequence wants uniform cells and a page size you control.

**Switching an existing atlas — the `Layout` dropdown in 🧩 Atlas settings.** The layout
used to be fixed when the atlas was created, so an atlas born `pack` could never honour
an atlas size no matter what you typed. `Layout` now switches it in place, keeping every
prompt, seed and reference on its regions:

| Choice | |
|---|---|
| **Pack the art (the tool sizes the page)** | `pack` |
| **Grid of cells (your atlas + cell size are used as they are)** | `grid` |

It also tells you what the atlas *currently is* — worth a look if you are not sure which
layout an atlas was created with.

**The panel follows the layout, so a field that does nothing is not on screen.** Switching
the dropdown repaints it immediately, before you save:

| | `pack` | `grid` |
|---|---|---|
| **Atlas width / height** | shown **read-only** — the packer sets them from the art | yours to set |
| **Default cell width / height** | hidden — nothing reads them | shown; this *is* the layout |
| **Frame trim** | shown | shown — it governs the alpha crop on both layouts |

Atlas width/height stay visible on `pack` rather than being hidden, because they are the
only readout of the page the packer actually produced. They are just not an input there —
which is why they are dimmed instead of editable. Typing a size into them on a `pack`
atlas is exactly what used to be silently discarded.

Nothing you set is lost by being hidden: a hidden field keeps its stored value, so
`grid` → `pack` → `grid` returns the cell size you had.

Two deliberate behaviours:

- **It is withheld from a `.atlas`-bound atlas only.** If `Source .atlas (geometry)` is
  set, the rects came from that file and handing them to the packer would re-measure and
  overwrite them with no undo — so the field simply is not there. Every other atlas gets
  it, **including an older one that has no layout of its own**: those carry rects authored
  elsewhere but are bound to nothing, and locking them out was a bug (they could never
  reach the grid).
- **An atlas with no layout opens on "Authored geometry (leave as is)".** That is its real
  state and choosing it does nothing at all — it stores no layout and clears no rect. It
  exists so the row can appear without implying the atlas is already `pack`, which one
  save would have made true, handing the authored rects to the packer.
- **Leaving "Authored geometry" is the one destructive switch.** Picking `pack` or `grid`
  there discards the rects and trim the regions were authored with, and nothing in this
  tool can put them back — the next Create Atlas lays every region out from scratch. The
  reply says so and names how many regions lost their rect.
- **Switching clears every region's rect from the old layout,** and says how many lost
  one. A pack rect describes a page the packer sized; a grid rect describes your cells.
  The regions come back placed on the next Create Atlas — that is expected, not a fault.

Straight after switching `pack` → `grid` the atlas has a page (the packer wrote one) but
has never had a cell size — nothing in `pack` reads one. Create Atlas will say so and lay
out nothing, because the cell size *is* the layout and guessing it would produce a grid
you did not choose. Type **Default cell width / height** (and your real Atlas width /
height), then Create Atlas.

**The geometry is recomputed on every Create Atlas, never frozen.** Change the cell
size in Settings, run Create Atlas again, and the whole grid re-flows. That is the
point of the mode: on a `pack` atlas the same edit is silently discarded, because
packing overwrites the very fields you typed.

**How each frame sits in its cell** is the region's **Fit mode**: `contain` (uniform
scale, centred, transparent margins — the one that keeps a sequence registered),
`cover` (fills and crops), `fill` (stretches). Unlike `pack`, a grid atlas never
rewrites this — it is your choice, not a measurement.

**One page, and it refuses rather than truncates.** An atlas has exactly one page. If
the cells do not leave room for every region, Create Atlas changes **nothing** and
names the capacity, the count and the overflow. Raise the atlas size, lower the cell
size, or export fewer frames. A half-laid-out grid would look like a successful run.

**Frame trim applies here too.** It does not change the cell — the cell is the cell —
but it decides whether each frame is cropped to its ink on the way into it. For a
regenerated sequence you almost always want **Keep the whole frame** (the default),
or every frame is re-centred on its own ink and the motion disappears.

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

**Blank means two different things, and the panel now says which.** For an
*optional* model — `flux_checkpoint`, `flux_lora`, `lora`, `flux_controlnet`,
`controlnet`, `flux_redux_style_model` — clearing the field genuinely disables
that step, and the dropdown offers `(blank — none)`. For a *required* one — the
checkpoint, FLUX UNet / CLIPs / VAE, sampler, scheduler, dtype, RMBG model —
there is no "none": the dropdown offers `(default: …)` instead, and clearing the
box means *unset*, so the engine default applies. A required field left empty
used to reach the GPU and come back as `vae_name: '' not in [...]` after a
queued job; the tool now refuses to submit such a graph and names the setting.

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

### The atlas prompt has its own Save

`📝 Atlas style` holds the prompt that applies to **every** region in this atlas —
`prefix` + the region prompt + `suffix` — and it is stored **per atlas**, in that
manifest, not shared. It is also the one panel the big **💾 Save changes** does not
carry: that button sends the region cards. The prefix, suffix and negative persist
only through **Save atlas style**, inside the panel.

So the way this goes wrong is quiet: type a prompt there, press the big Save, render —
and the render composes the prompt from the **saved** style while your typing sits on
screen looking applied. The panel therefore flags itself. Edit it and a **● unsaved**
badge appears on its title (visible while the panel is collapsed), and starting a
render asks first, offering to save the style before it goes. Decline and nothing is
written at all — not even the region cards.

Two related things worth knowing when a prompt seems to be ignored:

- **`Replace atlas positive`** on a region card means exactly that — the region prompt
  is used alone and the prefix/suffix are dropped for that region.
- **⤓ Resolved workflow** builds the graph exactly as the pipeline POSTs it, from the
  saved style. Whatever text sits on your positive node there is what ComfyUI receives.
  It settles "is my prompt getting through?" without spending a render.
## Blueprints: publishing one

**＋ New blueprint** takes a ComfyUI **API-format** export (Settings → “Save (API Format)” — the
editor's own `workflow.json` is the wrong file) and publishes it to the shared library. You then
point each **role** at a node input: `positive`, `negative`, `seed`, `width`/`height`, the
reference images (`style_ref` / `shape_ref`), and `output` (the save node).

**Only `output` is required** — it names the node the image is read from, so nothing can be
published without it. Every other role is optional, because a **processing** blueprint (an
upscale, a relight, a matting network) has no sampler and no text encoder and so has
nothing to bind `seed` or `positive` to. Requiring them used to make that whole class of
blueprint impossible to publish. A role you leave unbound is simply not written at render
time — the graph keeps whatever value your export baked in. If your graph *does* have a
seed or a prompt and you leave the role unbound, the modal says so and what it will cost
(every region identical, or the card prompts ignored) — a warning, not a refusal.

**Publishing does not make a blueprint run.** It adds it to the shared library; what the
Atlas Maker actually renders with is **⚙ Settings → Pipeline**, whose untouched default is
the built-in `sdxl` text-to-image path. Publish a background-removal blueprint, leave that
setting alone, and the next render comes back *regenerated from the region prompt* rather
than processed — the blueprint never ran. The modal therefore offers **“Use it for this
atlas straight away”**, ticked by default, which sets the pipeline for you as part of the
publish; untick it when you are publishing for someone else or for later.

**`Base model family` is a label, not a switch.** It offers `sdxl / flux / gpt_image` —
the same three words as the built-in pipelines — but nothing dispatches on it. It is
recorded so the library reads sensibly. The pipeline is chosen in ⚙ Settings, nowhere else.

**One input, one role.** If your graph has a single `LoadImage`, only `style_ref` is filled
in for you and `shape_ref` is deliberately left `(not used)`, with a line under the rows
saying so. Binding both to the same input does not apply both: at render time `shape_ref`
is written second and wins, and it is not your picture — it is `normalize_shape_ref`’s
grayscale silhouette on a black canvas, scaled to **Shape-ref fill %** (a single pixel at
`0`). You can still pick the collision by hand if you mean it. The same rule keeps a
one-`CLIPTextEncode` graph from filling `positive` and `negative` with the same node.

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
key (named after the node) and the default are read off the graph's own baked value, and the
**type, range and option list off the node's own contract** (what ComfyUI declares that input to
be): a `FLOAT` declared 0..1 arrives with **min · max** filled in, a COMBO — a model name — arrives
as a `select` with the node's real list rather than a text box. They follow the node if you
re-point the row, leaving anything you typed alone. If ComfyUI is asleep when you pick the file the
modal says so, and the settings fall back to a guess from the baked value with no range. The
**label is what the settings panel shows**, and it follows the key until you type a label of your
own — renaming the key is enough. A `text`
setting holding prose gets **prompt-sized box** ticked automatically and renders as a full-width
textarea; a `#222222` or a `ComfyUI` stays a narrow field. A node input can be driven by a role or
by a setting, never both — an input a role holds is not offered to a setting.

The modal is **header · scrolling body · pinned action bar**: everything from the file
picker down scrolls, and **Publish blueprint** sits in the bar at the bottom with the
status line, so a long **Exposed settings** list never pushes it out of reach. Each
`＋ Add` scrolls the row it just made into view. The bar is hidden until it has
something to carry — the first error, or the first successful read of your file.

In **🎛 Blueprint settings** a numeric setting with a declared range is a **slider + number box**,
and a typed number is clamped into the range (ComfyUI rejects a whole render over one
out-of-range value). A dropdown's list is **re-read from ComfyUI each time the panel renders** —
a model dropped on the pod's volume shows up without re-publishing the blueprint — and a saved
choice the live list lacks stays selected, marked *(not installed)*. With ComfyUI asleep, the
list the blueprint was published with is shown.

## Blueprints: authoring one yourself, end to end

The section above describes the modal. This one is the **runbook** — the loop to
work in, and the checks that stop a mistake costing a render. Everything here
was learned the expensive way on 2026-09-08 building a FLUX img2img blueprint.

### The whole model, in one paragraph

A blueprint is **two files**: `workflow.json` is the graph ComfyUI runs, and
`blueprint.json` is a *map* telling the Atlas Maker where to poke values into
it. The map has two kinds of entry. **Bindings** cover the eight fixed roles the
tool always needs (`positive`, `negative`, `seed`, `width`, `height`,
`style_ref`, `shape_ref`, `output`). **Params** are every other knob you want to
turn from ⚙ Blueprint settings. Both are the same shape: *node + field*.

**The node numbers in the modal's dropdowns are literally the top-level keys of
`workflow.json`.** `"43": { "class_type": "FluxGuidance", … }` is the entry that
shows as `FLUX guidance — FluxGuidance (#43)`. Open the file next to the modal
and the dropdown stops being a mystery — you are picking a JSON key and one of
its `inputs`.

### 1. Get the graph right in ComfyUI first

**Every widget you see on a node in the ComfyUI canvas is a required input in
the API JSON.** That is the rule that prevents the most common rejection. If the
node shows `megapixels` *and* `resolution_steps`, both must be present in the
JSON — a hand-edited graph missing one is refused with:

```
HTTP 400  prompt_outputs_failed_validation
node_errors: { "11": { "errors": [{ "type": "required_input_missing",
                                    "details": "resolution_steps" }] } }
```

That message is precise: it names the node id, the class and the missing input.
Add it and re-publish. Nothing is wrong with your bindings when you see this.

The same node class can differ between ComfyUI versions, so a graph that ran on
another machine is not proof. To read an input's real contract — type, default,
min/max, option list — without guessing, the tool asks the running ComfyUI, and
so can you from the browser console on the tool page:

```js
await (await fetch('/video/nodespecs', {method:'POST',
  body: JSON.stringify({classes:['ImageScaleToTotalPixels'], surface:'atlas'})
})).json()
```

### 2. Publish, and mind the two traps

Fill the roles, add the params (`+ Add` under **Exposed settings**), publish.
Two traps, both of which produce a *silently wrong render* rather than an error:

- **`shape_ref` is not a spare `style_ref`.** If your graph has one `LoadImage`
  and you bind both roles to it, `shape_ref` is applied **second and wins**, so
  the node receives the normalised grayscale silhouette instead of the
  photograph. Worse, `normalize_shape_ref` scales that silhouette to
  **Shape-ref fill %** of a black 1024² canvas — and at `0` that is a **single
  pixel**. A graph with one image input wants `style_ref` (the raw file) and
  `shape_ref` set to **(not used)**.
- **Most of ⚙ Settings does nothing on a blueprint pipeline.** The runner
  injects only the bound roles, the gen size, and your declared params.
  *ControlNet strength*, *ControlNet end %* and *Shape-ref fill %* still render
  as editable per-atlas fields and are ignored. Put anything you need to turn in
  `params`, not in those boxes.

### 3. Verify BEFORE you spend a render

**This is the step that is worth the most and gets skipped.** A publish reports
*presence*, never *content*: `/video/library` will happily show your blueprint
in `in_r2`, `on_disk` and `loaded` while the bytes are last week's. Uploading
the wrong file — easy, when two downloads share a name — looks identical to
success.

So after publishing, open **⤓ Resolved workflow** and read the graph back. It
force-hydrates from R2 first, so it is ground truth for what a render will send.
Check the one thing you just changed is actually in it. Thirty seconds there
saves the loop of *edit → publish → render → same failure*, which is how an
afternoon disappears.

**The quick version: compare the digest.** 🗑 Manage blueprints shows a 12-char
`graph_sha` beside each entry — the sha256 of the graph the library actually
holds. Recompute it from the file you meant to publish and the two must match:

```bash
python -c "import json,hashlib;print(hashlib.sha256(json.dumps(json.load(open('workflow.json')),sort_keys=True,separators=(',',':')).encode()).hexdigest()[:12])"
```

It is a CANONICAL digest (sorted keys, no whitespace), not a hash of the file
bytes — publishing re-serialises the graph as `json.dumps(graph, indent=2)`, so
a byte hash would differ for a file that landed perfectly. Formatting and key
order are therefore irrelevant; content is all that counts. `library_status`
carries `graph_sha`, `map_sha` and `updated_at` (the R2 publish time, not the
staging pull time) for scripted checks.

### Editing the semantic taxonomy from here

A graph that uses **Semantic Layer Analyze / Router** classifies each layer against a
taxonomy — a YAML list of roles, categories and keywords. With the `clip` analyzer those
keywords **are** the candidate labels, so the taxonomy is the whole quality knob: a layer
whose subject the vocabulary does not name scores near zero and falls to `UNRESOLVED`.
(That is not hypothetical — "raft" matched no rule once and the raft, most of the
picture, was dropped.)

Do **not** use `taxonomy_path` for an Atlas Maker render. It takes a filename, and the
production target is a serverless worker whose container is discarded after the job, so
no path you can type there survives.

**Edit it in 🏷 Taxonomy** (next to *Manage blueprints*, same permission). That is one
shared taxonomy for everyone: it is stored once, and every render injects it into any
node in the graph that takes one. No file on any disk, no per-blueprint param, and no
re-publishing a blueprint when you change a keyword — edit it on any machine and the
next render anywhere picks it up.

Start from `configs/default_taxonomy.yaml` in the pack and add your vocabulary. Keep
`UNRESOLVED` last in `roles`. **Save checks it before storing** — a taxonomy that would
not load is refused with the reason, because the node's own behaviour is to fall back to
a much smaller built-in vocabulary and carry on, so this is the last point where a typo
is visible to the person who made it. Save also tells you what it stored ("5 roles, 6
categories, 143 keywords"), which is the quickest way to confirm the edit you meant.

Two things worth knowing:

- **A blueprint that sets its own `taxonomy_yaml` keeps it.** The shared one is a
  default, not an override, so a graph with a deliberate taxonomy is never overwritten.
- **Leave Semantic Layer Router's taxonomy inputs empty.** It inherits whatever Analyze
  used. Giving it its own copy is how the two end up on different vocabularies, and an
  analyzer scoring against one while the router resolves against another looks exactly
  like a correct run — every role still arrives, just wrong.

If two of you edit it at once the second save is **refused**, not silently applied over
the first — copy your version out, reload, and reapply.

After a render, read the node's `report` output. A broken taxonomy never fails a render;
from the images alone a silent fallback and a silent success are identical.

### Troubleshooting

| Symptom | What it means | Fix |
| --- | --- | --- |
| `required_input_missing`, names an input | the graph omits a widget that node requires | add it to that node's `inputs` in `workflow.json` |
| `value_not_in_list` | a model name the target does not have | check the file is on that machine, or switch **Run generation on** |
| the fix you just published has no effect | the library still holds the old bytes | ⤓ Resolved workflow and confirm; re-upload the right file |
| a knob in ⚙ Settings does nothing | it is not injected for blueprint pipelines | expose it as a param instead |
| the render ignores your reference photo | `shape_ref` bound alongside `style_ref` | set `shape_ref` to **(not used)** |
| the pipeline output is greyscale, but the same graph is full colour in ComfyUI | the `LoadImage` is bound to `shape_ref`, which grayscales, thresholds and rescales the image onto a 1024×1024 canvas before ComfyUI sees it | bind it to `style_ref` and set `shape_ref` to **(not used)**. Tell: the pipeline output is exactly 1024×1024 |
| the semantic roles come out wrong, or everything lands in `UNRESOLVED` | the taxonomy has no vocabulary for your subject, or the node fell back to the built-in one | read the node's `report`; see "Editing the semantic taxonomy" above |
| `some models could not be verified` | no loader class maps that field, so the question cannot be asked (`pulid_file`, `ipadapter_file`, `clip_name3`, `gligen_name`, `hypernetwork_name`) | nothing — it is a permanent advisory and never blocks a render |

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
