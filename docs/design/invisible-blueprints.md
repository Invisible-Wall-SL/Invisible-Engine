# Invisible Blueprints — Design (v1, planned)

Shareable ComfyUI workflows ("blueprints") for the pipeline. A blueprint is a saved
generation network: the ComfyUI graph + a small binding descriptor + a list of the
models it needs. Anyone can upload one, everyone can see it, and selecting it in the
Atlas Maker means "generate with this network" — with the required models
auto-downloaded into the local ComfyUI first.

> Status: **not built.** This is the scoped plan. Decisions locked (2026-06-04):
> model download via **ComfyUI-Manager API**, authoring via **API-JSON export + a
> binding step**, scope is a **single global library visible to everyone**.

## 1. Why this is net-new

Three facts about today's pipeline (see the file refs in §8) shape the whole design:

1. **Workflow graphs are hardcoded Python dicts**, not loaded files. `batch_atlas.build_workflow` / `build_workflow_flux` / `build_workflow_gpt` emit fixed graphs with fixed node IDs (e.g. SaveImage is always node `"17"`, refs are uploaded to specific `LoadImage` nodes). An arbitrary user-uploaded graph has none of those IDs — so a blueprint must carry a **binding** that maps semantic roles (positive prompt, seed, style-ref, output…) to its own node IDs/fields.
2. **There is no model-download path anywhere.** The only mechanism today is "drop the file into ComfyUI's `models/` dir and restart"; `preflight_models` just *checks* the live `/object_info` enums and errors if a named model is missing. Auto-install is brand new and crosses the cloud→local boundary — the tunnel exposes only ComfyUI's HTTP API, not its filesystem.
3. **Sharing already has a precedent.** `_shared/spines/` is a global, cross-project R2 prefix every authed user can read (`toolScope.ts`). The blueprint library copies that exactly — no per-user ACLs.

## 2. What a blueprint is

A blueprint is a directory in R2 under a global prefix:

```
_shared/blueprints/<blueprint-id>/
  blueprint.json     # manifest: metadata + bindings + model requirements
  workflow.json      # the ComfyUI graph in API-prompt format (what we POST to /prompt)
  thumb.png          # optional preview (a sample output)
```

`<blueprint-id>` is an `r2_slug` of the name (lowercase, non-alphanumerics → `_`), the
same slug rule already used for client/project keys.

### `blueprint.json` shape

```jsonc
{
  "version": 1,
  "id": "sdxl_painterly_v2",
  "name": "SDXL Painterly v2",
  "description": "Soft painterly look, IP-Adapter style ref + Canny shape ref.",
  "author": "gualt",          // launcher username, stamped server-side
  "createdAt": "2026-06-04T...",
  "base": "sdxl",             // sdxl | flux | gpt_image — picks the ref/output conventions

  // Maps semantic roles → where they live in workflow.json.
  // role -> { node: "<id>", field: "<input name>" }
  "bindings": {
    "positive":   { "node": "6",  "field": "text" },
    "negative":   { "node": "7",  "field": "text" },
    "seed":       { "node": "10", "field": "seed" },
    "width":      { "node": "5",  "field": "width" },
    "height":     { "node": "5",  "field": "height" },
    "style_ref":  { "node": "12", "field": "image" },  // a LoadImage node
    "shape_ref":  { "node": "14", "field": "image" },  // optional
    "output":     { "node": "17" }                      // the SaveImage node
  },

  // OPTIONAL exposed parameters ("general settings"): tunable knobs the author
  // surfaces, beyond the fixed roles above. Each carries a baked DEFAULT (the
  // "general setting"), renders as an editable control in the Atlas Maker
  // Settings panel when the blueprint is selected, and drives ONE node input.
  // A param key must NOT collide with a binding role / another param key, and a
  // param must NOT target a (node, field) already driven by a binding.
  // type: int | float | text | bool | select.
  "params": [
    { "key": "steps", "label": "Steps", "type": "int",
      "default": 30, "min": 1, "max": 150, "step": 1,
      "node": "10", "field": "steps", "group": "General" },
    { "key": "sampler_name", "label": "Sampler", "type": "select",
      "default": "dpmpp_2m", "options": ["euler", "dpmpp_2m"],
      "node": "10", "field": "sampler_name" }
  ],

  // What ComfyUI must have installed for this graph to run.
  // Each entry: where it goes + where to fetch it from.
  "models": [
    {
      "field": "ckpt_name",            // matches a /object_info dropdown field
      "filename": "sdxlPainterly_v2.safetensors",
      "dir": "checkpoints",            // ComfyUI models/<dir>/
      "source": "https://huggingface.co/.../sdxlPainterly_v2.safetensors",
      "sha256": "…",                   // optional, for verify
      "size": 6938040714               // optional, for progress
    },
    { "field": "lora_name", "filename": "painterly.safetensors", "dir": "loras", "source": "..." }
  ]
}
```

