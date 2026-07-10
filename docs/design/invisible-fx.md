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
  event named `N` on this rig → play effect `effectId` on `bone`". De-dup by `(name, effectId, bone)`
  across animations at bake.

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

**LANDED (2026-07-09):** phases 1–3 + `forceEmit` (a rig-bound effect force-plays every layer on the
beat regardless of its authored trigger — the keyframe IS the trigger; `RiggedEffect`→`EffectPlayer`
→`EffectLayer forceEmit`). Runtime published to `_runtime/lines`. Owner-verify + Borut bump pending.

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

## 0. Status

**Phases 1 + 2 + 4 COMPLETE (headless) — the full author→ship→FIRE loop is wired.** Phase 4
landed in 3 increments: inc 1 (engine runtime player `<EffectPlayer>`/`<SpineBoneAttach>`),
inc 2 (export→bake→pull — an authored effect travels into a built game's bundle), inc 3 (the
TRIGGER — a baked effect plays in-game and a `trigger.on:'event'` layer fires on a game/Flow
event via `utils-event-emitter`). **Phase 0 / Tier C GATE PASSED (2026-06-25): the spike
verdict is NATIVE pooled-`SpineParticle` is VIABLE** (see Progress — `tools/fx-spike/spineParticle.ts`,
18/18 GREEN; perf ceiling is the one owner-verify-live caveat, flipbook-bake remains a per-effect
fallback). **Tier C (Phase 3) is now COMPLETE (headless): increment 1 built the RUNTIME
`SpineParticleBehavior` + `<EffectLayer>` wiring (a `particleKind:'spine'` layer RENDERS — pooled
`Spine` particles, `tools/fx-spike/spineParticleBehavior.ts` 21/21 GREEN), and increment 2 (2026-06-25)
built the `/fx` AUTHORING UI (a `particleKind` toggle + skeleton/animation/loop picker, reusing the
Backdrop bar's skeleton list), the FxStage LIVE spine-particle preview (pooling real `Spine`
instances), and the bake dangling-`skeletonKey` guard (the spine analogue of the atlas `art.assetKey`
check). So a spine-particle effect is now authorable→previewable→shippable→fireable.** The **skeletonKey
key-stability** seam is now CLOSED (2026-06-25 — `/fx` authors `spineParticle.skeletonKey` as the
canonical bundle `folder`, the SAME key the runtime registers the spine under in `loadedAssets` +
the bake dangling-key guard checks; the guard reconciles both ship namespaces to that folder, and the
runtime resolution falls back across them — see Progress + §9). The ONLY remaining owner-verify-live
items (NOT headless) are the WebGL pixels + the pool-size perf ceiling; once the owner confirms a
published game renders a spine-particle effect, Book of Borut bumps its `engine` submodule. The
`/fx` `trigger.eventType` PICKER is now BUILT (the inspector "Trigger" section authors
always/event + the event type + duration, sourced from the project's emitter vocabulary —
the same source `/flow` uses). **Current
state:** a LIVE saveable/reopenable `/fx` page (atlas pick → live emitter → save → reopen);
Tier B Spine attach (rig backdrop + pin a layer onto a bone); the full pipeline (export→bake→
pull→register) + the event-bus trigger; `/fx` is a REGISTERED tool (`fx` scope). **Owner-verify
pending** (WebGL + a published game): Tier A particles, Tier B bone-follow, and a game actually
FIRING a baked effect on an event (esp. `<SpineBoneAttach>`'s coord frame + `Effects.svelte`'s
host-rig assumptions). After this lands on `main` + owner-verify, \*\*Book of Borut bumps its
`engine` submodule\*\* to ship the runtime. See Progress.

### Progress

