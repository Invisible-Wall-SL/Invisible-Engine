# Invisible Flow — status

> Design: [invisible-flow-v2.md](../design/invisible-flow-v2.md) (+ [schema](../design/invisible-flow-v2-schema.md), [v1 plan](../design/invisible-flow.md), [flow-driven-game](../design/flow-driven-game.md)) · Guide: [docs/tools/flow.md](../tools/flow.md) · Agent: `.claude/agents/invisible-flow.md`

**One-line state:** Shipped and live — `/flow-v2` is the only editor, the v1 runtime + doc format + bake still power the game, and the flow-driven-game engine story (loading→tap→basegame, win-branch, condition guards, generic takeover mount, HUD replace) is complete on `main`; **no shipped game runs an authored FlowDoc yet.**

## Current state
- **Editor — `/flow-v2` only.** Unreal-style Blueprint graph (exec + typed data pins) over one game, at `apps/launcher-api/routes/(app)/flow-v2/`, backed by `packages/engine-flow-v2`. Palette projected from the template vocabulary (`BOOK_OF_VOCAB`), pins derived from node refs, connect-time type checking, live Validation panel, deterministic headless Preview (ordered effect/cue/delay/show/hide timeline, 1×/2× speed), Collapse-to-Function (global shared library) and Collapse-to-Group, drag-off-pin contextual spawner. Auto-saves (no Save button) to R2 `editor/flow-v2.json` via `POST /api/flow-v2/save` (flow-gated). **v1 `/flow` editor retired 2026-07-13** (route + `/api/flow/save` + v1-editor-only helpers deleted).
- **v1 runtime + doc format + bake still LIVE (load-bearing).** `engine-flow`, `flowExport.ts`/`exportEditorFlow` + `/api/editor/export-flow`, `flowVocabularies.ts` (the `/fx` tool derives its emitter vocab from it), and the `apps/lines/src/game/flow*` interpreter were deliberately KEPT — v2 storage/export, the FX tool, and the live runtime layer on these shared `flow*` primitives. The runtime dispatches a screen/event through the interpreter when a FlowDoc declares it, else falls through to coded mounting + `bookEventHandlerMap` (byte-identical to `main`).
- **Full ship chain exists.** `/flow-v2` author → R2 → `flowV2Export.ts` (`deploy/flow-v2.json`) → bake → bundle slot → game `bakedFlowV2Doc()`. v1 doc bake path also intact.
- **flow-driven-game engine — Phases 1–4 + 6.1–6.3 + 8 on `main`** (merged 2026-06-30, `bdc849f`; see [design](../design/flow-driven-game.md)):
  - **P1** loading splash is a Flow screen; tap fires its `complete` edge to `basegame`.
  - **P2** big-win / free-spin-intro promoted to exclusive Flow screen nodes (`bigWin`/`freeSpinIntro`) reached by guarded `bookEvent` transitions, returning via tap `complete`; small wins stay feed-driven overlays.
  - **P3** revived the `condition` trigger — bounded `$engine.*` reader + a `Game.svelte` `$effect` re-evaluates condition edges on state change. Every trigger kind (bookEvent / complete-tap / condition) is live.
  - **P4** generic `activeScreenTakeover` — any authored non-`basegame`/non-`loading` active screen mounts its backing scene as a top-layer takeover over the persisting board (retires the §20.1 hardcoded-mount limitation).
  - **P6.1–6.3** universal `action`/`visibleSource` bindings tray, UI-vs-schema controls (`visibleFor`/`screenAnchor`/custom `options`), per-instance cue-signal rebinding.
  - **P8** action→intent pins (Spin) SHIPPED. Container events fire from real button presses; Game Signals source node; intent-command actions for every standard HUD button.
