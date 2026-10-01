# Invisible Cinematic — status

> Design: [docs/design/invisible-cinematic.md](../design/invisible-cinematic.md) · Guide: [docs/tools/rigger.md §Cinematic mode](../tools/rigger.md#cinematic-mode) (it is a mode of `/rigger`, so it shares the Rigger's guide) · Agent: [`.claude/agents/invisible-rigger.md`](../../.claude/agents/invisible-rigger.md)

**One-line state:** Phases 0–3 + Tweak Mode, strip masks and inline posing are built — `/rigger`'s
🎬 Cinematic mode stages several rigs as tracks of strips + property/camera/visibility/cue keys,
saves per project, ships with the rigs it casts, and plays in game through `<Cinematic>` from a
Flow `playCinematic` node. ⏳ The editor is live-verified. The in-game player plays at authored
speed on a real clock (2026-10-01, a probe cinematic injected into the remake), but no project has
yet shipped an authored cinematic through a `playCinematic` node.

## Current state

- **`/rigger` cinematic mode (Phase 1).** A fourth mode beside Preview / Setup / Animate. Cast a
  rig from the project as an **actor** (the same rig twice = independent instances), place it
  (x / y / scale / rotation / flip), set draw order and visibility, give it a clip, scrub or play
  the stage. Works with **no rig open** (it boots the spine runtime + GL itself). Code:
  `static/rigger/cinematic.js`, plus four hooks in `view.html`. The mode hides the rig-only chrome
  (rig save/export, rig management, anim/skin pickers), so only one Save is on screen. A **Frame**
  picker draws the game canvas box per layout, resolved through `resolveLayoutProfile` (project →
  admin → coded), the same answer the Scene Editor uses.
- **R2 persistence (Phase 3, part 1).** Open / Save / ＋ New / 🗑 over
  `<client>/<project>/cinematics/<id>.json` (Ctrl+S), endpoints under `/api/cinematics/*`, gated by
  the **`rigger`** entitlement. No index blob (the list is a prefix listing); every save carries its
  `baseEtag` (create = `baseEtag: null`), a stale one answers 409 and the author is asked; the save
  posts its `projectKey` and a mismatch is refused even with `force`. `localStorage` is only a
  crash/reload draft. Failures surface in the red error bar with the status and body.
- **The ship chain (Phase 3, part 2).** `cinematicExport.ts` mirrors each cinematic into
  `<client>/<project>/deploy/cinematics/<id>.json` (pruning deleted ones), the runtime bundle and
  the offline bake embed them as `cinematics`, and the game reads `bakedCinematics()` /
  `bakedCinematic(id)` (`[]` when un-authored ⇒ parity). A cast rig may appear in no scene, so
  `exportEditorArt` takes an `extraSpineNames` seed from `cinematicRigNames()`. **Rig identity is
  the FOLDER** (the bundle name), never `SkeletonIndexEntry.id`, which is an array position
  reassigned on every scan.
- **`packages/engine-cinematic`** — the layered strip evaluator (`clipLocalTime`, `blendEnvelope`,
  `evaluateActor` with layer stack / additive / bone masks, `cuesCrossed`, channel sampling,
  `cineTimeForLocal`). Plain ESM JS + hand-written `.d.ts`, because `/rigger`'s static page fetches
  it over HTTP: `static/shared/cinematicEval.mjs` is a **generated verbatim copy**
  (`node scripts/sync-cinematic-eval.mjs`) and the gate fails if the two differ.
- **`<Cinematic>` (`engine-layout/svelte`)** — the in-game player: one `<SpineProvider>` per cast
  member keyed by rig folder, all driven from ONE clock through the shared evaluator on the Pixi
  ticker (a paused game pauses it). Props: `doc` · `playing` · `startTime` · `loop` · `speed` ·
  `oncomplete`. `CinematicActor.svelte` keeps `autoUpdate` ON (off froze every rig on first mount),
  `clearTracks()`, and poses in `beforeUpdateWorldTransforms`.
- **Flow-v2 `playCinematic` node** — pick a cinematic, set `speed`, choose `loop` or
  `awaitComplete`; exec-in play / stop, one exec-out. `loop` + `awaitComplete` is refused at three
  layers (inspector, `cinematic-await-loop` validation **error**, runtime), because it would hang a
  round silently; `stopCinematic` settles a pending await. `<FlowV2Cinematics>` renders the
  interpreter's `playingCinematics`.
- **The sequencer (Phase 2).** Shares `#timeline` with the dopesheet. Ruler scrub, one row per
  track, **layers** per actor (⧉), **strips**: drag, trim either edge (a left-trim moves `start` and
  `clipIn` together), Alt ignores the fps grid, Ctrl+wheel zoom, Del, Ctrl+D. Blend ramps drawn in
  the strip, additive strips tinted. The strip inspector exposes every evaluator field (clip, start,
  length, clipIn, speed, once / fill / count N / ping-pong, blend in/out, alpha, replace vs
  additive). One drag = one undo step.
- **Property + camera tracks** — ◆ keys actor x / y / scale / rotation / alpha at the playhead
  (linear / ease / hold); the camera track keys the current stage view, with a **🎥 live** toggle.
  A keyed channel owns its property for the whole cinematic (holds first/last value), so typing in
  its field keys rather than edits the static value.
- **Visibility tracks** — stepped keys (filled = shown from here, hollow = hidden); a keyed track
  holds its first key backwards so a hidden-then-shown actor never flashes at frame 0.
- **Cue tracks** — ⚡ named moments (`fx:` / `sfx:` / `music:` / `signal:`), picked from a real
  `<select>` (a datalist filters itself to the current value) or typed. Firing is `cuesCrossed`: a
  half-open `(prev, now]` window, and **a seek fires nothing**. Game-side, sounds go through the
  player (guarded by `hasSound`), everything else is broadcast on the event bus under its bare name.
- **Set + depth** — a cinematic can bind a Scene (`stage.sceneId`, mounted through `LayoutScene`).
  The set / `fx:` layer sits on the cast's z line at `stage.setZ` (absent ⇒ behind everything,
  parity), shown as a **⚡ fx** row (**🎬 set** once a Scene is bound) moved with ▲▼. The preview can
  only show bands (all rigs share one WebGL canvas); the game honours the real depth.
