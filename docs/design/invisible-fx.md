# Invisible FX (particle/effect authoring) — design + build plan

> An online **particle-effect authoring tool** — tune `@barvynkoa/particle-emitter`
> configs live in a WebGL preview, draw particle art from project **atlases** (static
> or animated multi-frame), pin emitters onto a **playing Spine rig**, and (ambitious
> tier) emit **Spine clips as the particles themselves** — then save an `EffectDoc`
> that ships through the standard deploy→bake→pull→register chain and is **triggered by
> Invisible Flow**.
> Owner direction 2026-06-24. Related: `live-assets.md` (the asset chain every new class
> must travel), `invisible-flow.md` (the trigger seam — a Broadcast event plays an FX),
> `invisible-rigger.md` (the sibling tool whose `/spine`-forked WebGL stage + R2 plumbing
> this reuses).

## 0. Status

**In build (Phase 1 — increments 1 + 2 landed headlessly).** This doc is the registered
build plan. Nothing ships until it travels the full asset chain (§8). Phase 0 (§7) is the
make-or-break gate for the **spine-as-particle** tier — do not start that tier until the
spike passes (the other two tiers are native and not gated). Current state: the `EffectDoc`
schema + a LIVE `/fx` emitter preview exist (atlas pick → live emitter), verified by two
headless harnesses; `/fx` stays UNREGISTERED (no save endpoint yet, so RULE 9 not yet
triggered). The WebGL pixels need live owner-verify (see Progress, increment 2).

### Progress

- **Phase 1 — increment 1: `EffectDoc` schema + headless round-trip harness — ✅ DONE
  HEADLESSLY (2026-06-24, branch `fx/phase1-emitter-core`, no game bump, `/fx`
  UNREGISTERED so RULE 9 is not yet triggered).** The first verifiable foundation of Tier
  A. **Landed:** new **`packages/engine-fx`** workspace package (`workspace:*`, house
  style, `tsc --noEmit` GREEN) — the shared home for the save contract, mirroring
  `engine-flow`'s package shape (`main`/`types` → `index.ts`) so BOTH the launcher save
  endpoint (it already deps `engine-flow` via `workspace:*` — `engine-fx` slots in the
  same way) and the engine-side `bakedEffects()` player can import the SAME types.
  - `src/types.ts` — `EffectDoc` / `EmitterLayer` / `EmitterArt` / `EmitterPlacement` /
    `SpineParticleConfig` / `EmitterTrigger` EXACTLY per §4, with `EmitterConfigV3`
    re-exported + nested **VERBATIM** from `@barvynkoa/particle-emitter` (never reshaped);
    `EFFECT_DOC_VERSION = 1`. The schema reduces precisely to `ParticleEmitter.svelte`'s
    contract (`config` + `key` = `art.assetKey` + `emit`/`emitSpeed`).
  - `src/normalize.ts` — `normalizeEffectDoc` (the canonicalizer `/api/fx/save` + the
    loader will run, mirroring `normalizeFlowDoc`): strips anything outside the schema so
    **editor-only state can never leak in** (it goes in the `.fx.meta.json` sidecar, §4),
    drops malformed layers, enforces particle-kind discipline (a `sprite` layer can't
    carry `spineParticle`), and keeps `layer.config` **byte-identical** (the verbatim
    contract); idempotent.
  - **Verified headlessly** by `tools/fx-spike/roundTrip.ts`
    (`pnpm --filter fx-spike run roundtrip`; new `tools/fx-spike` workspace added to
    `pnpm-workspace.yaml`): **24/24 GREEN** — (A) SAVE↔RELOAD: a representative authored
    `EffectDoc` (sparks + glow layers, free + bone placement, event + ambient triggers,
    animated flipbook frames) is a byte-identical FIXED POINT through author → JSON →
    `normalizeEffectDoc` → JSON → `normalizeEffectDoc`; normalize idempotent; editor-only
    junk + malformed layers dropped; absent doc ⇒ empty effect; spine-field gating holds.
    (B) CONFIG↔LIBRARY: the nested `EmitterConfigV3` feeds cleanly into the library's
    `upgradeConfig(config, textures)` — the EXACT call `ParticleEmitter.svelte` makes —
    proving the data contract OFFLINE ([[feedback_validate_data_contracts_offline]]).
  - **NB on lint:** `pnpm --filter engine-fx run lint` errors identically to the sibling
    `engine-flow` (no eslint flat-config wired for these leaf packages) — a pre-existing
    workspace condition, not introduced here; `typecheck` + the harness are the gates.
  - **Owner-verify live:** none yet (schema + harness only; no UI in this increment).
  - **Next increment:** the `/fx` page shell — fork the `/spine` WebGL stage (render /
    pan / zoom + play/pause) the way the Rigger did, reuse `loadRegionSet` +
    `/api/rigger/atlases` to list a project's atlases/regions, and drive a LIVE `Emitter`
    preview from an in-memory `EffectDoc` (still UNREGISTERED in `roles.ts` — registration
    + `docs/tools/fx.md` land with the real saveable page, RULE 9).
  - Files: `packages/engine-fx/{package.json,tsconfig.json,index.ts,src/types.ts,src/normalize.ts}`,
    `tools/fx-spike/{package.json,roundTrip.ts}`, `pnpm-workspace.yaml`.

