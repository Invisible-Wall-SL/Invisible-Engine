# Invisible FX — status

> Design: [docs/design/invisible-fx.md](../design/invisible-fx.md) · Guide: [docs/tools/fx.md](../tools/fx.md) · Agent: `.claude/agents/invisible-fx.md`

**One-line state:** Shipped on `main` — all three particle tiers, the event trigger, a pro emitter inspector and rig-timeline binding are live, and a rig plays its bound FX wherever it is mounted. Open: the Tier-C perf ceiling, an owner pass over the Min / Max rows, and a pixel check on a rig FX mounted outside a layout rig node.

## Current state
Live on `main`, owner-verified in the 2026-06-29 pass except the ⏳ items called out below.

- **All three tiers ship** (`/fx`, `fx` tool scope): **A** sprite/flipbook particles from project atlas regions, **B** an emitter pinned onto a bone of a playing rig backdrop (`RigBoneAttach`), and **C** whole rig clips *as* the particles (pooled `RigParticleBehavior`). The `skeletonKey` key-stability seam for Tier-C shipping is closed.
- **Event trigger end-to-end.** A `trigger.on:'event'` layer fires when a matching cue crosses the runtime event bus (a Flow v1 Broadcast / v2 `fireCue`), with an optional **Stop event** and **Duration**. The full author→ship→fire chain (export → `deploy/effects/` → bake → pull → `bakedEffects()` register) is wired.
- **Pro `/fx` inspector knobs:** emission **direction (centre °) + spread (±°)**, particle **spin min/max + accel**, a **rotation lock** (`noRotation` — travel along the arc without facing it), and a **Sprite** section — a fixed art **rotation offset** + a **pivot** (anchor) grid (see the 2026-10-14 entry); a **movement** toggle (eased `moveSpeed` vs **acceleration** — up-direction + a downward pull = a fountain); a stackable **Forces** section (gravity at any angle, wind with gusts, vortex with swirl + centrifugal/centripetal radial, attractor/repulsor with an absorb sink, turbulence, drag — see the 2026-10-13 entry); **colour** start/end tint **plus a colour overlay with a per-particle intensity min/max**; **blend mode** (Normal/Add/Screen/Multiply); five **spawn kinds** — point / circle / ring / rectangle / **burst** (even fan). Alpha, Scale and the eased Speed each carry an **On** switch (a config with no such behavior can grow one instead of the section silently vanishing) and a **Min / Max** switch that splits each end into a per-particle range — four INDEPENDENT bounds (see the 2026-08-28 fix entry). All are live sliders + number boxes that re-tune the preview verbatim.
- **Layer stack ops** — ▲/▼ reorder (list order IS draw order; `FxStage` re-appends the emitter containers in doc order each rebuild so the preview restacks), ⧉ duplicate, and a `localStorage`-backed **⧉ Copy / 📋 Paste** that survives navigation, so a layer moves **between effects**.
- **Flipbook playback is authorable** — an `animated` layer chooses **Match particle lifetime** (`framerate: -1`, the long-standing default) or an explicit **fps + loop**, carried on `art.framerate`/`art.loop` through `bindArt` at all four render sites.
- **Preset library** — per-layer "Apply preset…" (Fountain, Fire, Smoke, Sparks, Explosion-burst, Rain, Snow, Confetti, Magic glow) preserving art/placement/trigger.
- **Rig-timeline direct binding** — on a Rigger event keyframe you pick the effect, its host bone, the SLOT it draws at, and per-binding opacity / size / delay / duration / speed, and a **Continuous** flag that stops a looping clip restarting an ambient burst every lap (`evtObj.fx`), baked to a `rigFx` manifest and played by `RiggedEffect` on the beat (`forceEmit`); the cue-broadcast path stays as the advanced mode. A *persistent* rig FX slot (an always-on, keyable emitter — the other half of invisible-cinematic §12.4a) is still NOT built.
- **…and it plays on ANY rig, mounted by anything** (2026-09-04). `<RigProvider>` resolves and mounts a rig's bound effects + clips itself, through the `pixi-svelte` `rigBoundContent` seam `engine-layout` fills in — so a binding works on a rig reached by a coded component (the big-win `WinAnimation`, backdrops, transitions, cinematic actors) exactly as on a placed `spine` node. Authoring is unchanged; the binding was always baked, it just had two readers. See the 2026-09-04 entry.
- **Live particle previews everywhere** — the effect plays not just in `/fx` (`FxStage`) but in the **Rigger** and **Symbols state machine** via the shared `fxOverlay` on their raw-WebGL stages, all now riding the bone's **full transform** (position + rotation + per-axis scale) to match the game.
- **Effect atlases auto-ship** — `exportEditorArt` walks the project's effects and ships every layer's `art.assetKey`, so a placed/bound effect's particles have textures with no extra step.