- **Overrides — authoring motion inside the cinematic.**
  - **Inline posing** (✎ on a cast row): bones draw on the stage and the animate toolbar appears
    with timeline, cast and playhead unchanged; the first key builds a layer + strip + clip
    (`ensureOverrideClip`) with blend ramps by default — without a blend-out a strip holds its last
    frame (`holdForward`) for the rest of the cinematic.
  - **Tweak Mode** (double-click a strip / ✎ Tweak clip): the existing animator on that strip's
    clip, the rest of the stage posed around it, ONE clock (`syncPlayhead` via the shared
    `cineTimeForLocal`; only the part of the clip the strip shows is reachable). Keying a rotated
    actor's root subtracts the stage rotation. **＋ New clip** creates an empty animation on the rig
    and enters Tweak Mode. Both edit the **rig** — 💾 Save rig, not the cinematic save.
  - **Underlay** — while tweaking, the actor's strictly lower layers are evaluated underneath
    (clips resolved from the rig editor's own `SkeletonData`), additive previews as base + offset.
  - **Strip bone masks** — mask editor on the strip inspector and in the tweak bar (◑ ＋ bone,
    ◑ keyed), live count via the evaluator's `expandBoneMask`, masked bones tinted on stage, ◑ on
    the strip. A sparse hand-authored clip needs no mask (`MixBlend.replace` passes un-keyed bones
    through); masks are for using part of an existing full-body clip. An empty mask is deleted.
- **Undo / redo** — snapshot-based, coalescing edits within 600 ms, only in cinematic mode and never
  while a field has focus; cinematic-document only (rig editing still has no undo).

### Gates + verification

| Proof | Result |
|---|---|
| `tools/rigger-spike/cinematic.mjs` — gates 1 + 2, channel sampling, cues, visibility, tweak-mode time inverse, evaluator-drift (headless) | **118/118** |
| `tools/rigger-spike/cinematic-pixi.mjs` — gate 3, the `spine-pixi-v8` pose contract (not rendering — see its header) | **14/14** |
| `static/rigger/cinematic-harness.html` — gate 2's WebGL half, in a real browser | **11/11** |
| `tools/rigger-spike/cinematic-storage.mjs` — storage guards + the export/prune chain (headless) | **28/28** |
| `tools/rigger-spike/cinematic-flow.mjs` — `playCinematic` against the REAL interpreter + validator | **19/19** |
| Live browser runs of the editor | undo/redo 22, sequencer 35, property/camera 36, R2 client flow 19, masks 31, New clip + tweak-bar masks 35, Tweak Mode ~55, inline posing / underlay / fx row 59 |

### What the gates established

- **Determinism (gate 1).** `scrub(t) === play-to(t)` bit-for-bit over 427 samples × 86 bones
  across a crossfade, a `fill` loop and an additive `pingPong` layer.
- **The MixBlend rule.** First non-additive strip → `setup`, later ones → `replace`, additive →
  `add`; an alpha-0.5 layer lands exactly on `lerp(base, top, 0.5)`. A layer passes through the
  base until its own first keyframe.
- **Looping is resolved into local clip time**, never the runtime's `loop` flag (which would wrap
  the untrimmed duration and ignore `clipIn`).
