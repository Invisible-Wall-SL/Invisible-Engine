# ADR-0008 — Agents plan the art with the Atlas Maker blueprint library

- **Status:** proposed
- **Date:** 2026-10-06
- **Builds on:** ADR-0002 (tool adapters), ADR-0003 (run state and events), ADR-0005 (mockup
  analysis), ADR-0006 (costs and budgets). Amends ADR-0003 and ADR-0006 (see "Amendments to
  earlier ADRs" at the end).

## Context

### What the New game screen does today

The Preset card (`apps/launcher-api/src/routes/(app)/director/+page.svelte`, "Preset") makes the
owner pick, for the whole run, ONE Atlas Maker blueprint id (`sdxl` by default), a draft and a
final render size, a number of variants per region and a RunPod GPU. `runs.ts` stores it as
`RunPreset` in `director_runs.preset_json` (`parsePreset`, `DEFAULT_PRESET`), `estimateForTemplate`
prices the run from it, and `atlas-artist.md` is told to "use the preset blueprint; never switch
blueprints on your own".

That model is wrong for the tool the agents drive:

- **Atlas Maker has a library, not a setting.** `_shared/blueprints/<id>/{blueprint.json,
  workflow.json}` holds published ComfyUI graphs of several JOBS: text-to-image (`sdxl`, `flux`,
  `gpt_image` are the bundled ones in `services/atlas-tool/blueprints_src/`), image-to-image,
  background removal, upscale and other *processing* graphs (no sampler, no prompt: `output` is the
  only required role since 2026-09-09), layer *extraction* graphs (the SemanticLayers pack), and a
  video graph for the Flipbook (`wan22_i2v_flipbook`, `kind: video`). The owner publishes new ones
  from the ＋ New blueprint modal whenever a job needs one.
- **A blueprint is chosen per atlas and per region, and one image often takes a chain.**
  `settings.pipeline` on the manifest (`/saveconfig`) picks the atlas's generator; a region's
  `pipeline` override (`/saveadv`) picks its own; `settings.bpParams[<id>]` carries that blueprint's
  exposed settings for the atlas. A finished symbol may be: generate with `sdxl` → cut the
  background with a matting blueprint → add a `_glow` FX layer. A background may be: extract the
  scenery from a mockup with a layer-extraction blueprint → relight → upscale. The tool already has
  the building blocks for that: **AI layers** (`/addlayer`, `layer_of`: a second render of the same
  source onto the same page), **FX layers** (`<base>_glow` / `_shadow` / `_shine` / `_blur` /
  `_zoom` / `_colour`, computed by `shine.py` on the CPU), **⧉ Duplicate atlas** (`/duplicateatlas`:
  the same setup under a new name and a region tag, for a second pass), **references** per region
  (`style_ref` the raw image, `shape_ref` the normalised silhouette; `/saveadv` for an R2 path,
  `/setref` for an upload), and **committed tiles** (`/setoutput`: a given image used verbatim as a
  region's tile, no generation, no RMBG).
- **The GPU is not a choice the run makes.** Since #1064 the serverless endpoint's card comes from
  atlas-tool's `RUNPOD_ENDPOINT_GPU` and is recorded per job; the worker refuses to price a sum by a
  guess. A GPU picked on the New game screen prices the estimate at a card the render may not run
  on.
- **Draft and final sizes and variant counts are per step, not per run.** A cutout pass has one
  variant (it is deterministic); a draft symbol wants three; a final background wants one at the
  sheet's real size.

The owner's words, paraphrased: the agents must choose and run the blueprints themselves so the
correct image is created, and there must be an agent that really knows how to set Atlas Maker up.

### What exists to build on

- `director/ops/atlas.ts` (PLAN 2.4): `list_regions`, `get_region`, `set_region_prompt`,
  `queue_variants` (→ `/render`, a `jobRef`, settled by callback or the `/progress` watcher),
  `list_variants`, `get_variant_image`, `choose_variant` (→ `/save`, a whole card, compare-and-
  swapped), `pack_sheet` (→ `/createatlas`), `sheet_stats`, and `comfyui.job_status`. Reads come
  from the manifests in R2; writes go through atlas-tool's own routes with a launch token that names
  the acting agent and the run (`atlasClient.ts`), so every manifest save carries `saved_by.tool =
  'director'`.
- The gate (`director/gate.ts`): service token, hard refusals by op NAME (`refusals.ts`), per-op
  agent allow-list, schema validation, project scope, `opId` idempotency, write-target guard. Every
  model agent's frontmatter `tools:` list must equal the server allow-lists
  (`check:director-adapters`), and each agent's tool set must fit the strict tool-use limits (20
  tools, 24 optional parameters, 16 unions per request).
- `director_regions` (ADR-0003): one row per template region with status, variants, the art
  director's pick and the owner's note. There is no record of HOW a region was made.
- The estimate (`packages/director-costs` `estimateRun`, `estimate-profiles.json`): RunPod seconds
  per variant at 1024 px scaled by pixel count, times `regions × variants` drafts plus one final
  per region, at the preset's GPU. The cap projection (`budget.ts` `projectQueuedGpu`) prices a
  queued render at the run's mean billed render, or `seedSecondsPerRender` at the dearest GPU
  before the first is billed.
- Blueprint schema (`services/atlas-tool/blueprints.py`): `bindings` (roles `output` required;
  `positive`, `negative`, `seed`, `width`, `height`, `style_ref`, `shape_ref` injected when bound),
  `params[]` (`int|float|text|bool|select`, default, min/max/step, options, group), `models[]`,
  `kind` (`image|video`, default image), `base` (a label only). Publishing writes `blueprint.json` +
  `workflow.json` to R2 and reports `graph_sha` / `map_sha` / `updated_at` in `library_status`.

## Options

1. **Keep the Preset, add a per-group blueprint picker.** The owner picks a blueprint per region
   group on the New game screen. Rejected: the owner is doing the technician's job by hand, before
   seeing a single image, and a chain (generate → cut → glow) still cannot be expressed.
2. **Let the atlas artist pick from the library freely.** Give `atlas-artist` the whole Atlas
   Maker surface and a dump of every `blueprint.json`. Rejected: a `blueprint.json` says WHERE to
   poke values, not WHEN to use the graph, what it costs, or what goes wrong (the 2026-09-08/09
   runbook traps: `shape_ref` beside `style_ref`, publishing does not select, a processing graph has
   no prompt). The artist's job is prompts and curation; mixing in pipeline set-up makes one agent
   with 25 tools and two kinds of mistakes.
3. **A reviewed catalogue, a technician agent, a recipe per region.** Recommended, below.

## Recommendation

### 1. The New game screen loses the Preset card

What the owner still sets: **Project**, **Template**, **Starting point** (mockups with tags,
fidelity, the ownership check, notes), **Checkpoints** (now with an **Art plan** checkpoint, on by
default; see §7), and the **Budget cap** for this run, pre-filled from Settings
`DIRECTOR_RUN_BUDGET_USD` and stored on the draft run at create (today `budgetCapUsd` is null until
the worker copies the setting at start; with this change the worker copies it only when the row
has none). The Summary panel keeps the agents, the region counts and the estimate.

What goes:
- `RunPreset`, `parsePreset`, `DEFAULT_PRESET`, `RESOLUTIONS`, `MAX_VARIANTS_PER_REGION` and the
  `preset` key of the create and estimate requests (`/api/director/runs`, `/api/director/estimate`,
  `/api/director/templates` `preset.default`). A body that still sends `preset` is refused with
  `400 bad_request` naming the key, so a stale page fails loudly rather than silently losing a
  setting.
- The `director_runs.preset_json` column, dropped by card 8C's migration. **Existing draft runs:**
  there is nothing in `preset_json` a run still needs. The blueprint, sizes and variants now come
  from recipes (§5); the GPU comes from the endpoint (§6). A draft run created before 8C deploys
  keeps its project, starting point and checkpoints and starts normally; a run that was already
  running cannot exist, because the worker refuses to start a run whose agents name tools the
  launcher does not serve.
- `docs/tools/director.md` §"Preset" (rule 9: the doc ships in the same change as the UI).

### 2. The blueprint catalogue: `card.json` beside every blueprint

A **card** is the knowledge a blueprint's author has and its `blueprint.json` does not: when to use
it, what it needs, what it costs, what goes wrong. One card per blueprint, at
`_shared/blueprints/<id>/card.json`, next to `blueprint.json` and `workflow.json`. The bundled
blueprints carry theirs in `services/atlas-tool/blueprints_src/<id>/card.json`, mirrored to R2 by
`seed_blueprints.py` like the other two files, so a bundled card is a pipeline change.

```jsonc
{
  "version": 1,
  "id": "sdxl",                      // = the blueprint id
  "status": "reviewed",              // draft | reviewed — only reviewed cards reach an agent
  "rev": 3,                          // bumped on every save
  "graphSha": "3f1c9a0b2d4e",        // library_status graph_sha the card was reviewed against
  "reviewedBy": "gualt", "reviewedAt": "2026-10-07T…",
  "purpose": "Text-to-image for icon-style game art with a style reference.",
  "whenToUse": ["symbols, coins, buttons, plaques", "…"],
  "whenNotToUse": ["full-bleed backgrounds (the RMBG node cuts the scenery)", "…"],
  "inputs": {                        // required | optional | none
    "prompt": "required", "negative": "optional", "reference": "optional",
    "shape": "none", "sourceImage": "none", "mask": "none", "layer": "none"
  },
  "outputs": { "kind": "image", "alpha": true, "count": 1 },
  "settings": [                      // keys = blueprint.json params[].key, or a bound role
    { "key": "steps", "default": 35, "min": 20, "max": 50, "note": "25 is enough for drafts" },
    { "key": "cfg", "default": 8.5, "min": 5, "max": 10 },
    { "key": "width", "draft": 512, "final": 1024, "max": 1536 }
  ],
  "chain": { "position": "generate", "follows": [], "precedes": ["cutout", "upscale", "fx"] },
  "gpu": { "secondsPerImage": { "512": 6, "1024": 14, "1536": 30 }, "coldStart": 90,
           "source": "guess" },       // guess | measured
  "variants": { "draft": 3, "final": 1, "max": 6 },
  "gotchas": ["the LoRA bakes a 3D icon look; drop its strength for painterly art", "…"]
}
```

Rules:
- **Who edits.** The owner, in Atlas Maker: the ＋ New blueprint modal gains a **Card** section
  (prefilled from the graph: `inputs` from the bound roles, `settings` from `params`, `outputs.kind`
  from `kind`), and 🗑 Manage blueprints gains **✎ Card** on every entry. Saving needs
  `blueprintPublish`, the same capability as publishing. Atlas Maker validates a card against its
  blueprint on save: every `settings[].key` exists in `params` or is a bound role, ranges sit inside
  the param's own min/max, `inputs.prompt` is not `required` on a graph with no `positive` binding,
  and so on. The validation is the Python `blueprints.py` module's (a `validate_card` beside
  `_validate_manifest`), so an agent-facing listing never shows a card its blueprint contradicts.