⏳ **Still open (live-verify):** Tier-C rig-particle **GPU/perf ceiling** in a published game (expect tens, not hundreds); owner pixel-verify of the rig-bound FX size/rotation on live WebGL across `/symbols`, `/rigger`, and the game. The rotation was wrong in the game until the 2026-10-15 fix. The best check is a bone keyed through 90°, where the old code drew the FX upside down.

## Open items / next
- **Owner browser-pass over the Sprite section** (2026-10-14) — rotate a directional sprite (an arrow or a streak) and check it turns by the slider amount without changing its flight, and that Top / Bottom / Left / Right pivots put that edge on the spawn point (easiest with a big sprite and a single slow particle).
0. **Owner browser-pass over the Forces section** (2026-10-13) — the math and the real-`Emitter` coupling are gated headlessly, but no slider has been dragged in a browser. Worth checking while there: a Fire / Smoke / Fountain / Sparks / Rain preset now goes the way its name says (see the entry), and an existing effect's Direction reads the way its particles actually fly.
1. **Owner browser-pass over the Min / Max rows.** Two passes have now happened and each found a real defect (see the two 2026-08-28 fix entries) — the model is heavily covered headlessly, but every symptom so far has been a CLICK, and `/fx` is auth + Postgres + R2 gated so those sliders still cannot be driven from a session. A third pass on the corrected rows is owed.
2. **Tier-C perf ceiling live-verify** — confirm a published game renders a rig-particle effect at 60fps and find the pool-size ceiling; flipbook-bake stays the per-effect fallback.
3. **Owner pixel-check on a rig FX mounted OUTSIDE a layout rig node** (the 2026-09-04 change) — the reported case is the best one: play a big win in `invisible_wall/test6` and confirm `v_winripple` fires on `R_Wins`'s tier animations at `bone114`/`slot12`. `?fxdebug=1` on the game URL prints how every baked effect is routed. While there: that rig keys the SAME effect `continuous` on all ten tier animations, and a binding is one keyframe — so `Big_Intro → Big_Idle → Super_Intro` stacks three independent never-stopping emitters. `continuous` should be keyed ONCE, on the animation that starts it. **Also worth an eye on the BACKGROUND rigs:** `engine-game`'s `Background.svelte` mounts `foregroundAnimation` (and `foregroundFeatureAnimation`) TWICE concurrently — one instance driving `idle`, one driving `dust` — and each instance now mounts the rig's whole binding set independently. A binding that carries its `animation` is self-limiting (it only fires in the instance playing that animation), but a LEGACY manifest entry baked before beats existed has no `animation` and matches any, so such a binding on a background rig would fire twice, at double density. Nothing baked today is in that shape; re-bake rather than patch if it shows up.
4. Consolidation candidate: **three FX renderers** (engine `RigBoneAttach`, `/fx` `FxStage`, tool `fxOverlay`) are kept in sync by hand — a future unify. The 2026-08-28 change added a FIFTH thing they must each do (`registerFxBehaviors`), mitigated by routing all three launcher stages through `effectEmitter.client.ts`.

## Blocked (owner / external)
- **Owner live-verify** of the WebGL pixels / Tier-C perf is the gate on marking those items done.

## Recent changes
- 2026-10-15 — **A bone-bound FX turned the opposite way to its bone in the game.** Owner report:
  an FX parented to a bone looked right in `/fx` and the Rigger, but in the exported game it had a
  different orientation.
  - **Cause.** `<RigBoneAttach followRotation>` set `rotation = -bone.getWorldRotationX()`, a
    y-up → y-down flip. But RigView poses its skeleton y-down already, so the flip ran twice and the
    attachment turned by −θ where the bone turned by +θ. Only 0° and 180° agreed. The Rigger and
    `/symbols` previews read the angle of the bone's projected x-axis (`fxMatrix`), which is right,
    so the game was the odd one out. A binding with a **draw slot** had a second error: it mounts
    under the slot host, which RigView already turns to the slot's bone, and the bone's angle was
    added on top of that.
  - **Fix.** One rule, `pixi-svelte` `boneRotationInParent` (`src/lib/rigBoneRotation.ts`). It takes
    the bone's x-axis in the rig's frame, maps it to world, and maps it back into the attachment's
    parent frame. `<RigBoneAttach>` uses it, so this fixes every bone follower in the game: rig FX
    (`RiggedEffect`), Rigger flipbook clips (`RiggedFlipbook`), Tier-B bone layers (`EffectLayer`)
    and the bone-ridden reveal symbol. All of them now match their editor previews. `/fx`'s
    `FxStage` had the same formula on the same y-down RigView, so its Tier-B backdrop was mirrored
    too. It now calls the same helper.
  - **Verified.** New fixture `packages/pixi-svelte/fixtures/rigBoneRotation.fixture.ts` runs against
    a real engine-rig skeleton. It checks a plain mount, a fitted rig, a rig flipped on X, a slot on
    the same bone or another bone, and a sibling host. It also checks that the game's angle equals
    the Rigger preview's for every pose. I ran two mutations: the old sign fails it, and so does
    ignoring the parent frame. Prettier, lint, `check:undefined-names`, `check:svelte`
    (pixi-svelte + launcher at baseline) and `check:vendored-bundles` all pass. **Not
    pixel-verified in a browser.** **Engine change:** live games get it with the next runtime
    release. Any game with a bone follower on a ROTATED bone will look different from today, and
    it will now match what the editor showed.
