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

1. **Rigger mesh-deform animation timelines** — per-vertex `deform` channel keying (the largest
   missing animation channel). ([status/rigger](status/rigger.md))
2. **Reference layouts for `ways` / `cluster` / `scatter`** — only `lines` / `bookOf` have rich
   reference scene sets. ([status/editor](status/editor.md))
3. **Rigger Phase 3.6** — visual texture-panel UV editor + hull/edge editing.
4. **Rigger auto-weights quality** — geodesic/heat skinner + character-mesh validation gate.
5. **B4 HUD migration** — convert the live Balance/Win/Bet readouts to component instances behind
   the parity gate (B1–B3 done). ([status/engine](status/engine.md), [status/component-editor](status/component-editor.md))
6. **Blueprint model auto-download** (ComfyUI-Manager API) — uploaded blueprints assume their
   models are already installed.
7. Smaller: the concurrency **force-always Save** fix (symbols/fx/localization wire `onclick={save}`,
   passing the event as `force` → manual Save silently overwrites; change to `() => save()`); wire
   `gen-flow-vocabulary --check` into CI/pre-commit; refresh
    [tools/fx.md](tools/fx.md) for the new Emission/Movement/Colour/Blend/Presets sliders (rule 9).

**Recently closed** (2026-08-04): **Concurrency Phase 2 — COMPLETE** (the whole soft-lease + presence
story). 2b the BACKEND (`doc_leases` + `lease.ts` + `POST /api/lease`, DB-adjudicated conditional
upsert, migration 0014, PR #206); 2a the shared `saveState.svelte.ts` + `SaveStatusBadge` every
authoring tool saves through (PR #209, a helper bug + a sticky-conflict-on-target-switch regression
caught in review and fixed); 2c the client `LeaseState` rune + `PresenceBanner` + `SaveState.blockWhen`
read-only gate across **all** authoring tools — editor + flow-v2 (2c-core, PR #211, observer poll
auto-recovers a freed/expired lease, takeover always reachable, fails open on error), then
symbols/win-text/config/localization (2c-rest-A, PR #215) and the per-ITEM fx/flipbook/components via
`LeaseState.switchDoc` (2c-rest-B, PR #216). **Owner-verify owed** = the two-profile live test per tool
+ applying migration 0014 on deploy; Phase 3 (Python tools) is a separate later effort. · **Concurrency
Phase 1 — COMPLETE** (the conditional-write floor is
live + REQUIRED across all 13 authoring surfaces; the last residuals — component ETag threaded
load→editor→save, `saveComponentDefaults` guarded, and the fail-open closed via `writeGuard.ts` — PR
#204; owner-verify owed = a two-tab component conflict + a save/create smoke) · **Concurrency Phase 0
— COMPLETE** (rigger indexes → Postgres earlier; the last two RMW-on-a-global-key sites —
`test_server/games.json` + the fonts catalog — now guarded with `If-Match` + CAS retry, PR #201;
owner-verify owed = the two-profile live test) ·
**Invisible Game Config** (all phases + grid/bet-modes/win-tiers shipped and live-verified) ·
**Ship-from-Rigger** rule-8 wiring (a rig now travels export→deploy→bake→pull→register into a game) ·
**Flow-driven-game Phase 5** (a shipped title runs an authored FlowDoc). See each tool's
`docs/status/<tool>.md`.

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
