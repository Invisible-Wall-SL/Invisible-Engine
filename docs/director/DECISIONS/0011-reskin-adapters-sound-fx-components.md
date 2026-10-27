# ADR-0011 — Reskin adapters: Sound, FX and Component Editor art

- **Status:** proposed
- **Date:** 2026-10-27
- **Scope:** PLAN card 9H. The smallest set of adapter ops that lets a run re-point what a template
  already has at new sounds, new particle art and new art inside components. Nothing here adds a
  screen, an effect, a layer, a component, a node or a sound slot.
- **Builds on:** ADR-0002 (adapters), ADR-0006 (estimate), ADR-0009 §"Adapters missing for a reskin"
  and §4 last bullet. Shader Graph tints and Characters stay later cards.

## Context

- **Sound.** `<client>/<project>/sounds/sounds.json` (`soundsStorage.ts`) holds the library
  (`entries`) and the choices (`bindings`: `slots`, `symbols`, `anticipation`, `winTiers`;
  `engine-layout/soundLibrary.ts`). A doc with no `bindings` block falls back, whole-doc and one-way,
  to the legacy homes in the config and symbols docs (`effectiveSoundBindings`). The first save
  writes the block, and the fallback never runs again. `saveSoundsDoc(…, baseEtag)` takes no
  `savedBy`. It keeps no backups. `loadSoundsDocWithEtag` turns an unparseable doc into an empty
  library that still carries an etag, so a write on top of it would wipe the library.
- **Publish gate gap (found in this review).** `soundPublishCheck.ts` collects bound names from
  config, symbols and flow only (`collectSoundBindings`, `soundUsage.ts:155`). It never reads
  `SoundsDoc.bindings`, so since S10 a draft chosen in `/sound` would not block a publish. This is a
  Sound pipeline bug. 9H does not fix it, but it designs around it (§1).
- **FX.** Each effect is `<client>/<project>/<id>.fx.json` (`fxStorage.ts`). A layer's `art` holds
  `assetKey` (a manifest key under `manifests/`, the `/fx` picker's list), `frames` and `weights`.
  `config` is `EmitterConfigV3` verbatim. `saveEffect(…, baseEtag)` takes no `savedBy`, and it
  writes the `.fx.meta.json` sidecar unconditionally with whatever meta it is given. A corrupt doc
  loads as an empty effect that still has an etag.
- **Components.** Precedence is project (`editor/<slug>/components/`) ◁ shared
  (`_shared/editor-components/`) ◁ built-in (`componentStorage.ts`). Placement pins by default: the
  editor sets `componentVersion: def.version` (`editor/+page.svelte:851`). A changed save bumps
  `version` and keeps `<id>.v<N>.json` snapshots, so instances pinned to the old version keep its
  old art. The bake honours only top-level scene pins; a pin nested in a def draws latest
  (component-editor status, open item 2). `saveComponent` takes no `savedBy`, and it keeps unknown
  fields (`withUnknownComponentFields`), so a stray `saved_by` would bump the version. The
  project's component prefix lies outside the gate's `allowedPrefixes` (`toolScope.ts:41`), which
  allows `<client>/<project>/` only.
- **Limits** (`check-director-adapters.ts` ~3875: ≤20 tools, ≤24 optional, ≤16 unions):
  - builder today: 9 tools, 14 optional (`get_layout` 1, `update_nodes` 8, `bake_from_ttf` 5), 0 unions;
  - animator today: 7 tools, 14 optional (`rebind_attachments` 1, `list_clips` 1, `save_clip` 4,
    `set_state` 8), 0 unions.

## Decision (proposed)

Six ops, all through the tools' own storage modules with `baseEtag`. Each read returns the doc and
`baseEtag`, and each write takes `baseEtag` back. On a 409 the agent re-reads (ADR-0002). Every
name passes `refusedOp`: none contains a math, role, library, rect, delete or add word.

### 1. Sound: builder

**`sound.get_doc {}`** (0 optional) returns:
- `library`: name, kind, status, origin and loop for each entry;
- `builtin`: `soundOptionsFor(doc)`'s music and sfx lists;
- `moments`: what the `/sound` loader offers this project, built with the same helpers
  (`SOUND_SLOTS` with kind and defaults, `symbolsInPlay` × `symbolCueStates`, the token ids ×
  `TOKEN_SOUND_MOMENTS`, `winLevels` aliases). Move `symbolCueStates` out of `sound/+page.server.ts`
  into `$lib` so the page and the op share it;
- `bindings`: the effective bindings;
- `migrated` (whether `doc.bindings` exists) and `baseEtag`.

**`sound.set_cues { cues: [{ path, names[] }] ≤64, baseEtag }`** (0 optional). `path` is one of
`slots.<slotId>`, `symbols.<symbol>.<state|tokenMoment>`, `anticipation.activation|loop` or
`winTiers.<alias>.sfx|bgm`. It refuses, listing each refused cue with its reason, when:
- the path is not one of `moments` (no new slot, symbol row or tier);
- the number of names is wrong: a `single` slot and every non-slot path take exactly 1 name, a
  `ladder` takes 1–16;
- a name is not in `builtin` or in the library. A music bed (`baseMusic`, `freeSpinMusic`,
  `winTiers.*.bgm`) takes music names; everything else takes sfx names;
- a library entry is a `draft`. Agents never approve a sound, and the gate gap above would let a
  draft ship. Built-ins are always allowed;
- a slot is `enabled: false`. A person silenced it, and the agent does not undo that.

The write keeps a slot's `volume` and `enabled`. Names equal to the catalogue defaults are stored
as no `names`, which is what the page does. **Migration:** when `doc.bindings` is absent, the
handler first sets the block to `effectiveSoundBindings(doc, legacy)`, read exactly as
`soundExport.ts` `resolveBindings` reads it, and then applies the cues. A first Director save
therefore never drops a legacy choice. The result says `migrated: true`, and the legacy docs are
only read. **Corrupt doc:** add a `corrupt` flag to `loadSoundsDocWithEtag`'s return (additive, the
same as `loadSymbolsDocWithEtag`). The op answers 409 `unreadable_doc`. **No backups:** the result
carries `before` (the old value at each changed path), and `director_ops` stores it, so the change
can be reverted by hand. Writes: `soundsDocKey`.