- **HUD full-replace** — `hud_*` screens at the HUD z-band replace coded UI (`hasAuthoredHud` suppresses coded `<UI>`).
- **Generic `showMessage` effect** (2026-07-14) — Flow-authored Info Bar / transient toast producer, wired into the `winInfo` choreography in both v1 and v2 reference docs; fall-through unaffected.
- **Ships via runtime bundle vs main merge:** the launcher/editor UI ships on Railway from a `main` merge; the flow **engine** reaches a live online game only via a `publish-runtime-bundle.mjs` (`_runtime/lines`) + `/refresh`, and standalone Book of Borut only via an `engine` submodule bump.
- **⏳ Caveats:** **no shipped game runs an authored FlowDoc yet** — the pipeline exists but no real project's `bigWin`/`freeSpinIntro`/`loading` backing scenes are authored + baked + shipped. The cutover-track runtime dispatch / book-event ownership are landing incrementally; verify a project's authored flow against the live game (baked data masks dev-only bugs).

## Open items / next
1. **flow-driven-game Phase 5** — author real `bigWin`/`freeSpinIntro`/`loading` backing scenes in the editor, bake, and ship a game on a real FlowDoc (the end-to-end acceptance proof; owner online-authoring + republish, then bump the game submodule).
2. **Phase 9** — value dataflow pins → value edges (the symmetric other half of Phase 8; mirrors its shape).
3. **Phase 6 remainder** — `value`/`signal` universal binding (needs a def node to consume them), `def.slots` / component-`space` UI.
4. **Phase 7** — behaviour/timeline layer + open catalog (the long tail).
5. Author the `showMessage` action node into the live `winInfo` forEach + ship the runtime bundle.
6. Editor gaps: containers + `templateId` are data-only (not UI-editable); cue `await` flag not authorable; function Entry/Result signature fixed once created.

## Blocked (owner / external)
- **Ship a real game on a FlowDoc** — owner-owned online authoring + republish / Book of Borut `engine` submodule bump.

## Recent changes
- 2026-07-15 — `onTapToStart` pin made live + music is flow-driven ("Option B"). The runtime only ever dispatched `load`, so the Game Signals `onTapToStart` pin was dead. Now the flow holder (`flowV2InterpreterHolder.dispatchFlowV2Complete`) fires `tapToStart` into the flow EXACTLY ONCE per session — on the first tap-to-continue COMPLETE after `load` (one-shot latch reset per boot in `setFlowV2`); parity-safe (a no-op when no v2 flow owns `tapToStart`). `Sound.svelte` no longer auto-plays `bgm_main` at boot when a v2 flow drives screens (gated on the new canonical `flowV2DrivesScreens()` doc-level predicate in `flowV2Runtime.svelte.ts` — a synchronous mirror of Game.svelte's `ownsEvent('load')` decision, usable before the handle exists); the reference `LINES_FLOW_V2_DOC` wires `onTapToStart → soundMusic(bgm_main)` (validates 0 issues). Non-flow / v1 / v2-not-driving paths are byte-identical (music still boots as before). Verified headlessly by `tools/flow-spike/flowV2TapToStart.ts` (`pnpm --filter flow-spike run v2taptostart`) + `pnpm --filter lines build`. Not yet shipped to a live game (no runtime-bundle publish / submodule bump).
- 2026-07-15 — Node pins carry authored help. Optional `description` on `EventDecl`/`ParamDecl` (vocab) → derived onto `Pin.doc` → a theme-styled hover card in `FlowV2Node.svelte` (replaces the plain `title`). Authored for all 13 book-of Game Signals + their payload fields in `BOOK_OF_VOCAB`; the same `doc` also surfaces on standalone `event` nodes. Purely additive/optional — pins without a `description` keep the plain label tooltip.
- 2026-07-14 — Generic `showMessage` Flow effect (Info Bar / toast producer), authored into both reference docs ([detail in history](../history.md)).
- 2026-07-13 — v1 Flow editor teardown: `/flow` route retired, v2 is the only editor ([detail in history](../history.md)).
- 2026-07-10 — flow-v2 flatten re-namespaces colliding group-body node ids (fixes press-Spin → free-spin-intro); shipped via `_runtime/lines` ([detail in history](../history.md)).
- 2026-07-09 — flow-v2 generic overlay round-block HOLD + container z re-stamped from `docLayerZIndex`; drag-off-pin contextual spawner ([detail in history](../history.md)).
- 2026-07-08 — flow-v2 cutover track (parity + translator + game-side dispatch), Collapse-to-Group, Game Signals node, container events as exec-out pins, intent-command HUD actions ([detail in history](../history.md)).