The `bindings` are the contract that lets a *generic* runner drive any graph: fill
`positive`/`negative`/`seed`/`width`/`height`, upload refs to the `style_ref`/`shape_ref`
`LoadImage` nodes, set the `output` node's `filename_prefix` to the project prefix, then
submit. This replaces the per-pipeline hardcoded builders for blueprint runs.

## 3. Authoring / upload flow

ComfyUI exports a graph two ways: the editor `workflow.json` (UI positions) and the
**API format** (the node dict we already POST to `/prompt`). We need the API format.

1. **User builds & tests** the network in their local ComfyUI, then exports it in API
   format (Settings → "Save (API Format)", or the dev "Save API" button).
2. **Upload in the pipeline:** new Atlas Maker page/panel `Blueprints → New`. User picks
   the `workflow.json`, gives it a name/description, and picks `base` (sdxl/flux/gpt).
3. **Binding step (the new UI):** the importer parses the graph, lists every node with
   its `class_type`, and asks the user to point each role at a node:
   - candidate filtering helps — only `CLIPTextEncode` nodes offered for `positive`/`negative`, only `LoadImage` for refs, only `SaveImage` for `output`, only nodes with a `seed`/`noise_seed` field for `seed`.
   - *Convention shortcut (future):* if the author titled nodes `IW:positive`, `IW:output`, etc. in ComfyUI, pre-fill the bindings automatically and let them confirm.
4. **Model detection:** the importer scans the graph for model-loading fields
   (`ckpt_name`, `lora_name`, `vae_name`, `control_net_name`, the FLUX `unet`/`clip`/`vae`
   set, etc. — the existing `MODEL_FIELDS` map is the seed list) and lists each filename.
   For every one the user supplies a **source URL** (HF/Civitai) and target `dir`. Files
   already present in the live ComfyUI `/object_info` enums are flagged "installed" and the
   URL becomes optional.
5. **Save:** server writes `workflow.json` + `blueprint.json` (+ optional `thumb.png`) to
   `_shared/blueprints/<id>/` and pushes to R2. Visible to everyone immediately.

## 4. Model auto-download (ComfyUI-Manager API)

Locked approach: drive **ComfyUI-Manager's** model-install endpoints over the existing
tunnel. Manager runs inside ComfyUI, so it writes to the correct local `models/<dir>/`
and exposes an HTTP API we can already reach (same base URL + CF Access headers as every
other ComfyUI call).

**"Prepare blueprint" step** (runs before/at generate time):

1. Read the blueprint's `models[]`.
2. For each, check the live `/object_info` enum for its `field` (reuse `batch_atlas._available`). If the `filename` is already listed → installed, skip.
3. For each missing model, POST to Manager's model-install endpoint with the `source`
   URL + target `dir`/`filename`. (Exact route to confirm against the installed Manager
   version — historically `/customnode/...` / `/manager/...` style endpoints; verify and
   pin the version. This is the **one external dependency to nail down in a spike**.)