### 2. FX: animator

**`fx.get_effect { id? }`** (1 optional):
- with no id, it returns `listEffects` plus the project's atlases (manifest key and label, as the
  `/fx` loader builds them);
- with an id, it returns each layer's `key`, `particleKind`, `art` (`assetKey`, `frames`, `weights`,
  `animated`), its colour behaviours (`behaviors[i]` of type `color`, with their stop values, or
  `colorStatic`), the leaves an exposed param drives, `locked` (below) and `baseEtag`.

**`fx.update_art { id, layers: [{ layer, assetKey, frames[], weights?, colors?: [{ behavior,
values[] }] }] ≤16, baseEtag }`** (2 optional). `assetKey` and `frames` are required, so the agent
re-sends them when it only recolours. Allowed changes:
- **`assetKey`** must be a manifest under `SUB.manifests(client, project)` that `loadRegionSet`
  resolves with regions and a page. These are the `/fx` picker's rules. The bake's
  dangling-key check (`effectExport.ts` `referencedAssetKeys`) is the backstop.
- **`frames`**: 1–64 names, each a region of that atlas. The count may change. `animated`,
  `framerate` and `loop` are kept.
- **`weights`**: kept when the frame count is unchanged. When the count changes on a layer that has
  weights, new weights are required, one per frame and each above 0. Otherwise the layer is
  refused, so a mix never turns uniform without anyone noticing.
- **`colors`**: `behavior` indexes `config.behaviors`. A `color` behaviour takes exactly one value
  per existing stop, and the stop times stay. A `colorStatic` behaviour takes exactly 1 value.
  Values are `#rrggbb`, written in the form the stored values use. A behaviour that an
  `EffectParam` drive targets is refused, because the param owns that value.

The handler changes only those leaves. A fixture deep-compares everything else, which is never
written: emitter fields, other behaviours, `placement`, `trigger`, `material` (Shader Graph tints
are a later card), `spineParticle`, `params`, the layer list and its order, the name and the id.
It refuses:
- a `spine` layer (rig particles belong to the Rigger);
- an id that is not already `r2Slug(id)`;
- a doc with an etag and no layers (409 `unreadable_doc`);
- an effect placed by a `kind:'effect'` node that scene's `lockOf` locks.

