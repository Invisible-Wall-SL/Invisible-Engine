# Project status — global index

> **This file is now a slim index, not a changelog.** Each tool's living state lives in its
> own file under [`docs/status/`](status/) (see [`docs/status/README.md`](status/README.md)
> for the model). This page carries only the **cross-cutting roadmap**, the **owner/external
> blockers**, and the **map of where every tool's docs live**. When you finish work on a tool,
> update *that tool's* `docs/status/<tool>.md` — not this file.
>
> The old reconciled block + the dated 2026-07-xx changelog + the Track 1/Track 2 historical
> log were moved verbatim into [`docs/history.md`](history.md) (snapshot 2026-07-15). Nothing
> was lost.

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
| **Invisible Flipbook** (foundations only) | [status/flipbook](status/flipbook.md) | [design/invisible-flipbook](design/invisible-flipbook.md) | — (unbuilt) | — |
| **Invisible Flow** (v1 rt + v2 editor) | [status/flow](status/flow.md) | [design/invisible-flow-v2](design/invisible-flow-v2.md) | [tools/flow](tools/flow.md) | `invisible-flow` |
| **Invisible Editor** (Scene Editor) | [status/editor](status/editor.md) | [design/invisible-editor](design/invisible-editor.md) | [tools/invisible-editor](tools/invisible-editor.md) | `invisible-components` |
| **Component Editor** | [status/component-editor](status/component-editor.md) | [design/invisible-editor](design/invisible-editor.md) | [tools/component-editor](tools/component-editor.md) | `invisible-components` |
| **Invisible Rigger** | [status/rigger](status/rigger.md) | [design/invisible-rigger](design/invisible-rigger.md) | [tools/rigger](tools/rigger.md) | `invisible-rigger` |
| **Symbols State Machine** | [status/symbols](status/symbols.md) | [design/…-symbols-state-machine](design/invisible-symbols-state-machine.md) | [tools/symbols-state-machine](tools/symbols-state-machine.md) | `invisible-symbols` |
| **Atlas Maker** | [status/atlas-maker](status/atlas-maker.md) | [design/atlas-per-user-session](design/atlas-per-user-session.md) | [tools/atlas-maker](tools/atlas-maker.md) | `atlas-python-tools` |
| **Sheet Maker** | [status/sheet-maker](status/sheet-maker.md) | — | [tools/sheet-maker](tools/sheet-maker.md) | `atlas-python-tools` |
| **Font Maker** | [status/font-maker](status/font-maker.md) | [design/invisible-font-maker](design/invisible-font-maker.md) | [tools/font-maker](tools/font-maker.md) | `atlas-python-tools` |
| **Game Maker** | [status/game-maker](status/game-maker.md) | [design/invisible-game-maker](design/invisible-game-maker.md) | [tools/game-maker](tools/game-maker.md) | `invisible-game-maker` |
| **Game Config** | [status/game-config](status/game-config.md) | [design/invisible-game-config](design/invisible-game-config.md) | [tools/game-config](tools/game-config.md) | `invisible-game-config` |
| **Localization** | [status/localization](status/localization.md) | — | [tools/localization](tools/localization.md) | `invisible-localization` |
| **Win Text** | [status/win-text](status/win-text.md) | [design/invisible-win-text](design/invisible-win-text.md) | [tools/win-text](tools/win-text.md) | — |
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

1. **Multi-user concurrency — Phase 0** (`_shared/rigs|animations/index.json` RMW → Postgres).
   *Recommended next — this is live data loss, not a missing feature.* Those indexes are **global
   across every client and project**, so two users on unrelated projects silently drop each other's
   rows today. Then Phase 1 (`If-Match` through `r2.ts`) + Phase 2 (doc lease + presence).
   ([design/multi-user-concurrency](design/multi-user-concurrency.md))
2. **Invisible Game Config — live-verify only (SHIPPED 2026-07-24).** All five phases are in: a
   project authors its own symbols/paylines/grid/bet-modes/strips at `/config`, the game runs that
   instead of `apps/lines`' shared sample, and the symbol-defaults publish gates on the authored
   config — the fix for the wild (`W`) that rolled past a Lines game's reels its math never deals.
   Only the owner click-through of the `/config` page remains (it renders only in the deployed
   launcher). See [status/game-config](status/game-config.md).
3. **Ship-from-Rigger (rule 8)** — a rigged skeleton only `.irig`-saves to R2; there is no
   export→deploy→bake→pull→register wiring, so a Rigger rig never reaches a game.
   ([status/rigger](status/rigger.md))
4. **Flow-driven-game Phase 5** — author real `bigWin`/`freeSpinIntro`/`loading` backing scenes,
   bake, and ship to a game so a shipped title actually runs an authored FlowDoc (the runtime +
   editor exist; no shipped game runs one yet). ([status/flow](status/flow.md))
5. **Rigger mesh-deform animation timelines** — per-vertex `deform` channel keying (the largest
   missing animation channel). ([status/rigger](status/rigger.md))
6. **Reference layouts for `ways` / `cluster` / `scatter`** — only `lines` / `bookOf` have rich
   reference scene sets. ([status/editor](status/editor.md))
7. **Rigger Phase 3.6** — visual texture-panel UV editor + hull/edge editing.
8. **Rigger auto-weights quality** — geodesic/heat skinner + character-mesh validation gate.
9. **B4 HUD migration** — convert the live Balance/Win/Bet readouts to component instances behind
   the parity gate (B1–B3 done). ([status/engine](status/engine.md), [status/component-editor](status/component-editor.md))
10. **Blueprint model auto-download** (ComfyUI-Manager API) — uploaded blueprints assume their
   models are already installed.
11. Smaller: wire `gen-flow-vocabulary --check` into CI/pre-commit; refresh
    [tools/fx.md](tools/fx.md) for the new Emission/Movement/Colour/Blend/Presets sliders (rule 9).

## Blocked on owner / external (not code)

- **gpt_image generation** — needs the `Images to RGB` ComfyUI node + `COMFY_ORG_API_KEY`/credits
  locally (only SDXL ControlNets installed). Code is ready. ([status/infra](status/infra.md), [status/atlas-maker](status/atlas-maker.md))
- **FLUX ref/ControlNet path** — only SDXL ControlNets installed; txt2img FLUX proven, the
  ref/ControlNet path is unproven.
- **Shipped-game submodule bumps (owner-owned)** — Book of Borut bumps to ship FX / Flow / info-bar
  ([[feedback_bump_game_submodule]]).
- **prod DB migrations 0011/0012 applied?** — unverified here (no `DATABASE_URL`). ([status/infra](status/infra.md))

## History

The full done-work narrative + the archived STATUS changelog live in [`docs/history.md`](history.md)
(newest-first). Each tool's `docs/status/<tool>.md` keeps a short "Recent changes" list that links
into it.