- **A blueprint without a card in `status: reviewed` is not offered to agents.** The adapter's
  `atlas.list_blueprints` lists only reviewed cards; a technician plan naming any other blueprint is
  refused by the worker's plan validation (§5). Publishing a blueprint therefore makes it usable by
  people at once and by agents only after the owner reviews its card.
- **Versioning.** `rev` increments on every save, and the previous version is kept at
  `_shared/blueprints/<id>/card.history/<rev>.json` (create-only writes; the save itself is a
  compare-and-swap through `iw_common/docsave.py` like every other doc). When a blueprint is
  re-published and its `graph_sha` changes, the card's `graphSha` no longer matches and the card is
  shown as **stale** and treated as `draft` until the owner re-reviews it, because a graph change can
  change what the card promises (new params, a new role, a different cost). A run snapshots every
  card it uses into its recipes (`cardRev`), so the owner can always see what the agent read.
- **Measured GPU seconds.** Every `job_done` carries the render's billed seconds (#1064); the worker
  writes them per `(blueprint, genPx)` to a `director_blueprint_timings` table (rolling mean and
  count). The card editor shows them beside the card's own figures ("measured 18 s @1024, n=42") so
  the owner can copy them in and set `source: measured`. Agents read the card, never the table: the
  owner decides what counts as the known cost.