- 2026-10-14 — **Sprite rotation + pivot on sprite layers.** Owner ask: rotate the art the way it
  spawns on the particle, and choose whether it spawns at its centre, top, bottom, left or right.
  - **What shipped.** A **Sprite** section under Art (sprite layers only): **Rotation (°)**
    −180..180, a 3×3 **Pivot** grid (centre, edges, corners) plus **Pivot X / Y** 0..1 for any
    point in between. One new custom behavior, `fxSprite` (`packages/engine-fx/src/sprite.ts`).
  - **How it works.** The pivot is the particle's `anchor`. The rotation offset is NOT added to
    `particle.rotation`, which is also the launch direction and what spin, `noRotation` and
    rotate-to-travel write. It rides on `skew = (−θ, θ)`, which PIXI's matrix turns into a pure
    rotation by `rotation + θ`, so the offset composes with all of them and the particle flies
    exactly where it did before. `recycleParticle` resets both fields, because pooled particles
    keep them across `emitter.init` (switching the section back to defaults in the editor would
    otherwise leave stale art).
  - **Back-compat.** Like `fxForces`, it lives in `layer.config.behaviors`, so no EffectDoc schema
    or ship-chain change. A layer at the defaults carries no `fxSprite`, so existing effects are
    byte-identical; **Apply preset…** keeps the layer's sprite settings. Registered in
    `registerFxBehaviors`, so the runtime, `/fx`, the Scene Editor and the Rigger/Symbols overlay
    all render it; `rigger-fx.js` rebuilt.
  - **Verified.** `pnpm check:fx-sprite` (new, discovered by `check:all`): the clamp, defaults ⇒
    no behavior, position + rotation identical with and without the offset on the real `Emitter`,
    PIXI's own local matrix is an unsheared rotation by `rotation + θ`, recycle resets, preset
    keeps it, and the save → export → bake chain carries it verbatim. All 16 fx-spike gates,
    lint and `check:vendored-bundles` pass. **Not driven in a browser** — owner pass owed.
- 2026-10-13 — **The Rigger now plays the forces; every vendored bundle is gated against its source.**
  Owner report: the new forces did not play in the Rigger. The Rigger's static `view.html` loads a
  COMMITTED build of `fxOverlay` (`static/rigger/vendor/rigger-fx.js`), not the source, and the
  forces PR never rebuilt it — the bundle had last been built at #1108, so it had no `fxForces` and
  was still on PixiJS ~8.8 while the launcher runs ~8.22. Rebuilt `rigger-fx.js`, and
  `rigger-text.js`, which had drifted the same way. A "rebuild `rigger-fx.js` after editing the
  overlay" note had been written five times in the Rigger docs and still decayed, so the fix is a
  gate rather than another note: `pnpm --filter launcher-api check:vendored-bundles` rebuilds
  `rigger-fx.js`, `rigger-text.js` and `invisible-rig.js` into a temp dir and fails if any differs
  byte-for-byte from the committed file, naming the `build:<name>` that fixes it (the builds are
  deterministic). `check:all` discovers it, so CI runs it with no workflow edit. Verified: it fails
  on the stale bundles and passes after the rebuild. Not driven in a browser.