The handler passes the loaded meta back to `saveEffect`, so a person's camera survives. The result
carries `before` for each layer. Writes: `fxDocKey`, `fxMetaKey`.

### 3. Component Editor art: builder (second branch of 9H)

**`components.get_def { id? }`** (1 optional):
- with no id, it lists every def reachable from the project's scenes (top-level instances plus the
  def closure, `collectComponentIds`). For each: scope (project, shared or built-in), latest
  version, the instances with screen, node and pin, and `locked`;
- with an id, it returns the def's re-skinnable nodes inside `def.root` (id, kind, `assetKey`,
  `region`, `skin`, `clipId`, `paramBound`), `pins` (each top-level instance and whether a write
  reaches it), `baseEtag` (the project def's etag, or `new` when the winner is shared or built-in)
  and `layoutBaseEtag`.

**`components.update_art { id, changes: [{ node, assetKey?, region?, skin?, clipId? }] ≤64,
baseEtag, layoutBaseEtag }`** (4 optional). The fields and rules are `scene.update_nodes`'s
`SKINNABLE` table: a sprite takes `assetKey` and `region`, a rig `assetKey` and `skin`, a flipbook
`clipId`. That table moves with `lockOf`, `ownMathBinding` and `defLoader` from `scene.ts` into
`ops/mathLock.ts`; it is moved, not rewritten. The op never touches tint, text style, `params`,
`inputs` or signals, `stateMachine`, `events` or `on`, timelines, transforms, slots, or node
add/remove/reorder.
- **Refused:**
  - the whole def, when any instance whose closure holds it is locked by `lockOf` (bound to the
    math, on a math or mode screen, or editor-locked). This is the same rule as scene, so a
    component on the bet screen is never re-skinned;
  - a node field bound to a param (`paramBindings`), because the instance's param decides that art
    and params are out of scope. It is listed;
  - a foreign rig, refused by `saveComponent`'s own `healForeignRigRefs`, answered as 400.
- **Scope:** a project def is saved in place. A shared or built-in def is written as a **project
  copy under the same id, keeping its version**, with `baseEtag` `new`, exactly as the editor's
  `componentSaveRequest` does. `_shared/` is never written, and the `library` refusal still holds.
- **Pins:** after the def save, the handler re-pins in `scenes.json` each top-level instance pinned
  at a version `p` that differs from the saved version `v`, but only when snapshot `p` and the new
  def differ in nothing except these four art fields (`artOnlyDiff`, which ignores version, name and
  guides). It writes through `editorStorage.saveDoc` with `layoutBaseEtag` and `ctx.savedBy`, so
  the layout keeps a backup. Instances pinned at a version a person changed in other ways are
  listed as `notReached` and left alone. Unpinned instances already follow latest. The op is
  retry-safe: if the layout save loses after the def saved, it answers 409. The agent re-reads and
  sends the same changes again. The def's content is now equal, so it does not bump again, and the
  re-pin runs.
- **Gate:** for `op.tool === 'components'` only, `refusedWrite` adds `projectComponentsPrefix
  (projectKey)` to the allowed prefixes. The create guard already counts `editor/<slug>/` as the
  project's own tree (`gate.ts`). Writes: `projectComponentKey`, `projectComponentsPrefix` (the
  snapshot), `editorDocKey` and the editor backup prefix.

### 4. Agents and limits

| Agent | Adds | Tools | Optional | Unions |
|---|---|---|---|---|
| builder | `sound.get_doc`, `sound.set_cues`, `components.get_def`, `components.update_art` | 13 / 20 | 19 / 24 | 0 / 16 |
| animator | `fx.get_effect`, `fx.update_art` | 9 / 20 | 17 / 24 | 0 / 16 |

The edits to `builder.md`, `animator.md` and `coordinator.md` (tools, outputs, Never lists, and who
gets an FX or sound task) are runtime definitions. They ship in the same pipeline change with the
Agents tab eval. `services/director-worker/src/tools.ts` `ADAPTER_OPS` gains all six.

### 5. Where new audio and FX art come from

- **Audio** is chosen only from the project's library (uploaded and approved by people in `/sound`)
  and the engine's built-ins. There is **no audio generation in 9H.** It would be a new paid service
  with licences that `docs/reference/model-licences.md` does not cover, so it is an **owner
  decision, not 9H**.