- **Reads.** The launcher reads `_shared/blueprints/<id>/{blueprint.json,card.json}` straight from
  R2, as `list_regions` reads manifests, so no atlas-tool route is needed for the listing. The
  listing is cached for a minute and carries each card's `rev`, so a run's recipes name the version
  they were planned against.

### 3. A new runtime agent: `atlas-technician`

| | `atlas-technician` (new) | `atlas-artist` (narrowed) | `art-director` (unchanged) |
|---|---|---|---|
| Owns | Setting Atlas Maker up and running it: per region (and layer), choose the blueprint chain from the catalogue, set params, refs and sizes, add layers, duplicate an atlas for a second pass, render drafts, hand the variants to the art director, render finals, commit the chain's result as the region's tile, compose, deploy | Prompts and curation: write and revise each generate step's prompt and negative from the style pack, the mockup crop and the owner's notes; fold rejections and "Redo with my note" into the prompt | Look and approval: judge variants against the crop, palette and readability; pick one; explain |
| Model / effort | `claude-sonnet-5-5` / `high` | `claude-sonnet-5-5` / `medium` | `claude-sonnet-5-5` / `medium` |
| Why that model | Planning from a reviewed catalogue is retrieval plus rules, and the plan is reviewed by the owner at the Art plan checkpoint before any GPU spend, so a wrong plan costs a Sonnet turn, not a render. If the pilot shows plans the owner keeps correcting, raise it to Opus by editing the definition (a pipeline change with an evaluation, PLAN 5.4) | | |

