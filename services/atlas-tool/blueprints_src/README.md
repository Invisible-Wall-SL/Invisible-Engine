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

  // What ComfyUI must have installed. v1 is read-only metadata; auto-download
  // (ComfyUI-Manager) is a later phase. `source` blank = "must be pre-installed".
  "models": [
    { "field": "ckpt_name", "filename": "model.safetensors", "dir": "checkpoints", "source": "" }
  ]
}
```

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