- **Phase 1 — increment 2: `/fx` page shell + LIVE emitter preview (Tier A) — ✅ DONE
  HEADLESSLY (2026-06-24, branch `fx/phase1-emitter-core`, no game bump, `/fx` STILL
  UNREGISTERED in `roles.ts` so RULE 9 is not yet triggered — registration +
  `docs/tools/fx.md` land with the saveable page).** The first *visible* surface of Tier A:
  pick a project atlas, pick region(s), live-tune the core `EmitterConfigV3` in a WebGL
  preview, all driven from an in-memory `EffectDoc` (no save endpoint yet — that's the next
  increment). **Landed:**
  - **`/fx` route** (`apps/launcher-api/src/routes/(app)/fx/`): `+page.server.ts` (SSR
    OFF — the stage owns a `PIXI.Application`; auth + `editor`-scope gate, riding the
    existing `editor` tool id rather than minting a new auth surface before the page is
    saveable; loader REUSES `loadRegionSet` over the project's `manifests/*.json` — the
    exact `/api/rigger/atlases` pattern — to stream the atlas + region list). `+page.svelte`
    (layer list + atlas/region picker + minimal emitter inspector — frequency, max
    particles, lifetime, spawn radius, alpha/scale/speed endpoints — `ToolTopBar` branding).
    `FxStage.svelte` (the `/spine`-stage fork done Svelte-natively: own `Application` +
    pan/zoom/play-pause + a live `Emitter` per layer rebuilt verbatim from the doc, with
    the picked atlas page drawn faintly behind as a placement reference). `fxModel.client.ts`
    (PURE editing model + config mutators — kept rune-free + PixiJS-free so the harness can
    cover it). Art is read through the existing `editor`-gated `/api/editor/regions` +
    `/api/editor/asset`; the stage slices per-frame textures from the packed page by the
    picked region rects — so a picked region maps to `art.assetKey` + `art.frames` and
    renders as a particle. The page reduces to the real `ParticleEmitter.svelte` contract
    (`config` + `key`=`art.assetKey` + `emit`).
  - **CAUGHT + FIXED — the silent-invisible-particle trap (the load-bearing review find):**
    the prior shell relied on `upgradeConfig(config, textures)` to bind the art — but reading
    the library source, **`upgradeConfig` is a NO-OP for a V3 config** (its `art` arg only
    feeds the legacy V1/V2 flat-config upgrade; a V3 config returns unchanged). The default
    config is V3 with no art behavior, so every emitter would have spawned **textureless,
    invisible particles** — builds + ships + runs, renders nothing (exactly the trap class
    [[feedback_validate_data_contracts_offline]] warns of). Fixed by a pure
    **`bindArt(config, textures, animated)`** that injects the textures as the config's OWN
    `textureRandom` (static) / `animatedSingle` (flipbook, `framerate:-1` match-life, loop)
    behavior — leaving every other behavior byte-identical so the verbatim contract holds;
    `bindArt`'s clone-then-attach order means its result is NOT re-JSON-cloned (that would
    destroy the live `Texture` objects). This same injection is what the engine-side
    `bakedEffects()` player will run at register time — kept pure + shared. Also hardened:
    a rebuild **generation token** (fast inspector edits can't interleave two async
    rebuilds into torn/duplicate emitters), and `emit` gated on `hasArt` (an unbound layer
    never spawns).
  - **Verified headlessly** by `tools/fx-spike/modelHelpers.ts`
    (`pnpm --filter fx-spike run model`): **33/33 GREEN** — the default config has NO art
    behavior (proving the bug existed), `bindArt` injects the correct behavior for 0 / 1 /
    >1-static / >1-animated textures, carries the LIVE texture objects through (not
    JSON-cloned away), is pure (no input mutation), replaces (never stacks) a prior art
    behavior, and a bound config still passes `upgradeConfig` with its art intact; every
    inspector mutator (`setCoreParam`/`setListEndpoint`/`setSpawnRadius`) is pure +
    round-trips with its readout; the doc/layer factories produce a valid shape. The
    increment-1 round-trip harness still **PASSES** (schema unchanged). `pnpm --filter
    launcher-api build` **GREEN** (the `(app)/fx` entry builds).
  - **NEEDS LIVE OWNER-VERIFY (the WebGL pixels — not browser-verifiable here, authed):**
    (1) picked atlas regions actually **render as particles** on the `/fx` canvas (the
    texture-slice + `bindArt` path producing visible sprites); (2) the emitter **responds
    live** to inspector edits (changing frequency / lifetime / alpha-scale-speed endpoints /
    spawn radius visibly re-tunes the running emitter); (3) a >1-frame + Flipbook layer
    animates its frames; (4) pan/zoom/play-pause + the faint atlas backdrop behave; (5) no
    GPU/emitter leak across many edits (the gen-guarded rebuild + `init`/`destroy`
    lifecycle). The headless harness covers the data/config contract; only a human can
    confirm the pixels.
  - **Next increment:** `POST /api/fx/save` (mirroring `/api/rigger/save`) + reopen —
    write `<bundle>/<id>.fx.json` (+ `.fx.meta.json` sidecar for camera/selection), wire
    the load path, THEN register `/fx` in `roles.ts` and ship `docs/tools/fx.md` +
    the `docs/tools/README.md` row in the SAME change (RULE 9, via `docs-keeper`).
  - Files: `apps/launcher-api/src/routes/(app)/fx/{+page.server.ts,+page.svelte,FxStage.svelte,fxModel.client.ts}`,
    `tools/fx-spike/modelHelpers.ts` (+ `tools/fx-spike/package.json` `model` script),
    `apps/launcher-api/package.json` (+`engine-fx`, +`@barvynkoa/particle-emitter@0.0.1`).

