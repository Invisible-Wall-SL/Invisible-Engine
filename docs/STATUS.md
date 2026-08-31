# Project status — global index

> **This file is now a slim index, not a changelog.** Each tool's living state lives in its
> own file under [`docs/status/`](status/) (see [`docs/status/README.md`](status/README.md)
> for the model). This page carries only the **cross-cutting roadmap**, the **owner/external
> blockers**, and the **map of where every tool's docs live**. When you finish work on a tool,
> update *that tool's* `docs/status/<tool>.md` — not this file.
>
> The old reconciled block + the dated 2026-07-xx changelog + the Track 1/Track 2 historical
> log were moved verbatim into [`docs/history.md`](history.md) (snapshot 2026-07-15). Nothing
> was lost. That file is now a **frozen archive** — see [History](#history) at the bottom.

## The one rule that keeps these docs from drifting

A fact lives in **exactly one** surface. Design doc = the *plan*. Status file = *current
state*. Tool guide = *how to use the UI*. Agent prompt = *pointers*. The global index and the
agent prompts **link**, they never restate. (This split exists because STATUS.md kept
re-growing into a 3,000-line changelog — with no per-tool home for "current state", every
change piled back into one file. See [`docs/status/README.md`](status/README.md).)

## Tool & area map

| Area | Current state | Plan (design) | User guide | Agent |
|---|---|---|---|---|
| **Invisible FX** | [status/fx](status/fx.md) | [design/invisible-fx](design/invisible-fx.md) | [tools/fx](tools/fx.md) | `invisible-fx` |
| **Invisible Flipbook** | [status/flipbook](status/flipbook.md) | [design/invisible-flipbook](design/invisible-flipbook.md) | [tools/flipbook](tools/flipbook.md) | `invisible-flipbook` |
| **Invisible Flow** (v1 rt + v2 editor) | [status/flow](status/flow.md) | [design/invisible-flow-v2](design/invisible-flow-v2.md) | [tools/flow](tools/flow.md) | `invisible-flow` |
| **Invisible Editor** (Scene Editor) | [status/editor](status/editor.md) | [design/invisible-editor](design/invisible-editor.md) | [tools/invisible-editor](tools/invisible-editor.md) | `invisible-components` |
| **Component Editor** | [status/component-editor](status/component-editor.md) | [design/invisible-editor](design/invisible-editor.md) | [tools/component-editor](tools/component-editor.md) | `invisible-components` |
| **Invisible Rigger** | [status/rigger](status/rigger.md) | [design/invisible-rigger](design/invisible-rigger.md) | [tools/rigger](tools/rigger.md) | `invisible-rigger` |
| **Invisible Cinematic** (a mode inside `/rigger`) | [status/cinematic](status/cinematic.md) | [design/invisible-cinematic](design/invisible-cinematic.md) | [tools/rigger §Cinematic mode](tools/rigger.md#cinematic-mode) | `invisible-rigger` |
| **Symbols State Machine** | [status/symbols](status/symbols.md) | [design/…-symbols-state-machine](design/invisible-symbols-state-machine.md) | [tools/symbols-state-machine](tools/symbols-state-machine.md) | `invisible-symbols` |
| **Atlas Maker** | [status/atlas-maker](status/atlas-maker.md) | [design/atlas-per-user-session](design/atlas-per-user-session.md) | [tools/atlas-maker](tools/atlas-maker.md) | `atlas-python-tools` |
| **Sheet Maker** | [status/sheet-maker](status/sheet-maker.md) | — | [tools/sheet-maker](tools/sheet-maker.md) | `atlas-python-tools` |
| **Font Maker** | [status/font-maker](status/font-maker.md) | [design/invisible-font-maker](design/invisible-font-maker.md) | [tools/font-maker](tools/font-maker.md) | `atlas-python-tools` |
| **Game Maker** | [status/game-maker](status/game-maker.md) | [design/invisible-game-maker](design/invisible-game-maker.md) | [tools/game-maker](tools/game-maker.md) | `invisible-game-maker` |
| **Game Config** | [status/game-config](status/game-config.md) | [design/invisible-game-config](design/invisible-game-config.md) | [tools/game-config](tools/game-config.md) | `invisible-game-config` |
| **Localization** | [status/localization](status/localization.md) | — | [tools/localization](tools/localization.md) | `invisible-localization` |
| **Win Text** | [status/win-text](status/win-text.md) | [design/invisible-win-text](design/invisible-win-text.md) | [tools/win-text](tools/win-text.md) | — |
| **Invisible Sound** | [status/sound](status/sound.md) | [design/invisible-sound](design/invisible-sound.md) | [tools/sound](tools/sound.md) | — |
| **FTP Browser** | [status/ftp-browser](status/ftp-browser.md) | — | [tools/ftp-browser](tools/ftp-browser.md) | `invisible-ftp-browser` |
| **Spine Viewer** | [status/spine-viewer](status/spine-viewer.md) | — | [tools/spine-viewer](tools/spine-viewer.md) | `launcher-studio` |
| **Launcher / platform** | [status/launcher](status/launcher.md) | [design/unified-project-repo](design/unified-project-repo.md) | [tools/launcher](tools/launcher.md) | `launcher-studio` |
| **Engine & games** (runtime) | [status/engine](status/engine.md) | [design/flow-driven-game](design/flow-driven-game.md) | — | `engine-pixi-svelte` |
| **Infra** (Railway/CF/R2) | [status/infra](status/infra.md) | — | [INFRA.md](INFRA.md) | `infra-railway` |

**Not tracked here (by design):** third-party tools — **ComfyUI**, **Spine Editor**, **Storybook** —
keep their own upstream docs (we only ship a `docs/tools/` guide for how we host/launch them). The
**desktop Invisible Launcher** (publish-only) is covered inside [status/launcher](status/launcher.md).
**Invisible Blueprints** is an **Atlas Maker feature**, not a separate tool (no registry entry) —
shareable ComfyUI workflows the Atlas Maker picks from; code-complete, owner live-verify owed.
Tracked in [status/atlas-maker](status/atlas-maker.md). **Flow-driven game** is an initiative on top
of Invisible Flow, tracked in [status/flow](status/flow.md) — see [its design doc](design/flow-driven-game.md).

Cross-cutting design docs (not tools — platform/pipeline plans):
- [multi-user-concurrency](design/multi-user-concurrency.md) — **lost-update prevention**: doc leases + R2 conditional writes, so two users stop overwriting each other. Agent: `pipeline-concurrency`.
- [invisible-blueprints](design/invisible-blueprints.md) — shareable ComfyUI workflows for the Atlas Maker (feature, not a tool).
- [unified-project-repo](design/unified-project-repo.md) — **the live R2 folder layout**: one `<client>/<project>/` tree (by asset type) shared by all tools.
- [r2-client-isolation-and-scaffold](design/r2-client-isolation-and-scaffold.md) — the earlier per-tool R2 layout the unified repo superseded + project scaffolding.
- [live-assets](design/live-assets.md) — the `deploy/` asset contract + export→bake→pull→register chain every authored doc travels.
- [games-deploy](design/games-deploy.md) — one engine repo, shipped games as submodules.
- [project-explicit-tool-scoping](design/project-explicit-tool-scoping.md) — how tool capabilities/scopes are gated.
- [unified-tool-bar](design/unified-tool-bar.md) — the shared `ToolTopBar` chrome every tool renders.
- [invisible-debug-framework](design/invisible-debug-framework.md) — the shipped in-game `__IE_DEBUG__` menu framework.

## Cross-cutting roadmap — genuinely UNBUILT, prioritized

Per-tool "next" lives in each `docs/status/<tool>.md`; this is the pipeline-wide priority order.

1. **Rigger auto-weights quality** — geodesic/heat skinner + character-mesh validation gate.
2. **Blueprint model auto-download** (ComfyUI-Manager API) — uploaded blueprints assume their
   models are already installed.
3. Smaller: the concurrency **force-always Save** fix (symbols/fx/localization wire `onclick={save}`,
   passing the event as `force` → manual Save silently overwrites; change to `() => save()`);
   **Rigger Phase 3.6d** (hull-loop reordering — the 3.6c permutation primitive exists, no UI yet);
   refresh [tools/fx.md](tools/fx.md) for the new Emission/Movement/Colour/Blend/Presets sliders
   (rule 9).

**Recently closed** (2026-08-05 → 08-20):

- **`ways` is a first-class authoring kind** (2026-08-20, #361–#364 + the filled layout). It now has
  a slot template, a `/flow` emitter palette, its own `/flow-v2` vocabulary + starter flow seed, and
  a FILLED reference layout — on top of the win model, per-way pricing and ways mock protocol that
  landed in #355/#357/#360. It needed no new art: `apps/ways` ships the same `reelsFrame` atlas as
  `apps/lines`, frame-for-frame. **`cluster` / `scatter` were scoped OUT on 2026-08-19 — and that
  decision was REVERSED the next day** (see the next entry). Their win models were already declared
  and correctly priced. ([status/editor](status/editor.md) · [status/flow](status/flow.md))

- **The cascade (tumble) + multiplier-collect mechanics are in the shared runtime** (2026-08-20,
  #375 then #377 — cluster Phases 1–2, then scatter Phases 1–2). This reverses the 2026-08-19
  scope-out above, which was right that a cascade is a board **mechanic** rather than a template and
  wrong about what one costs. Two findings shrank it: the tumble is an **overlay** that mounts for
  the duration of a cascade and unmounts again (`boardHide → tumbleBoardShow → init → explode →
  removeExploded → slideDown → boardSettle → tumbleBoardHide → boardShow`), so a game that never
  tumbles never mounts it — the seam that let the mechanic land in the shared runtime without putting
  its risk on `lines` or `bookOf`; and **`explosion` was already an authorable symbol state**, so a
  cascade's defining animation is authored in `/symbols` like any other and the mechanic needed no
  symbol tooling of its own. Landed: `stateTumble.svelte.ts`, `TumbleBoard`/`TumbleSymbol`, three
  book events, seven `/flow` cues and a registered `/flow-v2` `cluster` vocabulary, then scatter's
  `boardMultiplierInfo` + six more cues on a `SCATTER_VOCAB` that INHERITS `CLUSTER_VOCAB` (the two
  share the whole cascade, so declaring the tumble surfaces twice would only let them drift). Both
  live in `apps/lines` because that IS the shared runtime bundle. Whether the `cluster` / `scatter`
  **templates** get built is now a separate, much smaller question.
  ([status/engine](status/engine.md))

- **Invisible Cinematic — Phases 0–3 COMPLETE + Tweak Mode** (built 2026-08-17, tweak 2026-08-18).
  Double-clicking a strip now opens its clip in the animator with the rest of the stage posed around
  it — the "overwrite an animation" ask that the Phase 1→2→3 run had skipped. A fourth mode inside `/rigger`:
  stage several rigs as actors, author them on an NLE-style sequencer (strips · layers · blending),
  key property / camera / visibility channels, drop named cues, undo/redo. Saves per project to R2,
  travels the ship chain with the rigs it casts, plays in-game through `<Cinematic>` off one shared
  evaluator, and is triggered from an authored flow by the **`playCinematic`** node. ⏳ The engine
  half has not yet run in a real game. ([status/cinematic](status/cinematic.md))
- **ComfyUI generation moved to RunPod — both local-GPU blockers are GONE** (owner-verified
  2026-08-18). **gpt_image** and the **FLUX ref/ControlNet path** both generate on the RunPod
  backend; neither depends on what is installed on the local 4070 any more. Supporting work: the
  serverless worker went cu128 / torch 2.8 so one image covers Blackwell through Ampere, a
  free-VRAM-conditional ComfyUI restart between jobs fixed the DepthAnything OOM, and each
  serverless variant now gets a unique filename instead of overwriting the last (all 08-15); the
  multi-pod R&D fleet + baked pod image landed 08-13.
  ([status/comfyui](status/comfyui.md), [status/atlas-maker](status/atlas-maker.md))
- **Localization reaches the game.** A project's translations were never actually loaded (catalog
  merged at module-eval, before the runtime fetch; `label` params skipped the resolver) — fixed, plus
  per-launch language + currency, bulk review, and reviewed-only builds. ([status/localization](status/localization.md))
- **Text as localized ART in a rig** — a `/localization` key rasterises into rig art and the
  attachment swaps with the game's language. ([status/rigger](status/rigger.md))
- **Authored text fits its frame** — authorable layout profiles, width-only text-box auto-fit (and
  the Info Bar gained the box), win copy that NAMES the paying symbol, and the symbol rendered as an
  inline image — boxed rows included. ([status/editor](status/editor.md), [status/win-text](status/win-text.md))
- **Engine fixes:** the runtime fetch aborting exactly as the response arrived; free spins rolling on
  by themselves after a big win; stacked pictures; reel anticipation. ([status/engine](status/engine.md))

**Earlier — closed 2026-08-04:** **Concurrency Phase 2 — COMPLETE** (the whole soft-lease + presence
story). 2b the BACKEND (`doc_leases` + `lease.ts` + `POST /api/lease`, DB-adjudicated conditional
upsert, migration 0014, PR #206); 2a the shared `saveState.svelte.ts` + `SaveStatusBadge` every
authoring tool saves through (PR #209, a helper bug + a sticky-conflict-on-target-switch regression
caught in review and fixed); 2c the client `LeaseState` rune + `PresenceBanner` + `SaveState.blockWhen`
read-only gate across **all** authoring tools — editor + flow-v2 (2c-core, PR #211, observer poll
auto-recovers a freed/expired lease, takeover always reachable, fails open on error), then
symbols/win-text/config/localization (2c-rest-A, PR #215) and the per-ITEM fx/flipbook/components via
`LeaseState.switchDoc` (2c-rest-B, PR #216). **Owner-verified live 2026-08-04** (two-profile test per
tool; migration 0014 applied). Phase 3 (Python tools) is a separate later effort. · **Concurrency
Phase 1 — COMPLETE + verified** (the conditional-write floor is
live + REQUIRED across all 13 authoring surfaces; the last residuals — component ETag threaded
load→editor→save, `saveComponentDefaults` guarded, and the fail-open closed via `writeGuard.ts` — PR
#204; owner-verified live) · **Concurrency Phase 0 — COMPLETE + verified**
(rigger indexes → Postgres earlier; the last two RMW-on-a-global-key sites —
`test_server/games.json` + the fonts catalog — now guarded with `If-Match` + CAS retry, PR #201;
owner-verified live) ·
**Invisible Game Config** (all phases + grid/bet-modes/win-tiers shipped and live-verified) ·
**Ship-from-Rigger** rule-8 wiring (a rig now travels export→deploy→bake→pull→register into a game) ·
**Flow-driven-game Phase 5** (a shipped title runs an authored FlowDoc) · **Rigger mesh-deform
animation timelines** (per-vertex `deform` dopesheet channel → Spine 4.2 keyframes, merged +
owner-confirmed) · **Rigger Phase 3.6a/b/c** (visual UV panel + constraint edges + hull promote/demote,
owner-verified live; only the minor 3.6d hull-loop reorder remains) · **B4 HUD migration — apps/lines
flip** (live Balance/Win/Bet readouts render as `hudReadout` component instances, shipped 2026-06-08;
the docs were just stale — remaining tail = the Borut mirror B4.6 + live-verify). See each tool's
`docs/status/<tool>.md`.

## Blocked on owner / external (not code)

- ~~**gpt_image generation**~~ — resolved: generates on the **RunPod** backend, owner-tested
  2026-08-18. It no longer depends on the `Images to RGB` node / ControlNets being installed on the
  local GPU. ([status/atlas-maker](status/atlas-maker.md))
- ~~**FLUX ref/ControlNet path**~~ — resolved the same way: proven on RunPod 2026-08-18, so the
  "only SDXL ControlNets are installed locally" constraint no longer gates it.
- **Shipped-game submodule bumps (owner-owned)** — Book of Borut bumps to ship FX / Flow / info-bar,
  **plus the B4.6 HUD-readout mirror** (Borut still renders coded `UiLabel*` binds; the apps/lines
  component-instance flip reaches it only on a submodule bump + republish) ([[feedback_bump_game_submodule]]).
- ~~**prod DB migrations applied?**~~ — resolved: migrations are applied through **0014** (the
  concurrency lease table), owner-confirmed 2026-08-04. ([status/infra](status/infra.md))

## History

[`docs/history.md`](history.md) is a **frozen archive** (newest-first) of done work up to
2026-07-29 — the old STATUS changelog plus the done-work narrative of that era. It is **read-only:
nothing gets appended to it any more.** Done-work detail now lives in each tool's
`docs/status/<tool>.md` "Recent changes", which is where it was already being written; the archive
was frozen on 2026-08-18 once it had fallen 270 commits behind and become a stale surface that
looked authoritative. The `([detail in history](history.md))` links in the older status entries
still resolve correctly — leave them.
