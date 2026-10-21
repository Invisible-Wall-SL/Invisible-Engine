# Invisible FX — status

> Design: [docs/design/invisible-fx.md](../design/invisible-fx.md) · Guide: [docs/tools/fx.md](../tools/fx.md) · Agent: `.claude/agents/invisible-fx.md`

**One-line state:** **Element FX** (effects that play ON a node, a screen or the reels — 43 kinds; editor section with an on-stage preview, ✦ Animate rows so a timeline or a state-machine state poses them; Flow `elementEffect`) built 2026-10-21, ⏳ not yet clicked in a browser. Particles: shipped on `main` — all three particle tiers, the event trigger, a pro emitter inspector and rig-timeline binding are live, and a rig plays its bound FX wherever it is mounted. **Exposed parameters (Steps 1 and 2 of the 2026-10-15 direction) are on `main` — gated headlessly, not yet driven in a browser:** a placed effect node sets them per placement (any kind, colour included) or takes them from its component's params, and its value bindings and timeline channels drive them (Step 2); state-machine inputs and the game clocks (Steps 3–4) are next. Open: the Tier-C perf ceiling, an owner pass over the Min / Max rows, and a pixel check on a rig FX mounted outside a layout rig node.

## Current state
Live on `main`, owner-verified in the 2026-06-29 pass except the ⏳ items called out below.

- **Element FX** (2026-10-21, [design/element-fx](../design/element-fx.md)) — effects that play ON
  an element rather than beside it: any node (image, rig / `.irig`, flipbook, particle effect,
  text, group, component placement), a whole screen, or the reels. 43 kinds in five families:
  motion (shake, wobble, pulse, heartbeat, jelly, bounce, spin, swing, float, pop in / out, slam
  in, fade in / out), 3D (flip sideways / over, bounce 3D, tilt 3D, sphericon), distort (wave X / Y, flag,
  twist, curl, ripple, bulge, melt), light (glow, outline, shine, flash, rainbow, chromatic, glitch,
  blur, pixelate, dissolve out / in) and break (crash, crumble, shatter, dissolve to / assemble from particles). Authored in the Scene Editor's
  **Element FX** section (node Properties and the Screen panel; ▶ previews on the stage on a still
  of the element) with an *Always* / *When shown* / *On cue* / *Keyed* trigger and a stop cue;
  fired from the Flow by `fireCue` or by `elementEffect` / `stopElementEffect`. A *Keyed* entry
  gets two ✦ rows in Animate (progress, strength): a timeline poses it, so a component
  state-machine state does too and a transition blends it, and scrubbing poses it on the stage.
  ⏳ Seen rendering in a headless WebGL1 and WebGL2 browser harness (every kind, mid-play and at
  the end); the editor's section, preview and posing were exercised in standalone harnesses only;
  not yet clicked in `/editor` or watched in a published game.

- **All three tiers ship** (`/fx`, `fx` tool scope): **A** sprite/flipbook particles from project atlas regions, **B** an emitter pinned onto a bone of a playing rig backdrop (`RigBoneAttach`), and **C** whole rig clips *as* the particles (pooled `RigParticleBehavior`). The `skeletonKey` key-stability seam for Tier-C shipping is closed.
- **Event trigger end-to-end.** A `trigger.on:'event'` layer fires when a matching cue crosses the runtime event bus (a Flow v1 Broadcast / v2 `fireCue`), with an optional **Stop event** and **Duration**. The full author→ship→fire chain (export → `deploy/effects/` → bake → pull → `bakedEffects()` register) is wired.
- **Pro `/fx` inspector knobs:** emission **direction (centre °) + spread (±°)**, particle **spin min/max + accel**, a **rotation lock** (`noRotation` — travel along the arc without facing it), and a **Sprite** section — a fixed art **rotation offset** + a **pivot** (anchor) grid (see the 2026-10-14 entry); a **movement** toggle (eased `moveSpeed` vs **acceleration** — up-direction + a downward pull = a fountain); a stackable **Forces** section (gravity at any angle, wind with gusts, vortex with swirl + centrifugal/centripetal radial, attractor/repulsor with an absorb sink, turbulence, drag — see the 2026-10-13 entry); **colour** start/end tint **plus a colour overlay with a per-particle intensity min/max**; **blend mode** (Normal/Add/Screen/Multiply); five **spawn kinds** — point / circle / ring / rectangle / **burst** (even fan). Alpha, Scale and the eased Speed each carry an **On** switch (a config with no such behavior can grow one instead of the section silently vanishing) and a **Min / Max** switch that splits each end into a per-particle range — four INDEPENDENT bounds (see the 2026-08-28 fix entry). All are live sliders + number boxes that re-tune the preview verbatim.
- **Layer stack ops** — ▲/▼ reorder (list order IS draw order; `FxStage` re-appends the emitter containers in doc order each rebuild so the preview restacks), ⧉ duplicate, and a `localStorage`-backed **⧉ Copy / 📋 Paste** that survives navigation, so a layer moves **between effects**.
- **Flipbook playback is authorable** — an `animated` layer chooses **Match particle lifetime** (`framerate: -1`, the long-standing default) or an explicit **fps + loop**, carried on `art.framerate`/`art.loop` through `bindArt` at all four render sites.
- **Preset library** — per-layer "Apply preset…" (Fountain, Fire, Smoke, Sparks, Explosion-burst, Rain, Snow, Confetti, Magic glow) preserving art/placement/trigger.
- **Rig-timeline direct binding** — on a Rigger event keyframe you pick the effect, its host bone, the SLOT it draws at, and per-binding opacity / size / delay / duration / speed, and a **Continuous** flag that stops a looping clip restarting an ambient burst every lap (`evtObj.fx`), baked to a `rigFx` manifest and played by `RiggedEffect` on the beat (`forceEmit`); the cue-broadcast path stays as the advanced mode. A *persistent* rig FX slot (an always-on, keyable emitter — the other half of invisible-cinematic §12.4a) is still NOT built.
- **…and it plays on ANY rig, mounted by anything** (2026-09-04). `<RigProvider>` resolves and mounts a rig's bound effects + clips itself, through the `pixi-svelte` `rigBoundContent` seam `engine-layout` fills in — so a binding works on a rig reached by a coded component (the big-win `WinAnimation`, backdrops, transitions, cinematic actors) exactly as on a placed `spine` node. Authoring is unchanged; the binding was always baked, it just had two readers. See the 2026-09-04 entry.
- **Turbo speeds up the particles** (2026-10-15) — one particle clock in `pixi-svelte`, set by the
  game from its turbo scalar, multiplies every `<ParticleEmitter>`'s step, and the FX emission timers
  divide by it, so an effect plays twice as fast in turbo with the same particles. The tools preview
  at normal speed. See the 2026-10-15 "particle clock" entry.
- **Live particle previews everywhere** — the effect plays not just in `/fx` (`FxStage`) but in the **Rigger** and **Symbols state machine** via the shared `fxOverlay` on their raw-WebGL stages, all now riding the bone's **full transform** (position + rotation + per-axis scale) to match the game.
- **Effect atlases auto-ship** — `exportEditorArt` walks the project's effects and ships every layer's `art.assetKey`, so a placed/bound effect's particles have textures with no extra step.
- **Exposed parameters (Step 1, 2026-10-15)** — any value of an effect can be a named parameter (`EffectDoc.params`): ⚡ on every inspector row or in the raw **All parameters** tree, an **Exposed parameters** panel with a live preview slider, and one shared applier in all four renderers that changes a value with no reset. The stored config is the effect at its defaults, so every existing renderer draws it unchanged. See the 2026-10-15 entry.
- **Driven from the node (Step 2, 2026-10-15)** — on a placed `effect` node, a **value binding**
  (`target: 'fxParam'`, `fxParam: <id>`) and a **timeline channel** (`fx:<id>`) set the effect's
  number and on/off parameters, through the node's one fold (its own bindings, then the timeline's,
  the last value winning). So a component state machine's state drives the effect, a transition
  blend mixes it, and a binding drives it from a component param or an engine source. A colour
  parameter is neither bound nor keyed yet. The Scene / Component Editor lists the placed effect's
  parameters in **Bind to value** and in Animate, and previews them live on the stage. See the
  2026-10-15 "Step 2" entry.