- **A missing sound** (a mockup or style note asks for a cue that no approved sound fits) is left at
  its current binding. The builder names it in its task report, and the coordinator carries it into
  the hand-off note as "sounds wanted: moment → what". It uses `run.ask_owner` only when the
  missing sound blocks a checkpoint the owner asked for. No new tool is needed.
- **FX art** is atlas regions already made through the atlas ops (the art director plans them, the
  atlas artist produces them). There is no new GPU path. A new effect or layer is a pipeline change
  (coordinator.md item 7, "an FX slot").
- **Estimate (ADR-0006).** No GPU or job cost. Add one token profile per item: per sound moment,
  per FX layer and per component art node, seeded like the region profiles and measured in PLAN 6.3.

### 6. Family gate and rule 8

- **Family gate.** `ADAPTER_TOOL_IDS` gains `sound: 'sound'`, `fx: 'fx'` and
  `components: 'editor'` (the Component Editor is the Components side of `/editor`, and
  `/api/editor/component` gates on `editor`). `FAMILY_TOOLS` (`roles.ts:495`) hides none of these
  from any family, so `not_for_family` never fires for them today. It will if a family drops one.
- **Rule 8.** All three changed docs already travel the chain to a published game:
  - **sounds:** `soundExport.ts` writes `deploy/sounds/` and the catalog with resolved `bindings`;
    `runtimeBundle.ts:604` assembles it; `scripts/bake-editor-doc.mjs` bakes it;
    `scripts/pull-project-assets.mjs` pulls it; `publishSoundBindings` and the banks register it;
  - **effects:** `effectExport.ts` writes `deploy/effects/`; `runtimeBundle.ts:429` assembles it;
    the bake embeds `effects`; pull mirrors it; `bakedEffects()` registers it;
  - **components:** the runtime bundle resolves defs (`runtimeBundle.ts:225`
    `resolveComponentClosureWithPins` over `loadComponentForGame`, which honours pins), and
    `editorArtExport.ts:333` ships the art of the closure and the pinned versions.

### 7. Attribution

`saveSymbolsDoc`, `saveDoc` and `saveClip` take `ctx.savedBy`. `saveSoundsDoc`, `saveEffect` and
`saveComponent` cannot carry it, and 9H leaves their behaviour alone:
- the sounds and FX normalizers rebuild the doc from a whitelist and would strip a `saved_by`;
- a component would keep it as an unknown field and bump the version.

For these three, attribution is the `director_ops` row (op, agent, run, input hash, and a result
with `before` and versions) plus the run's activity line. The component re-pin's layout write does
carry `saved_by`.

## Consequences

- Ships as two branches: 9H.1 (sound + FX) and 9H.2 (components, the move of `mathLock.ts`, the
  gate prefix). Each is a pipeline change, gated by `check:director-adapters` fixtures:
  - every refusal above, planted;
  - a 409 on a stale `baseEtag` for each op;
  - the sound legacy materialisation;
  - the FX deep-equal outside the allowed leaves;
  - a pinned instance reached and an art-plus-structure pin left `notReached`;
  - the limits check.
- Additive storage change: the `corrupt` flag on `loadSoundsDocWithEtag`. No tool behaves
  differently.
- ADR-0002's "every write carries `saved_by`" does not hold for the sounds, FX and component docs.
  Their attribution lives in `director_ops`.
- Known limits: a param-bound component art field, tint and text style, a material colour and a
  pin nested inside a def (it draws latest anyway) are not re-skinnable by an agent.

## Needs owner approval

1. **No audio generation in 9H.** Default: yes, it waits for its own decision (service, licences).
2. **Agents bind only approved library sounds and built-ins; a draft is refused.** Default: yes.
3. **Attribution for sounds, FX and components lives in `director_ops`, not `saved_by`.** Default:
   yes. Adding `savedBy` to each storage is a later pipeline change per tool.
4. **`components.update_art` re-pins placed instances when the only difference is art.** Default: yes.
5. **The sound doc has no backup; the op result keeps `before` instead.** Default: yes.

**For the coordinator (not an owner decision):** file the publish-gate gap above as a Sound
pipeline bug. Default: confirm it with a fixture first, then file it with `pipeline-triage`.