- **Inspector authoring-UX polish: LIVE SLIDERS + SPAWN-SHAPE picker — ✅ DONE HEADLESSLY
  (2026-06-25, branch `fx/phase1-emitter-core`, no game bump).** Owner-requested `/fx` inspector
  polish (the tool is otherwise feature-complete). Two improvements, both PURE config edits through
  the existing `patchConfig`/`updateSelected` seam (schema + `normalize` untouched — spawnShape is
  already verbatim inside the config):

  - **Live sliders (replace the value boxes).** The numeric Emitter (frequency / max particles /
    lifetime min+max) and Alpha/Scale/Speed start+end fields are now a reusable **"slider + number
    box"** combo (`{#snippet slider(label, value, min, max, step, apply)}` in `+page.svelte`). The
    range input fires `oninput` on EVERY drag tick → re-records the doc → the preview re-tunes live
    (FxStage's rebuild is already generation-guarded/coalesced, so dragging is safe); the paired
    numeric box shows the live value AND lets you type an exact one (`onchange`, on commit). Both call
    the SAME mutator. Per-field min/max/step: frequency 0.001–0.5 step 0.001; max particles 1–1000
    step 1; lifetime 0–5s step 0.05; alpha 0–1 step 0.01; scale 0–4 step 0.05; speed 0–1000 step 1;
    spawn radii 0–400 step 1; rect width/height 0–800 step 1. Placement offsets + trigger duration
    stay text boxes (unbounded / blank-clears — a slider is worse there).
  - **Spawn-shape picker.** Was: only a torus `radius`. Now a **Shape** dropdown — Point / Circle /
    Ring / Rectangle — driving the verbatim `spawnShape` behavior (`@barvynkoa/particle-emitter`):
    Point/Circle/Ring all map to the library `torus` (`point` = radius 0; `circle` = radius>0, no
    inner; `ring` = innerRadius>0), Rectangle maps to the library `rect` authored CENTRED on the
    emitter origin (`x`/`y` = `-w/2`/`-h/2`). Only the relevant params show (sliders, per above).
    Switching shape REWRITES only the `spawnShape` entry's `type`+`data`; all other behaviors stay
    byte-identical (the verbatim-config contract). A config with no `spawnShape` degrades gracefully —
    the picker APPENDS one.
  - **New PURE mutators/readout** (`fxModel.client.ts`, PixiJS-free so the harness covers them):
    `setSpawnShape` (switch + carry shared params non-destructively), `setSpawnRing` (outer+inner),
    `setSpawnRect` (centred w/h), and `spawnShape(config)` readout (recovers the authoring shape +
    params from the library `{type,data}`). `setSpawnRadius` reused for the Circle radius. All
    JSON-clone the config (like the existing mutators), edit ONLY the `spawnShape` behavior, never
    mutate the source.
  - **Verified headlessly** — `tools/fx-spike/modelHelpers.ts` (`pnpm --filter fx-spike run model`)
    extended GREEN: each shape produces the right `spawnShape` `type`+`data`; switching shapes is
    immutable + leaves all NON-spawnShape behaviors byte-identical; the readout round-trips
    (point/circle/ring/rect); a `spawnShape`-less config reads `undefined` + the picker adds one; and
    every shape config still feeds `upgradeConfig`/`bindArt` cleanly. ALL 11 fx harnesses GREEN.
    **Build GREEN:** `pnpm --filter launcher-api build`; Prettier clean (package-local config).
  - **NEEDS LIVE OWNER-VERIFY (NOT headless, authed `/fx` page):** the sliders re-tuning the preview
    LIVE as you drag, and each spawn shape visibly changing the particle spawn PATTERN.
  - **`docs/tools/fx.md`** wants a later `docs-keeper` refresh for the inspector section (live sliders
    + the Spawn-shape picker). No tool registration / submodule bump.
  - Files: `apps/launcher-api/src/routes/(app)/fx/{+page.svelte,fxModel.client.ts}`,
    `tools/fx-spike/modelHelpers.ts`, `docs/STATUS.md`.

- **Tier C `skeletonKey` key-stability seam — ✅ CLOSED HEADLESSLY (2026-06-25, branch
  `fx/phase1-emitter-core`, no game bump).** Per the increment-2 follow-up + §9 (the atlas "key
  stability" rule, applied to spines). The one correctness gap blocking a spine-particle effect from
  SHIPPING into a real game. **The two key namespaces (with the code that derives each):**

  - **Authored (was wrong):** the `/fx` Skeleton picker wrote `spineParticle.skeletonKey =
    `${entry.dir_b64}/${entry.skeleton_file}`` — a base64url-of-folder + filename ENTRY key (the
    `/spine/skeletons` listing shape, `spineIndex.ts` `buildSkeletonsIndex` → `dir_b64 =
    b64url(dir)`). Never a runtime lookup key.
  - **Canonical (runtime + bake):** the engine registers a spine in `loadedAssets` under the key
    `bakedEditorArtAssets()` / `bakedSymbolAssets()` set (`apps/lines/src/editor-scenes.ts`
    `out[spine.key] = {type:'spine',…}`). That `spine.key` is the bundle **`folder`** for a
    layout-placed spine — `editorArtExport.ts` rewrites it via `gameKey =
    bundleFromAssetKey(client, project, assetKey)` (`spine.ts`: strips `<…>/spines/` → the folder) —
    and the FULL R2 bundle prefix `<…>/spines/<folder>/` for a symbol-shipped spine
    (`symbolExport.ts` keeps `entry.key = assetKey`). `<EffectLayer>` resolves
    `loadedAssets[skeletonKey]` directly, and the bake guard checks `editorArt.spines[].key` ∪
    `symbols.index.spines[].key`. The authored and canonical namespaces never matched ⇒ an authored
    spine effect never resolved + the bake always flagged it dangling.
  - **Fix (smallest correct — author the canonical key, no translation layer):** (1) the `/fx`
    spine-particle picker now writes `skeletonKey = entry.folder` (the canonical bundle name),
    deduped to one option per shippable bundle (`spineParticleSkeletons` — the runtime/editor-art
    ship the FIRST skeleton of a folder, so a folder maps to one shippable skeleton); `resolveSkeleton`
    matches by `folder`; the `/fx` preview still loads via `loadFxSpine` (unchanged). The Tier-B
    Backdrop bar keeps `dir_b64/skeleton_file` (an authoring aid, never saved). (2) the bake guard
    (`bake-editor-doc.mjs`) reduces every SHIPPED spine key to its bundle `folder` (`<…>/spines/<f>/`
    → `<f>`; a bare editor-art folder key unchanged) before comparing — reconciling both ship
    namespaces to the one authored namespace. (3) `<EffectLayer>` resolution is now resilient:
    exact-key first (the editor-art/folder case), then a fallback matching any `loadedAssets` key
    whose bundle folder equals the authored key (the symbol-spine full-prefix case) — so an authored
    spine effect resolves regardless of which path shipped the skeleton, WITHOUT re-keying the
    symbol/runtime registration.
  - **Verified headlessly** — `tools/fx-spike/pipeline.ts` extended GREEN: an authored folder key
    PASSES the guard against an editor-art spine (same folder) AND a symbol spine (full prefix →
    same folder); a genuinely-absent skeleton is STILL flagged dangling; a different shipped bundle
    does not falsely satisfy the key; the `bundleFolder` reducer unit-covered (both namespaces
    collapse to the folder, a bare folder unchanged, a nested folder preserved). ALL 10 fx harnesses
    GREEN; the Phase-0 spine-particle spike still GREEN. **Builds GREEN:** `engine-fx` typecheck,
    `pnpm --filter {pixi-svelte,lines,launcher-api} build`, `node --check` on the bake script;
    Prettier clean. **PARITY:** sprite-only docs byte-identical (the sprite path is untouched).
  - **Borut:** the seam no longer blocks shipping — a spine effect whose skeleton genuinely ships now
    resolves at runtime + passes the bake guard. The ONLY remaining gate is owner-verify-live (the
    WebGL pixels + the pool-size perf ceiling in a published game); after that, bump the `engine`
    submodule.
  - Files: `apps/launcher-api/src/routes/(app)/fx/+page.svelte`,
    `apps/launcher-api/scripts/bake-editor-doc.mjs`,
    `packages/pixi-svelte/src/lib/components/EffectLayer.svelte`, `tools/fx-spike/pipeline.ts`,
    `docs/STATUS.md`.

- **Phase 3 (Tier C — spine-clips-AS-particles) — increment 2: the `/fx` authoring UI + live
  preview + the bake `skeletonKey` guard — ✅ DONE HEADLESSLY (2026-06-25, branch
  `fx/phase1-emitter-core`, no game bump).** Per §5 Tier C / §7 Phase 3 (Phase-0 build-plan steps
  3–4). Makes a `particleKind:'spine'` layer AUTHORABLE, PREVIEWABLE, and SHIPPABLE — closing
  Tier C (increment 1 built the runtime behavior; this is the tool + the pipeline guard).
  **Landed:**

  - **`/fx` authoring UI** (`apps/launcher-api/src/routes/(app)/fx/+page.svelte`) — a per-layer
    **Particle** section (above Art): a **Kind** select (**Sprite (atlas art)** vs **Spine clip**);
    when **Spine clip**, a **Skeleton** picker (REUSES the SAME `/spine/skeletons` list the Backdrop
    bar already loads — no second skeleton-listing path), an **Animation** picker (the chosen
    skeleton's clips, resolved on demand via `fxSpine.client.ts` `loadFxSpine`; degrades to a
    free-text input while the skeleton loads), and a **Loop** toggle. The Sprite **Art** section is
    GATED OUT for a spine layer. Switching kind is NON-DESTRUCTIVE (the atlas `art` AND a drafted
    `spineParticle` both survive a toggle, mirroring the placement/trigger non-destructive pattern).
    The page caches loaded skeletons (`resolveSkeleton`) and hands them to the stage.
  - **Pure mutators** in `fxModel.client.ts` (`setParticleKind` / `setSpineParticleSkeleton` /
    `setSpineParticleAnimation` / `setSpineParticleLoop` + the `spineParticleReady` gate) — edit
    ONLY `particleKind`/`spineParticle`, NEVER the verbatim `config` (nor `art`/`placement`/
    `trigger`); immutable + PixiJS-free so the harness covers them. `setParticleKind` to the same
    kind is a no-op; the spine setters force `particleKind:'spine'` and keep sibling fields.
  - **FxStage LIVE spine-particle preview** (`FxStage.svelte`) — for a `particleKind:'spine'` layer
    the stage `registerSpineParticleBehavior()` + injects a pixi-v8 backing factory
    (`createPixiSpineBackingFactory`, built from the skeleton the page resolves via the new
    `resolveSkeleton` prop) into the V3 config's `behaviors` (mirroring `<ParticleEmitter>`'s
    `bindSpineParticle` imperatively), INSTEAD of the `bindArt` sprite path. A spine emitter is
    ALWAYS recreated (not re-`init`ed) on rebuild so its pool is rebuilt cleanly; the pool is
    DISPOSED (`SpineParticleBehavior.dispose()`) on every teardown/rebuild/unmount (no leak —
    FxStage's generation-guarded rebuild owns it). A half-authored/unloadable spine layer falls
    through to the placeholder dots (never crashes). The sprite/placeholder/Tier-B paths stay
    BYTE-IDENTICAL. The launcher now deps `pixi-svelte` (`workspace:*`), whose index now exports the
    canonical Tier-C `spineParticleBehavior`/`spineBacking` (REUSE — the SAME pool `<EffectLayer>`
    mounts, so the authoring preview and the game render identically).
  - **Bake dangling-`skeletonKey` guard (§8 — the spine analogue of the atlas dangling-key guard)** —
    `effectExport.ts` now returns `referencedSkeletonKeys` (the distinct `spineParticle.skeletonKey`
    set of `particleKind:'spine'` layers); a spine layer adds NO atlas key (`assetKeysOf` now skips
    spine layers) and a sprite layer adds NO skeleton key. `bake-editor-doc.mjs` checks each
    referenced skeletonKey against the SHIPPED Spine bundles (`editorArt.spines[].key` ∪
    `symbols.index.spines[].key` — the keys a skeleton registers in `loadedAssets` under) and WARNS
    loudly for a dangling one (an unshipped skeleton ⇒ the spine particles have no skeleton ⇒
    invisible). Non-fatal (the author may wire the spine into the layout/symbols before shipping).
  - **Latent schema bug FIXED** — `normalizeEffectDoc` DROPPED any layer whose `art.assetKey` was
    empty, which would have killed EVERY spine-particle layer (a spine layer's particle IS the
    pooled `Spine`, not an atlas region — it legitimately carries empty art) at save→reopen / export.
    A SPINE layer now keeps an empty `{ assetKey:'', frames:[] }` block.
  - **Save-loses-the-layer bug FIXED (2026-07-08)** — the same drop ALSO killed a SPRITE layer
    with unbound art: author a new effect, tune the emitter against the placeholder dots (the UI
    explicitly invites this — "No art bound yet — tune the emitter"), Save, reopen → EMPTY. The
    save-time canonicalizer was doing the ship-time gate's job. `normalizeEffectDoc` now keeps
    EVERY layer (sprite too) with an empty `{ assetKey:'', frames:[] }` when art is unbound; empty
    art is safe at runtime (`bindArt` with 0 textures renders nothing) and the dangling-`assetKey`
    case is caught LOUDLY at bake (§8), the correct ship gate. Round-trip harness updated to assert
    the unbound sprite layer survives.
  - **Particle-art-never-rendered bug FIXED (2026-07-08)** — `FxStage` loaded the atlas page via Pixi
    `Assets.load(pageUrl)`, whose resolver keys off the URL's apparent extension; the auth-gated
    `/api/editor/asset?key=…` streamer URL (query string, no clean extension) tripped it, so the
    emitter got NO texture (placeholder dots) AND the faint backdrop never drew. The Editor loads the
    SAME endpoint via an `<img>` and works — the tell. `FxStage.loadPageSource()` now fetches the bytes
    itself + decodes via `createImageBitmap` → `ImageSource` (mirrors the Editor), per-load try/catch.
  - **Weighted per-image MIX added (2026-07-08)** — new `EmitterArt.weights?: number[]` (parallel to
    `frames`; normalized/validated, dropped unless aligned + a >1-frame layer). A static multi-frame
    layer now defaults to a random MIX (was: auto-forced flipbook); the inspector's "Mix — per-image
    share" sliders set the weights. `bindArt(config, textures, animated, weights?)` realises them via a
    repeated-texture multiset (`weightedTextures` — the library's `textureRandom` is uniform). Preview
    honors it; **runtime `<ParticleEmitter>` still binds the whole sheet (ignores `frames` + `weights`)
    — the frame-filtering gap is the tracked follow-up, after which weights ship for free via `bindArt`.**
  - **Runtime frame + weight filtering LANDED (2026-07-08, "in-game" Phase 0).** Closed the gap above.
    `EffectLayer.svelte` resolves a sprite layer's `art.frames` → the loaded per-frame `Texture`s
    (editor-art scoped→bare key precedence `<assetKey>::<frame>` — the SAME resolution `LayoutNodeView`
    uses; inlined to avoid a `pixi-svelte→engine-layout` dep) and passes `textures` + `weights` to
    `<ParticleEmitter>`, which forwards `weights` into `bindArt`. No `frames` ⇒ whole-sheet fallback
    (game-bundled spritesheet parity). This is why the sprite runtime never rendered: an FX atlas
    ships via editor-art export under namespaced per-frame keys, so `loadedAssets[assetKey]` was
    `undefined`. `bakedEffects()` was already un-gated (only its comments were stale — fixed). Harness
    `playerReduce.ts` covers weights-through-`bindArt`; WebGL pixels need owner live-verify.
  - **Scene-Editor placement LANDED (2026-07-08, "in-game" Phase 1).** New `EffectNode
    { kind:'effect'; effectId }` on the `engine-layout` `LayoutNode` union — an effect is placed like
    an image/spine. Resolution registry `registerEffects()`/`resolveEffect()` (mirrors
    `registerComponents`; game registers `bakedEffects()` at boot); `LayoutNodeView` mounts
    `<EffectPlayer>` for the resolved doc at the node transform. Launcher editor: `/api/editor/effects`
    list + an Effects palette section + spawn + a labelled placeholder chip (no live emitter in the 2D
    editor) + a Properties effect-picker; `'effect'` added to the `NODE_KINDS` whitelist. `apps/lines`
    `Effects.svelte` skips placed ids (`placedEffectIds()`) so a placed effect never double-mounts.
    **v1: scene-placed = FREE layers** (a bone layer has no host `<SpineProvider>` in a scene → falls
    back to origin+offset; bone effects stay on the host-rig path, timed in the Rigger = Phase 3).
    **Effect art ships only if its atlas is ALSO placed** (existing dangling-`assetKey` guard) —
    auto-shipping a placed effect's atlas is a tracked follow-up. **[DONE 2026-07-08]**
    `exportEditorArt` now walks the project's effects and auto-ships every layer's manifest
    `art.assetKey`, so a placed/mounted effect's particles have textures with no extra step (the
    dangling-`assetKey` guard now only fires for a genuinely unusable atlas).
  - **Flow activation — shared cue-name picker (2026-07-08, "in-game" Phase 2).** The runtime join
    already works + is harness-verified (`trigger.ts`): a Flow Broadcast (v1) / `fireCue` (v2) →
    `eventEmitter.broadcast({type: name})` fires an FX `on:'event'` layer whose `trigger.eventType ===
    name`. Closed the FX picker's dead-end: the Trigger→Event control is now a COMBOBOX (pick a
    suggestion or type any custom cue). Suggestions union the game's exported emitter vocabulary (v1
    Broadcast names) with the cues the project's saved Flow **v2** graph actually broadcasts (`fireCue`
    `ref`s, via `loadFlowV2Doc` in the FX loader) — the v2 template vocabulary isn't project-loaded
    yet (owner's in-progress flow-v2 work), so sourcing from the real FlowDoc is the non-blocked path.
    A first-class `playEffect` Flow node stays deferred.
  - **Rig-timeline → effect seam LANDED (2026-07-08, "in-game" Phase 3b).** `BaseSpineProvider`
    (→ `SpineProvider`) gains opt-in `rebroadcastEvents`: a Spine `AnimationState` listener broadcasts
    each fired animation event onto the `utils-event-emitter` bus as `{type: event.name, int, float,
    string}` — the SAME bus an FX `on:'event'` layer subscribes to. So a Rigger event key named `X` on
    an animation fires any effect whose `trigger.eventType === X`, exactly when the animation reaches
    it (the "time an effect on the timeline" seam). Enabled on placed spine nodes (`LayoutNodeView`) +
    the FX host rig (`Effects.svelte`); off elsewhere (opt-in, no spam); listener removed on destroy.
    Bone-attach was already done (`placement.space:'bone'` + `SpineBoneAttach`). Companion: the Rigger
    event-key authoring UI.
  - **Per-rig bone hosting LANDED (2026-07-08).** Closed the follow-up above. `EffectNode.hostSpineId`
    (the id of a placed spine node in the same scene) attaches an effect to a SPECIFIC rig: `LayoutScene`
    pairs the hosted effect to its host spine + suppresses it at top level, and `LayoutNodeView` renders
    its `<EffectPlayer>` DIRECTLY inside that rig's `<SpineProvider>` (`attachedEffects` prop) — so a bone
    layer rides that rig's bone and the rig's rebroadcast timeline events fire it. Editor: an "attach to
    rig" dropdown in the effect Properties. Reference model (not nesting) to keep spine a leaf node.
    Dangling id ⇒ normal top-level render. The effect rides the rig (its node transform ignored).
  - **Trigger STOP event added (2026-07-09).** `EmitterTrigger.stopEventType?` — an optional SECOND cue
    that STOPS emission, so Flow drives a continuous effect with a start cue + a stop cue (fire on
    `eventType`, stop on `stopEventType`). `EffectLayer` subscribes both; the stop cue cancels any
    duration timer; a stop cue equal to the fire cue is dropped (`layerTrigger`). Absent ⇒ the prior
    burst behaviour (stop by `duration`/`emitterLifetime`) is byte-identical. FX tool: a "Stop event"
    combobox. Covered by `trigger.ts` (start→stop-cue→stop, stop beats duration) + `roundTrip.ts`.
  - **Verified headlessly** — new `tools/fx-spike/particleKind.ts` (`pnpm --filter fx-spike run
particle-kind`): the mutators are pure/immutable + touch only `particleKind`/`spineParticle`,
    the sprite↔spine toggle is non-destructive, the `spineParticleReady` gate, and the kind
    discipline through `normalizeEffectDoc` (a true spine layer KEEPS spineParticle; a sprite layer
    DROPS a dormant one; idempotent fixed point). `tools/fx-spike/pipeline.ts` extended — the
    `referencedSkeletonKeys` export (sprite/spine classes don't cross-contaminate, deduped) + the
    dangling-`skeletonKey` guard (shipped-as-editor-spine / shipped-as-symbol-spine resolve,
    unshipped flagged). ALL 10 fx harnesses GREEN; the Phase-0 spine-particle spike still GREEN.
    **Builds GREEN:** `engine-fx` typecheck, `pnpm --filter {pixi-svelte,lines,launcher-api} build`
    (the `(app)/fx` entry grew to ~50 kB pulling in the particle behavior); `node --check` on the
    bake/pull `.mjs`; Prettier clean. **PARITY:** a sprite-only doc is byte-identical through
    normalize/export/bake.
  - **NEEDS LIVE OWNER-VERIFY (NOT headless):** (a) spine-clip particles actually RENDERING +
    animating + recycling in the `/fx` preview once a Skeleton + Animation are picked; (b) the
    pool-size CEILING that holds 60fps (the Phase-0 caveat — tens, not hundreds); (c) the
    **skeletonKey key-stability** seam — in `/fx` the authored `spineParticle.skeletonKey` is a
    `dir_b64/skeleton_file` entry key, but the runtime + the bake guard resolve against the R2
    bundle-prefix `loadedAssets` key (`editorArt.spines[].key`); these must be reconciled (the §9
    "atlas key stability" analogue) before a spine-particle effect SHIPS to a real game. Until then
    the guard correctly flags such an effect dangling.
  - **Borut note:** still NOT bumped — owner-verify the pixels + reconcile the skeletonKey seam
    first. **`docs/tools/fx.md`** wants a later `docs-keeper` refresh for the Particle/Spine-clip
    section (RULE 9 already satisfied — the tool is registered).
  - Files: `apps/launcher-api/src/routes/(app)/fx/{+page.svelte,FxStage.svelte,fxModel.client.ts,fxSpine.client.ts}`,
    `apps/launcher-api/src/lib/server/effectExport.ts`, `apps/launcher-api/scripts/bake-editor-doc.mjs`,
    `apps/launcher-api/package.json` (+`pixi-svelte`), `packages/pixi-svelte/src/lib/index.ts`,
    `packages/engine-fx/src/normalize.ts`, `tools/fx-spike/{particleKind.ts,pipeline.ts,package.json}`,
    `docs/STATUS.md`.

- \*\*Phase 3 (Tier C — spine-clips-AS-particles) — increment 1: the RUNTIME `SpineParticleBehavior`

  - `<EffectLayer>` wiring — ✅ DONE HEADLESSLY (2026-06-25, branch `fx/phase1-emitter-core`, no
    game bump).** Per §5 Tier C / §7 Phase 3 (Phase-0 verdict: NATIVE viable). Promotes the Phase-0
    spike's proven pooled-`Spine`-particle mechanism into the real runtime so a `particleKind:'spine'`
    layer RENDERS — each particle is a pooled `Spine` instance playing a clip. Scoped to the RUNTIME
    only (the `/fx` authoring UI + the FxStage preview + the bake dangling-`skeletonKey` guard are
    increment 2). **Landed:\*\*

  * **`SpineParticleBehavior`** (`packages/pixi-svelte/src/lib/spineParticleBehavior.ts`) — a real
    `@barvynkoa/particle-emitter` behavior (the `IEmitterBehavior`
    `{ order, initParticles, updateParticle, recycleParticle }` shape), registered via
    `Emitter.registerBehavior` through the idempotent `registerSpineParticleBehavior()`.
    Parameterised from the EffectDoc's `spineParticle` (`{ skeletonKey, animation, loop }`): pool
    sized from `config.maxParticles` + PRE-WARMED up-front; on spawn take a pooled backing,
    `state.setAnimation(0, animation, loop)`, add its view to the layer container; per frame advance
    the clip + weld the (textureless) particle's transform/alpha; on `recycleParticle` reset (clear
    tracks + setup pose + hide) + return to the pool; `dispose()` destroys every backing (pool +
    live) on unmount. NEVER a skeleton per-particle-per-frame (the spike's exact, proven shape).
    **Home is `pixi-svelte`** (alongside `ParticleEmitter`/`EffectLayer`/`SpineBoneAttach`) — it
    needs the pixi-v8 `Spine` class + the particle lib; `engine-fx` stays PURE (peer-deps only
    pixi.js).
  * **The pool is INJECTABLE** (`packages/pixi-svelte/src/lib/spineBacking.ts`) — the behavior pools
    a renderer-agnostic `SpineBacking` (`view`/`activate`/`advance`/`reset`/`destroy`) built by an
    injected `SpineBackingFactory`, so the headless harness injects an un-mangled `spine-core`
    backing where the runtime injects the real pixi-v8 `Spine` (the bookkeeping is decoupled from
    the renderer). `createPixiSpineBackingFactory(spineData)` builds the runtime factory from a
    loaded `SkeletonData`; the pixi-v8 backing runs `autoUpdate=false` so the emitter's ticker owns
    the clock, and a missing clip name degrades to a static pose (never throws).
  * **`skeletonKey` resolves from `loadedAssets`** — `<EffectLayer>` resolves
    `spineParticle.skeletonKey` against the game's `loadedAssets[key]` (a `LoadedSpine` =
    `SPINE_PIXI.SkeletonData`, the SAME lookup `SpineProvider` does — the skeleton bundle must
    travel the pipeline like an atlas does, §8) and binds the factory. A `spine` layer whose
    skeleton isn't loaded yields no config ⇒ the emitter falls back to the (textureless) sprite path
    and renders nothing, never crashing.
  * **`<EffectLayer>`/`<ParticleEmitter>` branch on `particleKind`** — `<EffectLayer>` passes a
    `spineParticle` config to `<ParticleEmitter>` (a new optional prop) for a `spine` layer;
    `<ParticleEmitter>` then registers the behavior + injects it into the V3 config's `behaviors`
    (via `bindSpineParticle`, mirroring `bindArt`'s clone-then-attach-live-objects order — the
    particles stay textureless, their art IS the pooled spine view), SKIPPING the sprite
    `bindArt`/`key` path entirely. **The sprite path (Tiers A/B) is BYTE-IDENTICAL for
    `particleKind:'sprite'`** (`spineParticle` absent ⇒ the exact prior `bindConfig`/`bindArt`
    flow). `<SpineBoneAttach>` placement still works for a spine-particle layer (the emitter can ride
    a bone). `ParticleEmitter`'s `onDestroy` disposes the behavior's pool.
  * **`planLayer` update** (`engine-fx` `playerPlan.ts`) — `isLayerRenderable` now returns true for a
    `spine` layer (a layer with no `spineParticle.skeletonKey`/`animation` is still skipped — the
    fail-safe analogue of a bone layer with no bone); `LayerPlan` carries `particleKind` + the
    `spineParticle` config through. The pure seam stays testable.
  * **Verified headlessly** by new `tools/fx-spike/spineParticleBehavior.ts` (`pnpm --filter fx-spike
run spine-particle-behavior`): **21/21 GREEN** against the REAL production `SpineParticleBehavior`
    class (importing it never drags in `spine-pixi-v8` — the `./spineBacking` import is TYPE-ONLY,
    erased at runtime) driving the REAL `@barvynkoa` `Emitter` at `maxParticles:30` with an injected
    `spine-core` backing — registration idempotent, pool pre-allocates 30 up-front, BOUNDED
    allocation (still 30 after 1500 frames, none per-frame), the per-particle lifecycle drives the
    genuine state machine (a live bone's clip advanced), live backings === live particles (no leak),
    pool+live partition the fixed allocation, full drain returns all 30, `dispose()` destroys all 30 - clears. `playerReduce.ts` updated for spine now rendering (a spine layer renders + carries its
    config; a config-less spine layer is skipped; sprite layers stay `particleKind:'sprite'`). ALL
    prior fx harnesses (roundtrip/model/save/placement/player/pipeline/trigger/trigger-ui/
    spine-particle) still PASS. **Builds GREEN:** `engine-fx` typecheck, `pnpm --filter
{pixi-svelte,lines,launcher-api} build`; svelte-check on pixi-svelte flags only the 3
    PRE-EXISTING errors (none in the new/edited files); Prettier clean. **PARITY:** a doc with no
    spine layers reduces byte-identically (the sprite path is untouched).
  * **NEEDS LIVE OWNER-VERIFY (WebGL pixels + perf — NOT headless):** actual spine-clip particles
    RENDERING + animating + recycling in a real game (or the `/fx` preview), and the pool-size
    CEILING that holds 60fps on target hardware (the Phase-0 caveat — expect tens, not hundreds; a
    real `Spine` is far heavier than a `Sprite`). The flipbook-bake fallback stays available
    per-effect.
  * **Exact next increment (Tier C inc 2):** the `/fx` authoring UI — a `particleKind` toggle
    (sprite↔spine) on the selected layer, a skeleton/animation/loop picker (reuse the Phase-2
    `/spine/skeletons` + `fxSpine.client.ts` loader already in the page), and the FxStage live
    preview pooling real `Spine` instances; PLUS the bake dangling-`skeletonKey` guard
    (`spineParticle.skeletonKey` is a NEW referenced-asset class — the shipped spine set must contain
    it, the spine analogue of the atlas `art.assetKey` check, §8). `normalizeEffectDoc` already gates
    `spineParticle` to `particleKind:'spine'` (Phase-1 inc-1) — the schema is ready.
  * Files: `packages/pixi-svelte/src/lib/{spineParticleBehavior.ts,spineBacking.ts}`,
    `packages/pixi-svelte/src/lib/components/{ParticleEmitter.svelte,EffectLayer.svelte}`,
    `packages/engine-fx/src/playerPlan.ts`,
    `tools/fx-spike/{spineParticleBehavior.ts,playerReduce.ts,package.json}`, `docs/STATUS.md`.

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
    - `docs/tools/fx.md` land with the real saveable page, RULE 9).
  - Files: `packages/engine-fx/{package.json,tsconfig.json,index.ts,src/types.ts,src/normalize.ts}`,
    `tools/fx-spike/{package.json,roundTrip.ts}`, `pnpm-workspace.yaml`.

- **Phase 1 — increment 2: `/fx` page shell + LIVE emitter preview (Tier A) — ✅ DONE
  HEADLESSLY (2026-06-24, branch `fx/phase1-emitter-core`, no game bump, `/fx` STILL
  UNREGISTERED in `roles.ts` so RULE 9 is not yet triggered — registration +
  `docs/tools/fx.md` land with the saveable page).** The first _visible_ surface of Tier A:
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
    behavior (proving the bug existed), `bindArt` injects the correct behavior for 0 / 1 / > 1-static / >1-animated textures, carries the LIVE texture objects through (not > JSON-cloned away), is pure (no input mutation), replaces (never stacks) a prior art > behavior, and a bound config still passes `upgradeConfig` with its art intact; every > inspector mutator (`setCoreParam`/`setListEndpoint`/`setSpawnRadius`) is pure + > round-trips with its readout; the doc/layer factories produce a valid shape. The > increment-1 round-trip harness still **PASSES** (schema unchanged). `pnpm --filter
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

- **Phase 1 — increment 3: save + reopen + tool registration — ✅ DONE HEADLESSLY
  (2026-06-24, branch `fx/phase1-emitter-core`, no game bump). RULE 9 NOW TRIGGERED** —
  `/fx` is a registered tool, so `docs/tools/fx.md` + the `docs/tools/README.md` row land
  in the SAME commit (authored by `docs-keeper`). This closes Phase 1: the effect is now a
  saveable, reopenable, R2-backed artifact (the deploy→bake→pull→register chain is Phase 4).
  **Landed:**

  - **`POST /api/fx/save`** (`apps/launcher-api/src/routes/api/fx/save/+server.ts`) — mirrors
    `/api/rigger/save` + `/api/flow/save` EXACTLY: the shared `gate` (now on the `fx` tool)
    resolves the SESSION-bound `(client, project)` and 403s without entitlement — no
    hand-rolled auth/scope/R2. Body `{ doc, meta? }`.
  - **`fxStorage.ts`** (`apps/launcher-api/src/lib/server/`) — the MULTI-DOC R2 load/save
    (a project holds many named effects, unlike Flow's single `flow.json`). `saveEffect`
    runs `normalizeEffectDoc` as the GATEKEEPER and writes TWO SEPARATE objects:
    `<client>/<project>/<id>.fx.json` (the pure EffectDoc) + `<id>.fx.meta.json` (the
    editor-only sidecar — camera + last-selected layer), enforcing §4's out-of-band
    discipline. `listEffects` enumerates the `*.fx.json` files (sidecars excluded) for the
    picker; `loadEffect` reads a doc + sidecar (absent ⇒ empty effect). Path helpers
    (`fxDocKey`/`fxMetaKey`/`FX_DOC_SUFFIX`/`FX_META_SUFFIX`) added to `projectPaths.ts`;
    the id slugs through the shared `r2Slug` (stable file-stem / `assetKey` rule, §9).
  - **Reopen path** — `+page.server.ts` lists the saved effects + (on `?effect=<id>`) loads
    one back into the in-memory `EffectDoc` + sidecar; `+page.svelte` seeds its `$state`
    doc from `data.openedDoc` (or a fresh empty one), restores the selected layer from the
    sidecar, and wires the New / Save / open-picker controls + the effect-name field. Save
    POSTs `$state.snapshot(doc)` + a `{ selectedLayer }` sidecar; on success it adopts the
    server-slugged id so a re-save round-trips to the same keys.
  - **Registration** (`roles.ts`) — new `fx` TOOLS entry ("Invisible FX", barName "FX",
    spark-burst icon), `ROLE_TOOLS` grants (admin via `Object.keys`, developer, artist —
    the particle/effects authors), `TOOL_BAR_ORDER` placement (after `flow`),
    `TOOL_DOC_SLUG.fx = 'fx'`. The page + save endpoint now gate on `fx` (not the borrowed
    `editor` scope); `ToolTopBar current="fx"`.
  - **The shared-read seam** — switching to the `fx` gate would have locked an `fx`-only
    user out of the editor's `/api/editor/regions` + `/api/editor/asset` (which the stage
    reads art through). Fixed by an `altTools` option on the shared `gate` (an OR over tool
    ids that NEVER widens the R2 prefix allow-list, only the entitlement check); those two
    READ endpoints now accept `editor` OR `fx`. Reuse, not a duplicate art surface.
  - **Verified headlessly** by `tools/fx-spike/saveSplit.ts` (`pnpm --filter fx-spike run
save`): **24/24 GREEN** — the EffectDoc↔sidecar PARTITION (editor-only camera /
    selection / swatches that leak onto the save payload's `doc` never reach the `.fx.json`;
    they only survive in the separate sidecar), the sidecar normalizer drops off-schema
    keys, the R2-key derivation (`<client>/<project>/<slug>.fx.json` + sibling
    `.fx.meta.json`), id round-trip stability (a reopened id re-derives the SAME keys), the
    `listEffects` file-stem extraction (a `.fx.meta.json` / non-fx key is NOT an openable
    effect), and the missing-id fallback. The increment-1 round-trip (24/24) + increment-2
    model (33/33) harnesses still PASS. `pnpm --filter launcher-api build` **GREEN** (the
    `(app)/fx` page + `api/fx/save` endpoint + `fxStorage` chunk all build).
  - **NEEDS LIVE OWNER-VERIFY (authed page — not browser-verifiable here):** (1) Save writes
    `<id>.fx.json` + `<id>.fx.meta.json` to R2 and the toast confirms; (2) the open-picker
    lists saved effects and reopening one restores its layers + inspector + selected layer;
    (3) the effect-name edit + New flow behave; (4) an `fx`-only (no `editor`) role can still
    read atlas art through the `altTools`-widened endpoints; (5) the increment-2 WebGL pixels
    still hold (particles render, live-tune, flipbook, pan/zoom). The harness covers the
    save/split/key data contract; only a human can confirm the R2 writes + the pixels.
  - **Next phase:** Phase 2 — Spine-attach (Tier B): load a Spine clip as the authoring
    backdrop, play it, pin a layer to a bone via `SpineBone` (`placement.space:'bone'`),
    offset, preview the FX riding the animation. Native (`SpineBone` exposes the live bone
    transform) — no Phase-0 gate. (Phase 4 pipeline wiring — export→bake→pull→`bakedEffects()`
    — is the chain that actually SHIPS an effect; "saves in `/fx`" ≠ "ships", §8.)
  - Files: `apps/launcher-api/src/routes/api/fx/save/+server.ts`,
    `apps/launcher-api/src/lib/server/fxStorage.ts`,
    `apps/launcher-api/src/lib/server/projectPaths.ts` (+`fxDocKey`/`fxMetaKey`/suffixes),
    `apps/launcher-api/src/lib/server/toolScope.ts` (+`altTools`),
    `apps/launcher-api/src/routes/api/editor/{regions,asset}/+server.ts` (+`altTools:['fx']`),
    `apps/launcher-api/src/routes/(app)/fx/{+page.server.ts,+page.svelte}`,
    `apps/launcher-api/src/lib/roles.ts` (TOOLS/ROLE_TOOLS/TOOL_BAR_ORDER/TOOL_DOC_SLUG/icon),
    `tools/fx-spike/{saveSplit.ts,package.json}` (+`save` script).

- **Phase 2 — Spine attach (Tier B) — ✅ DONE HEADLESSLY (2026-06-24, branch
  `fx/phase1-emitter-core`, no game bump).** Per §5 tier B + §7 Phase 2. Load a project
  Spine rig as a playing backdrop and pin a layer's emitter onto one of its bones so the FX
  rides the animation (flame on a torch tip, sparkle off a wand). Native — no Phase-0 gate.
  **Landed:**

  - **`fxSpine.client.ts`** (`apps/launcher-api/src/routes/(app)/fx/`) — loads a project
    skeleton imperatively (FxStage owns a bare `PIXI.Application`, so it can't mount the
    declarative `<SpineProvider>`/`<SpineBone>`): fetches the atlas + skeleton + page images
    through the SAME `/spine/file` endpoint the Spine Viewer uses (assembling `SkeletonData`
    by hand — the package's `Assets` atlas loader resolves page URLs relative to the atlas
    path, which our `/spine/file?dir=…&name=…` URLs don't have), reads `.skel`/`.json`, and
    returns a live `Spine` + its animation / skin / bone name lists. `playFxAnimation` guards
    against an unknown clip name (a stale picker value would otherwise THROW and abort a
    backdrop switch); `applyFxSkin` is best-effort.
  - **`FxStage.svelte`** — loads/unloads the backdrop reactively (`syncSpine`, generation-
    guarded + keyed so a fast switch can't mount two skeletons), plays the clip in step with
    play/pause (`spine.autoUpdate=false`, advanced from the stage ticker), and for each
    `bone`-placed layer welds the emitter's spawn (owner) position to the live bone transform
    every frame. **The load-bearing coordinate hop** (what `<SpineBone>` hides): the bone
    resolves to Pixi WORLD coords (`spine.getBonePosition` → `skeletonToPixiWorldCoordinates`),
    but the emitter's `updateOwnerPos` is in its CONTAINER's local space (which carries the
    stage pan/zoom) — inverting the emitter container's world matrix bridges the two, so the
    FX rides the bone at any pan/zoom. Surfaces the loaded rig's clip/skin/bone lists to the
    page via an `onSpineMeta` callback.
  - **`fxModel.client.ts`** — pure placement mutators (`setPlacementSpace` (free↔bone, drops
    the bone on →free, keeps it on ↔), `setPlacementBone`, `setPlacementOffset`),
    `layerFollowsBone` (true only when `space:'bone'` AND a bone is set — a bone layer with no
    bone yet still spawns at the scene origin so the preview never silently vanishes), and the
    bone-follow math (`worldToContainerLocal` affine-inverse, `emitterOwnerLocal`) — all
    PixiJS-free so the harness covers them.
  - **`+page.svelte`** — a **Backdrop** bar above the stage (skeleton `<select>` from
    `/spine/skeletons` fetched client-side + animation `<select>` + skin `<select>` when
    > 1 skin), and a per-layer **Placement** inspector section (Free/Bone mode, a bone picker
    > from the loaded rig's bones, offset X/Y). Picking a skeleton resets the clip/skin so the
    > stage never replays a previous rig's clip mid-load; `onSpineMeta` defaults to the first
    > clip. Placement edits the doc immutably like every other inspector control.
  - **The shared-read seam (reuse, not a new surface)** — `requireSpineAccess`
    (`apps/launcher-api/src/lib/server/spine.ts`) now also accepts the `fx` entitlement, so
    `/spine/skeletons` + `/spine/file` serve the FX page too (same OR-the-entitlement /
    never-widen-the-prefix pattern as Phase 3's `altTools`). `+page.server.ts` is UNCHANGED —
    the skeleton list is a client-side fetch, like the atlas-region fetches.
  - **Verified headlessly** by `tools/fx-spike/placement.ts` (`pnpm --filter fx-spike run
placement`): **5/5 GREEN** — a free layer spawns at origin (+offset); a bone layer spawns
    at bone-world + offset; the owner maps correctly through pan+zoom into container-local; an
    unresolved bone falls back to origin+offset. The increment-1/2/3 harnesses (roundtrip /
    model / saveSplit) still PASS. `pnpm --filter launcher-api build` **GREEN** (the `(app)/fx`
    entry grew to ~16.7 kB with the backdrop picker + placement controls). Prettier clean.
  - **NEEDS LIVE OWNER-VERIFY (authed WebGL page — not headless):** (1) a picked skeleton
    loads + plays as a backdrop; the animation/skin dropdowns switch it; (2) a `bone`-placed
    layer's particles RIDE the bone as the animation plays (and track at any pan/zoom);
    (3) the offset nudges correctly; (4) switching/clearing the backdrop is leak-free; (5) the
    Tier-A pixels still hold.
  - **Phase 4 note (carry forward):** at runtime the FX backdrop is just an authoring aid —
    the EffectDoc stores only the bone NAME + offset. For `bakedEffects()` to honour a
    `bone` placement in a real game, the player must resolve that bone on the HOST game's
    playing rig (not a backdrop) — i.e. wrap the emitter in the runtime `<SpineBone>` against
    the game's `SpineProvider`. Decide the host-rig binding when Phase 4 wires the player.
  - **Next phase:** Phase 4 (pipeline wiring) or Phase 3 (Tier C, Phase-0 gated). Files:
    `apps/launcher-api/src/routes/(app)/fx/{fxSpine.client.ts,FxStage.svelte,fxModel.client.ts,+page.svelte}`,
    `apps/launcher-api/src/lib/server/spine.ts`, `apps/launcher-api/package.json`
    (+`@esotericsoftware/spine-pixi-v8@4.2.74`), `tools/fx-spike/{placement.ts,package.json}`,
    `docs/tools/fx.md` (Tier-B refresh).

- **Phase 4 (pipeline wiring) — increment 1: engine RUNTIME player (`<EffectPlayer>` +
  `bakedEffects()`) — ✅ DONE HEADLESSLY (2026-06-24, branch `fx/phase1-emitter-core`, no
  game bump — nothing ships until the rest of the chain lands).** Per §3 / §4.4 / §8. The
  engine-side runtime that PLAYS an `EffectDoc`, scoped tightly to the runtime only (the
  export endpoint, `deploy/effects/`, bake, pull, and the Flow trigger are LATER Phase-4
  increments). **Landed:**

  - **Shared `bindArt` promoted into `engine-fx`** (`packages/engine-fx/src/bindArt.ts` —
    `bindArt` + `ART_BEHAVIOR_TYPES` / `behaviorsOf` / `BehaviorEntry`/`BehaviorConfig`):
    THE canonical "EffectDoc V3 config → library-renderable config" seam, the ONE copy both
    the `/fx` tool and the engine runtime share (DRY). The launcher-local copy is DELETED;
    `fxModel.client.ts` re-imports + re-exports `bindArt`/`behaviorsOf` from `engine-fx`
    (existing `/fx` import sites + the `modelHelpers` harness stay green against the shared
    one); `FxStage.svelte` imports `bindArt` straight from `engine-fx`. The UI-only mutators
    (`setCoreParam`/`setListEndpoint`/the placement setters/the bone-follow affine math)
    stay in `fxModel.client.ts`.
  - **V3 configs render art at runtime** — `ParticleEmitter.svelte` (THE runtime contract,
    §3) gained a `bindConfig(config, textures, animated)`: a V1/V2 config (no `behaviors`)
    binds through `upgradeConfig(config, art)` EXACTLY as before — byte-identical for the
    lone fountain story (verified: that config takes the `upgradeConfig` branch and produces
    an identical result) — while a V3 config (`'behaviors' in config`, the library's own
    version test) binds via the shared `bindArt`, otherwise it spawns the textureless,
    invisible particles the Phase-1 increment-2 review caught. New optional `animated?` prop
    (V3 flipbook vs `textureRandom`), added to the `propsSyncEffect` ignore list.
    `pixi-svelte` now deps `engine-fx` (`workspace:*`; no cycle — engine-fx only peer-deps
    pixi.js, which pixi-svelte already has).
  - **`<EffectPlayer doc={EffectDoc}>` + `<SpineBoneAttach>`** (new `packages/pixi-svelte`
    components, exported from `components/index.ts`). `EffectPlayer` reduces a doc to
    per-layer mounts via the shared PURE `planLayer`/`planEffect`
    (`packages/engine-fx/src/playerPlan.ts`): each sprite layer mounts
    `<ParticleEmitter key={art.assetKey} config={layer.config} animated emit>`, wrapped in
    `<SpineBoneAttach boneName=…>` for a `bone`-placed layer (else a plain offset
    `<Container>`); ambient (`trigger.on:'always'`, or no trigger) emits, an `event` trigger
    stays DORMANT (the event-bus subscription is the seam — `layerEmits` — a later increment
    flips), a `particleKind:'spine'` layer is SKIPPED (guarded TODO — Tier C / Phase 3).
    `<SpineBoneAttach>` is the RUNTIME bone-follow that the Phase-2 note called for (the
    EffectDoc stores only the bone NAME + offset; `<SpineBone>` only WRITES a bone): within
    the HOST game's `<SpineProvider>` it parents a container under the Spine and positions it
    at the live bone every tick (`getBonePosition`→`skeletonToPixiWorldCoordinates` into the
    Spine's own child space — no pan/zoom inverse, unlike the `/fx` authoring stage),
    honouring `placement.offset`; an unresolved bone falls back to origin+offset. So a `bone`
    layer resolves on the GAME's playing rig (per the Phase-2 carry-forward), NOT a backdrop —
    the consuming game mounts `<EffectPlayer>` inside the relevant `<SpineProvider>`.
  - **`bakedEffects()` reader** (`apps/lines/src/editor-scenes.ts`, mirroring
    `bakedEditorArtAssets()`): returns the bundle's `EffectDoc[]` (`BakedBundle.effects`),
    runtime→baked→`[]` — EMPTY until the export→`deploy/effects/`→bake→pull half (a later
    increment) populates it (parity: un-baked / dev returns `[]`). `apps/lines` now deps
    `engine-fx`.
  - **Verified headlessly** by `tools/fx-spike/playerReduce.ts` (`pnpm --filter fx-spike run
player`): **24/24 GREEN** — the per-layer mount plan (free vs bone-wrapped, offset
    carried, a `bone` layer with no bone name falls back to a free mount, ambient-emits /
    event-dormant, spine-particle skipped), the whole-doc plan (one entry per layer in
    document order, the spine-particle layer excluded from the rendered set, mixed bone+free),
    AND the shared `bindArt` (the V3 `upgradeConfig` no-op PROVEN, static→`textureRandom`,
    animated→`animatedSingle` flipbook `framerate:-1`+loop, live textures carried not
    JSON-cloned, 0-tex→no art behavior, pure, a V1/V2 config still binds via `upgradeConfig`).
    The increment-1/2/3 + Phase-2 harnesses (roundtrip/model/save/placement) ALL still PASS
    against the moved `bindArt`. **Builds GREEN:** `engine-fx` typecheck,
    `pnpm --filter pixi-svelte build` (svelte-package; svelte-check flags only 3 PRE-EXISTING
    errors, none in the new/edited files), `pnpm --filter launcher-api build` (the `(app)/fx`
    entry still 16.69 kB), `pnpm --filter lines build` (the `bakedEffects()` reader compiled
    into `editor-scenes.js`).
  - **NEEDS LIVE OWNER-VERIFY (WebGL pixels — NOT headless-verifiable):** a real game actually
    PLAYING an `<EffectPlayer>` effect — free + bone-placed layers rendering particles, a
    `bone` layer riding the host rig's animation, a flipbook animating. The harness covers the
    pure mount/bind reduction; only a human can confirm the pixels.
  - **Borut note:** when the full Phase-4 chain ships, Book of Borut would bump its `engine`
    submodule to gain `<EffectPlayer>`/`bakedEffects()` — NOT this increment (nothing ships
    until export→bake→pull→trigger land).
  - **Exact next increment:** the `/fx` export endpoint → `<client>/<project>/deploy/effects/`
    (mirroring `editorArtExport.ts`), THEN bake (embed the effect index in
    `BakedBundle.effects`; `bake:doc` BEFORE `pull:assets`), THEN pull (mirror into
    `static/assets/`), THEN the Flow trigger (subscribe a layer to `trigger.eventType` on
    `utils-event-emitter` — flip the `layerEmits` seam). Verify the referenced `art.assetKey`
    atlas is actually in the bundle at bake (a dangling key = an invisible effect, §8).
  - Files: `packages/engine-fx/{index.ts,src/bindArt.ts,src/playerPlan.ts}`,
    `packages/pixi-svelte/{package.json,src/lib/components/{ParticleEmitter,EffectPlayer,SpineBoneAttach}.svelte,src/lib/components/index.ts}`,
    `apps/lines/{package.json,src/editor-scenes.ts}`,
    `apps/launcher-api/src/routes/(app)/fx/{fxModel.client.ts,FxStage.svelte}`,
    `tools/fx-spike/{playerReduce.ts,package.json}`, `docs/STATUS.md`.

- **Phase 4 (pipeline wiring) — increment 2: export → bake → pull (the asset-travel half) —
  ✅ DONE HEADLESSLY (2026-06-24, branch `fx/phase1-emitter-core`, NO game bump — Borut bumps
  when the trigger increment + a game mounting `<EffectPlayer>` land).** Per §8 (RULE 8). Makes
  an authored effect actually TRAVEL into a built game's bundle so `bakedEffects()` returns real
  effects — the DATA half of Phase 4 (the Flow trigger + a game mounting `<EffectPlayer>` are the
  NEXT increment). Mirrors the Invisible Flow pipeline (Phase 6/7), the closest template.
  **Landed (the 3 stages):**

  - **Export** — `apps/launcher-api/src/lib/server/effectExport.ts` `exportEffects` (mirrors
    `flowExport.ts`, but MULTI-DOC like `fxStorage`): loads every saved `<id>.fx.json`, re-runs
    `normalizeEffectDoc` (THE gatekeeper — only the PURE doc travels, editor-only state can never
    reach `deploy/`), writes each to `<client>/<project>/deploy/effects/<id>.json` + an
    `index.json`, and prunes stale objects so the deploy mirror matches the source (un-authored ⇒
    no effects, parity). Like a FlowDoc it ships NO binary assets of its own — the particle ART is
    an atlas the editor-art export already ships, FX references it by `art.assetKey` (never
    re-packs textures, §4/§8). It also returns `referencedAssetKeys` (the distinct `art.assetKey`
    set) so the bake can run the dangling-key guard. New endpoint
    `apps/launcher-api/src/routes/api/editor/export-effects/+server.ts` mirrors `export-flow`
    (deploy-token gated; called by the bake, no launcher session).
  - **Bake** — `scripts/bake-editor-doc.mjs` now POSTs `export-effects` alongside the
    art/font/symbol/flow exports and embeds the returned `EffectDoc[]` into `bundle.effects`
    ONLY when non-empty (parity — the bundle stays byte-identical for every game with no FX);
    summary log gains `effects={N}`. `bake:doc` already runs BEFORE `pull:assets` (the known
    trap), so the embed + the deploy write land before the mirror.
  - **Pull** — `pull-project-assets.mjs` already mirrors the whole `deploy/` tree verbatim, so
    `deploy/effects/` rides along with NO endpoint change (`/api/deploy` lists/serves it
    generically); only its `GENERATED_SUBTREES` prune list gained `effects` so a deleted effect's
    stale file is cleaned from `static/assets/`.
  - **Dangling-`assetKey` guard (§8 — the invisible-effect trap; the particle analogue of
    [[gotcha_manifest_region_no_geometry_dropped]]):** at bake each effect's `art.assetKey` is
    checked against the SHIPPED atlases (`editorArt.sheets[].key` + `editorArt.images[].key`). A
    referenced atlas NOT in the shipped set never reaches the game's `loadedAssets` ⇒ textureless
    invisible particles — so the bake WARNS loudly (non-fatal: the atlas ships only because the
    layout ALSO places it, since FX never re-packs, so an FX-authored project may legitimately
    add the atlas to its layout before shipping; a warning beats a silent invisible effect).
  - **Verified headlessly** by new `tools/fx-spike/pipeline.ts` (`pnpm --filter fx-spike run
pipeline`): **22/22 GREEN** against the REAL `normalizeEffectDoc` — (1) EXPORT shape (each
    doc PURE-normalized: doc-level `camera`/`selectedLayer` + layer-level junk STRIPPED, the
    nested `EmitterConfigV3` VERBATIM, layers in order, the `{id,name,layers}` index row,
    `referencedAssetKeys` deduped, un-authored ⇒ nothing); (2) BAKE embedding (non-empty ⇒
    `bundle.effects`, empty ⇒ OMITTED for parity) + `bakedEffects()`'s `source.effects ?? []`
    resolution returns the embedded docs byte-identically (and `[]` for an un-baked game); (3)
    DANGLING detection (all-shipped ⇒ clean, a missing atlas flagged, a key shipped as a
    standalone image also resolves — no false positive). The pure helpers MIRROR the production
    logic so the harness pins it. The increment-1/2/3 + Phase-2 + Phase-4-inc-1 harnesses
    (roundtrip/model/save/placement/player) ALL still PASS; `node --check` GREEN on both edited
    `.mjs` scripts. **Builds GREEN:** `pnpm --filter launcher-api build` (the
    `api/editor/export-effects` endpoint + `effectExport` chunk), `pnpm --filter lines build`
    (the `bakedEffects()` reader), `engine-fx` typecheck. Prettier clean.
  - **NEEDS LIVE OWNER-VERIFY (authed publish — not headless):** a real publish actually shipping
    an effect into a game bundle — `export-effects` writes `deploy/effects/`, the bake embeds +
    the dangling guard fires when an effect's atlas isn't placed in the layout, the pull mirrors
    into `static/assets/`, and `bakedEffects()` returns the baked effect in the deployed game.
    (The full HTTP bake against a live launcher + R2 is part of this owner-verify; the pure
    embed/guard logic is proven headlessly.) Watch the build-env token trap (no deploy token in
    the build env ⇒ stale/missing assets, [[project_component_art_to_game]]).
  - **Borut note:** Book of Borut bumps its `engine` submodule to GAIN effects only once the
    trigger increment + a game mounting `<EffectPlayer>` land — NOT this increment (the data
    travels, but no game instantiates an `<EffectPlayer>` yet).
  - **Exact next increment:** the Flow/event-bus TRIGGER — subscribe a layer to
    `trigger.eventType` on `utils-event-emitter` (flip the `<EffectPlayer>` event-dormant
    `layerEmits` seam so a Flow Broadcast fires the effect), bind to the game's
    `EmitterVocabulary` — AND a game mounting `<EffectPlayer>` per `bakedEffects()` entry inside
    the relevant `<SpineProvider>` (so a `bone` layer resolves on the host rig). At that point
    Book of Borut bumps its `engine` submodule.
  - Files: `apps/launcher-api/src/lib/server/effectExport.ts`,
    `apps/launcher-api/src/routes/api/editor/export-effects/+server.ts`,
    `apps/launcher-api/scripts/{bake-editor-doc.mjs,pull-project-assets.mjs}`,
    `tools/fx-spike/{pipeline.ts,package.json}`, `docs/STATUS.md`.

- **Phase 4 (pipeline wiring) — increment 3: the TRIGGER — effects FIRE in a game — ✅ DONE
  HEADLESSLY (2026-06-25, branch `fx/phase1-emitter-core`, no game bump yet).** Closes the
  Phase-4 author→ship→FIRE loop: a baked effect now PLAYS in the running game, and a
  `trigger.on:'event'` layer fires on a game/Flow event. **Landed:**

  - **Emit seam** (`engine-fx` `playerPlan.ts`): `layerTrigger(layer) → LayerEmitPlan`
    (`mode 'always'|'event'`, mount-time `emit`, `eventType`, `duration`); `planLayer` carries
    it; `layerEmits` kept as a back-compat wrapper. PURE — the single source of truth for emit
    gating. An `event` layer with no `eventType` stays dormant (can never fire — the fail-safe
    analogue of a bone layer with no bone).
  - **`<EffectLayer>`** (new `pixi-svelte` component): splits the per-layer mount out of
    `<EffectPlayer>` so each layer has its OWN reactive `emit` + trigger lifecycle. Ambient
    (`always`) emits from mount; `event` subscribes `trigger.eventType` on the shared bus via
    `getContextEventEmitter().eventEmitter.subscribe({ [type]: … })` — the REAL
    `utils-event-emitter` API (the lifecycle-free `subscribe` built for `$effect` use, returns
    an unsubscribe) — pulsing `emit` true on each matching event and back to false after
    `trigger.duration` ms (re-fire RESETS the stop timer; no duration ⇒ the config's
    `emitterLifetime` governs the burst). Unsubscribes + clears the timer on destroy. The bus
    `type` is EXACTLY what a Flow Broadcast emits — the FX⇄Flow seam (§1/§4.4). `<EffectPlayer>`
    now just maps each layer to `<EffectLayer>`; `pixi-svelte` deps `utils-event-emitter`.
  - **`ParticleEmitter.svelte`**: `emit:false` now stops the emitter (so an event layer that
    ran its `duration` ceases; existing particles fade via lifetime). Ambient layers keep
    `emit:true` ⇒ the SAME `init` branch as before (byte-identical, no regression).
  - **Game mount** (`apps/lines/src/components/Effects.svelte`, mounted in `Game.svelte`):
    one `<EffectPlayer>` per `bakedEffects()` doc — all-`free` effects at scene level, any-`bone`
    effect INSIDE a host `<SpineProvider key="foregroundAnimation">` so `<SpineBoneAttach>`
    resolves the bone on the HOST game's rig (the Phase-2 carry-forward). Zero baked effects ⇒
    nothing mounts ⇒ byte-identical (parity).
  - **Verified headlessly** by `tools/fx-spike/trigger.ts` (`pnpm --filter fx-spike run
trigger`): **18/18 GREEN** driving the REAL `createEventEmitter` bus — ambient emits + ignores
    events; an event layer is dormant, a non-matching event doesn't start it, the matching event
    starts it, it stops after `duration`, a re-fire restarts + a mid-burst re-fire RESETS the
    timer, a duration-less layer never auto-stops, and after dispose the event no longer fires it;
    plus the pure `layerTrigger`/`planLayer` classification. ALL prior fx harnesses PASS. Builds
    GREEN: `engine-fx` typecheck, `pnpm --filter {pixi-svelte,lines,launcher-api} build`. Prettier
    clean.
  - **NEEDS LIVE OWNER-VERIFY** (WebGL + a published game): a real game FIRING a baked effect on
    an event (free + bone-placed), the bone layer riding the `foregroundAnimation` rig, the
    `duration` stop; confirm the host-rig key + `canvasSizes()` assumptions in `Effects.svelte`
    fit the target game. **Borut:** now eligible — bump its `engine` submodule after this lands on
    main + owner-verify.
  - **Remaining FX work:** a `/fx` `trigger.eventType` PICKER (author "fire on event Y" in the
    UI — the runtime binding works now; this is UI polish), and Tier C / Phase 3 (spine-as-
    particle, Phase-0 gated). Files: `packages/engine-fx/src/playerPlan.ts`,
    `packages/pixi-svelte/src/lib/components/{EffectLayer,EffectPlayer,ParticleEmitter}.svelte`
    (+`package.json`), `apps/lines/src/components/{Effects,Game}.svelte`,
    `tools/fx-spike/{trigger.ts,package.json}`, `docs/STATUS.md`.

- **`/fx` trigger PICKER (author "fire on event Y" in the tool) — ✅ DONE HEADLESSLY
  (2026-06-25, branch `fx/phase1-emitter-core`, no game bump).** The runtime trigger binding
  already works (the inc-3 `<EffectLayer>` subscribes `trigger.eventType` on the event bus);
  this exposes it in the `/fx` inspector so an author can SET it. Closes the "open: trigger
  picker" item in §0. **Landed:**

  - **Inspector "Trigger" section** (`apps/launcher-api/src/routes/(app)/fx/+page.svelte`, per
    selected layer, between Placement and Emitter): a **Mode** select — **Always (ambient)** vs
    **On event**; when On event, an **Event** picker + a **Duration (ms)** input (blank ⇒ the
    config's `emitterLifetime` governs). Edits the doc IMMUTABLY through the new mutators, like
    every other inspector control.
  - **Event source = the project's emitter vocabulary, REUSED (the FX⇄Flow seam, §4.4).** The
    `/fx` `+page.server.ts` loader now `loadDoc()`s the project LayoutDoc and runs
    `resolveFlowVocabulary(layout.gameType)` — the SAME `$lib/flowVocabularies` source `/flow`
    uses (Flow Phase 7, codegen'd from each game's `typesEmitterEvent.ts`) — and surfaces the
    broadcastable event `type`s as `data.eventTypes`. A layer's `eventType` is therefore exactly
    a `type` a Flow Broadcast can emit. **No-vocabulary fallback:** an unrecognized/absent game
    falls back to `DEFAULT_EMITTER_VOCABULARY`; if even that yields no events, the Event control
    degrades to a FREE-TEXT input (with a hint) so the picker never dead-ends.
  - **Pure trigger mutators** in `fxModel.client.ts` (`setTriggerMode` / `setTriggerEvent` /
    `setTriggerDuration` + the `triggerMode` readout): edit ONLY `layer.trigger`, never the
    verbatim `config` (or `placement`). Switching to `always` DROPS `eventType`/`duration`
    (mirroring `setPlacementSpace('free')` dropping the bone); an event↔event toggle KEEPS them;
    a blank duration (NaN via the page's new `numOrBlank` helper) clears it ⇒ `emitterLifetime`
    governs. PixiJS-free so the harness covers them.
  - **normalize round-trip confirmed** — `normalizeEffectDoc` already round-trips `trigger`
    cleanly (the Phase-1 harness asserts event+ambient triggers). Verified every shape the picker
    can produce (ambient / event+type+duration / event+type-no-duration / event-no-type-dormant)
    survives save→reopen byte-identically; no normalizer or mutator change was needed.
  - **Verified headlessly** by `tools/fx-spike/triggerPicker.ts` (`pnpm --filter fx-spike run
trigger-ui`): **31/31 GREEN** — the mutators are pure/immutable + touch only `trigger`, the
    always↔event drop/keep gating holds, and an authored trigger (incl. a picker-BUILT one driven
    through JSON→`normalizeEffectDoc`) is a normalize FIXED POINT + idempotent. ALL prior fx
    harnesses (roundtrip/model/save/placement/player/pipeline/trigger) still PASS. `pnpm --filter
launcher-api build` **GREEN** (the `(app)/fx` entry grew to 21.05 kB; the loader now links the
    `flowVocabularies` chunk). Prettier clean.
  - **NEEDS LIVE OWNER-VERIFY (authed page — not browser-verifiable here):** the dropdown
    POPULATES from the project's vocabulary (and degrades to free-text when there's none), and an
    authored trigger SURVIVES save→reopen in the live `/fx`.
  - **Docs:** the `/fx` UI gained a Trigger section — `docs/tools/fx.md` wants a refresh (a later
    `docs-keeper` pass; not written here, RULE 9 already satisfied since the tool is registered).
    Did NOT register a new tool / touch `roles.ts` / bump any game submodule.
  - **Remaining FX work:** Tier C / Phase 3 (spine-as-particle, Phase-0 gated). Files:
    `apps/launcher-api/src/routes/(app)/fx/{+page.svelte,+page.server.ts,fxModel.client.ts}`,
    `tools/fx-spike/{triggerPicker.ts,package.json}`, `docs/STATUS.md`.

- **Phase 0 — Tier C SPINE-AS-PARTICLE spike (the make-or-break gate) — VERDICT: NATIVE
  VIABLE — ✅ PROVEN HEADLESSLY (2026-06-25, branch `fx/phase1-emitter-core`, no game bump,
  SPIKE ONLY — no Tier C tool/runtime built, not committed by the spike author).** Per §5
  Tier C + §7 Phase 0 + §10. Settles the one open Tier-C question: can each particle be a
  pooled `Spine` skeleton instance playing a clip (a burst of 30 spinning coins, each a real
  skeleton), rendering + animating + recycling at a real particle count — or must Tier C ship
  via the flipbook-bake fallback? **VERDICT: a NATIVE pooled-`SpineParticle` is mechanically
  viable** (rendering pixels + real-clip perf at count remain owner-verify-live — see caveat).
  - **The library code that decides it** (`@barvynkoa/particle-emitter@0.0.1`,
    `lib/particle-emitter.es.js` / `lib/Particle.d.ts`): the particle class is HARD-CODED —
    `class Particle extends Sprite` (L1675) and every spawn site allocates `new Particle(this)`
    (L1943 `fillPool`, L2195 + L2332 spawn) with NO particle-class factory hook; the pool is
    `Particle`-typed (`_poolFirst: Particle`, `recycle(particle: Particle)`). So **a particle
    can never BE a `Spine`.** BUT the behavior system is fully pluggable: `Emitter.registerBehavior` - the `IEmitterBehavior` interface (`{ order, initParticles, updateParticle?,
recycleParticle? }`, `lib/behaviors/Behaviors.d.ts`) — every art behavior is just a
    registered behavior mutating the particle (`SingleTexture`/`Animated` set `particle.texture`,
    `Color` sets `.tint`, `Scale` sets `.scale`, all `Sprite` props). Crucially `Particle extends
Sprite extends Container`, and the `recycleParticle(particle, natural)` hook fires on every
    death (L1955, before the particle returns to `_poolFirst`). So the native Tier-C mechanism is
    **a custom `spineParticle` behavior that owns a POOL of `Spine` instances** (each `Spine
extends ViewContainer`, a Container, confirmed `spine-pixi-v8` `dist/Spine.d.ts:155`): on
    spawn take one from the pool, `state.setAnimation`, add its view to the layer container; each
    frame advance its clip + track the (textureless) particle's transform; on `recycleParticle`
    reset + return to the pool. Never a skeleton per-particle-per-frame.
  - **The spike** (`tools/fx-spike/spineParticle.ts`, `pnpm --filter fx-spike run spine-particle`):
    **18/18 GREEN.** Drives the REAL `@barvynkoa` `Emitter` (it runs in Node — Pixi
    `Container`/`Sprite` construct without a renderer; confirmed) at `maxParticles:30` (the doc's
    "burst of 30 coins") with a custom `spineParticle` behavior backed by a pool of REAL
    `@esotericsoftware/spine-core` `Skeleton` + `AnimationState` instances (the UN-MANGLED core,
    so the state machine + class names are genuine, per [[gotcha_minified_spine_constructor_name]]
    — a synthetic `spin` clip rotates a bone 0→360° over a real 1s timeline). PROVES the three
    Phase-0 asks: **(a) bounded allocation** — 30 skeletons pre-allocated up-front, then across
    1500 frames (~24s, dozens of particle lifetimes) NOT ONE further skeleton is allocated (the
    whole perf claim — counted via the `SpineBacking` ctor); **(b) the per-particle lifecycle
    drives the skeleton** — spawn→`setAnimation`, `update(dt)` advances the clip (a live
    skeleton's bone is asserted non-zero, i.e. the clip ran), death→reset+return-to-pool;
    **(c) composes with the emitter lifecycle without leaking** — live skeletons === live
    particles every step, pool + live partition the fixed 30 allocation, and on drain (emit off,
    all particles die) ALL 30 return to the pool, both display trees empty, still zero extra
    allocation. Prettier clean; the prior 8 fx harnesses (roundtrip/model/save/placement/player/
    pipeline/trigger/trigger-ui) ALL still PASS.
  - **PERF CAVEAT — owner-verify-live (the spike proves MECHANICS, not GPU/CPU cost):** the
    headless spike proves the pool/lifecycle SHAPE is sound and allocation-free, but cannot
    measure the real cost of N live skeletons each running `state.update`+`apply`+
    `updateWorldTransform` AND a draw call per frame on the GPU. A real `Spine` is far heavier
    than a `Sprite` particle (per-frame skeletal solve + mesh deform + its own draw call, no
    batching across instances). So the **pool-size CEILING must be owner-verified live** at a
    real count on the target hardware — expect tens, not hundreds (30 coins fine; a 500-particle
    spark burst as skeletons is NOT the use case — that's still Tier A). Recommend the Tier-C
    authoring UI cap `maxParticles` low for `particleKind:'spine'` and surface a perf hint. If a
    live count proves too costly for a given effect, the **flipbook-bake fallback remains
    available per-effect** (it ships _something_ regardless, §5) — bake that clip to a sprite
    sheet, ride Tier A `animatedSingle`. Native and fallback are not mutually exclusive: native
    for low-count hero bursts, flipbook for dense ones.
  - **Recommended Tier-C build plan (native path won):** (1) a `SpineParticleBehavior` in
    `engine-fx` (registered via `Emitter.registerBehavior`) implementing the pooled-`Spine`
    mechanism above, parameterised by the EffectDoc's `spineParticle` ({ `skeletonKey`,
    `animation`, `loop` }) — pool size derived from `config.maxParticles`, pre-warmed; the spine
    views render in the emitter's layer container, tracking each particle's transform/alpha each
    frame (the spike's exact shape). (2) Runtime: `<EffectLayer>` already SKIPS
    `particleKind:'spine'` (the guarded TODO) — flip it to register the behavior + inject the
    config, resolving `spineParticle.skeletonKey` against the game's `loadedAssets` `LoadedSpine`
    (the skeleton must travel the pipeline like an atlas does — §8). (3) `/fx` tool: a
    `particleKind` toggle + a `skeletonKey`/`animation`/`loop` picker (reuse the Phase-2
    `/spine/skeletons` + `fxSpine.client.ts` loader already in the page); the live preview pools
    real `Spine` instances. (4) Pipeline: `spineParticle.skeletonKey` is a NEW referenced-asset
    class for the bake's dangling-key guard (the skeleton bundle must be in the shipped set, the
    spine analogue of the atlas `art.assetKey` check). (5) `normalizeEffectDoc` ALREADY gates
    `spineParticle` to `particleKind:'spine'` (Phase-1 inc-1) — the schema is ready.
  - **Owner-verify-live (the pixels + perf — NOT headless):** a real game (or the `/fx` preview)
    rendering N pooled `Spine` particles each playing a clip, recycling cleanly, at an acceptable
    frame budget on target hardware — and the pool-size ceiling that holds 60fps. The spike
    proves the allocation/lifecycle/leak math; only a live run proves the GPU/CPU cost.
  - Files (spike only): `tools/fx-spike/spineParticle.ts`,
    `tools/fx-spike/package.json` (+`spine-particle` script, +`@esotericsoftware/spine-core`, +`pixi.js` dev deps).

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
