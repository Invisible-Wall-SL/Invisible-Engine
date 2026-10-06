# ADR-0008 — Agents plan the art with the Atlas Maker blueprint library

- **Status:** proposed
- **Date:** 2026-10-06 (revised the same day after a design review, an atlas-tool fact-check and the
  coordinator's review of head a6a5961)
- **Scope:** image pipelines for a run's regions. Video cards (`kind: video`) and loop/flipbook
  chains are catalogued but out of scope for the technician; they are the animator's, in a later ADR.
- **Builds on:** ADR-0002 (tool adapters), ADR-0003 (run state and events), ADR-0005 (mockup
  analysis), ADR-0006 (costs and budgets). Amends ADR-0003, ADR-0005 and ADR-0006 and SPEC §1.1
  (see "Amendments" at the end).

## Context

### What the New game screen does today

The Preset card (`apps/launcher-api/src/routes/(app)/director/+page.svelte`) makes the owner pick,
for the whole run, ONE Atlas Maker blueprint id (`sdxl` by default), a draft and a final render
size, a number of variants per region and a RunPod GPU. `runs.ts` stores it as `RunPreset` in
`director_runs.preset_json` (`parsePreset`, `DEFAULT_PRESET`), `estimateForTemplate` prices the run
from it, the worker reads it (`store.ts` `preset_json`, `driver.ts` puts it in the coordinator's
brief), and `atlas-artist.md` is told to "use the preset blueprint; never switch blueprints on your
own".

That model is wrong for the tool the agents drive. What Atlas Maker actually is, read off
`services/atlas-tool/{ui_server.py,batch_atlas.py,blueprints.py}` and `docs/tools/atlas-maker.md`:

- **Three built-in pipelines and a library of blueprints.** The ids `sdxl`, `flux` and
  `gpt_image` run the hardcoded Python builders (`build_workflow`, `build_workflow_flux`,
  `build_workflow_gpt`), tuned by the Settings keys: per atlas (`PER_ATLAS_KEYS`: checkpoint, LoRA
  and its strength, ControlNet model and strength, `rembg` and its model, IPAdapter weight,
  `ksampler_steps`, `ksampler_cfg`, `gen_width`, `gen_height`, …) and per region (`ADV_FIELDS`:
  `pipeline`, `ipadapter_weight`, `redux_strength`, `flux_lora_strength`, `controlnet_strength`,
  `controlnet_end_percent`, `checkpoint`, `style_ref`, `shape_ref`, `fit_mode`, `gpt_rembg`), plus
  keys that exist only globally (`flux_steps`, `flux_guidance`, `gpt_image_size/quality/background`).
  Any other id is looked up in the library, `_shared/blueprints/<id>/{blueprint.json,workflow.json}`,
  and driven by the generic runner (`build_workflow_blueprint`) through its bound roles and its
  `params[]`. The bundled `blueprints_src/{sdxl,flux,gpt_image}` graphs are reference copies and
  never run under those ids.
- **The library today** (read from the owner's export of `_shared/blueprints/`, 2026-10-06): seven
  blueprints: `wan22_i2v_flipbook` (bundled, video), `wanloopingvideo__3_` (video, a looping clip),
  `removebackgroundsam3__2_` (SAM3 cutout by a text prompt), `composite4layers_sam_` (SAM3 multi-
  layer alpha composite), `birefnet` (BiRefNet matting), `characterdesignertest3` (FLUX + PuLID face
  + ControlNets, R&D) and `bluprinttest` (a FLUX two-pass test). Four are processing or extraction
  graphs with no sampler and no prompt: `output` is the only required role since 2026-09-09.
- **Where a pipeline is chosen.** `settings.pipeline` is a PROJECT-WIDE key in `atlas_config.json`
  (`/saveconfig` sends every key that is not in `PER_ATLAS_KEYS` to `apply_global_edit`); the only
  per-scope selector is the region's `pipeline` override (`/saveadv`). A blueprint's exposed params
  are saved per atlas (`manifest.settings.bpParams[<id>]`) but applied only when that blueprint is
  the ACTIVE pipeline (`batch_atlas.main`, `resolve_blueprint_workflow`): a region whose own
  `pipeline` differs from the atlas's renders that blueprint at its baked defaults. The generation
  size (`gen_width`/`gen_height`) is per atlas, not per region.
- **One image often takes a chain,** and the tool has the pieces: `/duplicateatlas` (the same
  setup under a new name and a region tag, for a second pass; built for extraction passes),
  `/addlayer` (an AI layer: a second render of the same source onto the same page) and FX layers
  (`<base>_glow` / `_shadow` / `_shine` / `_blur` / `_zoom` / `_colour`, `shine.py` on the CPU),
  references per region (`style_ref` and `shape_ref`, stored paths; `/setref` uploads a `shape_ref`;
  which role gets the raw image and which the normalised silhouette is the blueprint's binding, not
  the field's), and `/setoutput` (a given image used verbatim as the region's committed tile).
- **Writes.** Every POST parses `X-IW-Doc-Bases` and every author save goes through
  `doc_sync.commit`, so a stale base is a 409 on every route, not only `/save`. Mutation routes
  answer `200 text/plain` with a `✓` / `⚠` / `✖` prefix; the written doc versions come back in
  `X-IW-Doc-Versions`. `/saveadv` posts a WHOLE advanced card: a key absent from `fields` is cleared.
  One render slot per process (`claim_render_slot`): a second `/render` while one runs answers
  `started: false`.
- **The GPU is not the run's choice.** Since #1064 the endpoint's card is atlas-tool's
  `RUNPOD_ENDPOINT_GPU`, recorded per job, and the worker refuses to price a sum by a guess.

The owner's words, paraphrased: the agents must choose and run the blueprints themselves so the
correct image is created, and there must be an agent that really knows how to set Atlas Maker up.

### What exists to build on

- `director/ops/atlas.ts` (PLAN 2.4): `list_regions`, `get_region`, `set_region_prompt`,
  `queue_variants` (→ `/render`, a `jobRef`, settled by callback or the `/progress` watcher),
  `list_variants`, `get_variant_image`, `choose_variant` (→ `/save`, the whole card re-posted by
  `cardOf`), `pack_sheet` (→ `/createatlas`), `sheet_stats`, `comfyui.job_status`. Writes carry a
  launch token naming the acting agent and run (`atlasClient.ts`), so manifests save with
  `saved_by.tool = 'director'`.
- The gate (`director/gate.ts`): service token, hard refusals by op NAME (`refusals.ts`), per-op
  agent allow-list, schema validation, project scope, `opId` idempotency, write-target guard. The
  worker's `strictSchema` closes every object and the API's strict tool use allows 20 tools, 24
  optional parameters and 16 union-typed parameters per request (`check:director-adapters` tallies
  them per agent).
- `director_regions` (ADR-0003): status, variants, the art director's pick, the owner's note. No
  record of HOW a region was made.
- The estimate (`packages/director-costs` `estimateRun`, `estimate-profiles.json`) and the cap
  projection (`budget.ts` `projectQueuedGpu`: the run's mean billed render, else
  `seedSecondsPerRender` at the dearest GPU).

## Options

1. **Keep the Preset, add a per-group blueprint picker.** Rejected: the owner does the
   technician's job by hand before seeing an image, and a chain still cannot be expressed.
2. **Let the atlas artist pick from the library freely.** Rejected: `blueprint.json` says WHERE
   to poke values, not WHEN to use a graph, what it needs, what it costs, or what goes wrong
   (`shape_ref` beside `style_ref` turns a photo into a silhouette; publishing does not select; a
   processing graph has no prompt). Prompts and curation and pipeline set-up are two jobs.
3. **A reviewed catalogue, a technician agent, a recipe per region.** Recommended, below.

## Recommendation

### 1. The New game screen loses the Preset card

What the owner still sets: **Project**, **Template**, **Starting point** (mockups with tags,
fidelity, the ownership check, notes), **Checkpoints** (with a new **Art plan** checkpoint, on by
default; §7) and the **Budget cap** for this run, pre-filled from Settings
`DIRECTOR_RUN_BUDGET_USD`, bounded by that setting's own bounds and stored on the draft run at
create; the worker copies the Settings value at start only when the row has none. "Save as preset"
is replaced by **per-template default recipes**: an approved group recipe becomes the default the
technician starts from on the next run of the same template (§5).

What goes: `RunPreset`, `parsePreset`, `DEFAULT_PRESET`, `RESOLUTIONS`, `MAX_VARIANTS_PER_REGION`,
the `preset` key of the create and estimate requests and of `/api/director/templates`. A body
that still sends `preset` is refused `400 bad_request` naming the key, so a stale page fails
loudly. SPEC §1.1 "Preset" and `docs/tools/director.md` §3 change in the same card (rule 9).

**Migration, expand then contract.** The Preset UI goes LAST (card 8C, after the technician and
the chain pricing are live): until then the stored preset is read only as the fallback default
recipe (`sdxl`, the preset's final size, its variants) so every card before it ships inert. 8C
stops reading and writing `preset_json` (launcher `runs.ts`, worker `store.ts` and `driver.ts`)
but keeps the column, so the change is revertable and a worker on the previous build still boots;
a later cleanup card drops the column. **In-flight
runs:** ADR-0003 re-claims running, waiting and paused runs after a deploy, and a mid-batch
`atlas-artist` would wake to `job_done` without the tools it queued with. So 8C deploys only when
no run is non-terminal (a `scripts/check-director-idle.ts` the deploy checklist runs); if one is,
the deploy pauses those runs first with an owner message naming why.

### 2. The blueprint catalogue: `card.json` beside every blueprint

A **card** is what a blueprint's author knows and `blueprint.json` does not: when to use it, what
it needs, what it costs, what goes wrong. One card per pipeline id, at
`_shared/blueprints/<id>/card.json` next to `blueprint.json` and `workflow.json`. The three
built-in pipelines get cards too (`blueprints_src/{sdxl,flux,gpt_image}/card.json`, describing
what RUNS under those ids: the Python builders), and every bundled card is tracked in git and
mirrored to R2 by `seed_blueprints.py` AND `blueprints._sync_bundled` (which runs at every boot and
today ships only `blueprint.json`, `workflow.json`, `thumb.png`), so a bundled card is a pipeline
change.

```jsonc
{
  "version": 1,
  "id": "birefnet",
  "status": "reviewed",              // draft | reviewed — only reviewed cards reach an agent
  "rev": 2,                          // bumped on every save
  "graphSha": "f097cbda71df",        // library_status graph_sha the card was reviewed against
  "mapSha": "…",                     // and map_sha: params and bindings are what settings name
  "reviewedBy": "gualt", "reviewedAt": "2026-10-07T…",
  "purpose": "Cut a toon-style still to alpha with BiRefNet.",
  "whenToUse": ["a rendered symbol whose RMBG edge is dirty", "…"],
  "whenNotToUse": ["photo-real art: pick BiRefNet-general (a different card)", "…"],
  "inputs": { "prompt": "none", "negative": "none", "reference": "none", "shape": "none",
              "sourceImage": "required", "mask": "none" },
  "outputs": { "kind": "image", "alpha": true, "count": 1, "sizeRule": "source size" },
  "settings": [                      // keys = blueprint params[].key, or for a built-in pipeline
                                     // a per-atlas (PER_ATLAS_KEYS) or per-region (ADV_FIELDS) key
    { "key": "blur", "default": 10, "min": 0, "max": 24, "note": "2 for crisp toon edges" },
    { "key": "offset", "default": 20, "min": -5, "max": 20 }
  ],
  "chain": { "position": "process", "follows": ["sdxl", "flux"], "precedes": ["fx"] },
  "gpu": { "secondsPerImage": { "1024": 3 }, "coldStart": 60, "source": "guess" },
  "variants": { "draft": 1, "final": 1, "max": 1 },
  "billing": "gpu",                  // gpu | credits — credits-billed cards cannot be reviewed for
                                     // agents until ADR-0006 has a `credits` spend kind (§6)
  "licence": "conditional",          // ok | blocked | conditional, from docs/reference/model-licences.md;
                                     // carried into every recipe step and listed at before-publish (§7)
  "gotchas": ["the atlas style prefix/suffix do nothing here: no prompt role", "…"]
}
```

Rules:
- **Who edits, and why a card review is the owner's approval.** Anyone with `blueprintPublish`
  may draft a card in Atlas Maker: the ＋ New blueprint modal gains a **Card** section (prefilled
  from the graph: `inputs` from the bound roles, `settings` from `params`, `outputs.kind` from
  `kind`, `gpu.secondsPerImage` from `director_blueprint_timings` with `source: measured` when
  there are measurements) and 🗑 Manage blueprints gains **✎ Card** on every entry. **Marking a
  card `reviewed` needs the owner's capability (`pipelineMerge`)**, because a reviewed card changes
  what agents do in every later run with no PR: the review IS the approval that SPEC rule 2 asks
  for on a blueprint change, done where the blueprint lives instead of on a branch (a branch
  cannot carry an R2-published graph; the card's `rev` + history give the revert). The technician
  may PROPOSE a card draft for a blueprint it finds useful but unreviewed, written to the run's own
  project (`<C>/<P>/director/card-proposals/<id>.json`, inside ADR-0002's write scope) for the
  owner to copy into the editor; it never writes under `_shared/`. Atlas Maker validates a card against its blueprint on save
  (`blueprints.validate_card`): every `settings[].key` is a param of that blueprint or, for a
  built-in id, a `PER_ATLAS_KEYS` / `ADV_FIELDS` key (never a global-only key); ranges sit inside
  the param's own min/max; `inputs.prompt` is not `required` on a graph with no `positive`
  binding; a `sourceImage: required` card has a `style_ref` or `shape_ref` binding.
- **A blueprint without a card in `status: reviewed` is not offered to agents.** The adapter lists
  only reviewed `image` cards; a plan naming any other id is refused by the worker's plan
  validation (§5). Publishing makes a blueprint usable by people at once and by agents only after
  the owner reviews its card.
- **Versioning.** `rev` increments on every save; the previous version is kept at
  `_shared/blueprints/<id>/card.history/<rev>.json` (create-only); the save is a compare-and-swap
  through `iw_common/docsave.py`. The card pins `graphSha` AND `mapSha`, both written by atlas-tool
  from `library_status` at save (the launcher never recomputes a digest). When either changes on a
  re-publish, atlas-tool reports the card **stale** and it counts as `draft` until re-reviewed.
  `/deleteblueprint` deletes `card.json` and `card.history/` with the blueprint. A run snapshots
  every card it uses into its recipes (`cardRev`).
- **Measured GPU seconds.** Every `job_done` carries billed seconds (#1064). The worker writes
  execution and delay seconds separately per `(effective pipeline id, genPx)` to
  `director_blueprint_timings` (rolling mean and count). The card editor shows them ("measured
  18 s exec + 40 s delay @1024, n=42") so the owner can copy a figure in and set `source: measured`.
  Agents read the card, never the table.
- **Reads.** A new atlas-tool route `GET /blueprints?kind=image` (card 8A) answers the reviewed
  cards with each blueprint's bound roles and params, the stale flag, and the endpoint's GPU
  (`RUNPOD_ENDPOINT_GPU`), so staleness and the GPU have one home. The launcher calls it with the
  same `api` launch token as every other atlas call, caches it for a minute, and the adapter
  `atlas.list_blueprints` serves it.

### 3. A new runtime agent: `atlas-technician`

| | `atlas-technician` (new) | `atlas-artist` (narrowed) | `art-director` (unchanged) |
|---|---|---|---|
| Owns | Setting Atlas Maker up and running it: per region, choose the pipeline chain from the catalogue, set settings, refs and sizes, duplicate an atlas for a scratch pass, render drafts, hand variants to the art director, derive finals from the approved pick, commit the chain's result as the template region's tile, compose, deploy | Prompts and curation: write each generate step's prompt, negative and (for `gpt_image`) edit instruction from the style pack, the mockup crop and the owner's notes; fold rejections and "Redo with my note" into the prompt | Look and approval: judge variants against the crop, palette and readability; pick one; explain; confirm the finished tile matches the pick |
| Model / effort | `claude-sonnet-5-5` / `high` | `claude-sonnet-5-5` / `medium` | `claude-sonnet-5-5` / `medium` |
| Why that model | Planning from a reviewed catalogue is retrieval plus rules, and the owner reviews the plan before any GPU spend, so a wrong plan costs a Sonnet turn, not a render. If the pilot shows plans the owner keeps correcting, raise it to Opus by editing the definition (a pipeline change with an evaluation, PLAN 5.4) | | |

**The technician's tool list** (18, inside the strict limits: Appendix A tallies 2 optional
parameters and 0 unions):

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
`atlas.set_region_prompt` (gains `gptPrompt`), `atlas.list_variants`, `mockups.get_crop` and
`run.post_activity`. The coordinator gains `atlas.list_blueprints` in its frontmatter;
`run.assign_task`'s agent enum follows the definitions.

**Hard refusals** (in the definition AND in code, each with a failing-on-purpose fixture):
- Never publish a game; never touch the math contract (ADR-0002, unchanged). The technician also
  never writes a region's rect or geometry (`x/y/w/h/rotated/bounds`): the packer's and the
  `.atlas` file's.
- **Never add a region the template does not have.** SPEC §1.2 and `coordinator.md` rule 6: a
  slot the template lacks is a pipeline change, never a silent workaround. `add_layer` and
  `remove_layer` are allowed only on a **scratch atlas** (one this run made with
  `duplicate_atlas`; the adapter checks `director_ops`), which is never packed into a template
  sheet or deployed. On a template atlas the technician fills the layer regions the template
  already has (`<base>_glow` and the like are ordinary regions to it) and requests any new one
  through the coordinator (`run.request_pipeline_change`).
- **Never delete art.** No adapter calls `/delvariants`, `/clearoutput` or `/delregion` on a
  region the run did not create; `remove_layer` never touches variant files. `/setoutput` writes
  ONE file per region (`input/refs/useroutput_<region>.png`, overwritten each call), so
  `set_output` refuses a template region that already carries an `output_override` this run did
  not write, unless the owner's checkpoint answer allows it; card 8B versions the file name
  (`useroutput_<region>_<run>_<id>.png`) so a committed tile is never overwritten in place.
- **Never switch "Run generation on".** `run_on` is a global config key; no adapter writes any
  global key, and atlas-tool refuses a `/render` from a Director token (`act.tool = 'director'`,
  `Identity.act_tool`) when `effective_run_on()` is `http`: the Director renders only on RunPod.
- **Never write the library or the global config.** No op publishes, edits or deletes a blueprint,
  a card or the shared taxonomy; `refusals.ts` gains a `library` refusal (op names with `upload`,
  `delete`, `taxonomy` or `card`, checked AFTER `READ_OP` so a future read is not caught), and the
  write-target guard refuses any key under `_shared/` and the project's `atlas_config.json`.
  `set_atlas_pipeline` sends only a positive whitelist of per-atlas keys (§4). `duplicate_atlas`
  must not switch the project's active manifest (`cfg.manifest_path`) under a Director token: an
  atlas-tool change in 8B, because `/duplicateatlas` and `/newatlas` do that today for everyone.
- **Stays within the budget.** Every GPU submit passes the worker's cap check (ADR-0006), and the
  gate refuses a `queue_variants` whose recipe step is not approved or whose projected cost would
  cross the remaining cap (§5, §6); the run pauses on the `budget` checkpoint instead.
- Never wait on a GPU job in a loop; never use a tool not in its list (unchanged). When the
  render slot is busy (`started: false`), the adapter records the wait and the worker re-wakes the
  technician when `/progress` shows the slot free: the model never retries in a loop.

### 4. New and changed Atlas adapter tools

All ops are `tool: 'atlas'`, `scope: 'project'`, and every write takes an `opId` and sends
`X-IW-Doc-Bases` for the manifest it writes (atlas-tool refuses a write to a doc absent from the
header as `unseen`). "Endpoint" is the atlas-tool route the Atlas Maker page calls; replies are
`200 text/plain` prose and the adapter parses the `✓`/`⚠`/`✖` prefix as `saveCard` does, taking the
written version from `X-IW-Doc-Versions`. Full input schemas are in Appendix A.

| Op | Agents | What it does | Endpoint | Writes | GPU |
|---|---|---|---|---|---|
| `list_blueprints` | technician, coordinator | The reviewed `image` cards, each with its blueprint's bound roles and params, plus the endpoint GPU | `GET /blueprints?kind=image` (new, 8A) | — | no |
| `set_atlas_pipeline` | technician | Set the ATLAS's pipeline, generation size and that pipeline's per-atlas settings: for a built-in id the `PER_ATLAS_KEYS` the card names; for a blueprint `bpParams[<id>]` | `POST /saveconfig?manifest=` with a positive whitelist: `atlas_pipeline` (a NEW key, 8B, stored as `manifest.settings.pipeline`, which `apply_manifest_settings` already honours; the human Settings page keeps its global `pipeline` control untouched), `gen_width`, `gen_height`, `bpParams`, and the card's `PER_ATLAS_KEYS`; everything else refused before the call | the manifest | no |
| `set_region_pipeline` | technician | A region's own pipeline override (`""` = the atlas's), fit mode and per-REGION settings: the `ADV_FIELDS` keys the card marks `scope: region` (`ipadapter_weight`, `redux_strength`, `flux_lora_strength`, `controlnet_strength`, `controlnet_end_percent`, `checkpoint`) | `GET /regionadv/<name>` then `POST /saveadv` with the FULL field set, only the named keys changed (a missing key is cleared by the route); a key the card does not name is refused | the manifest | no |
| `set_refs` | technician | A region's `style_ref` and `shape_ref`. Each is `keep`, `clear`, a Sheet Maker key (`sheets/…`, `sheet_src/…`), a rendered variant (`atlas/region/id`, copied by the adapter to `<C>/<P>/input/refs/director_<region>_<id>.png` and stored as `refs/director_<region>_<id>.png`) or the run's mockup crop (copied the same way). Any other key resolves nowhere in the render subprocess and is refused | `GET /regionadv/<name>` then `POST /saveadv` with the full field set; the copies are create-only `putObject`s | the manifest, `input/refs/director_*` | no |
| `add_layer` | technician | An AI layer (`/addlayer {base, suffix}`) or an FX layer (`/addregion {name: <base>_<mode>}` then `/setmode {name, mode}`) on a SCRATCH atlas only; FX pixels appear on `pack_sheet` | as named; the two-call FX form is resumed from the second call on a replay | the scratch manifest | no |
| `remove_layer` | technician | Remove a layer this run's `add_layer` created on a scratch atlas | `POST /delregion {name}` | the scratch manifest | no |
| `duplicate_atlas` | technician | A scratch copy of an atlas under a new name with a region tag (setup copied, results dropped, refs shared; refused on a `.atlas`-bound atlas and on an existing name) | `POST /duplicateatlas {name, prefix: tag}`; the adapter computes `regions[{from,to}]` from the `<tag>_<name>` rule | the new manifest | no |
| `queue_variants` (changed) | technician | Render regions of one atlas, `variants` each, for an APPROVED recipe step; the gate refuses when no approved step matches atlas, region, pipeline, `genPx` and `variants`, or while `art_plan` is open | `POST /render {names, variants, callback}` as today; busy → recorded wait, re-wake by code | as today | **yes** |
| `choose_variant` (changed) | technician | Make a variant the region's tile and lock it or not; round-trips `negative`, `gpt_prompt` and the replace flags (`/save` clears a blank one) | `POST /save` (the card, with `lock` and the variant's seed) | the manifest | no |
| `set_output` | technician | Commit a rendered variant (from any atlas of the project) as a TEMPLATE region's tile, verbatim, no RMBG: how a chain's last step lands on the region the game reads; refused when the region carries an `output_override` this run did not write (§3) | `POST /setoutput {name, data}` with the variant's PNG; 8B names the file `useroutput_<region>_<run>_<id>.png` | the manifest, `input/refs/useroutput_*` | no |
| `pack_sheet` (unchanged) | technician | Create Atlas on a template atlas (FX layers are rebuilt here) | `POST /createatlas` | as today | no (CPU) |
| `deploy_atlas` | technician | Deploy a template atlas's composed page: `<C>/<P>/deploy/<subpath>/<base>.{webp,atlas,json}` where the subpath comes from the manifest's `deploy_path`, else `asset-map.json`, else `sprites/`/`spines/` | `POST /deployatlas?manifest=`; refused by the adapter when the manifest's `deploy_path` is a fully-qualified key outside `deploy/` | `deploy/`, the manifest (`deploy_page_only`) | no |
| `list_regions`, `get_region`, `list_variants`, `get_variant_image`, `sheet_stats`, `comfyui.job_status` | as today, plus technician where it needs them | `get_region` also returns `pipeline`, `styleRef`, `shapeRef`, `layerOf`, `mode`, `fitMode`, `outputOverride` from the manifest | | | |

Idempotency: every write claims its `opId`. `duplicate_atlas` and `add_layer` are the creates; a
replay returns the stored result, and the routes refuse an existing name anyway. `set_refs` copies
bytes with create-only writes keyed by `(region, variant id)`, so a retry finds the copy and only
re-sends the manifest write; `set_output` is idempotent through its `opId` and, after 8B, through
the versioned file name. Conflicts: a stale base is `conflict` on every route and
the technician re-reads. A human edit always wins.

### 5. The recipe: how a region is made, on the run

`director_regions` gains `recipe_json` and `recipe_rev`. A recipe is the technician's plan for one
region, written with `run.set_recipe` (a worker tool whose input is validated in code before it is
stored) and advanced by the worker as steps run:

```jsonc
{
  "rev": 2, "region": "H1", "atlas": "symbols", "group": "Symbols",
  "plannedBy": "atlas-technician", "approved": { "by": "<user>", "at": "…", "rev": 2 },
  "steps": [
    { "n": 1, "kind": "generate", "pipeline": "sdxl", "cardRev": 3,
      "atlas": "symbols", "region": "H1", "genPx": 1024, "variants": 3,
      "settings": [{"key": "ksampler_steps", "value": "28"}, {"key": "rembg", "value": "on"}],
      "style": {"source": "mockupCrop", "value": ""}, "shape": {"source": "keep", "value": ""},
      "status": "done", "jobRef": "st_…", "chosen": "00017" },
    { "n": 2, "kind": "process", "pipeline": "birefnet", "cardRev": 2,
      "atlas": "symbols_cut", "region": "cut_H1", "genPx": 1024, "variants": 1,
      "settings": [{"key": "blur", "value": "2"}],
      "style": {"source": "variant", "value": "symbols/H1/<chosen of step 1>"},
      "shape": {"source": "keep", "value": ""}, "status": "planned" },
    { "n": 3, "kind": "finish", "pipeline": "", "atlas": "symbols", "region": "H1",
      "genPx": 0, "variants": 0, "settings": [],
      "style": {"source": "variant", "value": "symbols_cut/cut_H1/<chosen of step 2>"},
      "shape": {"source": "keep", "value": ""}, "status": "planned" }
  ],
  "projected": { "gpuSeconds": 45, "gpuUsd": 0.02, "claudeUsd": 0.09 }
}
```

- **Drafts and finals.** Drafts render at the size the art director and owner judge. The approved
  pick is the only image that is ever shipped or derived from: a final is the pick itself (drafts
  rendered at the final size, the default for symbols and UI) or a `process` step over the pick
  (an upscale or matting blueprint with the pick as `sourceImage`, or a low-denoise img2img once
  such a card is reviewed). A recipe never re-samples a region after approval: `seed`-based
  re-renders at another size give a different picture (and a locked region is skipped by
  `already_generated` anyway), so the owner would approve one image and ship another.
- **Scratch atlases.** A `process` step runs on a scratch atlas the technician makes with
  `duplicate_atlas` (regions tagged, e.g. `symbols_cut`), whose regions take the previous step's
  variant as `style_ref`; the chain's last step is `finish`: `set_output` of the scratch region's
  chosen variant onto the template region. Scratch atlases are never packed or deployed; they
  stay in the project as the run's working files.
- **Per-atlas facts the plan respects:** one pipeline, one generation size and one set of
  per-atlas settings (`PER_ATLAS_KEYS`, `bpParams`) per atlas at a time, so the technician groups
  `queue_variants` calls by (atlas, pipeline, genPx, per-atlas settings) and the validator refuses
  a step whose pipeline, size OR per-atlas settings differ between regions of one atlas; per-region
  settings (`ADV_FIELDS`) may differ and go through `set_region_pipeline`. A region with its own
  `pipeline` override renders that blueprint at its baked defaults until 8B keys `bpParams` by the
  effective pipeline.
- **Code validates a recipe before storing it:** every `pipeline` has a reviewed card (`""` only on
  `finish`); a `generate` step's card has `inputs.prompt ≠ none`; a `process` step has a source; a
  card with `inputs.sourceImage: required` gets one; `genPx` within the card's `width` range;
  `variants ≤ card.variants.max`; settings keys, scopes and ranges per the card; a `finish` step
  targets a template region and nothing else writes one; `billing: credits` cards are refused
  until ADR-0006 tracks credits; each step carries its card's `licence`; `projected` is recomputed
  by code from the cards (§6). A recipe that fails is answered
  with the reasons and not stored.
- **The owner sees recipes** at the Art plan checkpoint (§7) and on the Review panel ("How this was
  made": one line per step, the intermediate images as thumbnails, the finished tile beside the
  pick). **Owner edits travel as checkpoint payloads** (`checkpoint_resolved` with `recipeEdits`,
  or an `owner_message`), never as a page write: the worker validates them with the same rules
  module (shared with the launcher's display) and writes `rev + 1` with `editedBy` (ADR-0003's
  single-writer rule).
- **"Redo with my note"** re-runs the region from its last `generate` step with the note folded
  into the artist's prompt. A note that names a pipeline, a size or a setting goes to the
  technician, who writes `rev + 1`. **A revision after the Art plan needs re-approval when it
  changes a pipeline or raises the projected cost**; otherwise it runs and is shown.
- **Reuse.** The technician plans the first region of a group fully and copies the chain to its
  siblings. An approved group recipe becomes the template's default in a launcher table,
  `director_template_recipes` (keyed by the template project id and group; versioned, each row
  naming the run and Art plan approval it came from, revertable to the previous version), written
  by the worker only after the owner approves an Art plan. Nothing is written into the template
  project: it is a pipeline-change target (SPEC rule 2) outside ADR-0002's write scope. Before any
  row exists, the fallback default is the old preset's shape (`sdxl` at the preset's final size,
  its variants, then `birefnet`), read from `estimate-profiles.json`.

### 6. The estimate: price per chain (ADR-0006 amendment)

- **Price of a step** = (`card.gpu.secondsPerImage[genPx]` interpolated by pixel count +
  the measured mean delay per job for that pipeline, else the seed delay) × `variants` × the
  endpoint GPU's `$/s`, plus `card.gpu.coldStart` once per (atlas, pipeline) batch. Billing is
  execution plus delay (#1064), so an estimate that priced execution alone would under-count. The
  GPU is the one atlas-tool reports in `GET /blueprints` (`RUNPOD_ENDPOINT_GPU`), never a run
  setting and not a second copy in `pricing.json`; with none reported the estimate says so and the
  cap keeps its dearest-GPU fallback.
- **Price of a region** = Σ its steps + the Claude profiles per region and per variant; the
  technician gets its own lines in `estimate-profiles.json` (per run for the plan, per region per
  step). **Price of a run** = Σ regions + the per-run, per-mockup and per-checkpoint profiles.
- **Before a plan exists** (the New game screen) the estimate uses **default recipes per region
  group**: the template's stored defaults (§5) when it has them, else the `recipes` section of
  `estimate-profiles.json`, priced from the reviewed cards; a default naming an unreviewed card
  falls back to `secondsPerVariantAt1024` and sets `placeholder`.
- **After the Art plan** the run's `projected` total is recomputed from the real recipes and shown
  beside the plan. **The cap keeps failing closed (ADR-0006):** the projection for a queued render
  is the HIGHEST of the step's card seconds plus delay, the run's measured average for that
  pipeline, and `seedSecondsPerRender`; only a card with `source: measured` may lower a projection
  below the seed, a guessed card never does. The run refuses to start a batch whose projection
  crosses the remaining cap and opens the `budget` checkpoint.
- **Credits.** `gpt_image` and any API node bill comfy.org credits, outside `director_spend`'s
  `claude | runpod` kinds. Until ADR-0006 gains a `credits` kind (priced from a `comfyOrg.usdPerCredit`
  entry), a `billing: credits` card cannot be reviewed for agents, and whether the serverless
  worker can authenticate an API node at all is unverified (the `http` transport passes
  `COMFY_ORG_API_KEY`; the serverless job carries no key). Open question: sending client mockup
  crops to a third-party API needs the owner's yes.

### 7. Checkpoints

- A new checkpoint id **`art_plan`**, on by default (`checkpoints_json.artPlan`;
  `director_runs.waiting_on` accepts it; ADR-0003 amendment). **Code opens it**: when every region
  the coordinator's `run.set_plan` names has a stored recipe, the worker opens `art_plan` and no
  `queue_variants` passes the gate until it is resolved. With the checkpoint off, the plan is still
  stored and shown, and the worker marks it `approved.by = 'auto'` once its projection fits the
  remaining cap, so the gate's "approved step" rule never deadlocks. "Nothing is submitted to
  RunPod until the owner confirms" (ADR-0005) now covers the plan whenever the checkpoint is on.
- **What the owner sees:** the recipes grouped by region group and collapsed by identical chain
  ("11 symbols: sdxl 1024 ×3 → birefnet → finish"), each pipeline with its card's one-line purpose,
  the projected GPU and Claude spend against the cap, and the regions the plan skips. Actions:
  **Looks right, start rendering**; edit a chain for a group or a region (pipeline, size, variants,
  a setting within the card's range, add or remove a step), sent as `recipeEdits`; **Send my
  changes** (free text).
- **Region batches** are unchanged in shape. The Review panel adds the recipe, the step thumbnails
  and, once the chain has run, the finished tile beside the pick; the art director confirms the
  tile matches the pick before `pack_sheet`, and the owner can "Redo" it. The before-publish
  checkpoint lists every finished tile and **every step whose card's `licence` is `blocked` or
  `conditional`**, so no licence-encumbered art reaches Game Maker unnoticed.
- The Live run's five steps stay; `art_plan` is a checkpoint inside **Style pack**, so the strip
  reads Mockup breakdown → Style pack (Art plan ✓) → Regions → Build → Hand-off.

### 8. Migration and safety

- **Agent definitions.** `atlas-artist.md` rewritten (prompts and curation; tools as in §3; it
  names the recipe's pipeline so it writes the right kind of prompt: tags for `sdxl`, prose for
  `flux`, an edit instruction in `gptPrompt` for `gpt_image`, an object list for a SAM3 card).
  `atlas-technician.md` is new. `coordinator.md` plans the Art plan and gains `atlas.list_blueprints`.
  `DIRECTOR_AGENTS` in `adapter.ts` gains `atlas-technician`; the registry's allow-lists and the
  worker's `tools.ts` gain the new ops; `check:director-adapters` keeps the frontmatter ↔ allow-list
  equality and the strict-limits tally over the new agent.
- **Refusals** gain `library` (§3) with fixtures that try `atlas.upload_blueprint`,
  `atlas.delete_card`, a write under `_shared/`, a `/saveconfig` carrying `run_on` or any key off
  the whitelist, `remove_layer` on a template atlas, and `add_layer` on a template atlas, each
  refused.
- **atlas-tool pipeline changes** (card 8B, each with a Python test): a new `/saveconfig` key
  `atlas_pipeline` → `manifest.settings.pipeline` (the human page's global Pipeline control is
  untouched; the human-visible effect, that an atlas a Director run configured renders on its own
  pipeline whatever the global control says, is stated in `docs/tools/atlas-maker.md` in the same
  card and is an open question) and `bpParams` keyed by the region's EFFECTIVE pipeline; `/render`
  refuses a Director token on the `http` transport; `/setoutput` versions its file name; `/duplicateatlas` and `/newatlas` do not switch
  `manifest_path` under a Director token; `GET /blueprints` with cards, staleness and the endpoint
  GPU; card.json read / validate / save / history / delete, the modal section and ✎ Card;
  `seed_blueprints.py` and `_sync_bundled` ship `card.json`. (The doc-base checks need no change:
  every route already honours `X-IW-Doc-Bases`.)
- **Eval reference set.** `docs/director/eval/blueprints/` gets a fixture catalogue (the built-in
  and bundled cards plus two fixture-only processing cards) and `expected-art-plan.json` for the
  reference template's 23 regions. A new `prove:art-plan` fixture drives the technician's planning
  turn through the fake transport (like `prove:breakdown`) and checks the §5 rules on its output;
  it also runs under PLAN 5.4's before/after evaluation when `atlas-technician.md` or
  `atlas-artist.md` changes.
- **Build order, each card shippable and revertable alone:** 8A card schema, validation, storage,
  history, `GET /blueprints`, seed/sync of bundled cards (inert without a consumer); 8B the render
  and duplicate safety changes, `atlas_pipeline`, `bpParams` by effective pipeline, versioned
  `/setoutput`; 8D the technician, the adapter ops, recipes, validation, gate, refusals,
  `prove:art-plan`, the idle-deploy check, with the old preset as the fallback default recipe; 8E
  the Art plan checkpoint UI, "How this was made", chain pricing and timings; 8C LAST: the Preset
  UI out and `preset_json` unread; 8F drops the column.
- **No current game changes.** Everything here is launcher, worker, docs and atlas-tool paths a
  human render never takes (a Director token is the only thing that triggers the new refusals and
  `settings.pipeline` is inert until a manifest carries it). The current-games harness passes
  without a render.

## Consequences

- One new agent, one new checkpoint, `recipe_json` / `recipe_rev` on `director_regions`, one new
  table (`director_blueprint_timings`), `preset_json` first unread then dropped, eleven new or
  changed adapter ops, a `card.json` per pipeline id with an editor in Atlas Maker, and the
  atlas-tool changes listed in §8.
- The owner reviews a plan before paying for it and corrects it in the tool's own terms.
- A newly published blueprint is invisible to agents until its card is reviewed: the library can
  grow without the agents' behaviour changing under a run.
- The estimate becomes honest: measured seconds per pipeline and size, or a flagged guess.

## Needs owner approval

- Removing the Preset (and the GPU choice) from the New game screen; per-template default recipes
  replace "Save as preset".
- `card.json` as the agents' only source of blueprint knowledge, edited in Atlas Maker, and the
  rule that an unreviewed or stale card hides its blueprint from agents.
- `atlas-technician` on Sonnet 5.5 at high effort, with the tool list and refusals above; layers
  only on scratch atlases.
- The Art plan checkpoint, on by default; re-approval when a revision changes a pipeline or raises
  the cost.
- Finals are the approved pick or derived from it, never re-sampled.
- Credit-billed blueprints excluded until ADR-0006 tracks credits; third-party API use of mockup
  crops is the owner's call.
- Marking a card `reviewed` needs `pipelineMerge` and counts as the owner's approval of that
  blueprint for agents.
- Default recipes live in `director_template_recipes`, never in the template project.
- The `atlas_pipeline` key: an atlas a run configured renders on its own pipeline regardless of the
  global Settings control.
- The idle-deploy rule for the technician card (no run non-terminal).

## Amendments to earlier ADRs (take effect when this ADR is approved)

- **ADR-0003:** checkpoint ids and `waiting_on` gain `art_plan`; `checkpoints_json` gains
  `artPlan`; `director_regions` gains `recipe_json` / `recipe_rev`; owner recipe edits are
  `checkpoint_resolved` / `owner_message` payloads the worker applies; `director_runs.preset_json`
  is unread, then dropped by a later card.
- **ADR-0005:** "nothing is submitted to RunPod until the owner confirms" covers the Art plan.
- **ADR-0006:** the estimate prices chains from cards (§6); the GPU comes from atlas-tool, not a
  run setting; the cap projection prefers a step's card seconds; `budgetCapUsd` is set at create
  and copied from Settings at start only when null; a `credits` spend kind is a prerequisite for
  credit-billed cards.
- **SPEC §1.1:** the Preset bullet is replaced by the Budget cap and the Art plan checkpoint.

## Appendix A — Technician tool schemas and the strict-limit tally

Every object is closed; `base` is `{etag, rev}` as today. "n/a" values are `""` or `0`, never
omitted, so no field is optional unless marked. Union-typed fields are avoided: a ref is a
`source` enum plus a `value` string.

| Tool | Input (all required unless `?`) | Optional | Unions |
|---|---|---|---|
| `atlas.list_blueprints` | `{}` | 0 | 0 |
| `atlas.list_regions` (existing) | `{atlas?}` | 1 | 0 |
| `atlas.get_region` | `{atlas, region}` | 0 | 0 |
| `atlas.set_atlas_pipeline` | `{atlas, pipeline, genPx, settings: [{key, value}], base}` | 0 | 0 |
| `atlas.set_region_pipeline` | `{atlas, region, pipeline, fitMode, settings: [{key, value}], base}` (`""` = inherit / default; `settings` keys = the card's `scope: region` keys) | 0 | 0 |
| `atlas.set_refs` | `{atlas, region, style: {source, value}, shape: {source, value}, base}` with `source ∈ keep, clear, key, variant, mockupCrop` | 0 | 0 |
| `atlas.add_layer` | `{atlas, base, suffix, kind, mode}` (`kind ∈ ai, fx`; `mode` `""` for `ai`) | 0 | 0 |
| `atlas.remove_layer` | `{atlas, name, base}` | 0 | 0 |
| `atlas.duplicate_atlas` | `{atlas, name, tag}` | 0 | 0 |
| `atlas.queue_variants` | `{atlas, regions[], variants, step}` (`step` = `<region>#<n>`) | 0 | 0 |
| `atlas.list_variants` | `{atlas, region}` | 0 | 0 |
| `atlas.choose_variant` | `{atlas, region, id, lock, base?}` | 1 | 0 |
| `atlas.set_output` | `{atlas, region, from: {atlas, region, id}, base}` | 0 | 0 |
| `atlas.pack_sheet` | `{atlas}` | 0 | 0 |
| `atlas.deploy_atlas` | `{atlas}` | 0 | 0 |
| `comfyui.job_status` | `{jobRef}` | 0 | 0 |
| `run.set_recipe` | `{region, atlas, group, steps: [{n, kind, pipeline, atlas, region, genPx, variants, settings: [{key, value}], style: {source, value}, shape: {source, value}, note}]}` | 0 | 0 |
| `run.post_activity` | `{text}` | 0 | 0 |
| **Total: 18 tools** | | **2** | **0** |

`settings` values are strings coerced by code from the card's declared type; `pipeline` is a
string the gate checks against the reviewed cards (`""` only where the table says).

**Coordinator:** 10 tools today plus `atlas.list_blueprints` = 11, adding 0 optional parameters
and 0 unions to its request.
