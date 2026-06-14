# Invisible Atlas Maker — Pipeline Blueprints

A **blueprint** is a data-driven ComfyUI pipeline the Atlas Maker can drive
without a hardcoded Python builder. It's a ComfyUI graph (API/prompt format)
plus a small `bindings` descriptor that maps semantic roles (positive prompt,
seed, refs, output node) onto that graph's own node IDs. This is the backbone
of **Invisible Blueprints** (`docs/design/invisible-blueprints.md`).

## Storage

Blueprints live in a global, cross-project R2 prefix (mirroring
`_shared/spines/`), one directory per blueprint:

```
_shared/blueprints/<id>/blueprint.json   # manifest: metadata + base + bindings + models
_shared/blueprints/<id>/workflow.json    # the ComfyUI graph in API/prompt format
_shared/blueprints/<id>/thumb.png        # optional preview (unused by the runner)
```

`<id>` is an `r2_slug` (lowercase, non-alphanumerics → `_`).

This `blueprints_src/` folder is the **tracked source** for the built-in
reference blueprints. `py seed_blueprints.py` mirrors it to R2. The deployed
tool hydrates `_shared/blueprints/` from R2 into staging at container start.

## To add a 4th pipeline

1. Build & test the network in your local ComfyUI, then export it in **API
   format** (Settings → "Save (API Format)" / the dev "Save API" button). That
   gives you the node-dict we POST to `/prompt` — NOT the editor `workflow.json`
   (which has `nodes`/`links`/positions; that's UI format and won't run).
2. Create `blueprints_src/<id>/workflow.json` with that API-format graph.
3. Create `blueprints_src/<id>/blueprint.json` (schema below) — point each role
   at the node/field it lives on in *your* graph.
4. `py seed_blueprints.py` (R2 creds in env), then **restart** the atlas-tool
   service so it re-hydrates.