- **Set per placement** (2026-10-16) — the placed effect's Properties list every exposed parameter
  under **Effect → Parameters** with a value for that node (`EffectNode.params`: a number, an
  on/off or a `#rrggbb` colour). Inside a component, **⇡** takes one from a param of the component
  (`paramBindings['params.<id>']`, the nested-instance forward), so each placement of the component
  sets it. Precedence: the parameter's default ◁ the node's own value ◁ the component's param ◁ a
  binding ◁ a timeline. See the 2026-10-16 entry.

⏳ **Still open (live-verify):** Tier-C rig-particle **GPU/perf ceiling** in a published game (expect tens, not hundreds); owner pixel-verify of the rig-bound FX size/rotation on live WebGL across `/symbols`, `/rigger`, and the game. The rotation was wrong in the game until the 2026-10-15 fix. The best check is a bone keyed through 90°, where the old code drew the FX upside down.

## Open items / next
- **Owner browser-pass over Element FX** (2026-10-21) — in `/editor` add a few effects to a rig,
  a flipbook, a particle effect node, the reel grid and a screen (Screen panel), ▶ preview each,
  and Save → reopen. Then in a published game: an *Always* float / glow / flag on a node, a *When
  shown* pop in / slam in on a screen, an *On cue* crash fired by a Flow `fireCue`, and a Flow
  `elementEffect` on `reels` (shake, wave Y) and on `screen:<id>`; turbo should speed them up.
  Then the state machine: a *Keyed* entry on a node of a component, ✦ rows keyed in two states'
  timelines, and a transition between them — scrub in Animate and run the state machine in the
  editor, then watch it in the game. And a Sphericon on a symbol-sized element, and Dissolve to
  particles on a big one (a character rig) with each Wind, then Assemble from particles on its
  stop cue to bring it back. And Shatter (glass) on a framed panel, from each Impact point, and Melt on a gold symbol with
  some Heat.
  Worth an eye: a crash / crumble on an animating rig (it breaks a still), an exit (pop out, fade
  out, dissolve out, crash, crumble) staying hidden until its stop cue, and the base-game screen,
  whose two parts around the reels each play the screen's FX. In the editor: a posed node can be
  clicked and dragged mid-effect, Esc during ▶ keeps the selection, a cut never blinks the stage,
  and panning or zooming a posed still cuts it again once you stop.