**The technician's tool list** (18; fits the 20-tool limit and, with the schemas in §4, the
24-optional-parameter limit, which `check:director-adapters` enforces):

```
atlas.list_blueprints   atlas.list_regions       atlas.get_region
atlas.set_atlas_pipeline  atlas.set_region_pipeline  atlas.set_refs
atlas.add_layer         atlas.remove_layer       atlas.duplicate_atlas
atlas.queue_variants    atlas.list_variants      atlas.choose_variant
atlas.set_output        atlas.pack_sheet         atlas.deploy_atlas
comfyui.job_status      run.set_recipe           run.post_activity
```

`atlas.queue_variants`, `atlas.choose_variant`, `atlas.pack_sheet` and `comfyui.job_status` move
from the artist to the technician; the artist keeps `atlas.list_regions`, `atlas.get_region`,
`atlas.set_region_prompt`, `atlas.list_variants`, `mockups.get_crop` and `run.post_activity`. The
coordinator assigns both; `run.assign_task`'s agent enum follows the definitions automatically.

**Hard refusals** (in the definition AND in code, each with a failing-on-purpose fixture):
- Never publish a game (ADR-0002, unchanged).
- Never touch the math contract (unchanged). The technician also never writes a region's rect or
  geometry: `x/y/w/h/rotated/bounds` are the packer's and the `.atlas` file's.
- **Never delete art.** No adapter calls `/delvariants`, `/clearoutput` or `/delregion` on a region
  the run did not create. `atlas.remove_layer` removes only a layer region this run added (the
  adapter checks `director_ops` for the `add_layer` that made it) and never its variant files.
- **Never switch "Run generation on".** No adapter can write `run_on` (global or per atlas), and
  atlas-tool refuses a `/render` from a Director token (`act.tool = 'director'`) when the effective
  transport is `http` ("My computer"): the Director renders only on RunPod. That is a small atlas-
  tool pipeline change in card 8B.
- **Never write the library.** No op publishes, edits or deletes a blueprint or a card, or the
  shared taxonomy. `refusals.ts` gains a `library` refusal: op names with `upload`, `delete`,
  `taxonomy` or `card` are refused, and the write-target guard refuses any key under `_shared/`
  outright (defence in depth: the project-scope check already stops it).
- **Never change global Atlas Maker settings.** `atlas.set_atlas_pipeline` writes the ATLAS's
  settings (`manifest.settings`), never `atlas_config.json`.