- 2026-10-13 — **Forces: stackable gravity / wind / vortex / attractor / turbulence / drag on every layer.**
  Owner ask: controllable gravity, a vortex that can also throw particles outward, and any other
  forces worth having.
  - **What shipped.** One new custom behavior, `fxForces` (`packages/engine-fx/src/forces.ts`). Its
    config is a stack of entries, each with an `enabled` switch:
    - **gravity**: strength, angle;
    - **wind**: strength, angle, gust 0..1, gusts/s;
    - **vortex**: centre x/y (offset from the emitter), swirl, CW/CCW, radial (+ out = centrifugal,
      − in = centripetal), radius, falloff;
    - **attractor**: centre, ± strength, radius, falloff, absorb radius (particles inside it are
      recycled);
    - **turbulence**: strength, cell size, evolve/s. It is a two-octave curl field, so particles
      swirl without bunching;
    - **drag**: amount.

    The `/fx` inspector has a **Forces** section with **Add a force…**, and each entry has **On**,
    **✕**, and slider + number-box rows.
  - **How it combines with movement.** No movement behavior is replaced. With `moveAcceleration`
    or `moveSpeedStatic` on the layer, the forces add into that behavior's `config.velocity`, so its
    max-speed cap and rotate-to-travel apply to the forced motion and drag slows the launch. With
    anything else (`moveSpeed`/`fxSpeed`, or no movement) the forces keep their own velocity, from
    rest, and add it on top. So Gravity works in either movement mode. The old acceleration-mode
    knobs are untouched in the data, so saved effects render the same. Only their labels changed:
    "Acceleration X/Y", "Acceleration (launch + constant pull)".
  - **Frame-rate independent.** Each step uses `deltaSec`, and with drag it is the exact solution
    of `v' = a − k·v`, so the decay and the terminal speed `a/k` do not depend on fps. Gusts and
    turbulence follow particle age, not the frame count.
  - **Back-compat + schema.** Forces live inside `layer.config.behaviors`, the verbatim
    `EmitterConfigV3`, like `fxAlpha`, so there is NO EffectDoc schema change and no
    normalize/export/bake/pull change: those pass `config` through untouched (asserted). A layer
    without forces carries no `fxForces` entry, and removing the last force deletes it, so every
    existing effect stays byte-identical. `readFxForces` is the one clamp: it drops unknown kinds,
    pins ranges, wraps angles and maps NaN to the default. The behavior and the inspector both
    read through it.
  - **One registration.** `fxForces` joins `registerFxBehaviors`, which the runtime
    `<ParticleEmitter>` and the launcher's shared `effectEmitter.client.ts` already call at module
    load, before any emitter is built. That covers `/fx`, the Scene Editor, the Symbols overlay
    and the game — but NOT the Rigger until its committed bundle was rebuilt (next entry).
  - **Pre-existing bug fixed alongside: the angle convention was upside down.** The Direction hint
    (and the guide) said 90° = up. The library rotates in screen space, where y grows down, so 90°
    is DOWN. The real `Emitter` proves it in the gate. As a result the Fountain, Fire, Smoke and
    Sparks presets launched downward and Rain launched upward. Those presets now use 270° / 90°,
    and the hint, guide and `emitterParams.ts` assertion are corrected. Saved effects are NOT
    rewritten: an effect someone tuned by eye already looks the way it was tuned.
  - **Found, not fixed (library):** a stock `moveSpeed` whose start and end values are EQUAL throws
    inside `@barvynkoa/particle-emitter` (`PropertyList.intValueComplex`: `next` is null) on the
    first update. Typing the same Speed start and end in the inspector can therefore hit it. It was
    reproduced headlessly and is untouched here.
  - **Verified.**
    - New gate `pnpm check:fx-forces` (`tools/fx-spike/forces.ts`, 59 assertions, run in CI by
      `check:all` in the Checks workflow like the other fx-spike harnesses). It covers: the clamp; absent forces = no change;
      gravity ½gt² along 0/90/270° with 30 vs 240 fps agreement; vortex radial out/in, CW/CCW
      sense, radius and falloff, centre offset and the no-NaN centre; attractor pull/push/absorb;
      exact drag and terminal speed; wind gust range; turbulence that is bounded, divergence-free
      and deterministic. It then drives the real `Emitter` with no movement, `fxSpeed` and
      `moveAcceleration`, checks the max-speed cap, a vortex on a moved emitter and sink recycling,
      and runs the save → export → bake round-trip that rebuilds the behavior.
    - The 14 other fx-spike harnesses plus `check:rig-fx-overrides` and
      `check:rig-flipbook-overrides` are green.
    - `engine-fx` typecheck and lint are clean. `pnpm check:svelte --only apps/launcher-api` is at
      48, the same as the baseline, with none in FX files.
  - **NOT browser-verified.** `/fx` is auth + Postgres + R2 gated (open item 0). **Engine change on
    `main`**: it reaches shipped games only through a runtime-bundle republish.