4. Poll Manager for download progress; surface it in the same diagnostics/progress panel
   `run_render` already streams into.
5. ComfyUI only scans `models/` at startup → after installs, trigger a **rescan/restart**
   (Manager has a reboot endpoint) and re-check `/object_info` until all `models[]` resolve.
6. Only then submit the generation. If any model can't be fetched, fail with a readable
   checklist (filename + dir + source) — the same shape as today's `preflight_models` error.

**Caching:** installs are idempotent — once a model is in the local `models/` dir it shows
up in `/object_info` forever, so the prepare step is a near-instant no-op on subsequent
runs. Downloads happen once per machine.

**Boundary note:** this assumes ComfyUI-Manager is installed in the user's local ComfyUI.
That becomes a documented pipeline prerequisite (add to `docs/ONBOARDING.md` / the ComfyUI
launcher setup). No new local process is required beyond Manager itself — that's why this
beat the "local downloader companion" option.

## 5. Atlas Maker integration

The blueprint picker lives at the top of the Settings panel, next to the existing
`pipeline` selector (`ui_server.py` `PIPELINE_OPTIONS` / the `"all"` group).

- **Blueprint dropdown** lists `_shared/blueprints/*` (id + name + thumb). Default option
  is "Built-in pipeline" (today's behaviour, unchanged).
- **Selecting a blueprint** sets `manifest["settings"].blueprint = "<id>"` (saved via
  `/saveconfig`, same plumbing as other settings). It hides the per-field model `<select>`s
  (the blueprint pins its own models) but keeps prompt/seed/size/refs editable.
- **Generate** (`/render` → `run_render` → `batch_atlas.py` subprocess) branches: when a
  blueprint is set, instead of `build_workflow_*` it loads `workflow.json`, runs the
  **prepare** step (§4), applies the **bindings** (§2) to inject prompt/seed/size/refs and
  the project output prefix, then submits through the existing `run_region` submit/poll/
  `_persist_variant` path. Output lands in `<client>/<project>/batch/...` exactly as now.

So the blueprint changes *which graph* and *which models* — nothing downstream
(persistence, compose, slice, R2 layout) changes.

**Exposed-param controls (Phase 8).** When the active pipeline is a blueprint
that declares `params[]`, the Settings panel grows a **"Blueprint settings"**
section rendering each param as the right control (number / text / checkbox /
select). Values persist per-manifest, **namespaced by blueprint id**
(`manifest.settings.bpParams.<blueprintId>.<key>`) through the existing
`/saveconfig` path, so switching blueprints never cross-contaminates. The
authoring modal ("＋ New blueprint") gains an **"Exposed settings"** step where
the author picks a node + scalar/enum input (filtered to inputs NOT already
bound as a role), a type, label, default, and bounds/options. At generate time
the generic runner sets each param's effective value (per-manifest override,
else the baked default) onto its bound node input.

## 6. Sharing / auth

- Storage: one global `_shared/blueprints/` prefix, mirroring `_shared/spines/`.
- Launcher: add an opt-in `includeBlueprints` flag to `ScopeOptions` in `toolScope.ts`
  and allow-list the prefix (read for everyone; write gated to roles that may publish).
- The Atlas Maker already trusts the launcher's role/project gate; it just needs read
  access to the shared prefix in its R2 hydration (extend `cloud_paths` lazy subtrees to
  pull `_shared/blueprints/` alongside the project tree).
- Publishing (upload/overwrite/delete a blueprint) is the only write path — gate it behind
  a role permission (e.g. `blueprintPublish`) so the library doesn't get clobbered.

## 7. Build plan (phased)

1. **Spike — ComfyUI-Manager model install.** Confirm the installed Manager version's
   model-download + reboot endpoints over the tunnel; install one model end-to-end and
   verify it appears in `/object_info` after a rescan. *De-risks the whole feature.*