- **Stays within the budget.** Every GPU submit still passes the worker's cap check (ADR-0006). In
  addition the worker refuses to start a region batch whose recipes' projected GPU cost (§6)
  exceeds the remaining cap, and opens the `budget` checkpoint instead.
- Never wait on a GPU job in a loop; never use a tool not in its list (unchanged).

### 4. New and changed Atlas adapter tools

All ops are `tool: 'atlas'`, `scope: 'project'`, project-scoped like today's, and every write takes
an `opId`. "Endpoint" is the atlas-tool route the Atlas Maker page itself calls; "Writes" is the
write-target list the gate checks. GPU jobs return a `jobRef` at once and are settled by code
(callback or the `/progress` watcher), never by the model.

| Op | Agents | Input | Output | Endpoint / source | Writes | GPU |
|---|---|---|---|---|---|---|
| `list_blueprints` | technician, coordinator | `{}` | `{blueprints: [{id, name, kind, rev, card}]}` — reviewed `image` cards only, each with its `params` and bound roles from `blueprint.json` | R2 `_shared/blueprints/*/{blueprint,card}.json` | — | no |
| `set_atlas_pipeline` | technician | `{atlas, blueprint, genPx, params: {key: value}, base?}` | `{atlas, blueprint, genPx, applied: [key], version}` | `POST /saveconfig?manifest=` with `{pipeline, gen_width, gen_height, bpParams: {<blueprint>: params}}` — the per-ATLAS settings only; `run_on` and every global key are refused by the adapter before the call | the manifest | no |
| `set_region_pipeline` | technician | `{atlas, region, blueprint, fitMode?, base?}` (`blueprint: ""` = inherit the atlas) | `{atlas, region, blueprint, version}` | `POST /saveadv` `{name, fields: {pipeline, fit_mode}}` | the manifest | no |
| `set_refs` | technician | `{atlas, region, style?, shape?, base?}` — each ref is one of `{key}` (an R2 key inside the project, e.g. a `sheet_src/` silhouette), `{variant: {atlas, region, id}}` (a rendered variant, copied by the adapter to `input/refs/director_<region>_<id>.png`), `{mockupCrop: true}` (the run's crop `director/crops/<runId>/<region>.png`, copied likewise), or `{clear: true}` | `{atlas, region, style, shape, version}` | `POST /saveadv` `{name, fields: {style_ref, shape_ref}}` with the R2-relative path; the copies are plain `putObject` create-only writes under `input/refs/` | the manifest, `input/refs/director_*` | no |
| `add_layer` | technician | `{atlas, base, suffix, kind: 'ai' \| 'fx', mode?}` (`fx` needs `mode` ∈ glow/shadow/shine/blur/zoom/colour; the suffix then equals the mode) | `{atlas, name, kind, version}` | `ai`: `POST /addlayer` `{base, suffix}`; `fx`: `POST /addregion` `{name: <base>_<mode>}` then `POST /setmode` `{name, mode}` | the manifest | no |
| `remove_layer` | technician | `{atlas, name, base?}` | `{atlas, name, version}` | `POST /delregion` `{name}` — only for a region this run's `add_layer` created; variants are never deleted | the manifest | no |
| `duplicate_atlas` | technician | `{atlas, name, tag}` | `{atlas: name, regions: [{from, to}], version}` | `POST /duplicateatlas` `{name, prefix: tag}` (refused on a `.atlas`-bound atlas and on an existing name, as the UI is) | the new manifest | no |
| `queue_variants` (changed) | technician | `{atlas, regions[], variants}` | as today | `POST /render` — unchanged; the atlas's pipeline and gen size are whatever `set_atlas_pipeline` / `set_region_pipeline` set | as today | **yes** |
| `choose_variant` (changed) | technician | `{atlas, region, id, lock?, base?}` | `{…, locked}` | `POST /save` (the card, with `lock` and the variant's seed when `lock` is true) | the manifest | no |
| `set_output` | technician | `{atlas, region, from: {atlas, region, id}, base?}` | `{atlas, region, output, version}` | `POST /setoutput` `{name, data}` with the variant's PNG — this is how a chain's LAST step (rendered on a duplicate or a layer) becomes the template region's tile, used verbatim with no RMBG | the manifest, `input/refs/useroutput_<region>.png` | no |
| `pack_sheet` (unchanged) | technician | `{atlas}` | as today | `POST /createatlas` | as today | no (CPU, in atlas-tool) |
| `deploy_atlas` | technician | `{atlas}` | `{atlas, deployed: [keys], note}` | `POST /deployatlas?manifest=` — copies the composed page and its `.json` to the project's `deploy/` prefix (the asset-map target); the write-target guard allows `<C>/<P>/deploy/` and nothing else | `deploy/` | no |
| `list_regions`, `get_region`, `list_variants`, `get_variant_image`, `sheet_stats`, `comfyui.job_status` | as today, plus technician where it needs them | unchanged | `get_region` also returns `pipeline`, `styleRef`, `shapeRef`, `layerOf`, `mode`, `outputOverride` | | | |

Idempotency: every write claims its `opId` as today. `duplicate_atlas` and `add_layer` are the two
creates; a replay returns the stored result and the second call never reaches atlas-tool (the
routes themselves refuse an existing name, so a lost reply is also safe). `set_output` and
`set_refs` copy bytes with create-only writes keyed by `(region, variant id)`, so a retry finds the
copy and only re-sends the manifest write.

Conflicts: all manifest writes are compare-and-swapped on `base` (`X-IW-Doc-Bases`) as today; a
person's save in between is `conflict` and the technician re-reads. **`/saveadv`, `/addregion`,
`/setmode` and `/setoutput` do not take a doc base today** (only `/save`, `/saveconfig` and the
creates do, via `doc_sync`): card 8B extends them to honour `X-IW-Doc-Bases` for a Director token,
which is a pipeline change to atlas-tool and the reason those four are listed with `base?`.

### 5. The recipe: how a region is made, on the run

`director_regions` gains `recipe_json` and `recipe_rev`. A recipe is the technician's plan for one
region, written with `run.set_recipe` (a worker tool, validated in code before it is stored) and
updated as steps run:

```jsonc
{
  "rev": 2, "region": "H1", "atlas": "symbols", "group": "Symbols",
  "plannedBy": "atlas-technician", "approvedBy": {"user": "…", "at": "…"},   // at the Art plan
  "steps": [
    { "n": 1, "kind": "generate", "blueprint": "sdxl", "cardRev": 3,
      "atlas": "symbols", "region": "H1", "genPx": 512, "variants": 3,
      "params": { "steps": 28, "cfg": 7.5 }, "refs": { "style": {"mockupCrop": true} },
      "status": "done", "jobRef": "st_…", "chosen": "00017" },
    { "n": 2, "kind": "generate", "blueprint": "sdxl", "atlas": "symbols", "region": "H1",
      "genPx": 1024, "variants": 1, "seedFrom": 1, "status": "queued", "jobRef": "st_…" },
    { "n": 3, "kind": "process", "blueprint": "cutout_birefnet", "cardRev": 1,
      "atlas": "symbols_cut", "region": "cut_H1", "genPx": 1024, "variants": 1,
      "refs": { "style": {"variant": {"atlas": "symbols", "region": "H1", "id": "<step 2>"}} },
      "status": "planned" },
    { "n": 4, "kind": "finish", "op": "set_output",
      "from": {"atlas": "symbols_cut", "region": "cut_H1"}, "status": "planned" },
    { "n": 5, "kind": "layer", "layer": "fx", "mode": "glow", "status": "planned" }
  ],
  "ownerNote": null,
  "projected": { "gpuSeconds": 62, "gpuUsd": 0.03, "claudeUsd": 0.09 }
}
```

- **Code validates a recipe before storing it** (the same posture as ADR-0005's conflict rules):
  every `blueprint` has a reviewed card; a `generate` step's card has `inputs.prompt ≠ none`; a
  `process` step has a source (`refs.style` or `seedFrom`); `genPx` is within the card's
  `settings.width` range; `variants` ≤ the card's `variants.max`; the chain ends in the template
  region (a `finish` step, or step 1 renders on it directly); a `layer` step names a known FX mode or
  an AI layer the plan also renders; `projected` is recomputed by code from the cards (§6). A recipe
  that fails is answered with the reasons and not stored.
- **The owner sees recipes** at the Art plan checkpoint (§7) and on the Live run Review panel
  ("How this was made": the chain, one line per step, with the intermediate images as thumbnails).
  An edit at either place writes a new `rev` with `editedBy` and is what the technician runs next.
- **"Redo with my note"** re-runs the region's recipe from the last `generate` step with the note
  folded into the artist's prompt; if the note names a blueprint, a size or a setting ("use flux",
  "bigger", "no glow"), the coordinator hands it to the technician, who writes `rev + 1` and runs
  that. Earlier variants are kept (never delete art).
- **Reuse.** An approved recipe is the default for the other regions of its group: the technician
  plans the first region of a group fully and copies the chain to its siblings (changing only region
  names and refs), which is also what keeps the Art plan readable (grouped by identical chains).

### 6. The estimate: price per chain (ADR-0006 amendment)

- **Price of a step** = `card.gpu.secondsPerImage[genPx]` (linear interpolation between the card's
  sizes, by pixel count) × `variants` × RunPod `$/s` for the endpoint's GPU. `pricing.json` gains
  `runpod.endpointGpu`, the key of `perSecondByGpu` the serverless endpoint runs on (reviewed with
  the prices; the Admin override can change it). The cap projection keeps "the dearest GPU" as its
  fallback when `endpointGpu` is unset.
- **Price of a region** = Σ its steps + the Claude profiles per region and per variant as today.
  **Price of a run** = Σ regions + per-run, per-mockup and per-checkpoint profiles.
- **Before a plan exists** (the New game screen), the estimate uses **default recipes per region
  group** from `estimate-profiles.json` (new `recipes` section: e.g. Symbols → `sdxl` 512 ×3 drafts
  + 1024 ×1 final + cutout; Backgrounds → `flux` 1024 ×2 + 1536 ×1, no cutout), priced from the
  reviewed cards at estimate time; a default naming a blueprint with no reviewed card falls back to
  the old `secondsPerVariantAt1024` seed and the panel says so (`placeholder: true`).
- **After the Art plan** the run's `projected` total is recomputed from the real recipes and shown
  beside the plan ("Planned GPU ≈ $4.10, Claude ≈ $6–9, cap $25"). The cap projection
  (`projectQueuedGpu`) prices a queued render at its step's card seconds when the card has them,
  else at the run mean, else at the seed — the cap keeps failing closed.
- `estimateRun`'s input changes from `{variantsPerRegion, draftPx, finalPx, gpu}` to `{recipes}`;
  the `check:director-runs` and `director-costs` fixtures follow.

### 7. Checkpoints

- A new checkpoint id **`art_plan`**, on by default, next to `breakdown` and `regionBatch` in
  `checkpoints_json`; `director_runs.waiting_on` accepts it (ADR-0003 amendment). It opens when the
  technician has written a recipe for every region the run will render and BEFORE the first GPU
  submit — so "nothing is submitted to RunPod until the owner confirms" (ADR-0005) now also covers
  the plan. With the checkpoint off, the plan is still stored and shown; the run just does not stop
  on it.
- **What the owner sees:** the recipes grouped by region group and collapsed by identical chain
  ("11 symbols: sdxl 512 ×3 → sdxl 1024 ×1 → cutout → glow"), each blueprint with its card's
  one-line purpose, the projected GPU and Claude spend against the cap, and the regions the plan
  skips (locked, or no source). Actions: **Looks right, start rendering**; edit a chain for a group
  or one region (blueprint, size, variants, a setting from the card's ranges, add/remove a step);
  **Send my changes** (free text to the coordinator, as the breakdown has).
- **Region batches** are unchanged in shape. The Review panel adds the recipe and the step
  thumbnails; approval still chooses the variant in the manifest (now via the technician's
  `choose_variant` with `lock`), and the technician runs the chain's remaining steps (final render,
  cutout, finish, layers) on the approved pick before compose.
- The Live run's five steps stay; the Art plan is a checkpoint inside **Style pack** (the plan needs
  the palette and references the style pack produces), so the step strip reads Mockup breakdown →
  Style pack (Art plan ✓) → Regions → Build → Hand-off.

### 8. Migration and safety

- **Agent definitions.** `atlas-artist.md` is rewritten (prompts and curation only; its tool list
  shrinks as in §3; its prompt text names the recipe's blueprint so it writes the right kind of
  prompt: tag-style for `sdxl`, prose for `flux`, an edit instruction in `gpt_prompt` for
  `gpt_image`). `atlas-technician.md` is new. `coordinator.md` gains the Art plan and the technician
  in its plan. `DIRECTOR_AGENTS` in `adapter.ts` gains `atlas-technician`; the registry's allow-lists
  and the worker's `tools.ts` catalogue gain the new ops; `check:director-adapters` keeps the
  frontmatter ↔ allow-list equality and the strict-limits check over the new agent.
- **Refusals** gain `library` (§3) with a fixture that tries `atlas.upload_blueprint`,
  `atlas.delete_card`, a write to `_shared/blueprints/x/card.json` and a `/saveconfig` carrying
  `run_on`, each refused.
- **atlas-tool pipeline changes** (card 8B, each with a Python test): `X-IW-Doc-Bases` honoured on
  `/saveadv`, `/addregion`, `/setmode`, `/setoutput`; `/render` refuses a Director token on the
  `http` transport; `card.json` read/validate/save (`blueprints.validate_card`, the modal section,
  ✎ Card in Manage blueprints, `card.history/`); `seed_blueprints.py` mirrors `card.json`.
- **Eval reference set.** `docs/director/eval/blueprints/` gets a fixture catalogue (the four
  bundled cards plus two fixture-only processing cards, `cutout_fixture` and `upscale_fixture`,
  marked as such) and `expected-art-plan.json` for the reference template's 23 regions. A new
  `prove:art-plan` fixture drives the technician's planning turn through the fake transport (like
  `prove:breakdown`) and checks the code rules of §5 on its output; it also runs under PLAN 5.4's
  before/after evaluation when `atlas-technician.md` or `atlas-artist.md` changes.