5. Select it by setting the region/atlas `pipeline` value to `<id>` (anything
   that isn't `sdxl`/`flux`/`gpt_image` is looked up as a blueprint id). An
   in-browser picker is a later phase.

That's it — no Python change. Adding a pipeline = dropping two files.

## `blueprint.json` schema

```jsonc
{
  "version": 1,
  "id": "my_pipeline",            // r2_slug of the name; matches the dir
  "name": "My Pipeline",
  "description": "...",
  "author": "...",
  "base": "sdxl",                 // sdxl | flux | gpt_image — ref/output conventions

  // role -> { node: "<id>", field: "<input name>" }. Maps each semantic role
  // to where it lives in YOUR workflow.json.
  "bindings": {
    "positive":  { "node": "10", "field": "text" },   // REQUIRED
    "seed":      { "node": "13", "field": "seed" },    // REQUIRED
    "output":    { "node": "17" },                     // REQUIRED (SaveImage; no field)
    "negative":  { "node": "11", "field": "text" },    // optional (omit for FLUX)
    "width":     { "node": "12", "field": "width" },   // optional
    "height":    { "node": "12", "field": "height" },  // optional
    "style_ref": { "node": "3",  "field": "image" },   // optional — a LoadImage node
    "shape_ref": { "node": "4",  "field": "image" }    // optional — a LoadImage node
  },

  // Exposed settings ("general settings") — OPTIONAL, defaults to []. Tunable
  // knobs the author surfaces in the Atlas Maker Settings panel. Each carries a
  // baked DEFAULT (the general setting) and drives ONE node input. A param key
  // may NOT collide with a binding role or another param key, and a param may
  // NOT target a (node, field) already driven by a binding (no double-drive).
  "params": [
    { "key": "steps", "label": "Steps", "type": "int",
      "default": 35, "min": 1, "max": 150, "step": 1,
      "node": "13", "field": "steps", "group": "Sampler" },
    { "key": "sampler_name", "label": "Sampler", "type": "select",
      "default": "dpmpp_2m", "options": ["euler", "dpmpp_2m"],
      "node": "13", "field": "sampler_name" }
  ],

  // What ComfyUI must have installed. The catalog match keys (url/save_path/
  // base/filename) gate AUTO-DOWNLOAD via ComfyUI-Manager (see below); `field`
  // is the /object_info enum field used to check if it's already installed.
  "models": [
    { "field": "ckpt_name", "filename": "model.safetensors",
      "save_path": "checkpoints", "base": "SDXL",
      "url": "https://huggingface.co/.../model.safetensors" }
  ]
}
```

### Model requirements (`models[]`) — auto-download (B43)

Each entry tells the "prepare models" step (which runs before generation when a
blueprint is selected) what ComfyUI must have, and whether it can be fetched
automatically via **ComfyUI-Manager**:

| field | meaning |
| --- | --- |
| `field` | the `/object_info` enum field (e.g. `ckpt_name`, `lora_name`, `vae_name`) — used to check if the file is ALREADY installed (skip if so). |
| `filename` | the exact filename ComfyUI expects (incl. extension). |
| `save_path` | the ComfyUI `models/<folder>` it goes in (a catalog match key). |
| `base` | the model family (e.g. `SDXL`, `FLUX.1`) — a catalog match key. |
| `url` | the download URL (a catalog match key + where the bytes come from). |
| `sha256` / `size` | optional verify / progress metadata. |

**Catalog-only (whitelist) constraint.** ComfyUI-Manager only auto-installs
models present in its **curated `model-list.json`**, matched by the
*(`save_path`, `base`, `filename`)* triple. A model whose triple isn't in the
catalog — or that's missing any of `url`/`save_path`/`base`/`filename` — can NOT
be auto-installed; the prepare step lists it in a **manual checklist** instead
(put the file in `models/<save_path>/`, restart ComfyUI, retry). This is why a
custom Civitai/HF URL that isn't in Manager's catalog still needs a manual drop.

A model with an empty `url` (or only the legacy `{dir, source}` keys) is treated
as "must be pre-installed" → checklist if absent. The legacy
`{ "dir": ..., "source": ... }` shape still loads (mapped to `save_path`/`url`).

**Kill-switch.** `BLUEPRINT_AUTO_INSTALL_MODELS` (default ENABLED) gates
auto-install. When set to `off`/`0`/`false`, the prepare step does NOT install
or reboot ComfyUI — it only emits the checklist of missing models (the safer,
non-disruptive behaviour, since installing reboots ComfyUI once at the end to
rescan `models/`).

### Exposed params (`params[]`) — "general settings"

`params` lets a blueprint author surface tunable knobs that are NOT one of the
fixed semantic roles. Each entry:

| field | meaning |
| --- | --- |
| `key` | unique id (also the per-manifest override key). Must not equal a binding role name or another param key. |
| `type` | `int` \| `float` \| `text` \| `bool` \| `select` — controls the editor widget + value coercion. |
| `default` | the baked value (the "general setting"); used when the manifest has no override. |
| `node` / `field` | the node input it drives. Must exist in `workflow.json` and must NOT already be a binding target. |
| `label` | display label (defaults to `key`). |
| `min` / `max` / `step` | numeric bounds for `int`/`float` (optional). |
| `options` | choices for `select` (required for `select`). |
| `group` | optional UI grouping hint. |

At generate time `batch_atlas.build_workflow_blueprint` sets each param's
EFFECTIVE value onto its bound node input — the per-manifest override
(`manifest.settings.bpParams.<blueprintId>.<key>`, edited in the Settings
panel's "Blueprint settings" section) if present, else the param `default`.
A blueprint with no `params`, and a built-in pipeline, are unaffected.

The runner degrades gracefully so a bad user value never reaches the node (and
never opaquely fails the whole ComfyUI prompt): an override that can't be coerced
to the declared `type` falls back to the param's `default`; numeric values are
clamped into `min`/`max`; a `select` value outside `options` falls back to the
`default`. If even the default is unusable, the node input is left at whatever
the graph shipped with — never a wrong-typed/out-of-domain value. A blank value
in the UI (including the bool control's "— default —") is treated as no override.

### How the generic runner applies bindings

`batch_atlas.build_workflow_blueprint(region, style, blueprint)`:

- `positive`/`negative`/`seed` ← the SAME style+region prompt-combine + random-
  seed logic as the SDXL builder (`_resolve_text`). Omit a role to leave the
  graph's baked value (e.g. FLUX's empty negative).
- `width`/`height` ← the configured generation size (when bound).
- `style_ref`/`shape_ref` ← the region's staging ref path is written onto the
  bound `LoadImage` node's `image`; `_upload_workflow_refs` then uploads it to
  the remote ComfyUI. `shape_ref` is normalized (centered on a 1024² canvas)
  exactly like the built-in path.
- `output` ← the bound SaveImage node's `filename_prefix` is set to the
  project's R2 prefix; the runner reads the result from `bindings.output.node`.

Roles whose node/field aren't present in the graph are silently skipped, so a
graph that doesn't use a role just omits its binding.

## The three built-ins

`sdxl`, `flux`, `gpt_image` are seeded here as reference blueprints (the
canonical examples to copy). They are **also** the proven default path: when no
blueprint is selected, the tool still uses the hardcoded Python builders
(`build_workflow` / `build_workflow_flux` / `build_workflow_gpt`) unchanged —
the blueprints are reference/templates, not a behavior change for the built-ins.

`workflow.ui.json` in each dir is the ComfyUI **editor** export (UI format),
kept only as a human-readable authoring source; the runner ignores it and the
seeder does not upload it.