- **Bone masks are snapshot-and-restore** of the bones outside the mask; bone transforms only.
- **The in-game seam (gate 3)** — `state.clearTracks()` (a leftover track keeps firing its clip's
  events), pose in `beforeUpdateWorldTransforms` (the `after` hook renders the previous pose). The
  gate's `autoUpdate = false` was wrong for rendering: Pixi then never re-uploads the geometry, so
  the player keeps it ON — an emptied `AnimationState` makes that safe.

## Open items / next

1. **⏳ Watch a full AUTHORED cinematic in a game.** The player itself is proved (2026-10-01 below),
   but only with a probe doc injected into the runtime bundle and started from the flow handle. No
   authored cinematic (cues + set + a `playCinematic` with `awaitComplete`) has run through the
   export chain yet; the remake's one doc (`suca_cine`) has no cast and is not exported.
2. **⏳ Live-verify the server chain against real R2 + Postgres** — save, reload, open, publish,
   and confirm `deploy/cinematics/` fills and the bundle carries `cinematics`.
3. **⏳ Owner eyeball** — two rigs staged together (premultiply halos, relative scale between rigs
   authored at different atlas `scale:` factors); and whether Tweak Mode / inline posing *feel*
   like the ask (owner asked to keep both routes until the shape settles).
4. **`sync-cinematic-eval.mjs` is manual** — the gate catches drift, but nothing regenerates the
   browser copy; wire it into a pre-build step.
5. **Non-rig content (design §12)** — `＋ Text` / `＋ FX` quick-add into the bound set (§12.3), and
   placed/persistent FX slots (§12.4a). Rig-level localized text is done as §12.4a in the Rigger.
6. Resolve design §9's open questions (doc scoping + template library, per-ratio, inline vs
   referenced set, flatten-to-`.irig` escape hatch).
7. **A frame hitch when a cinematic mounts.** On the live remake (2026-10-01) the probe cinematic's
   ×1 run took 8.2 s of wall time for 6 s of game time (323 frames), and ×2 took 4.4 s for 3 s.
   The game clock paused for 1–2 s, and so did the cinematic, which follows the game clock by
   design. Locally it ran 6.000 / 3.006 s, with one 8.4 s outlier. It is likely first-use texture
   upload of the cast rigs' large atlases. Measure the longest frame at mount; preloading the cast's
   textures when the flow arms a `playCinematic` would hide it.

## Blocked (owner / external)

- Nothing external.

## Recent changes