## 1. Naming (settled here to avoid a real collision)

"Emitter" is already taken in this repo: `utils-event-emitter` is the inter-component
**event bus**, and Flow's `emitterVocabulary.ts` Broadcast nodes name **event-emitter
events**. Naming a *particle* tool "Invisible Emitter" would collide head-on with that
vocabulary. So:

- **Tool name: "Invisible FX"** (working). Route **`/fx`**. Saved artifact: an
  **`EffectDoc`** (one named effect = a stack of particle emitter layers).
- The underlying particle system stays `@barvynkoa/particle-emitter` (the engine
  already ships it via [`ParticleEmitter.svelte`](../../packages/pixi-svelte/src/lib/components/ParticleEmitter.svelte)).
- The collision is also the **integration seam** (§4.4): a Flow **Broadcast** fires an
  *event-emitter* event; a registered **FX** reacts by emitting particles. Authoring the
  particle effect (Invisible FX) and authoring *when it fires* (Invisible Flow) stay
  separate, exactly as Flow already separates "declare the event" from "implement it".

## 2. Why this tool exists (the goal)

Particle/effect work is constant, fiddly, and today has **no authoring surface** — an
`EmitterConfigV3` is hand-written JSON (see the lone
[ParticleEmitter story](../../packages/pixi-svelte-storybook/src/stories/ParticleEmitter.stories.svelte)
fountain config). Tuning it means editing numbers blind and rebuilding. Invisible FX
gives the same browser-based, R2-backed, license-free authoring the Rigger/Atlas tools
do: **see the effect while you tune it**, draw its art from the project's real atlases,
author it *in context* on the actual animated rig it will sit on, and save it where the
pipeline can ship it. This is the "build the emitter in the tool" path we chose over
importing point clouds (point clouds → bones is a category mismatch; see the 2026-06-24
decision — offline sims bake to flipbooks, runtime particles are authored here).