- **No current game changes.** Everything here is launcher, worker, docs and atlas-tool code
  paths that a human render never takes (a Director token is the only thing that triggers the new
  refusals and the doc-base checks on the four routes). The current-games harness passes without
  a render.

## Consequences

- One new agent, one new checkpoint, one new column pair on `director_regions`, one new table
  (`director_blueprint_timings`), one dropped column (`preset_json`), eleven new or changed adapter
  ops, a `card.json` per blueprint with an editor in Atlas Maker, and four small atlas-tool changes.
- The owner reviews a plan before paying for it, and can correct it in the terms the tool uses
  (blueprint, size, variants, settings), not in the agents' prompts.
- A newly published blueprint is invisible to agents until its card is reviewed: the library can
  grow without the agents' behaviour changing underneath a run.
- The estimate becomes honest about what it knows: measured seconds per blueprint and size, or a
  flagged guess.

## Needs owner approval

- Removing the Preset (and the GPU choice) from the New game screen; the GPU comes from the
  endpoint.
- `card.json` as the agents' only source of blueprint knowledge, edited in Atlas Maker, and the
  rule that an unreviewed card hides its blueprint from agents.
- `atlas-technician` on Sonnet 5.5 at high effort, with the tool list and refusals above.
- The Art plan checkpoint, on by default.
- Recipes stored on `director_regions` and editable by the owner.

## Amendments to earlier ADRs (take effect when this ADR is approved)

- **ADR-0003:** `waiting_on` and the checkpoint ids gain `art_plan`; `director_regions` gains
  `recipe_json` / `recipe_rev`; `director_runs.preset_json` is dropped; `checkpoints_json` gains
  `artPlan`.
- **ADR-0006:** the estimate prices chains from cards (§6) instead of `variantsPerRegion × draftPx
  / finalPx` at a chosen GPU; `pricing.json` gains `runpod.endpointGpu`; the cap projection prefers
  a step's card seconds; `budgetCapUsd` is set at create from the New game screen (bounded by the
  Settings value's own bounds) and copied from Settings at start only when null.
- **ADR-0005:** "nothing is submitted to RunPod until the owner confirms" covers the Art plan.