2. ✅ **Blueprint format + storage.** *(DONE 2026-06-06, built-in scope.)* `blueprint.json`
   defined + validated in `services/atlas-tool/blueprints.py` (loader: `list_blueprints` /
   `get_blueprint` / `blueprint_exists`); `_shared/blueprints/<id>/` layout + a `seed`-style
   uploader (`seed_blueprints.py`) mirroring the tracked `blueprints_src/` source; hydration
   of the shared prefix is in `blueprints.hydrate()` (once-per-process, incremental, lazy on
   first access). `toolScope.ts` allow-list (read for everyone) is **deferred to phase 7**
   (write/publish gating) — read works today because the tool hydrates R2 directly.
3. ✅ **Generic graph runner.** *(DONE 2026-06-06.)* `batch_atlas.build_workflow_blueprint(region,
   style, blueprint) -> (wf, output_node_id)` (`:1154`, helper `_set_node_input` `:1136`)
   injects via bindings (reusing `_resolve_text`) and reuses the existing
   `_upload_workflow_refs` + submit/poll/`_persist_variant` path; `run_region` (`:1598`)
   dispatches to it for a non-built-in `pipeline` id and reads the result from
   `bindings.output.node` (generalizing the hardcoded `"17"`). Bindings injection
   unit-tested against the seeded `sdxl` graph.
4. **Prepare step.** Implement model check + Manager install + rescan loop (§4), with
   progress streamed into the existing diagnostics panel and the readable-failure checklist.
5. **Atlas Maker UI — pick & generate.** Blueprint dropdown in Settings; wire selection
   into `/saveconfig` and the `/render` branch.
6. **Atlas Maker UI — upload & bind.** The `Blueprints → New` page: API-JSON upload, the
   binding step, model-source entry, save to R2.
7. **Publish gating + docs.** Role permission for publishing; ONBOARDING note that local
   ComfyUI needs ComfyUI-Manager; STATUS update.
8. ✅ **Blueprint exposed params / "general settings"** *(DONE-code 2026-06-14,
   live-verify owed.)* Strictly-additive follow-on: a blueprint may declare an
   OPTIONAL `params[]` array — author-tunable knobs (steps/cfg/sampler/denoise/
   any node input) each carrying a baked DEFAULT (the "general setting").
   - `blueprints.py` parses + validates `params[]` (`_validate_params`; node/field
     existence checked in `validate_against_graph`); rejects key↔role / key↔key
     collisions and double-driving a binding's (node, field). `get_blueprint` /
     `list_blueprints` surface `params`.
   - `batch_atlas.build_workflow_blueprint(region, style, blueprint, overrides=None)`
     applies each param's effective value (per-manifest override else default,
     coerced by type) onto its bound node input AFTER the role bindings;
     `run_region` threads `BP_PARAM_OVERRIDES` (resolved in `main()` from
     `manifest.settings.bpParams[<activeBlueprint>]`). A blueprint with no
     `params`, and the built-in Python paths, are byte-identical.
   - **Graceful fallback** (`_effective_param_value`): a bad user value never
     reaches the node (no opaque remote-ComfyUI prompt rejection) — an override
     that won't coerce to the declared `type` falls back to the param `default`,
     numeric values are clamped into `min`/`max`, and a `select` value outside
     `options` falls back to the `default`. If even the default is unusable the
     node input is left at the graph's baked value (never garbage). The bool
     generate-time control carries a blank "— default —" option so a saved bool
     can be unset like every other type (the save path drops blanks).
   - `ui_server.py`: the "＋ New blueprint" modal grows an "Exposed settings"
     authoring step (`addBpParam`/`collectBpParams`), `_uploadblueprint` persists
     `params[]`; the Settings panel renders the active blueprint's params
     (`renderBpParams`/`saveBpParams`) and `_saveconfig` merges
     `settings.bpParams[<id>]` (namespaced). Seeded `blueprints_src/sdxl` carries
     steps/cfg/sampler_name as a worked example; `blueprints_src/README.md`
     documents the schema.
   - **Verify owed (owner-side):** seed (`py seed_blueprints.py`) + restart, then
     a live generate THROUGH the `sdxl` blueprint id with a changed `steps`/`cfg`
     to confirm the override lands on the KSampler in the remote ComfyUI graph.