## 3. What we already have to build on (reuse, don't rebuild)

- **Runtime particle component** — `ParticleEmitter.svelte` takes
  `config: EmitterConfigV3` + `key` (a loaded sprite-sheet key) + `emit`/`emitSpeed`,
  and calls `upgradeConfig(config, textures)` to bind textures. **This is the runtime
  contract** — whatever we author must reduce to exactly this.
- **Atlas as particle art is native** — particle textures come from
  `loadedAssets[key]` as `LoadedSpriteSheet = PIXI.Texture[]` ([types.ts](../../packages/pixi-svelte/src/lib/types.ts)).
  Any atlas region / sheet frame is already a valid particle. Multi-frame **animated**
  particles are native too (`@barvynkoa/particle-emitter` `animatedSingle` /
  `animatedRandom` art behaviors).
- **Spine stage + bone-follow are native** — `SpineProvider` / `SpineTrack` /
  `SpineSlot` / **`SpineBone`** ([SpineBone.svelte](../../packages/pixi-svelte/src/lib/components/SpineBone.svelte))
  expose a live bone transform; parenting a `ParticleEmitter` under a `SpineBone` makes
  the FX follow that bone every frame. The spine-attach tier is mostly wiring, not new math.
- **The `/spine`-forked WebGL stage** — the Rigger proved the pattern: fork the Spine
  Viewer's render/pan/zoom/scrubber/anim-skin shell, reuse `/spine/skeletons` +
  `/spine/file`, reuse `loadRegionSet` to list a project's atlases/manifests + region
  names (the Rigger's `/api/rigger/atlases`). Invisible FX is a launcher-native page in
  the same mould.
- **Flow's trigger vocabulary** — `engine-flow/emitterVocabulary.ts` already models the
  game's broadcastable events; an FX binds its `trigger` to one of those `type`s (§4.4).

## 4. The save contract — `EffectDoc` (the heart of the tool)

Unlike the Rigger (whose file must be byte-pure Spine because an external runtime eats
it), particle-emitter config has **no proprietary "project file"** ambiguity — so the
`EffectDoc` is **our own schema that *contains* `EmitterConfigV3` verbatim** plus the
wiring the runtime component can't infer (art source, placement, trigger, particle kind).
Pure config stays nested and untouched so it round-trips into the library cleanly
([[feedback_validate_data_contracts_offline]]).

```ts
EffectDoc {
  id: string;
  name: string;
  layers: EmitterLayer[];          // an effect = a stack of emitters (sparks + smoke + glow)
}

EmitterLayer {
  key: string;                     // layer id (unique within the effect)
  config: EmitterConfigV3;         // VERBATIM → ParticleEmitter.svelte `config`
  art: {
    assetKey: string;              // loadedAssets key = an atlas/sheet bundle (the `key` prop)
    frames: string[];              // region/frame names; >1 + animated = a flipbook particle
    animated?: boolean;            // AnimatedParticle vs static texture
  };
  placement: {
    space: 'free' | 'bone';        // free = positioned in the scene; bone = follow a rig bone
    bone?: string;                 // when space==='bone' → wrap emitter in <SpineBone boneName=…>
    offset?: { x: number; y: number };
  };
  particleKind: 'sprite' | 'spine';// 'spine' = the spine-as-particle tier (Phase 0-gated)
  spineParticle?: {                // only when particleKind==='spine'
    skeletonKey: string;           // a loaded spine bundle
    animation: string;             // clip each particle plays
    loop?: boolean;
  };
  trigger?: {                      // when this layer emits (resolved by Flow at runtime)
    on: 'always' | 'event';        // 'event' = play on a Flow Broadcast / emitter-event type
    eventType?: string;            // a `type` from the game's EmitterVocabulary
    duration?: number;             // emit for N ms then stop (else emitterLifetime governs)
  };
}
```

Editor-only state (camera, last-selected layer, swatches) goes in an **`.fx.meta.json`
sidecar**, never inside the `EffectDoc` — same out-of-band discipline the Rigger uses.

## 4.4 How it plays at runtime (the register step)

A small engine-side player — `bakedEffects()` / `<EffectPlayer doc=…/>`, mirroring
`bakedEditorArtAssets()` / `bakedEditorArt` registration — takes an `EffectDoc` and:
1. Ensures each `art.assetKey` is in `loadedAssets` (atlas/sheet already travels the
   pipeline; FX just references it by key).
2. For each layer, mounts `<ParticleEmitter key={art.assetKey} config={layer.config}>`,
   wrapped in `<SpineBone boneName=…>` when `placement.space==='bone'`.
3. For `particleKind: 'spine'`, swaps in the custom `SpineParticle` runtime (Phase 3 / §7).
4. Subscribes the layer to its `trigger.eventType` on the event bus — so **Flow's
   Broadcast node is the fire button**. `on:'always'` emits continuously (ambient FX).

## 5. The three tiers (owner picked all three, 2026-06-24)

| Tier | What it is | Native? | Cost |
|---|---|---|---|
| **A — atlas / animated-sprite particles** | particle art = atlas regions; >1 frame = flipbook particle | ✅ native (`animatedRandom`) | low |
| **B — emitter attached to a spine rig** | load a playing Spine clip as backdrop; pin emitters to bones (flame on a torch, sparkle off a wand tip); FX follows the bone | ✅ native (`SpineBone`) | low–medium |
| **C — Spine clips AS the particles** | each particle is a pooled Spine skeleton instance playing a clip (a burst of 30 spinning coins) | ❌ **no native support** | **high — gated** |

Tier C is the only one with real risk: `@barvynkoa/particle-emitter` spawns
sprite/texture particles, not skeletons. It needs a custom particle behavior backed by a
**pool of `Spine` instances** (allocating a skeleton per particle per frame is a non-
starter). **Phase 0 decides native-vs-fallback** — and the fallback is elegant and
already-decided doctrine: **bake the Spine clip to a sprite-sheet flipbook and use Tier
A.** So Tier C ships *something* regardless; the spike only decides *how good*.

## 6. Architecture (proposed)

- **Host:** launcher-native Svelte 5 page **`/fx`** — reuses launcher auth, the
  client→project selector, scope gating, R2 writes (the `/rigger` pattern). No new
  Railway/Python service.
- **Stage:** fork the `/spine` WebGL viewer shell (render/pan/zoom + a play/pause + the
  anim/skin pickers) — the same fork the Rigger did. The FX **delta** is the emitter
  inspector (spawn shape, lifetime, alpha/scale/color/speed/rotation curves, blend),
  the **atlas region picker** (drives `art.frames`), the **layer list**, and a
  **bone picker** when a spine backdrop is loaded.
- **Source of truth while editing = the `EffectDoc`**; the live `Emitter` is rebuilt
  from it on change (the library's `emitter.init(config)` already re-inits cleanly — see
  `ParticleEmitter.svelte` `$effect`). Runtime = preview; doc = truth — same boundary as
  the Rigger.
- **Writes:** an `fx`-gated `POST /api/fx/save` using the existing `r2.ts` writers +
  `assertAllowed`, writing `<bundle>/<name>.fx.json` (+ sidecar). Atlas/spine listing
  reuses the Rigger's `loadRegionSet` + `/spine/skeletons` endpoints — **don't duplicate**.

## 7. Build plan (phased — each ships something usable)

| Phase | Delivers | Risk |
|---|---|---|
| **0 — Spine-particle spike (Tier C gate)** | prove a pooled-`Spine`-instance custom particle renders + animates + recycles inside (or beside) `@barvynkoa/particle-emitter` at a real particle count, OR confirm the flipbook-bake fallback. **Do before committing Tier C.** | **make-or-break (Tier C only)** |
| **1 — Emitter core + atlas art (Tier A)** | `/fx` page; load a project atlas; pick region(s); live-tune `EmitterConfigV3` in the WebGL preview; static + animated-sprite particles; save `EffectDoc` to R2; reopen | low |
| **2 — Spine-attach (Tier B)** | load a Spine clip as backdrop, play it, pin layers to bones via `SpineBone`; offset; preview FX riding the animation | low–medium |
| **3 — Spine-as-particle (Tier C)** | per Phase 0: native `SpineParticle` behavior **or** flipbook-bake path; `particleKind:'spine'` authoring | high |
| **4 — Pipeline + Flow trigger** | export → `deploy/` → bake (embed effect index) → pull → `bakedEffects()` register; bind `trigger.eventType` to the game's `EmitterVocabulary`; Flow Broadcast fires it | medium |

**Phase 0 is a gate, not a formality** — and *only* for Tier C. Tiers A and B are native
(§3) and proceed without it. If the spike shows native Spine particles can't hit an
acceptable count/perf, Tier C ships via the flipbook fallback and we lose nothing else.

## 8. Pipeline wiring (rule 8 — non-negotiable)

An effect is a **new asset class**, so it only ships when it travels the full chain,
mirroring `editorArtExport.ts` / `fontExport.ts`
([[project_live_assets_pipeline]], [[feedback_r2_assets_must_ship]]):

**author in `/fx` → `<client>/<project>/deploy/effects/` → bake (embed the effect index
in the bundle) → pull (mirror into `static/assets/`) → `bakedEffects()` register in the
game.**

"It plays in `/fx`" does **not** mean it ships — the editor reads R2 directly. Watch the
two known traps: `bake:doc` must run **before** `pull:assets`, and the build-env token
trap that silently serves stale assets ([[project_component_art_to_game]],
[[gotcha_game_build_stale_engine_dist]]). The particle **art** atlas already travels the
chain; the FX layer just references it by `assetKey` — but verify the referenced atlas is
actually in the bundle at bake (a dangling `assetKey` = an invisible effect, the particle
analogue of [[gotcha_manifest_region_no_geometry_dropped]]).

**Rule 9 (docs):** when `/fx` is registered in `roles.ts` (`TOOLS` / `ROLE_TOOLS` /
`TOOL_BAR_ORDER` / `TOOL_DOC_SLUG`), `docs/tools/fx.md` + the `docs/tools/README.md` row
ship in the SAME change (use `docs-keeper`). Not done here — this is the plan, not the tool.

## 9. Open questions (resolve during Phase 0/1)

- **Tier C verdict** — native pooled `SpineParticle` vs flipbook-bake fallback (Phase 0).
- **Effect = one emitter or a stack?** Modelled as `layers[]` above (sparks+smoke+glow as
  one named effect) — confirm that's the right grain vs one-file-per-emitter.
- **Trigger ownership** — does the FX carry its own `trigger`, or is *all* triggering
  delegated to Flow (FX stays a pure effect, Flow owns when)? Leaning Flow-owns-when, with
  `trigger` as an optional convenience for ambient `on:'always'` effects.
- **Atlas key stability** — the `assetKey` an effect references must match the runtime
  `loadedAssets` key the bake produces; pin the naming the way editor-art namespaces did
  ([[gotcha_editor_art_region_name_collision]]).
- **A dedicated `invisible-fx` subagent** (like `invisible-flow`) once the build starts.

## 10. Model note

Default the build to **Opus 4.8** (the `/fx` page, atlas picker, emitter inspector,
pipeline wiring are well-specified Svelte 5 / PixiJS work). Reserve **Fable 5** for the
one genuinely hard piece if it bites: the **Tier C `SpineParticle` pooling/perf spike**
(Phase 0). Blanket-Fable would waste tokens — same calculus as the Rigger doc §11.
