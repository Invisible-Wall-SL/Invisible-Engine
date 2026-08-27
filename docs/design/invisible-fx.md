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

## Direction (2026-07-09): rig-timeline **direct FX binding** — "pick the effect on the keyframe"

**Owner direction.** Today, firing an FX from a rig animation is a 3-tool dance: author the effect
in `/fx` (with a `trigger.on:'event'` layer whose `eventType` = some cue), **place** it in the
Scene Editor (an `EffectNode`, optionally `hostSpineId`-attached to the rig), then add a Rigger
event key **named the same cue**. The Rigger key alone renders nothing — it just broadcasts a name.
The owner (rightly) wants the natural model: **on a Rigger event keyframe, pick the effect directly
(a dropdown of the project's effects) + optionally a host bone; it rides the rig and plays in-game —
no Scene-Editor placement, no cue-string matching.** The cue-broadcast path stays as a secondary
(advanced) mode — Flow still needs it, and "one animation → different effects per placement" is
occasionally useful.

### Why it's a real (but small) engine path, not just a dropdown
Two findings from the code map (2026-07-09) frame the design:
1. **A binding stored on the rig ships verbatim.** `POST /api/rigger/save` writes the whole `rawDoc`
   to `<client>/<project>/spines/<bundle>/<stem>.irig`; deploy copies it byte-faithful (renamed
   `.irig`→`.json` for PIXI.Assets). So **custom fields on the rig survive to the runtime.**
2. **…but spine-pixi discards non-standard event fields at parse time.** `BaseSpineProvider`'s
   `rebroadcastEvents` listener only sees `event.data.name` + `int/float/string` — a custom
   `evtObj.effectId` is in the file but NOT in the parsed `AnimationState` event. So the binding
   **cannot be read through the event stream**; it must be read from the rig data directly →
   **bake a small rig→bindings manifest** (exactly like `bakedEffects()` / `registerEffects()`).

Everything else already exists and is reused unchanged: `resolveEffect(id)` (the effects registry —
**every authored effect already ships**, doc + sprite atlas, regardless of scene placement),
`attachedEffects` (mounts an `<EffectPlayer>` INSIDE a rig's `<SpineProvider>`), `SpineBoneAttach`
(rides a bone), and `rebroadcastEvents` (already enabled on every placed rig).

### Data model
A first-class binding on the rig, authored per event key, source of truth = the event object:
- On an event object: `evtObj.fx = { effectId: string, bone?: string }` (omit ⇒ plain cue event,
  today's behaviour). `bone` defaults to the event author's selected bone (or none = rig origin).
- The binding is keyed at runtime by the **event NAME** (what the rebroadcast bus carries): "spine
  event named `N` on this rig → play effect `effectId` on `bone`". De-dup by
  `(name, effectId, bone, slot)` across animations at bake.

**Per-binding overrides (2026-08-27).** `evtObj.fx` also carries seven optional fields — `slot`,
`alpha`, `scale`, `delay`, `duration`, `speed` — typed as `RigFxOverrides` in
`engine-layout/registerRigFx.ts`, which also owns the ONE clamp (`readRigFxOverrides`) the bake, the
registry and the previews all read through. They are OVERRIDES, not authoring: the `EffectDoc` stays
the effect's definition and these adjust one use of it on one beat, so two rigs can fire the same
effect dimmer/slower/deeper without forking the doc.

- **Absent ≠ default.** An unset field stays absent end to end; that is what keeps every rig baked
  before they existed byte-identical. Out-of-range and malformed values are DROPPED, never coerced.
- **`slot` is DEPTH.** In game `<RiggedEffect>` hands its container to spine-pixi's `addSlotObject`,
  so the burst renders at that slot's place in the draw order instead of over the whole rig; an
  unknown slot name falls back to on-top rather than throwing. With no `bone`, the slot's own bone
  hosts the burst. `alpha`/`scale` live on a nested container, because spine rewrites the slotted
  one's transform and alpha every frame.
- **`duration` closes a real divergence:** `forceEmit` starts emission and nothing ended it, so a
  continuous effect fired from a keyframe emitted forever in-game while the previews force-stopped
  at ~1.5s. It maps to `<EffectPlayer emitFor>`, and to the preview overlay's hold cap.
- **What the manifest cannot carry:** it is keyed by event NAME, so placement (`bone`, `slot`)
  identifies a binding and the numbers ride along from the first matching keyframe. Two keys of one
  name that disagree cannot both reach the game — the per-keyframe timeline the previews read CAN
  express it, so the Rigger warns at the point of authoring. Guarded by
  `pnpm --filter launcher-api run check:rig-fx-overrides` (mutation-verified).
- **`continuous` is the one BOOLEAN**, and the one that changes the FIRING MODEL rather than a value:
  the first beat starts the effect and later beats are ignored, so a looping clip stops chopping an
  ambient burst up once per lap. It stops when the RIG unmounts, not when the animation changes (the
  manifest is keyed by event name, not by clip). Three renderers had to agree, because each clears
  bursts on a loop wrap for its own reasons: `RiggedEffect`, the Rigger stage, and the `/symbols`
  grid — and the preview overlay skips its `PREVIEW_HOLD_MS` cap for one, since capping it would show
  the author the exact stutter the flag removes.
- **Still NOT built:** a *persistent* FX slot — an always-on emitter living on the rig as a slot,
  keyable like any other channel (the other half of `invisible-cinematic.md` §12.4a). This is the
  one-shot cue gaining depth and modifiers, not that.

### Travel (rule 8 — export→bake→pull→register)
- **export:** the rig `.irig` already ships (verbatim, carrying `evtObj.fx`). The **bake** walks each
  shipped rig `.json`, collects every `animations[].events[]` with an `fx` binding into a manifest
  `rigFx[<rigAssetKey>] = [{ event, effectId, bone? }]`, embedded in the bundle beside `effects`.
- **register:** boot calls `registerRigFx(rigFx)`; runtime `resolveRigFx(rigAssetKey)` (mirrors
  `registerEffects`/`resolveEffect`).
- **effects themselves:** no change — sprite-particle effects ship doc+atlas for every authored
  effect. **Caveat (deferred):** a Tier-C *spine-particle* effect bound ONLY via a rig still needs
  its skeleton shipped (today skeletons auto-ship only when placed) — v1 supports sprite-particle
  bound effects; spine-particle needs a follow-up auto-ship path (note it in the UI).

### Runtime
`LayoutNodeView` spine branch, inside the existing `<SpineProvider …>`: for each
`resolveRigFx(node.assetKey)` entry, render a small new **`RiggedEffect`** that plays a bound effect
on the beat:
- `RiggedEffect.svelte` (pixi-svelte) — props `{ doc, event, bone? }`. Subscribes the event bus for
  `{type: event}` (the rig's own rebroadcast); on each fire it bumps a `runId` `$state` and renders
  `{#key runId}` an `<EffectPlayer doc={doc}>`, bone-wrapped in `<SpineBoneAttach boneName={bone}>`
  when `bone` is set (else a plain offset container = rig origin). Re-mount-on-fire = a clean one-shot
  from t=0 each beat. Reuses `EffectPlayer`/`EffectLayer`/`SpineBoneAttach` **unchanged**;
  `BaseSpineProvider` stays generic (no FX logic leaks in).
- v1 semantics: **one-shot burst per beat.** Bound effects should be finite (own `emitterLifetime`);
  a continuous effect would run until unmount. A `stopEvent` binding (reusing `EmitterTrigger.
  stopEventType`) is a deferred follow-up.

### Authoring (Rigger, `view.html`)
The docked **⚡ Event key** panel gains, above the payload:
- **Play effect** — a `<select>` of the project's effects (fetch `GET /api/editor/effects` once on
  first open; session-scoped, same list `/fx` + the Scene-Editor palette use). `— none (cue only) —`
  = today's plain broadcast. Picking one sets `evtObj.fx.effectId`.
- **On bone** — a `<select>` of `skeletonData.bones[].name` (default = the selected bone, or
  `— rig origin —`). Sets `evtObj.fx.bone`.
- The dope-sheet ⚡ key gets an FX affordance (e.g. a ✨ tint / title suffix) when bound.
- `setEventKeyField` gains `fx.effectId` / `fx.bone` cases (empty ⇒ delete the field / the whole `fx`
  when both empty, keeping export clean). A spine-particle effect selection shows a "needs a follow-up
  to ship" hint (deferred caveat above).

### Phasing
1. **Rigger authoring + storage** (`view.html`) — dropdowns + `evtObj.fx`; ships verbatim, no runtime
   effect yet (safe, reversible). 2. **Bake manifest + register** (`bake-editor-doc.mjs` /
   `effectExport`-style server + `editor-scenes.ts` `registerRigFx`/`resolveRigFx`). 3. **Runtime
   `RiggedEffect` + `LayoutNodeView` wiring.** 4. Owner live-verify on a published game; then Borut
   bumps its `engine` submodule. Deferred: stop-event, continuous effects, spine-particle bound ship,
   `docs/tools/rigger.md` refresh (docs-keeper).

### Rigger LIVE FX preview — faithful overlay (2026-07-10, building)

**Owner direction:** show the bound effect PLAYING in the Rigger stage (not just in-game), on the beat,
riding the bound bone — so the Rigger is a true FX-authoring surface.

**The catch:** the Rigger stage is **raw `spine-webgl` on a hand-rolled WebGL context** (`view.html`
`#cv` / `gl = cv.getContext('webgl')`), NOT Pixi. The engine's whole particle stack is Pixi-based, so
it can't render into that context. Solution = a **transparent Pixi overlay canvas** on top of `#cv`,
running the REAL engine emitter, projected onto bones via the stage camera.

**Faithful, because it reuses the engine reduction verbatim.** The load-bearing logic is already plain
TS / Pixi-only (no Svelte): `engine-fx` `normalizeEffectDoc`/`planLayer`/**`bindArt`** (injects the
layer's textures into the particle-emitter V3 config's `behaviors`) + the shared art helper
`apps/launcher-api/src/lib/fx/effectEmitter.client.ts` (`loadPageSource` = fetch→`createImageBitmap`→
`ImageSource`, the query-string-URL gotcha fix; `framesToTextures` = page→per-frame `Texture[]`). Only
the Svelte *shells* (`EffectPlayer`/`EffectLayer`/`ParticleEmitter`/`EditorEffectLayer`) are
reimplemented as plain functions. `EditorEffectLayer.svelte` (the Scene-Editor overlay) is the direct
template — self-owned transparent `Application`, per-effect container, per-frame ticker with a
`try/catch` per `emitter.update`, `app.destroy(true)` to free the GL context.

**Vendored bundle.** Build a standalone IIFE `rigger-fx.js` (pixi.js + `@barvynkoa/particle-emitter` +
the reused `engine-fx`/art-helper code) → committed at `apps/launcher-api/static/rigger/vendor/`,
loaded by the Rigger with the SAME `<script>` pattern it already uses for `spine-webgl-*.js`. Exposes
`window.RiggerFx`: `init(hostEl)` (transparent `Application` in `#stage`, a `world` Container, a ticker),
`playEffect(doc, {x,y}, scale)` (per layer: `framesToTextures`→`bindArt`→`new Emitter(container, config)`,
force-emit like `forceEmit`; sprite tiers only — skip `particleKind:'spine'`), `followPoint(handle, x, y,
scale)` (per frame), `clear()`, `destroy()`.

**Rigger integration (`view.html`).** In the `frame()` loop, right after `poseAtTime(curAnim, animTime)`:
- **Fire on crossing:** track `animTime` across frames; when it crosses an `event.fx` keyframe (play or
  scrub), `RiggerFx.playEffect(doc, screenPos, scale)`. Effect `doc`s fetched+cached by id (like the
  effects list) from `GET /api/editor/effect?id=`.
- **Bone-follow + align:** each frame, for an active bound effect, project the bound bone (or rig origin)
  world pos → screen px via `renderer.camera.worldToScreen(v, cv.width, cv.height)` (the SAME call the
  bone dots use), and set the effect's screen position; scale the effect container by the world→screen
  factor (empirically = screen distance between two world points 1 unit apart) so particle size tracks
  zoom. Advance `RiggerFx.update(dt)`.
- Clear active previews on loop-restart / scrub-back so a one-shot re-fires cleanly.

**Endpoint scope.** The Rigger's art + doc fetches (`/api/editor/effect`, `/api/editor/regions`,
`/api/editor/asset`) gate on `editor`/`fx`; add the `rigger` alt-tool so a rigger-only role previews
(same fix already applied to `/api/editor/effects`).

**Scope:** sprite-particle effects (Tiers A/B) — a `particleKind:'spine'` layer is skipped in the preview
(matches the v1 ship scope). It's an approximation of the game only in camera framing; the emitter
config + art are identical, so the LOOK is faithful. **Owner live-verify** the pixels (WebGL + the
overlay alignment on a zoomed/panned stage).

> Build status: see [docs/status/fx.md](../status/fx.md); detailed done-log in [docs/history.md](../history.md).

## 1. Naming (settled here to avoid a real collision)

"Emitter" is already taken in this repo: `utils-event-emitter` is the inter-component
**event bus**, and Flow's `emitterVocabulary.ts` Broadcast nodes name **event-emitter
events**. Naming a _particle_ tool "Invisible Emitter" would collide head-on with that
vocabulary. So:

- **Tool name: "Invisible FX"** (working). Route **`/fx`**. Saved artifact: an
  **`EffectDoc`** (one named effect = a stack of particle emitter layers).
- The underlying particle system stays `@barvynkoa/particle-emitter` (the engine
  already ships it via [`ParticleEmitter.svelte`](../../packages/pixi-svelte/src/lib/components/ParticleEmitter.svelte)).
- The collision is also the **integration seam** (§4.4): a Flow **Broadcast** fires an
  _event-emitter_ event; a registered **FX** reacts by emitting particles. Authoring the
  particle effect (Invisible FX) and authoring _when it fires_ (Invisible Flow) stay
  separate, exactly as Flow already separates "declare the event" from "implement it".

## 2. Why this tool exists (the goal)

Particle/effect work is constant, fiddly, and today has **no authoring surface** — an
`EmitterConfigV3` is hand-written JSON (see the lone
[ParticleEmitter story](../../packages/pixi-svelte-storybook/src/stories/ParticleEmitter.stories.svelte)
fountain config). Tuning it means editing numbers blind and rebuilding. Invisible FX
gives the same browser-based, R2-backed, license-free authoring the Rigger/Atlas tools
do: **see the effect while you tune it**, draw its art from the project's real atlases,
author it _in context_ on the actual animated rig it will sit on, and save it where the
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
`EffectDoc` is **our own schema that _contains_ `EmitterConfigV3` verbatim** plus the
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

| Tier                                      | What it is                                                                                                                   | Native?                      | Cost             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| **A — atlas / animated-sprite particles** | particle art = atlas regions; >1 frame = flipbook particle                                                                   | ✅ native (`animatedRandom`) | low              |
| **B — emitter attached to a spine rig**   | load a playing Spine clip as backdrop; pin emitters to bones (flame on a torch, sparkle off a wand tip); FX follows the bone | ✅ native (`SpineBone`)      | low–medium       |
| **C — Spine clips AS the particles**      | each particle is a pooled Spine skeleton instance playing a clip (a burst of 30 spinning coins)                              | ❌ **no native support**     | **high — gated** |

Tier C is the only one with real risk: `@barvynkoa/particle-emitter` spawns
sprite/texture particles, not skeletons. It needs a custom particle behavior backed by a
**pool of `Spine` instances** (allocating a skeleton per particle per frame is a non-
starter). **Phase 0 decides native-vs-fallback** — and the fallback is elegant and
already-decided doctrine: **bake the Spine clip to a sprite-sheet flipbook and use Tier
A.** So Tier C ships _something_ regardless; the spike only decides _how good_.

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

| Phase                                      | Delivers                                                                                                                                                                                                                         | Risk                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **0 — Spine-particle spike (Tier C gate)** | prove a pooled-`Spine`-instance custom particle renders + animates + recycles inside (or beside) `@barvynkoa/particle-emitter` at a real particle count, OR confirm the flipbook-bake fallback. **Do before committing Tier C.** | **make-or-break (Tier C only)** |
| **1 — Emitter core + atlas art (Tier A)**  | `/fx` page; load a project atlas; pick region(s); live-tune `EmitterConfigV3` in the WebGL preview; static + animated-sprite particles; save `EffectDoc` to R2; reopen                                                           | low                             |
| **2 — Spine-attach (Tier B)**              | load a Spine clip as backdrop, play it, pin layers to bones via `SpineBone`; offset; preview FX riding the animation                                                                                                             | low–medium                      |
| **3 — Spine-as-particle (Tier C)**         | per Phase 0: native `SpineParticle` behavior **or** flipbook-bake path; `particleKind:'spine'` authoring                                                                                                                         | high                            |
| **4 — Pipeline + Flow trigger**            | export → `deploy/` → bake (embed effect index) → pull → `bakedEffects()` register; bind `trigger.eventType` to the game's `EmitterVocabulary`; Flow Broadcast fires it                                                           | medium                          |

**Phase 0 is a gate, not a formality** — and _only_ for Tier C. Tiers A and B are native
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
- **Trigger ownership** — does the FX carry its own `trigger`, or is _all_ triggering
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