- 2026-10-01 — **`<Cinematic>` threw on every in-game mount, and now plays.** It read
  `appContext.app.ticker`, but pixi-svelte's app context is `{ stateApp }` (the application is
  `stateApp.pixiApplication`), so mounting it threw "Cannot read properties of undefined (reading
  'ticker')" and nothing played. svelte-check had reported it from day one (5 × `ts:2339`, with the
  undeclared `oncue` prop), but the errors sat in the ratchet baseline. Both are fixed and the
  baseline is lowered. Found while proving the spine-pixi-v8 4.2.120 bump (#929).
  - **autoUpdate verdict:** 4.2.120 made the `autoUpdate` setter idempotent and moved it onto a
    configurable `ticker` (default `Ticker.shared`). A default `Spine` still registers once, and
    `false` still detaches. 4.2.74 used to add a second listener on a repeated `true`, which would
    double-update a rig. `<CinematicActor>` never touches `autoUpdate`, so its contract is unchanged.
    `tools/rigger-spike/cinematic-pixi.mjs` part C now asserts this against the real runtime.
  - **Real-clock proof:** a local `apps/lines` build (the bump + this fix) on the headless shell at
    60 fps booted the remake's live data. A two-rig probe doc (`R_Cinematic1` Intro → Idle,
    `R_Cinematic2` Tier1_Intro, 6 s) was injected into `/api/editor/runtime` over CDP and started via
    `__IE_FLOW_V2__.playingCinematics`. `oncomplete` fired at 6.012 s for ×1 and 3.032 s for ×2,
    both rigs re-posed every sample, and it unmounted on completion. Across about 200k spine
    updates, none ran twice on a tick with dt > 0; the only repeats were `SpineTrack`'s `update(0)`.

- 2026-08-19 — **Inline posing** (✎ on a cast row) — the owner's third iteration on "edit my bones
  straight into cinematic"; Tweak Mode had answered with a surface swap onto an empty clip.
  Reuses Tweak Mode's state with `inline: true`. Caught live: override blend-outs are
  load-bearing, and `renderTimeline`'s tweak guard had hidden the cinematic timeline.
- 2026-08-19 — **Tweak underlay** — an override is authored over the layers below it, not over a
  T-pose. `beginTweak` now asserts cinematic mode is on (a late `restoreRiggerState` had left
  `cineMode` false with every tweak flag set: frozen stage, UI claiming to tweak).
- 2026-08-19 — **The fx depth row exists without a bound Scene** (it had been gated on
  `stage.sceneId`, leaving the common case with no control), and says when the preview can only
  approximate the depth.
- 2026-08-18 — **＋ New clip, tweak-bar masks, masked bones on stage** — a mask filters a clip; the
  clip it filters could not be created from the cinematic.
- 2026-08-18 — **Strip bone masks** — the evaluator had supported them since Phase 0 with no UI.
- 2026-08-18 — **Tweak Mode** (design §4.4). Three pre-existing crashes fixed on the way:
  `stripById` walked keys-only tracks; imported Spine JSON omits `time` at 0 (`normalizeKeyTimes`
  on load); `getAttachment(null)` throws.
- 2026-08-18 — **The set is a layer** (`stage.setZ`), so an `fx:` cue can play in front of a rig;
  **a cue can be changed** after it is set (real `<select>`, not a datalist).
- 2026-08-17 — **Every game app's build was broken** — `engine-layout` imported
  `@esotericsoftware/spine-pixi-v8` without declaring it; `vite dev` and the launcher (which
  declares it) stayed green. Declared at the same pin as `pixi-svelte` so there is ONE Spine
  runtime. A package that imports a module must declare it; a green dev server is not evidence the
  games build.
- 2026-08-17 — **First real game mount: rigs appeared but never moved** — `autoUpdate = false`
  stops Pixi's update+render pass; it stays ON now (see "What the gates established").
- 2026-08-17 — Frame guide + Frame picker via the canonical layout resolver; set picker (with
  pickers that re-render when their async lists land, and a 🗑 that says why it declined);
  cinematic mode hides the rig-only chrome; save/open failures surface with status + body.
- 2026-08-17 — **Phases 0–3 built in one day**: gates 1–3, the Phase 1 mode (an rAF-polled asset
  wait hangs in a non-painting tab — poll with `setTimeout`; expose `SPINE` as a getter), undo,
  the sequencer, property/camera/visibility/cue tracks, R2 persistence (the save had posted no
  `projectKey`, making the scope guard dead code), the export chain (the `rigId` → folder identity
  fix), `<Cinematic>`, and `playCinematic`.