- **Element FX preview, known limits** (editor only; the game plays on the live element): a still
  copies its canvases with plain compositing, so an additive or screen-blended element previews as
  a normal one (and a rig layer's dimming scrim, when up, is copied with it); each posed node keeps
  a stage-sized overlay canvas while its timeline previews; a still that cannot be read back (a
  cross-origin image) ends ▶ without a message.
- **Element FX next** (design §9): HUD instances (`LayoutEditable` renders them outside
  `<LayoutNodeView>`), rotated elements (the passes assume an axis-aligned box), and binding /
  keying an entry's params.
- **Owner browser-pass over per-placement values** (2026-10-16) — the reported case: open the Pot
  Meter copy → **Edit inside Pot ›**, select `BackgroundBeam2`, and under **Effect → Parameters**
  drag `BeamAlpha` and pick a `Color`: the beam on the stage follows with no reset, and **×** puts
  each back. **⇡ → Expose on Pot Meter** on `Color`: it shows under Component variables; on the
  Pots screen give two pots different colours and check both the canvas (each pot now previews its
  own beam, see the 2026-10-16 "every placement" entry) and a published game. Also worth a look: a
  screen-placed effect (no ⇡ there), Inspect (controls disabled), and Save → reopen. `/editor` is
  auth + Postgres + R2 gated, so none of this has been clicked.
- **Owner browser-pass over exposed parameters** (2026-10-15) — ⚡ a few rows (Frequency, an Alpha end, a tint colour, a force's Strength and its On switch), drag each preview slider and check the preview changes with no reset (particles in flight carry on), that a mapped row (Direction) goes read-only with the ⚡ name, that editing an as-is driven row (Frequency) moves the parameter's default, and that Save → reopen shows the same panel. `/fx` is auth + Postgres + R2 gated, so none of this has been clicked yet.
- **`effect.*` drives cannot be authored in `/fx` yet.** The schema, the normalizer, the applier
  and the runtime wrapper (`EffectParamGroup`) all handle `effect.alpha | scale | tint | timeScale`,
  but no inspector row or "All parameters" leaf writes them, so only a hand-written doc reaches
  that wrapper today. An effect-level section (or effect rows in the panel) is owed.
- **Owner browser-pass over Step 2** (2026-10-15) — on a component with a placed effect that exposes
  `intensity` (number) and an on/off parameter: **Bind to value → + drive… → ⚡ intensity** from a
  param and drag the test value (the stage's particles should follow with no reset); in Animate key
  `⚡ intensity` at two times and scrub; tick the on/off row (it keys stepped); build a state machine
  whose two states key different intensities with a 300 ms blend and ▶ Run it; then place the
  component in a game and check the same. `/editor` is auth + Postgres + R2 gated, so none of
  this has been clicked.
- **Next per the design: Steps 3–4** (`invisible-fx.md` §"Direction (2026-10-15)") — `{ input }`
  binding refs from the component state machine, then the `time.*` clocks and `wave` shaping. Both
  plug into Step 2's fold: a new `BindingInputRef` kind and a clock-fed binding reach
  `boundFxParamValues` unchanged. A colour parameter as a binding or channel target is not planned
  in any step yet.
- **The Rigger / Symbols overlay** (`fxOverlay`, `FxPlayOptions.params`) still draws every effect at
  its defaults: a rig timeline has no node actors, so nothing there sets a value.
- **Owner browser-pass over the Sprite section** (2026-10-14) — rotate a directional sprite (an arrow or a streak) and check it turns by the slider amount without changing its flight, and that Top / Bottom / Left / Right pivots put that edge on the spawn point (easiest with a big sprite and a single slow particle).
0. **Owner browser-pass over the Forces section** (2026-10-13) — the math and the real-`Emitter` coupling are gated headlessly, but no slider has been dragged in a browser. Worth checking while there: a Fire / Smoke / Fountain / Sparks / Rain preset now goes the way its name says (see the entry), and an existing effect's Direction reads the way its particles actually fly.
1. **Owner browser-pass over the Min / Max rows.** Two passes have now happened and each found a real defect (see the two 2026-08-28 fix entries) — the model is heavily covered headlessly, but every symptom so far has been a CLICK, and `/fx` is auth + Postgres + R2 gated so those sliders still cannot be driven from a session. A third pass on the corrected rows is owed.
2. **Tier-C perf ceiling live-verify** — confirm a published game renders a rig-particle effect at 60fps and find the pool-size ceiling; flipbook-bake stays the per-effect fallback.
3. **Owner pixel-check on a rig FX mounted OUTSIDE a layout rig node** (the 2026-09-04 change) — the reported case is the best one: play a big win in `invisible_wall/test6` and confirm `v_winripple` fires on `R_Wins`'s tier animations at `bone114`/`slot12`. `?fxdebug=1` on the game URL prints how every baked effect is routed. While there: that rig keys the SAME effect `continuous` on all ten tier animations, and a binding is one keyframe — so `Big_Intro → Big_Idle → Super_Intro` stacks three independent never-stopping emitters. `continuous` should be keyed ONCE, on the animation that starts it. **Also worth an eye on the BACKGROUND rigs:** `engine-game`'s `Background.svelte` mounts `foregroundAnimation` (and `foregroundFeatureAnimation`) TWICE concurrently — one instance driving `idle`, one driving `dust` — and each instance now mounts the rig's whole binding set independently. A binding that carries its `animation` is self-limiting (it only fires in the instance playing that animation), but a LEGACY manifest entry baked before beats existed has no `animation` and matches any, so such a binding on a background rig would fire twice, at double density. Nothing baked today is in that shape; re-bake rather than patch if it shows up.
4. Consolidation candidate: **three FX renderers** (engine `RigBoneAttach`, `/fx` `FxStage`, tool `fxOverlay`) are kept in sync by hand — a future unify. The 2026-08-28 change added a FIFTH thing they must each do (`registerFxBehaviors`), mitigated by routing all three launcher stages through `effectEmitter.client.ts`.

## Blocked (owner / external)
- **Owner live-verify** of the WebGL pixels / Tier-C perf is the gate on marking those items done.

## Recent changes
- 2026-10-21 — **Melt** (a 43rd kind, distort, exit). Owner ask: a melt effect. One shader pass
  (`meltFilter`): each column runs down by its own amount — a slow swell, finer streaks and a few
  long drips from 1-D value noise across the element (`drips`, 2–24, default 7) — and a row runs
  the further the lower it sits (row v moves down by d·(0.3 + 0.7v), inverted in closed form), so
  the top sinks while the bottom drips furthest, up to `length` element heights (default 0.8, ×
  strength). The run starts slow and then flows (t^1.6); `heat` (0–1, default 0) tints the
  running part in `color` (default #ff6a00) for hot metal. The kind's motion fades the element
  over the last 30% so it ends hidden like every exit, and the pass's padding grows with the run
  so the drips are never clipped. `check:element-fx` 95 → 97 (untouched at the start, runs to its
  end, makes more room as it runs, fades only at the end); the GLSL scan covers the new pass.
  Rendered on WebGL1 and WebGL2 in the headless harness (default, with heat, and a 1.6-height run
  with nothing clipped). ⏳ Not clicked in a browser.
- 2026-10-21 — **Shatter (glass)** (a 42nd kind, break, exit). Owner ask: a shatter-into-glass
  effect, apart from Crash. A `glass` break style (`cutGlass` in `breakApart.ts`): a spiderweb
  fracture — spokes from the impact (`impact`: random in the middle by default; center, top,
  bottom, left, right) crossed by irregular rings, denser near the hit, each cell clipped to the
  box (Sutherland–Hodgman) is a shard (`pieces`, 16–160, default 56). Over the first `crack` of the
  play (default 0.3) the cracks race out from the impact (a `Graphics` overlay, each line dark then
  light so it reads on any art; spokes bold, a quarter of the ring cracks left out, a flash at the
  hit) and a hairline gap opens round each shard they reach; then the pane falls in, the shards
  by the impact first, pushed out a little, coming towards the viewer, tumbling end over end
  (scaled across by the cosine of their turn) and dropping under `gravity`. The break meshes now
  pack pieces of any vertex count (a shard is a fan of n − 2 triangles) into ≤ 96-vertex meshes,
  and a piece can scale differently across and along. The outer ring sits far enough out that
  its chords clear the corners: a stress run of 1,080 layouts (every impact, 16 / 56 / 160 shards,
  three box shapes) tiles the box exactly. `check:element-fx` 89 → 95. Rendered on WebGL1 and
  WebGL2 in the headless harness. ⏳ Not clicked in a browser.
- 2026-10-21 — **Assemble from particles** (a 41st kind, break, entrance). Owner ask: the reverse
  of dissolve to particles. The same dust break played backwards: `KindImpl.reversed` makes the
  runtime run a break from its end (`breakProgress`), so the specks start blown away and invisible
  (a delay keeps them so), blow in from the **From** side swaying and growing, the far side settling
  first, and at the end the pieces go and the live element shows. Its no-renderer fallback drifts
  back in and fades up. Same params as the dissolve (Particles, From, Turbulence). As an entrance it
  also releases a held exit, so a dissolve to particles then an assemble brings the element back.
  `check:element-fx` 85 → 89 (through `playElementFx` with a stand-in renderer: starts hidden,
  comes together, ends at rest exactly; mutation-checked — without the reversal it fails).
  Rendered on WebGL1 and WebGL2 in the headless harness. ⏳ Not clicked in a browser.
- 2026-10-21 — **Dissolve to particles** (a 40th kind, break, exit). Owner ask: a
  dissolve-to-particles effect. The element turns to dust: a still of it is cut into square specks
  (`particles`, 100–2000, default 700) that let go in a ragged front — the side the `drift` wind
  blows to first (up-right by default; up, up-left, right, left, down), so specks blow off clear of
  what is left, the front roughened by value noise — and fly on the wind, picking up speed,
  swaying across it (`turbulence`), turning and shrinking to nothing. A new `dust` break style in
  `breakApart.ts` (`cutSpecks`, the same small batched meshes as crash and crumble); with no
  renderer it fades and drifts on its wind. Plays through the Flow's `elementEffect` and previews
  with ▶ like every kind (the Flow vocabulary reads the catalog, so nothing was regenerated).
  `check:element-fx` 79 → 85: the specks tile the element at the start, batch in meshes of ≤ 96
  vertices, let go on the wind's side first, shrink to nothing by the end and leave with the run.
  Rendered on WebGL1 and WebGL2 in the headless harness. ⏳ Not clicked in a browser.
- 2026-10-21 — **Element FX: code-review fixes to the editor preview and the Sphericon.**
  - **A posed node stays selectable.** The stand-in hiding a node behind its still now applies to
    the draw layers only (`previewResolveTransform`); the hit tests, the selection frame and the
    drag read `previewPoseTransform`, which only the Outline's Hide skips. Before, in Animate a
    node mid-effect could not be clicked or dragged and lost its handles.
  - **Esc during ▶** stops the preview only; it no longer also ran the stage's Esc (select parent).
  - **Cuts never blink the stage.** `coverStage` puts a frozen copy of every stage canvas (blend
    modes and opacity included) over the stage while a still is cut, for ▶ and for posed stills.
  - **Posed stills stay current.** An edit of a keyed entry re-poses it on the same still
    (`PosedOverlay.setEntries`); an edit of the node's art (not its Element FX or baked
    `coverBox`), a pan of a still the canvas's edge cropped, or zooming in past 1.25× of the cut
    zoom cuts a new still once it has held for 300 ms, the old one showing meanwhile. The posed
    sync now tracks the posed nodes' doc.
  - **The reel grid** is never keyable, in one rule: `keyableElementFxEntries` (engine-layout)
    serves `validateNodeActors`, the Animate rows, the ⚠ stale rows (a reel grid's old keys now
    show and can be deleted) and the stage posing (it no longer poses the reel grid).
  - **The Timeline** redraws its rows only when the keyed set changes (`keyedFxKey`), not on every
    param or strength edit. The FX section resets its open rows per node and per screen.
  - **Sphericon:** Tilt now tilts the solid towards the viewer (it only shifted the roll's start);
    its art is upright unturned and rolled half a turn (it was turned 90° as it folded); Rolls is
    taken in whole half-turns and the side swing returns to 0, so it unfolds upright (one roll
    used to end mirrored); a ray along a cone's slope is solved instead of dropped.
  - **Gates:** `check:element-fx` 78 → 79 (the reel grid rule) and its GLSL scan covers every
    GLSL ES 1.00 / 3.00 reserved word. Green: `check:element-fx-flow` (20), `check:flow-bonus-modes`
    (113), `check:component-timelines` (80), `check:component-state-machine` (184),
    `check:component-state-machine-editor` (79), `check:fx-node-params` (105),
    `check:timeline-rows`, `check:screen-timeline-mounts`, `check:editor-gl-contexts`,
    `check:vendored-bundles`, `check:svelte` at baseline (launcher-api 46, engine-layout 291,
    pixi-svelte 14), `pnpm lint`, `check:undefined-names`, the launcher build. The sphericon
    renders the same on WebGL1 and WebGL2 in the headless harness. ⏳ Not clicked in a browser.
- 2026-10-21 — **Element FX in the editor, the timeline and the state machine; a Sphericon.**
  Owner follow-ups: put Element FX in the component state machine and animate them on the stage;
  add a Sphericon 3D effect.
  - **Editor** (`EditorElementFx.svelte`, `elementFxPreview.client.svelte.ts`, `EditorCanvas.svelte`):
    the **Element FX** section on every node (the reel grid included) and on the Screen panel, with
    sparse writes and unreadable entries kept verbatim. **▶** plays the entry on the stage. The
    canvas hides everything but the element for three frames and copies its screen's surfaces into
    a still. It then hides the element and plays the real runtime on the still in a
    `createPixiSurface` overlay. Escape, a press, a wheel, pan or zoom cancel it.
  - **Keyed** (`screenTimeline.ts`, `EditorTimelinePanel.svelte`, `stateMachinePreview.ts`): two ✦
    rows per keyed entry (progress 0…1 resting at 0, strength 0…4 resting at 1), stale rows flagged,
    ◆ keying from Properties. A node keyed only on `efx:` is now in the preview drives, and the
    state-machine preview carries it. While a timeline or state is previewed, a posed overlay per
    node (one still, cut the first time it leaves rest) poses the effect on the stage and follows the
    node's drawn transform; the real node hides only while an entry is past rest.
  - **Sphericon** (a 39th kind, 3D): the element folds into a lit, spinning sphericon wrapped in
    its own art, rolls, and unfolds back — one ray-cast pass. A first run on WebGL1 failed on the
    reserved word `flat`; `check:element-fx` now scans for reserved words used as names.
  - **Break meshes** are cut into batches of ≤ 96 vertices: one large unbatched mesh kept the still
    bound after it was destroyed, and Pixi warned as a crumble ended.
  - **Gates:** `check:element-fx` 76 → 78. The editor gates the change touches are green: `check:svelte --only apps/launcher-api`
    at baseline (46), `check:editor-gl-contexts`, `check:component-timelines` (80),
    `check:component-state-machine` (184), `check:component-state-machine-editor` (79),
    `check:fx-node-params` (105), `check:timeline-rows`, `check:timeline-ratio-keys`,
    `check:doc-readers-unknown-fields` (271), `check:save-keeps-unknown-blocks` (154), `pnpm lint`,
    `check:undefined-names`, and the launcher build. Every kind, the sphericon included, renders
    with no shader error on WebGL1 and WebGL2 in the headless harness. ⏳ Not clicked in a browser.
- 2026-10-21 — **Element FX: effects that play ON an element.** Owner ask: FX placeable on assets
  (rig, `.irig`, flipbook, particle effect) and elements (screens, reels), and new ones (wave X /
  Y, flip on itself, twist, curl, glow, shine, crash, crumble, bounce 3D, more). Plan:
  [design/element-fx](../design/element-fx.md). **Engine change** (`constants-shared`,
  `pixi-svelte`, `engine-layout`, `engine-flow-v2`, `apps/lines`): it reaches online games only
  through a runtime-bundle republish.
  - **Catalog** (`constants-shared/elementFx`): the 38 kinds (39 with the sphericon above) with phase (emphasis / loop / enter /
    exit), default length and params; the entry shape and its reader (`readElementFxEntries`).
  - **Runtime** (`pixi-svelte/src/lib/elementFx`, subpath `pixi-svelte/elementFx`):
    `playElementFx` / `stopElementFx`. One runtime per container: motions fold into one change of
    its transform (owner writes mid-play become the new rest, everything restored exactly at the
    end); passes stack after its own filters, bounded by a `filterArea`; a break snapshots it and
    flies the still in one mesh (no renderer ⇒ a fade). Custom GLSL (perspective, wave, twist,
    curl, ripple, bulge, shine, colour mix, dissolve) compiles on WebGL1 and WebGL2: a first run on
    WebGL1 failed on `transpose()`, now written out and scanned for by the gate. Follows turbo.
  - **Engine**: `BaseNode.elementFx` and `Scene.elementFx`. `<LayoutNodeView>` wraps a node that
    carries some in one container (the node's `zIndex`, anchored by node id) with
    `<ElementFxPlayer>`; `<LayoutScene>` does the same for a screen (`screen:<id>`); flow- and
    engine-mounted screens register `screen:<id>` on their own container; the reel stack's
    `MainContainer` is `reels` and plays the reel grid node's entries. No FX ⇒ no container.
  - **Flow**: `elementEffect` / `stopElementEffect` and the `ElementFxKind` / `ElementFxTarget`
    enums; the launcher widens the target enum per project (`collectElementFxTargets`, editor and
    publish gate alike) and harvests Element FX cues into the cue palette. `gen:flow-vocab`
    regenerated (69 effects). `check:flow-bonus-modes` pins the additions and hashes the rest of
    every vocabulary as before.
  - **Save**: nodes keep the field verbatim; `normalizeScene` keeps `Scene.elementFx`;
    `componentFields.ts` lists it.
  - **Gates:** new `pnpm check:element-fx` (catalog, reader, samplers, the runtime on real Pixi
    containers, the WebGL1 GLSL scan, the wiring; mutation-checked: dropping the alpha restore
    fails 3 checks) and `pnpm --filter launcher-api check:element-fx-flow` (20). Also green:
    `check:flow-bonus-modes` (113), `check:flow-publish-gate`, `check:scene-cues`,
    `check:flow-symbols-follow-config`, `check:signal-scope`, the flow-spike `v2vocab` /
    `v2holdandwin` / `v2optional` / `vocab`, `gen:flow-vocab:check`,
    `check:doc-readers-unknown-fields` (271), `check:save-keeps-unknown-blocks` (154),
    `check:authored-freespins-followup`, `check:fx-node-params` (105), `check:depth-segments`,
    `check:component-links`, and `check:svelte` for `pixi-svelte`, `engine-layout` and
    `apps/lines` (at baseline). A headless Chromium harness rendered every kind at three moments and
    at the end on WebGL1 and WebGL2 with no shader error. ⏳ Not clicked in a browser.
- 2026-10-16 — **The editor previews every placement of a nested effect, not one copy.**
  `EditorEffectLayer` keyed its live emitters by the effect node's id, which every placement of one
  component shares. On a screen with three Pot Meters it built the first pot's beam, then moved
  that one emitter to each later pot, so one beam showed, at the last pot. The game draws all three.
  Per-placement values (the entry below) made this worse: two pots with different colours previewed
  as one. Editor-only, so no runtime republish.
  - **Key.** A placement is keyed by its id path from the top of the screen, `depthKey(ids)` (the
    key the depth split already records each node under). A top-level effect's key is its own id,
    as before. Each placement builds its own emitters and reads the params of the instance it sits
    in, so each pot plays its own beam in its own colour.
  - **Reports stay by node id**, which is what `EditorCanvas` (`mergeEffectReady` /
    `mergeEffectBounds`) and its chip and selection-box code read. A node is ready while any of its
    placements renders, the same union the canvas takes across its sublayers. Its box is the union
    of its placements' particle spreads, all in the node's own local space.
    - The union also holds across overlays. Each scene, depth segment and blend group reports from
      its own overlay, and three pots whose glow sits under their art land in three segments.
      `mergeEffectBounds` kept only the last report, so it now unions them (`mergeSpreadBoxes`,
      `editorCanvas.helpers.ts`).
  - The rig overlay had nothing to copy: it shares one instance per asset key and draws it at every
    target. The text overlay keys its objects by chain the same way (`chainKey`).
  - **Trade-off:** moving a top-level effect into a group (or out of one) changes its key, so its
    particles restart instead of carrying on.
  - **Gate:** `check:fx-node-params` 104 → 105. The new check scans the overlay and canvas wiring:
    placements keyed by path, reports by node id, the canvas's union. It fails on the old overlay.
    `check:depth-segments` gains §5: a one-id path keys as the id, three pots' glows get three keys
    in three segments, and `mergeSpreadBoxes` folds their reports into one enclosing box (it fails
    on a last-wins merge). Also green: `check:svelte --only apps/launcher-api` (at baseline),
    `pnpm lint`, `check:undefined-names`. ⏳ Not clicked in a browser.
- 2026-10-16 — **A placed effect's exposed parameters can be set where it is placed.** Owner
  report: an effect exposing `BeamAlpha` (number) and `Color` (colour), placed inside the Pot
  Meter's `Pot` part, showed neither parameter on the node: they were reachable only as a **Bind to
  value** target or an Animate channel (both need a source), and a colour one nowhere. **Engine
  change** (`engine-layout`): it reaches online games only through a runtime-bundle republish.
  - **Format.** `EffectNode.params?: Record<id, number | boolean | '#rrggbb'>`, this placement's
    values. Inside a component, `paramBindings['params.<id>'] = '<key>'` takes one from a param
    of the enclosing component, the format a nested instance already forwards with (#1237), so
    `pruneOrphanParamBindings` drops it when that param is deleted. Nodes are stored verbatim, so
    no normalizer change (gated: layout doc and component def keep both).
  - **One fold.** `placedFxParamValues` (`fxNodeParams.ts`) reads, per declared parameter, the
    component's param while it holds a value of the parameter's kind (a colour param's `0xrrggbb`
    reads as `#rrggbb`), else the node's own value, clamped by `effectParamValue`; an undeclared
    id or a mistyped value is skipped. `createNodeFold` puts the bound and keyed values on top
    (`nodeFxParamValues`), in one `$derived` that also tracks the component's params, so a
    per-placement or live param change reaches the emitter with no reset. `fxParamsDriven` now
    counts a node that sets a parameter (any kind, so a colour-only node gets a getter);
    `attachedEffectDrives` follows, so a bone-hosted effect gets `<DrivenEffectPlayer>` too. An
    effect node that sets nothing still mounts the bare `<EffectPlayer>` (parity).
  - **Blends rest on the placement.** `fxParamRest(params, channel, own)` with `own` =
    `placedFxParamValues`: a state-machine blend where only one side keys a parameter mixes from
    or towards the value the node sets (the component's param, else its own), else the default.
    `ComponentTimelinePlayer` takes the instance's params lazily (`() => providedParams`), so the
    rest follows a live param. The editor does the same: the Animate field shows (and ◆ keys) an
    unkeyed parameter at that value (`fxChannelValue(…, placed)`), and the State machine stage
    preview's player reads the component's preview params.
  - **Swapping the effect** on a node drops its values and forwards, since the new effect declares
    its own parameters.
  - **Editor.** Properties → **Effect → Parameters**: a slider + number box (number, the slider
    only with a usable `min..max`), a tick box (on/off) or a swatch (colour), **×** back to the
    default, a note when a **Bind to value** binding drives the same parameter, and the
    parameter's own note. In component mode each row has the **⇡** picker:
    `exposeEffectParam` (a `number` / `boolean` / `color` param at the value shown now),
    `linkEffectParam` (an existing param of the matching kind), × = `unlinkInstanceParam`
    (`instanceParamForwarding.ts`). The live overlay (`EditorEffectLayer`) now gets the open
    component's `componentParams` and the project's `componentDefaults` and resolves each nested
    instance's params on the way down (`forwardInstanceParams` → `resolveComponentParams`, as the
    rig layer does), and `previewEffectParamValues` folds the placement's values under the test
    values and the timeline.
  - **Gate:** `pnpm --filter launcher-api check:fx-node-params` 76 → 104 (a new §11, plus the
    compiled fold in §8 following a component param live, and the save round-trip in §9). Also
    green: `check:component-param-forwarding` (106), `check:component-state-machine` (151),
    `check:component-state-machine-editor` (42), `check:component-timelines` (80), the
    `check:authored-*` gates, `check:doc-readers-unknown-fields` (271),
    `check:save-keeps-unknown-blocks` (154), `check:component-links` (75), `check:depth-segments`,
    `check:vendored-bundles`, `check:undefined-names`, `check:svelte-init-order`, and
    `check:svelte` for `engine-layout` and `launcher-api` (at baseline). ⏳ Not clicked in a
    browser.
- 2026-10-15 — **Exposed parameters, Step 2: drive them from the node.** Plan: design §"Direction
  (2026-10-15)", the four steps, row 2. **Engine change** (`engine-cinematic`, `engine-layout`): it
  reaches online games only through a runtime-bundle republish.
  - **Binding target.** `VALUE_BINDING_TARGETS` gains `fxParam`, with `ValueBinding.fxParam` naming
    the parameter. `bindingTargetsForKind('effect')` offers it.
    - A **number** parameter takes the mapped output. With no authored out range it maps onto the
      parameter's own `min..max` (`defaultBindingOutRange(binding, param)`), and the value goes
      through `effectParamValue` (clamped).
    - A **bool** one switches by `threshold` / `below`, as `visible` does (`isSwitchBinding`), and
      never glides.
    - A **colour** parameter is not a target.
  - **Timeline channel.** `fx:<id>`, one per number or bool parameter, from
    `nodeActorChannelsForKind('effect', params)`.
    - `NodeActorChannel` is now ``(typeof NODE_ACTOR_CHANNELS)[number] | `fx:${string}` ``: the fixed
      list is one exported value, and `FX_PARAM_CHANNEL_PREFIX` is exported once, by the evaluator;
      `engine-layout` builds every channel name from it (`fxParamChannel`).
    - The evaluator (`sampleNodeActor`) samples every `fx:` channel of a property track under its
      own name: a number interpolates, a bool is keyed 0 / 1 on `hold` keys (Animate keys it that
      way). The node reads a bool as on from 0.5, so a blend steps it at half way.
    - Colours are left out: the evaluator interpolates colour only on a channel named `tint`.
    - `static/shared/cinematicEval.mjs` is regenerated.
  - **One fold.** `nodeActorBindings` turns each `fx:<id>` channel into an `fxParam` binding, so a
    timeline joins the node's own bindings in `allBindings` / `allOutputs`. `boundFxParamValues`
    (`fxNodeParams.ts`) reads them in order, the last value winning. That is the rule
    `withNodeActorOutputs` already gives `fill` and `frame`: a timeline after the node's own
    bindings, a later binding over an earlier one.
    - The fold is ONE function, `createNodeFold` (`nodeFold.svelte.ts`): `<LayoutNodeView>` runs it
      for every node (it replaced the view's inline `createBoundValues` → `withNodeActorOutputs`
      code, same deriveds) and `DrivenEffectPlayer.svelte` for a bone-hosted effect. It hands the
      effect's parameter shapes to `createBoundValues`, and gives `<EffectPlayer params>` a getter
      over a `$derived` of the values, recomputed when the outputs change, not once per layer per
      frame.
    - A **bone-hosted** effect (`hostSpineId`) has no view of its own, so `DrivenEffectPlayer` runs
      the fold for it, mounted only when something drives it. Whether something does is asked
      once per effect, untracked (`attachedEffectDrives`), so a re-render never swaps its player.
  - **State machine blend.** `blendNodeSamples` mixes `fx:` channels on an effect node. The player
    hands it each channel's rest, the parameter's default read from `resolveEffect`, so a blend
    where only one state keys the parameter mixes from or towards the default. With no rest known
    it steps at half way.
  - **Unknown or stale ids are inert and reported.** Inert at runtime: `boundFxParamValues` skips
    them, and the applier ignores a value no parameter declares.
    - `validateNodeActors` reports `fx-param-unknown`. Its new `effects` argument resolves the
      caller's own effects and defaults to resolving none, so validation never reads a
      process-wide registry: the editor passes the effects it loaded (`placedEffect`), and
      `/flow-v2`'s server load passes a resolver that knows none (it reads no effect docs, so
      `fx:` channels go unchecked on that page). An effect it does not know is left unchecked.
    - **Bind to value** shows `fxParamBindingIssue` (missing, unknown, colour) on the row.
  - **Editor.**
    - `placedEffects.client.svelte.ts` keeps the placed effects in the engine's own registry
      (`registerEffects`; the live overlay notes each doc it loads, a panel fetches one it lacks),
      so lists, validation and blends read them as the game does.
      - Both reads (the loader's and the overlay's `loadEffectDoc`) are pinned to the tab's
        project (`withEditorProject`), and `/api/editor/effect` now refuses a pin the session no
        longer holds (409 `scope-mismatch`). So a second tab on another project can't make this one
        list that project's parameters. The Rigger and Symbols, which send no pin, read as before.
      - A failed read is asked again after 5 s.
      - A doc is not refreshed when the tab regains focus. No effect reload signal exists to hang
        it on, and refreshing the lists alone would let them disagree with the stage. A canvas
        remount (or a page reload) reads the docs again.
    - **Bind to value** lists `⚡ <param>` in **drives** (number or on/off; an on/off one gets
      threshold / below). A number binding is created with its out range blank, so it follows the
      parameter's range, shown as the placeholder, even after the range changes in `/fx`.
    - **Animate** lists a `⚡ <param>` row per parameter (a number field, or a tick box that keys a
      stepped key).
    - The shared Timeline module gains a `host.actorChannels(cast)` hook and a
      `keyProperty(…, ease)` argument. `/rigger` passes neither and is unchanged; `timeline.mjs`
      is regenerated.
      - The editor adds the effect's rows through the hook (`fxTimelineRows` in
        `screenTimeline.ts`).
      - A keyed `fx:` channel the effect does not declare shows as `⚠`, so its keys can be removed.
        That includes an effect whose last parameter was removed.
      - While the effect is not loaded, every keyed `fx:` channel is listed as it is.
    - The panel's issues re-run when an effect doc lands, and check every host (the component and
      each in **Also on**) against the loaded effects, loading the ones they place.
    - `EditorEffectLayer`'s `effectParamValues(node, doc)` is now passed by all three overlay
      mounts, from `previewEffectParamValues` (the binding test values and the previewed timeline
      or state machine, through the same fold).
  - **Ship chain.** Nothing new travels. Bindings ride the node (layout and component readers pass
    nodes through), channels ride the cinematic doc (stored and exported verbatim), parameters ride
    the `EffectDoc`.
  - **Parity.**
    - An effect node with no `fxParam` binding and no `fx:` channel mounts `<EffectPlayer>` with no
      `params` getter and creates no fold (`fxParamsDriven` is `undefined`); a bone-hosted one mounts
      the bare player as before.
    - A player whose timelines key no `fx:` channel holds no rest, and a blend without one leaves
      `fx:` keys alone.
    - The one per-frame addition everywhere: `sampleNodeActor` scans a property track's channel
      names for the `fx:` prefix (a few string checks per driven node actor). At init every view
      also makes one small `attachedEffectDrives` closure, whose cache is created only by a rig
      with attached effects.
    - `engine-layout` now depends on `engine-fx` (pure, PixiJS-free) for `effectParamValue`.
  - **Verified.** New gate `pnpm --filter launcher-api check:fx-node-params`
    (`scripts/check-fx-node-params.ts`, discovered by `check:all`, 76 checks).
    - It covers the lists, the range mapping, bool thresholds, precedence, unknown ids (inert,
      reported, ignored by a real applier), the evaluator and its static copy, and a state machine
      whose states key `fx:intensity` / `fx:burst`, with blends both-sided, towards and from the
      default, and with no rest.
    - Those values move a REAL `Emitter` through `bindEffectParams` with no reset (every particle
      in flight is still flying, aged by every frame).
    - The real `createNodeFold`, compiled with Svelte's compiler, maps a component param and a
      registered engine source onto the parameters (a switch never glides) and merges a moving
      timeline. An undriven effect gets no getter. A bone-hosted effect's drive is asked once and
      holds.
    - The Timeline's rows: loaded with parameters, with none, and not loaded.
    - Save → normalize (layout doc, component def, cinematic store) → export → bundle JSON → the
      game's registries → a player built from the baked docs.
    - Source checks that the two components run the fold (with their drive), that the editor
      pins its effect reads and refreshes its issues, that the route refuses a mismatch, and
      that the server passes its own resolver. `check:component-links` lists `editor/effect`
      among the routes that refuse a mismatched project.
    - Mutation-checked: each of 37 single mutations turns it red.
      - Engine: each list, the default range, the switch, last-wins, the colour exclusion, the
        clamp, the prefix, the evaluator and its copy, the blend rests (both sides), the player's
        rests, a blend with no rest blending `fx:` anyway.
      - Bindings and channels: validation (and its default reading the registry), channel →
        binding and its output, the glide exclusion, the parameter shape (in `createBoundValues`,
        and as the fold's 4th argument), the timeline merge, the getter and its gating,
        `fxParamsDriven`.
      - Bone-hosted effects: the asked-once cache; a per-render drive or a fold without its drive,
        in either component.
      - Editor and server: the no-parameters rows, the issues' refresh and resolver, both pinned
        reads, the retry, the route's refusal, the server resolver, the overlay wiring.
    - `check:doc-readers-unknown-fields` now carries an `fxParam` binding in its layout and
      component docs.
    - `cinematic-screen-timeline.mjs`'s pure-file shim lists `fxNodeParams`.
  - **NOT browser-verified** (auth + Postgres + R2 gated) — open item above.
- 2026-10-15 — **The depth split reaches inside nested components and groups.** Owner report after
  the entry below shipped: an FX inside a nested component still covered the art after it in that
  component. The split only looked at a screen's top-level nodes, so a placed component whose def
  is `[glow FX, piece art]` stayed in one segment and its art stayed under the FX surface.
  `depthSegments` now walks the tree in draw order (into groups, parts and resolvable components)
  and records each node's segment by its id path (`segmentOf`, keyed by `depthKey`). A group or
  component that the split crosses is walked on every segment it spans, and each node's own art is
  drawn only on its own segment: the 2D pass through a `drawNode` wrapper that tracks the path,
  and the rig, text and FX layers through a new `depthSlice` prop (`inDepthSlice`). A path the
  split never visited (a repeater's cards) draws with its nearest ancestor. The FX layer now also
  rebuilds when `nodeFilter` changes. Gate: `check:depth-segments` (now covers the nested case;
  mutation-verified: not walking into components fails 7 checks, and dropping the ancestor
  fallback fails 1). Verified: svelte-check at baseline (47), eslint, Prettier,
  `check:undefined-names`, launcher build, and the real `EditorCanvas` in headless Chromium with
  `[bg, pot{glow FX, art}, frame]`. On `main` the pot's art is drawn on the 2D canvas under the FX
  layer; now it is on a canvas above it. Only the FX layer of the glow's segment fetches the
  effect, and moving the glow after the art merges back to one segment under the frame. Particles
  were not drawn (no effect server), so a look on a real effect is still owed.
- 2026-10-15 — **Turbo speeds up the particles: one particle clock** (owner decision, design
  §"Decided (owner, 2026-10-15)"). **This changes how every game looks IN TURBO:** every particle
  effect now plays twice as fast while turbo is on — authored FX, rig-bound FX, Tier-C rig particles,
  win coins and flight trails. Until now turbo sped up the rest of the presentation (the symbol
  and anticipation rigs, Flow's delays) and the particles ran at normal speed beside it. With turbo
  off nothing changes. **Engine change** (`pixi-svelte`,
  `apps/lines`): it reaches online games only through a runtime-bundle republish.
  - **The clock.** `packages/pixi-svelte/src/lib/particleClock.ts`, also a subpath export
    (`pixi-svelte/particleClock`) so a plain `.ts` module can use it without the barrel (the
    `webfontloader` SSR trap of the 2026-09-04 entry).
    - `setParticleTimeScale(read)` and `particleTimeScale()`, default 1.
    - A read that is not a finite number above 0, or that throws, counts as 1. 0 would be a pause,
      and pausing is not this clock's job.
    - The read is always untracked, so a timer started inside an effect never makes that effect
      re-run, and restart its burst, on a turbo toggle.
  - **Who follows it.**
    - `<ParticleEmitter>` now steps through `particleStepSeconds`: the emit-speed step ×
      `effect.timeScale` × the clock. Every coded emitter (`engine-game` `WinCoins`, `FlightView`'s
      trail, the per-app `WinCoins`) and every authored layer goes through that component.
    - Tier-C rig particles advance their clip by the emitter's step, so they follow with no change.
    - These wall-clock timers divide by the clock at the moment they start, via `particleWallMs`:
      `<EffectLayer>`'s trigger `duration` and `emitFor`, `<RiggedEffect>`'s `delay` (its
      `duration` rides `emitFor`), `SymbolLayer`'s one-shot FX completion, and a flight's
      trail-settle wait. A burst therefore keeps its shape: the same particles, in half the time.
    - A turbo toggle mid-burst doesn't re-time a running timer.
  - **Who sets it.**
    - `apps/lines`' `Game.svelte`, at boot beside the effect registrations:
      `setParticleTimeScale(stateBetDerived.timeScale)`, which is `isTurbo ? 2 : 1`, read live.
    - The other reference apps (`cluster`, `scatter`, `ways`, `price`, `number-picker`) each have
      their own `Game.svelte` and share no boot module, so their coins stay at normal speed in turbo.
      They are dev / reference games, not the shipped runtime.
    - No tool sets the clock: `/fx`, the Scene Editor and the Rigger / Symbols overlay drive their
      own emitters and preview at normal speed. The launcher imports no game boot code.
  - **Left alone on purpose:**
    - Flow's `showContainer.durationMs` pin stays a normal-speed measurement, because Flow already
      divides its delays by the same turbo scalar.
    - Flipbook clips don't follow this clock.
    - The flight head's own flight time is still unscaled by turbo (only a slam speeds it up). In
      turbo the trail behind it is therefore shorter.
  - **Verified.**
    - New gate `pnpm check:fx-particle-clock` (`tools/fx-spike/particleClock.ts`, discovered by
      `check:all`).
    - Parity at 1: the step is bit-identical to `emitterDeltaSeconds × effect.timeScale` across
      frame lengths and emit speeds, and timer lengths are unchanged.
    - At 2, on the real `Emitter`: the step doubles, a burst spawns the same 49 particles in 7
      frames instead of 13, the particles age twice as fast, and a Tier-C clip advances by the
      doubled step.
    - Bad reads are 1, and a timer started in turbo keeps its halved length through a toggle.
    - Source checks: every `<EffectLayer>` / `<RiggedEffect>` timer divides, `<ParticleEmitter>`
      steps only through the clock, the game sets it, and no launcher file does.
    - Mutation-checked: an unscaled step, an undivided timer, a missing ≤ 0 guard, a raw
      `duration` or `delay`, or the boot call removed each turns it red.
  - **NOT browser-verified:** no turbo spin has been watched yet. Owner pass: toggle turbo during a
    big win and check the coins, the authored win FX and a flight trail run faster without growing
    denser.
- 2026-10-15 — **Exposed parameters: review fixes** (on top of the Step 1 entry below).
  - **A curve with equal ends no longer crashes any renderer.** The library keeps one node of a
    one-entry list, or of a two-entry list with equal values, and a non-stepped one-node list throws
    on its first update (`Cannot read properties of null (reading 'time')`). In the game the
    `ParticleEmitter` tick has no try/catch, so the Pixi ticker stopped for good. Colour start ==
    end and the stock `moveSpeed` with equal ends (2026-10-13, "Found, not fixed") hit it today; a
    parameter default equal to a curve's other end saved one too.
    - The single-point → stepped guard is now ONE `engine-fx` helper, `stepCollapsedValueLists`. It
      runs on the CLONED config wherever a renderer binds one: `bindArt` (runtime sprite path and
      all three launcher stages), the Tier-C `bindRigParticle` in `<ParticleEmitter>`, `FxStage`'s
      `bindRigParticleConfig`, and the applier's rebuild of a behaviour.
    - The stored doc is never altered.
    - The applier's working copies come from the layer's own config, not the stepped bound copy, so
      a value that opens the curve again interpolates instead of sticking as a step.
  - **A driven `emitterLifetime` now sets the burst length.** `init` → `emit` latched the config's
    lifetime into the emission countdown before the drive wrote it. New `bindEffectParams` (the
    applier + its first values) restarts the countdown when a drive changed it. All four renderers
    bind through it, and `FxStage` sets `emit` after binding on its placeholder and rig-particle
    paths too.
  - **⚡ New parameter… on a value outside the row's range** (Offset X 640 on a −500..500 row)
    widens the parameter's range instead of clamping the default. Mapped leaves are extended along
    the same line, so exposing never changes the look.
  - **The page always equals what Save stores.**
    - Every `doc =` on `/fx` goes through one `setDoc` that re-applies the defaults.
    - Deleting a layer drops the drives that name it; a parameter left with none stays. A drive on a
      removed behaviour stays (⚠), so switching the section back on restores it.
    - A new, pasted, duplicated or renamed layer never takes a key an orphan drive still names
      (`nextLayerKey`, `uniqueLayerKey`, `layerKeyTaken`).
  - **Inspector cost.** A row's "is it driven" check no longer runs the row's setter and lists the
    leaves on every render. What a row writes is cached by row key and recomputed only when the
    layer's set of leaves changes, and the full exposure is built only when ⚡ is clicked. Measured
    in Node on the Smoke preset: 70 rows per render, 13.6 ms → 0.05 ms.
  - **Nits.**
    - `pos.x / pos.y` are written in the space `init` uses (config space turned by the emitter's
      `rotation`), and apply / restore at the defaults write nothing. Before, the mount-time
      `restore()` moved a rotated emitter's spawn point.
    - `<ParticleEmitter>` skips its params effect's first run, so the mount binds once.
    - The applier keeps plain arrays (no `Map` iteration per frame), and `EditorEffectLayer`
      iterates its nodes as before when nothing supplies values.
    - Two drives on one value are flagged (`param-target-duplicate`) in the panel, amber.
    - `RIG_PARTICLE_BEHAVIOR_TYPE` is defined once in `engine-fx`; `pixi-svelte`'s
      `rigParticleBehavior` imports it.
    - `renameParamTo` no longer shadows its argument.
    - `rigger-fx.js` rebuilt.
  - **Verified.** `pnpm check:fx-params` grows the cases below, each mutation-checked: it goes red
    with the `bindArt` guard removed, the re-latch removed, `pos` ignoring rotation, the working copy
    taken from the stepped bound copy, and the range widening removed.
    - Collapsed alpha, colour and `moveSpeed` lists plus a one-point scale render on the real
      `Emitter` through `bindArt`, with the stored config byte-identical.
    - The burst lasts the driven 3 s, including when emission starts later.
    - The out-of-range expose leaves the saved config byte-identical, for an as-is and a mapped leaf.
    - The layer-delete and key-reservation model.
    - The rotated `spawnPos` is left alone at the defaults and matches `init` + `rotate` when driven.
    - Shared targets are flagged.
  - **NOT browser-verified** (auth + Postgres + R2 gated).
- 2026-10-15 — **Exposed parameters, Step 1: any value of an effect can be a named parameter
  that moves the effect live with no reset.** Owner ask (2026-10-15): expose parameters of an
  effect and drive them from outside; any parameter, not a fixed list. Plan:
  [design §"Direction (2026-10-15)"](../design/invisible-fx.md).
  - **Schema.** `EffectDoc.params?: EffectParam[]` — `{ id, kind: number | color | bool, default,
    min?, max?, note?, drives }`, each drive `{ id, layer?, path, from?, to? }`. Paths:
    `emitter.<field>`, `behavior:<type>[#n].<dot.path>`, `placement.offset.x|y`, `effect.alpha |
    scale | tint | timeScale`. The art behaviours and Tier C's `spineParticle` are refused.
  - **One module: `packages/engine-fx/src/params.ts`** (exported from the package, PixiJS-free):
    the parser, the mapping (number → number linear + clamped; number → colour RGB lerp; bool picks
    from / to; colour writes itself), `applyEffectParamDefaults`, validation, the leaf listing, and
    the live applier. `normalizeEffectDoc` keeps `params` fail-closed (a malformed parameter or
    drive is dropped; one whose layer or behaviour is gone is KEPT, reported by validation and
    inert) and writes every drive's default into the configs, idempotently. An effect without
    `params` is byte-identical: same object, same JSON, no new key.
  - **How a value applies.** `Emitter.init` kills every live particle, so the applier never calls
    it: it rebuilds only the driven behaviour from a copy of the BOUND config (art kept) with the
    old instance's own constructor and swaps it into the same slot of `initBehaviors` /
    `updateBehaviors` / `recycleBehaviors` — at most once per behaviour per frame, only on a
    change. Emitter fields are set with `init`'s own coercion (`spawnPos` through
    `updateSpawnPos`). No values, or values equal to the defaults, do nothing. Two library traps
    surfaced and are handled: a rebuilt behaviour whose value list collapses to one point (a curve
    end dragged onto the other's value) is built STEPPED, because the library throws on such a list
    (now one helper for every renderer — see the review-fixes entry); and `fxForces` now resolves its movement coupling on update as
    well as on init, so a strength swapped in mid-flight keeps folding into
    `moveAcceleration` / `moveSpeedStatic`'s velocity.
  - **Four renderers, one applier.** `<EffectPlayer params>` takes a getter read on the Pixi
    ticker (not a reactive prop) → `<EffectLayer>` → `<ParticleEmitter fxParams timeScale>`; a new
    `EffectParamGroup.svelte` wrapper is mounted only when the doc has an `effect.*` drive. `/fx`'s
    `FxStage`, the Scene Editor's `EditorEffectLayer` (`effectParamValues` prop) and the
    Rigger/Symbols `fxOverlay` (`FxPlayOptions.params`) use the same applier; the latter two apply
    the `effect.*` defaults (no stored leaf) and get live values from Steps 2–4. `rigger-fx.js`
    rebuilt. `effect.scale` sizes free layers only: `<RigBoneAttach>` divides its parent's scale
    out, so a bone layer keeps its bone's size (alpha and tint reach every layer).
  - **`/fx` UI.** ⚡ on every inspector row (sliders, number boxes, colour fields, the force
    On and rotate-to-travel switches): **New parameter…** or **Drive with** an existing one. The
    leaves are found by running the row's own setter on a scratch copy and diffing — so a row that
    writes two leaves (direction ± spread, a rectangle's width) exposes both, a non-linear side
    effect (Lifetime min dragging max) is dropped, a clamped row is exposed through its own leaf,
    and a row whose behaviour exists only off its default (spin at 0) says to move it first. An
    **All parameters** tree lists every scalar leaf of the layer. The **Exposed parameters** panel
    (Layers column) edits id, kind, range, default and note (saved), lists each drive with an
    editable from → to, ✕ and a ⚠ when it no longer resolves, and has a **Preview** slider (not
    saved) that moves the stage live. A driven row shows ⚡ with the parameter's name; an as-is
    drive keeps it editable (it edits the default), a mapped one makes it read-only. Every change
    the page makes to the doc goes through one setter that re-applies the defaults (see the
    review-fixes entry above), so what the page shows is what Save stores. A layer rename follows
    into the drives. Save / lease / unsaved-guard paths are unchanged.
  - **Verified.** New gate `pnpm check:fx-params` (`tools/fx-spike/exposedParams.ts`, discovered by
    `check:all`): the parser (good / bad paths, `#n`, the excluded behaviours), the mapping,
    defaults-in-config + normalize idempotence + no-params byte identity, the expose model on real
    inspector setters, and the real `Emitter` — the same live particle objects survive, the count
    does not drop, live and new particles show the new alpha / scale / colour / force, the three
    behaviour arrays keep their order and length, one rebuild per behaviour per call, every emitter
    field equals what `init` makes of the same value, `restore()`, the collapsed-list guard, and the
    save → export → bake round-trip carrying `params` verbatim. Mutation-checked: dropping the
    `updateBehaviors` swap, reverting the `fxForces` fix or removing the list guard each turns it
    red. The 16 other fx-spike gates, `check:rig-fx-overrides`, `check:rig-flipbook-overrides`,
    `check:doc-readers-unknown-fields` (now covering a parameter and a drive), `engine-fx`
    typecheck + lint, `check:vendored-bundles`, and `check:svelte` for `apps/launcher-api` (47) and
    `packages/pixi-svelte` (14) at their baselines are green; `launcher-api` and `apps/lines` build.
  - **Fixed alongside:** Particle → Kind's **Rig clip** option carried `value="rig"`, but the
    model's kind is `'spine'`, so choosing it set `particleKind: 'rig'` — the rig picker never
    showed and Save normalized the layer back to a sprite. It now carries `'spine'`.
  - **Found, then fixed on `main`:** the Scene Editor overlay drew a free layer at the node origin
    and never applied its authored `placement.offset`. #1221 (the entry below) put each free layer
    in a container at its offset; merging it here made an offset drive in the Scene Editor move
    that container to the driven offset, as it does in the game and `/fx`.
  - **NOT browser-verified** — `/fx` is auth + Postgres + R2 gated (open item above). **Engine
    change** (`engine-fx`, `pixi-svelte`): it reaches shipped games only through a runtime-bundle
    republish.
- 2026-10-15 — **An FX previews under the art that follows it in the outline.** Owner-approved
  follow-up to the restack entry below. The Scene and Component Editors stack one surface per
  kind for each screen (2D, then rigs, then text, then FX), so every FX drew over every sprite,
  rig and text on its screen; the game draws them in outline order. `EditorCanvas.svelte` now
  splits a screen into **depth segments** (`depthSegments` in `editorCanvas.helpers.ts`): a new
  segment starts at the first node with other art after an FX, and each segment gets its own
  2D / rig / text / FX surfaces, so later art draws over the FX. A screen with no FX ahead of
  other art stays one segment with the same surfaces and report keys as before. The cost is WebGL
  contexts: each later segment adds a rig, text or FX layer only when it holds that kind. Report
  buffers are keyed per segment (`<sceneId>#seg<i>`) and dropped when a reorder merges a segment
  away (`forgetReportKey`). A full-screen dim is drawn by one segment's rig layer only (the one
  holding the dim anchor, else the first with a rig), so it never doubles. `EditorTextLayer` gained the `nodeFilter` the rig and FX layers already had.
  Inside one segment the fixed 2D → rig → text → FX order still applies, and a node's own `zIndex`
  is still not read by the editor. Gate: `check:depth-segments` (mutation-verified: never
  splitting, and ignoring a bound anchor, each fail it). Verified: svelte-check at baseline (47),
  eslint, Prettier, `check:undefined-names`, launcher build, and the real `EditorCanvas` mounted in
  headless Chromium. With `[bg, FX, frame]` the stack is now 2D(bg) → FX → 2D(frame), where before
  it was one 2D canvas (bg and frame) under the FX. Reordering the FX to the end merges it back to
  one segment with no errors. Particles were not drawn in that harness (no effect server), so the
  pixels on a real effect are owed a look.
- 2026-10-15 — **Placed FX restack when the outline order changes.** Owner report: in the
  Component Editor the FX ignored their order. `EditorEffectLayer.svelte` (the Scene and
  Component Editors' live particle overlay) only added a node's container when it was built, and
  a rebuild only repositioned kept nodes. So reordering FX in the outline, hiding and showing
  one, or swapping its effect left them stacked in the order they were built. Each rebuild now
  re-appends the containers in tree order, as `FxStage` already does for layers. This fixes the
  order among FX only; FX against other art is the entry above. Verified: the restack loop against
  `pixi.js` 8.22.0 (`addChild` moves a kept child to the top, so a reorder and an insert both
  land in outline order). Not driven in a browser.
- 2026-10-15 — **The Scene Editor previews a free layer at its offset.** `/editor`'s live particle
  overlay (`EditorEffectLayer.svelte`) built every emitter at the node origin and never read
  `placement.offset`, while the game's `<EffectLayer>` mounts a free layer in a container at that
  offset — so an offset layer previewed in one place and played in another. Each free layer's
  emitter now sits in a child container at `planLayer(layer).offset`, the same reduction the
  runtime mounts from, so the two can't drift on this again. The measured particle spread (the
  selection-box fit) follows, since it is read off the node container. Bone layers are still
  skipped by the overlay. Not a vendored bundle, so no rebuild. Verified: the fx-spike `placement`
  and `player` gates, `pnpm check:svelte --only apps/launcher-api` (47, at baseline), lint and
  `check:undefined-names` pass, and a one-off Node run of the overlay's container shape against
  the real `Emitter` put the particle and its bounds at the authored offset. **Not driven in a
  browser** (`/editor` is auth + Postgres + R2 gated).
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
    and the bone-ridden reveal symbol. `/fx`'s `FxStage` had the same formula on the same y-down
    RigView, so its Tier-B backdrop was mirrored too. It now calls the same helper.
  - **Mirrored rigs.** A follower INSIDE a flipped rig shares its mirror and lines up with the bone.
    A follower mounted BESIDE a flipped rig (the reveal rider, a layout node's attached effects) is
    not mirrored, so it keeps the axis the flip spares: its up-axis under an X flip (the editor's
    `unrotatedScale` reading), its x-axis under a Y flip. It is upright at rest and turns the way the
    bone visibly turns. The old formula happened to get this one case right, and it is unchanged.
  - **Still differs from the Scene Editor preview** on a rig node that is rotated or flipped. The
    preview's bone rider ignores the node's rotation and doesn't reverse its turn under a flip. That
    gap predates this change.
  - **Known lag.** Under a slot host, the parent's world transform is read from the last render, so
    on a fast-moving slot bone the FX can be a frame off. Position has always had the same lag.
  - **Verified.** New fixture `packages/pixi-svelte/fixtures/rigBoneRotation.fixture.ts` runs against
    a real engine-rig skeleton. It checks a plain mount, a fitted rig, a rig flipped on X, a slot on
    the same bone or another bone, a sibling host, and a sibling of a rig flipped on X or Y. It also
    checks that the game's angle equals the Rigger preview's for every pose. It fails against the
    old sign, against ignoring the parent frame, and against an x-axis-only rule (which turns a
    follower beside an X-flipped rig upside down). Prettier, lint, `check:undefined-names`,
    `check:svelte` (pixi-svelte + launcher at baseline) and `check:vendored-bundles` all pass. **Not
    pixel-verified in a browser.** **Engine change:** live games get it with the next runtime
    release. Any game with a bone follower on a ROTATED bone will look different from today. It
    will now turn the way the bone does.
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
    reproduced headlessly and is untouched here. *(Fixed 2026-10-15 for every renderer — see the
    "Exposed parameters: review fixes" entry.)*
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