- 2026-10-03 — **An effect placed inside a component no longer also bursts at the stage origin**
  (found by the Hold and Win 12c done-when rehearsal, #1006).
  - **The bug:** `Effects.svelte` auto-mounts every event-triggered effect that is not placed, at
    the stage origin. The game's `placedEffectIds()` walked only the scenes, so an effect node
    inside a component def counted as unplaced. An FX in a Pot therefore fired twice on each cue:
    on its pot, and unscoped in the top-left corner, on every pot's cue. Measured at the burst's
    peak: 47 particles from each emitter.
  - **The fix:** one walk, `collectPlacedEffectIds` (engine-layout), over the scenes and every
    shipped def. The game and the launcher's `effectReachability.ts` both call it; the launcher
    already walked the defs.
  - **Verified:** `test-placed-effects.mjs` (6 assertions), and on the real game the same Pot FX
    fires on its own pot only, with 0 particles anywhere else.
- 2026-10-02 — **Trigger scope (Hold and Win Phase 12a, #1003).**
  - `EmitterTrigger.scope` fires a layer only on events about one part (a meter, a tier, a reel),
    matched against the event's `scope`.
  - A layer with no scope takes the scope of the component it is placed in, so a "pot full" effect
    in the Pot fires on its own pot.
  - **Scope** field in `/fx` (`*` = every part); kept by `normalizeEffectDoc` and `layerTrigger`.

  Detail: [hold-and-win](hold-and-win.md).
- 2026-09-30 — **Leaving with unsaved edits asks in-app too.** The page's own `beforeunload` (reload / tab close only) is replaced by the shared `guardUnsavedWork` (`src/lib/unsavedGuard.ts`), so a tool-bar switch or Back with an unsaved effect now raises the app's confirm dialog (Cancel / Leave anyway) instead of discarding it silently. The pagehide lease release is unchanged; opening another effect is still guarded by `confirmDiscard`.
- 2026-09-29 — **Guide refreshed to match the UI** ([tools/fx.md](../tools/fx.md)): Particle → Kind, and the force-save overwrite prompt.
- 2026-09-28 — **A manual Save asks before overwriting a colleague's newer save again.** The Save button was bound `onclick={saveEffect}` where `saveEffect(force = false)`, so the click event arrived as a truthy `force`: the transport sent `force` instead of the base ETag, `writeGuard` skipped its conflict check, and every manual Save was an unconditional overwrite. Now `onclick={() => saveEffect()}`. Same fix in /symbols and /localization (one change). New guard `pnpm --filter launcher-api check:event-bound-flags` (wired into the Lint workflow's *launcher gates hold* step) fails on any function whose first parameter is a boolean bound straight to an `on…` attribute or `addEventListener`; it carries a self-test so a regex drift fails loudly, and it flags all three pre-fix pages. Verified by running the real `SaveState` (Svelte-compiled) against a stub server holding a newer ETag: the old binding sent `{force:true}` with no prompt, the new one sends the stale `baseEtag`, gets the conflict and reaches the overwrite prompt; the three pages compile to `(event, saveEffect) => saveEffect()`. Not driven in a browser (the tools are auth + Postgres + R2 gated). **SHIPPED 2026-09-28** — merged as `3354b50e` (#821); verified live by reading the served client chunks for all three pages: before the deploy each Save button compiled to a direct `__click=<save>`, after it to the wrapped `__click=[handler, <save>]`.
- 2026-09-04 — **A rig plays its bound FX wherever it is mounted: the join moved from the two mount sites into `<RigProvider>`.** Owner-reported: particle FX bound on the rig `R_Wins` (the big-win tier rig in `invisible_wall/test6`) never appeared in game. Nothing was wrong with the authoring or the pipeline — the `.irig` carried ten `event.fx` keyframes → `v_winripple`, `skeletons.json` listed the rig as JSON so the bake keyed the manifest `R_Wins`, and `deploy/effects/v_winripple.json` shipped. **`<RiggedEffect>` was mounted in exactly two places** — `LayoutNodeView`'s `kind:'spine'` branch and `SymbolRigMain` — each carrying its own hand-copy of the same ~25-line resolve-and-mount block. `R_Wins` is neither: it reaches the game as a component PARAM (`winSpine`/`bigRig`) of the `win` component, which binds the coded `WinVisual` → `engine-game`'s `WinAnimation`, which mounts its own `<RigProvider>` and never called `resolveRigFx`. So the binding was baked, correct, and read by nothing — and the same held for **every other rig in the engine**: `Background`, `TransitionAnimation`, `FreeSpinIntro/OutroVisual`, `FreeSpinAnimation`, `Anticipation`, `BoardFrame`, `InfoOverlay`, `Cinematic`/`CinematicActor`, `LayoutScene`, `StackedPicture`. ~20 mount sites, 2 of them wired. (It also rendered NOWHERE else: `Effects.svelte` deliberately excludes rig-bound ids from its free auto-mount to avoid a 0,0 phantom burst.) **Fixed at the seam, not at the site:** new `packages/pixi-svelte/src/lib/rigBoundContent.ts` declares a resolver contract (`setRigBoundContentResolver` / `resolveRigBoundContent`, plus a shared FROZEN empty returned by identity), `<RigProvider>` asks it for whatever is bound to the rig it just resolved and mounts a `<RiggedEffect>` / `<RiggedFlipbook>` per entry, and `engine-layout`'s new `rigBoundContentInstall.ts` fills the contract in from the four registries. The dependency inverts the same way `registerFxBehaviors(Emitter)` does — `pixi-svelte` sits BELOW `engine-layout`, so the lower package declares the shape and the higher one supplies it. **No boot step to forget:** `registerRigFx` / `registerRigFlipbooks` install the resolver themselves, so a game that has bindings always has the lookup and one that has none never pays for it. Both hand-copies deleted (they would now double-mount). The install imports `pixi-svelte/rigBoundContent` — a **new subpath export**, deliberately not the barrel: `registerRigFx` is pulled into `apps/lines`' SSR route analysis, and the barrel drags `webfontloader`, which touches `window` at import time and crashes the prerender (hit and fixed during this change). Keyed by the rig's RESOLVED `assetKey` (already the bundle folder the manifests use, even when the caller passed an editor doc's full R2 prefix). Parity: a rig with no bindings gets the frozen empty by identity ⇒ nothing mounts, no `{#each}` churn. Verified: new headless harness `tools/fx-spike/rigBound.ts` (`pnpm --filter fx-spike run rig-bound`, 34 assertions) covering the un-installed empty, self-install, the full props mapping incl. `slot`→`drawSlot`, folder tolerance, dangling-id drops, the flipbook twin's `foldFlipbookPlayback`, latest-wins re-registration, and a **regression block reproducing the real `R_Wins` rig** (one effect keyed `continuous` on ten animations ⇒ ten DISTINCT `{#each}` keys, since a collision would silently drop nine tiers); the thirteen pre-existing fx-spike harnesses + `check:rig-fx-overrides` / `check:rig-flipbook-overrides` stay green; `svelte-check` clean on every touched file (187 pre-existing errors unchanged — they sit in real source, NOT in `static/assets/**`: `Game.svelte`, the `stories/` fixtures and ~60 other files; what makes them safe is the unchanged COUNT plus the fact that no diagnostic names the new seam); `apps/lines` and `launcher-api` both build. **NOT browser-verified** — `/fx` and the project's game are auth + Postgres + R2 gated, so the WebGL pixels are owner-owned (open item 2). **Engine change on `main` — reaches shipped games only via a runtime-bundle republish.** **SHIPPED 2026-09-04** — merged as `ca74c142` (#590); the shared `_runtime/lines` runtime now carries it (release `4337001`, the `engine(win)` merge that landed 20s behind it and contains it), so every online game on that runtime runs this engine. **Two deploy lessons worth keeping:** the auto-release's *Refresh the test server* step reported SUCCESS while all nine attempts returned 502 — by design, it never fails the job — and `games.invisiblewall.org` was fully down (`/` 502'd too), not mid-rehydrate; the bundle reached the games through the server's boot-time hydrate and the NEXT release's refresh, not through that step. So a green release is not proof: verify the SERVED bundle. The cheap check is a string literal that survives minification — here `grep -c "rigBoundContent] resolver threw"` against `https://games.invisiblewall.org/<game>/_app/immutable/bundle.*.js`, which is how this one was confirmed live.
- 2026-08-28 (fix 2) — **The Min / Max mins are stored ABSOLUTE, and all four thumbs share one axis.** Owner-reported after fix 1: "when I move the start and end MAX, the min also moves". Two causes, both in the presentation of an otherwise-correct model. (1) Each `min` slider was capped at ITS OWN `max`, so dragging the max **rescaled the min's track** — the min thumb slid from 45% to 25% of its groove while its value never changed. All four sliders now share the section's axis (`lo`..`hi`), and overshoot is clamped in `setCurveBound` where it belongs. (2) The floors were stored as RATIOS (`startMult`/`endMult`) and the absolute redisplayed as `max × ratio`, so every drag tick re-derived the min through a divide-then-multiply — invisible in the model tests, but a float smear in the number box and one more place for the two to couple. They are stored as the ABSOLUTE numbers the author typed now (`startMin`/`endMin`); the behavior derives its own ratio at init. Both legacy forms (`startMult`/`endMult` from fix 1, and the library's whole-curve `minMult` in the presets) are still read and migrate on first edit, so nothing already saved renders differently. Verified by simulating real drags tick-by-tick — an 86-tick max drag up and back leaves the min bit-identical. `tools/fx-spike/variation.ts` is at 121 assertions; the eleven other harnesses stay green. Still NOT browser-verified (auth-gated `/fx`).
- 2026-08-28 (fix) — **Min / Max: four bounds that are actually four bounds.** The first cut mapped the inspector's four boxes onto the library's THREE degrees of freedom (one whole-curve `minMult`) and derived the mode from the numbers. Owner-reported, both real: (1) on Scale, clicking a `min` made the sliders vanish and unticked the box — dragging a min to/above its max, or against a zero `End max`, pinned the ratio to 1, and `varied` was `minMult < 1`, so the mode switched ITSELF off; (2) on Movement, moving one end dragged the others, because `startMin`/`endMin` were both derived from that single shared ratio. Fixed at the root: `fxScale` + `fxSpeed` join `fxAlpha` in `engine-fx/src/behaviors.ts`, each mirroring its stock twin but carrying `startMult` **and** `endMult` — two independent floors, drawn per particle and interpolated across its life, so `t=0` lands in `[curve(0)·startMult, curve(0)]` and `t=1` in `[curve(1)·endMult, curve(1)]` independently. Multi-point curves keep their shape (the factor scales the whole list). `varied` is now keyed off the behavior TYPE, never the numbers, so only the toggle can turn the mode off; each `min` slider tops out at its own `max`; and dragging a `max` holds its own `min` at its ABSOLUTE value. A stock `minMult` (the presets, and anything authored before the split) is read as both floors and migrated on first edit, so nothing re-renders differently until it is touched. `fxSpeed` reproduces `SpeedBehavior`'s integration exactly, with one deliberate improvement: the launch direction is stored as a UNIT vector, so a curve starting at 0 cannot hit the stock `normalize()` divide-by-zero. Verified: `engine-fx` typecheck, launcher `tsc` clean over every FX module, `pixi-svelte` + launcher builds, and `tools/fx-spike/variation.ts` grown to ~110 assertions — including a regression block that reproduces BOTH reported bugs and closed-form checks of the new behaviors' particle output. The eleven other fx-spike harnesses stay green. Still NOT browser-verified (auth-gated `/fx`). **Engine change on `main` — reaches shipped games only via a runtime-bundle republish.**
- 2026-08-28 — **Per-particle Min / Max everywhere the library can express it, a colour overlay, spin accel + a rotation lock, flipbook speed/loop, and layer stack ops.** The inspector's biggest gap wasn't a missing knob, it was that a section VANISHED when its behavior was absent (`{#if alphaEnds}`) — so a layer without an alpha curve gave the author no way to add one. Every curve section now carries an **On** switch, and Alpha/Scale/Speed a **Min / Max** switch. The variation itself is the library's own model: `minMult` on `scale`/`moveSpeed` (a random multiplier in `[minMult, 1]` drawn once per particle and applied to the whole curve), so `min` writes the ratio and `max` writes the authored endpoint — and, unavoidably, **one ratio governs both ends of a curve**, which the UI says out loud rather than faking independent bands. `alpha` is the one curve the library gives no `minMult` and NOTHING randomises tint, so `engine-fx/src/behaviors.ts` adds exactly two custom behaviors — **`fxAlpha`** (the stock alpha config plus `minMult`; the two swap by TYPE alone, so variation-off configs stay 100% stock) and **`fxColorOverlay`** (a colour blended in at a per-particle intensity, running at order `Late` so it composes over `color`; it remembers the tint it last wrote, so with no colour behavior present it can't compound its own output into a runaway tint). They are import-free classes and `registerFxBehaviors(Emitter)` takes the class as an argument, keeping `engine-fx` PixiJS-free; the runtime registers in `<ParticleEmitter>` and all three launcher stages inherit it from the shared `effectEmitter.client.ts`. Also: `art.framerate`/`art.loop` (an EffectDoc schema addition — absent ⇒ the old match-life default, so every existing effect is byte-identical) threaded through `bindArt` at all four call sites; spin **accel** and a `noRotation` **angle lock** exposed; **▲▼ reorder / ⧉ duplicate / Copy-Paste-across-effects** in the Layers panel, with `FxStage` re-appending emitter containers in doc order each rebuild so a reorder actually restacks the preview (it only ever added them at creation). Verified: `engine-fx` typecheck, launcher `tsc` clean over every FX module, launcher build, and a new headless harness `tools/fx-spike/variation.ts` (`pnpm --filter fx-spike run variation`, 80 assertions) covering purity, the alpha↔fxAlpha swap, the ratio math, the two behaviors' actual particle output, `registerFxBehaviors`, flipbook binding, layer ops, and save→reopen through `normalizeEffectDoc`. All ten pre-existing fx-spike harnesses stay green. **NOT browser-verified** — `/fx` is auth + Postgres + R2 gated (open item 1). **Engine change on `main` — reaches shipped games only via a runtime-bundle republish.**
- 2026-08-27 — **A rig binding now carries draw depth + five modifiers, not just an effect and a bone.** `evtObj.fx` gained `slot` (draw at that slot's place in the skeleton draw order, via the reference Pixi runtime `addSlotObject`) plus `alpha` / `scale` / `delay` / `duration` / `speed`, all optional and all ABSENT by default so every rig baked before them is byte-identical. `readRigFxOverrides` in `engine-layout` is the single clamp the bake, the runtime registry and both live previews read through, and `rigFxExport.ts` now imports the binding type instead of hand-mirroring it. `duration` closes a real preview-vs-game divergence: `forceEmit` started emission and nothing ended it, so a continuous effect fired from a keyframe emitted forever in-game while the previews capped at ~1.5s. Guarded by `check:rig-fx-overrides` (mutation-verified). Detail + the owed in-game pixel check in [status/rigger](rigger.md).
- 2026-08-20 — **The Tier-B backdrop skeleton never loaded: `loadFxRig` fetched its atlas pages with `Assets.load`.** Pixi's resolver picks a loader by the URL's apparent EXTENSION and drops the query string first, so `/rig-viewer/file?dir=…&name=….webp` reads as extension-less — the load resolves to `null` and reading `.source` off it throws, aborting the skeleton. Exactly the trap the emitters' own page loading was fixed for in July (`/api/editor/asset?key=…`), in the one place that still called `Assets.load`; it now goes through the same `loadPageSource` (fetch → `createImageBitmap` → `ImageSource`). Surfaced via the admin boot-mark preview, which reuses this helper — full story + the live verification in [launcher.md](launcher.md).
- 2026-08-03 — **Preview↔runtime FX speed mismatch fixed — the `/fx` editor now plays effects at the EXACT game speed.** The in-game runtime (`ParticleEmitter.svelte`) advanced the emitter by `deltaMS * 0.00234` (~2.34× real seconds), but the `/fx` preview (`FxStage.svelte`) used `deltaMS / 1000` (1× real seconds) — so an effect ran ~2.34× faster in-game than the editor showed, the drift behind mis-timed authored delays. Both now advance through ONE shared scalar: new `packages/engine-fx/src/playback.ts` — `DEFAULT_EMIT_SPEED = 0.00234`, `emitterDeltaSeconds(deltaMS, emitSpeed?)`, and `emitterSecondsToWallMs(emitterSeconds, emitSpeed?)` (emitter-lifetime → true wall-clock ms; `1/0.00234 ≈ 427ms` per emitter-second). All three emitter-driving renderers now call `emitterDeltaSeconds` — the runtime `ParticleEmitter.svelte`, the `/fx` `FxStage.svelte`, and the shared Rigger/Symbols `fxOverlay.client.ts`; each preview's backdrop RIG stays on real seconds (a rig clip is wall-clock). **Effects now appear ~2.34× faster in the editor than before — that is the correct, game-matching speed, not a regression.** `emitterSecondsToWallMs` also backs Flow v2's new `showContainer.durationMs` pin (an FX node's contribution to a screen's duration). Verified: `engine-fx` typecheck clean + offline scalar math. NOT browser-verified (auth-gated `/fx`). **Engine change on `main` — reaches shipped games only via a runtime-bundle republish.**
- 2026-07-14 — `/symbols` + Rigger `fxOverlay` now apply the bone's full transform, matching the game ([detail in history](../history.md))
- 2026-07-14 — rig FX rides the bone's full transform (rotation + scale) via `followRotation`/`followScale`; published to `_runtime/lines` ([detail in history](../history.md))
- 2026-07-14 — fixed `RigBoneAttach` bone-follow drift in a scaled game (map world→parent-local) ([detail in history](../history.md))
- 2026-07-13 — live runtime bundle now ships FX (effects + rigFx), parity with the offline bake ([detail in history](../history.md))
- 2026-07-13 — rig FX render fixes: cross-talk firing + effect-ignored-rig-transform in `RiggedEffect` ([detail in history](../history.md))
- 2026-07-10 — rig-timeline DIRECT binding (pick an effect on a Rigger keyframe) + live particle preview in the Rigger ([detail in history](../history.md))