Phases 1–3 are the backbone; 4–5 make it usable; 6–7 make it self-serve and safe;
8 lets a blueprint expose its own tunable settings.

> **Backbone status (2026-06-06):** phases **2–3 DONE** for BUILT-IN pipelines
> (`services/atlas-tool/blueprints.py`, `batch_atlas.build_workflow_blueprint`, the
> `blueprints_src/{sdxl,flux,gpt_image}/` reference set, `seed_blueprints.py`,
> `blueprints_src/README.md`). Phase **1** (ComfyUI-Manager model-download spike) is
> still the next external unknown — `blueprint.json.models[]` is read-only metadata
> until then. Phases **4–7** unbuilt. Code is in the working tree, uncommitted.

## 8. Anchor points in current code

- Generation engine / graph builders: `services/atlas-tool/batch_atlas.py`
  (`build_workflow` `:1213`, `build_workflow_flux` `:1405`, `build_workflow_gpt` `:1001`,
  `build_workflow_blueprint` `:1154`, `_set_node_input` `:1136`, `run_region` `:1598`,
  `_persist_variant` `:1683`, `_available` `:666`, `preflight_models` `:692`,
  `_DEFAULTS` `:41`). Blueprint loader: `services/atlas-tool/blueprints.py`
  (`list_blueprints`, `get_blueprint`, `blueprint_exists`, `hydrate`). Seeder +
  reference set: `services/atlas-tool/seed_blueprints.py`, `blueprints_src/`.
- ComfyUI HTTP client: `services/_shared/iw_common/comfy.py` (`submit_prompt`,
  `wait_images`, `fetch_image`, `upload_image`) and the stdlib twins in `batch_atlas.py`.
- UI: `services/atlas-tool/ui_server.py` (`/render` `:2923`, `run_render` `:1416`,
  `MODEL_FIELDS` `:383`, `PIPELINE_OPTIONS` `:423`, `/saveconfig` `:2921`, `_gate` `:2748`).
- R2 + prefixes: `services/_shared/iw_common/storage.py`, `context.py`
  (`r2_slug`/`project_prefix`), `services/atlas-tool/cloud_paths.py` (hydration),
  `seed_r2.py` (seeder precedent).
- Sharing precedent + launcher scope: `apps/launcher-api/src/lib/server/toolScope.ts`
  (`_shared/spines/`, `allowedPrefixes`, `ScopeOptions`), `r2.ts`,
  `apps/launcher-api/src/routes/(app)/atlas/+page.server.ts` (role gate + handoff).
- Backend reference (dormant, but cleaner graph injection example):
  `services/atlas-backend/workflows.py` (`sdxl_region`, `_resolve_text`), `app.py`
  (`/generate-region`).

## 9. Open questions / risks

- **Manager API surface** (phase 1 spike): exact endpoints + version pinning; behaviour if
  Manager isn't installed (clear error + setup link).
- **Download auth:** Civitai/gated-HF models may need a token. v1 = public URLs only;
  later, per-user tokens stored launcher-side and passed to the prepare step.
- **Restart cost:** a rescan/reboot interrupts in-flight work on the user's local ComfyUI.
  Prepare should batch all installs, then reboot once.
- **Graph drift:** if a blueprint's `base` conventions (ref node count, output node) don't
  match what the runner expects, generation fails — the binding step must validate required
  roles are mapped before saving.
- **Large files:** multi-GB checkpoints over a home connection — show size/progress and let
  the user pre-warm (run prepare without generating).
