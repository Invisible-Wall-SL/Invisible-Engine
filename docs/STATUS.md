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
| **ComfyUI** (our RunPod hosting of it) | [status/comfyui](status/comfyui.md) | [design/runpod-comfyui-backend](design/runpod-comfyui-backend.md) | [tools/comfyui](tools/comfyui.md) | `atlas-python-tools` |
| **Game Maker** | [status/game-maker](status/game-maker.md) | [design/invisible-game-maker](design/invisible-game-maker.md) | [tools/game-maker](tools/game-maker.md) | `invisible-game-maker` |
| **Game Config** | [status/game-config](status/game-config.md) | [design/invisible-game-config](design/invisible-game-config.md) | [tools/game-config](tools/game-config.md) | `invisible-game-config` |
| **Localization** | [status/localization](status/localization.md) | — | [tools/localization](tools/localization.md) | `invisible-localization` |
| **Win Text** | [status/win-text](status/win-text.md) | [design/invisible-win-text](design/invisible-win-text.md) | [tools/win-text](tools/win-text.md) | — |
| **Invisible Sound** | [status/sound](status/sound.md) | [design/invisible-sound](design/invisible-sound.md) | [tools/sound](tools/sound.md) | — |
| **FTP Browser** | [status/ftp-browser](status/ftp-browser.md) | — | [tools/ftp-browser](tools/ftp-browser.md) | `invisible-ftp-browser` |
| **Rig Viewer** | [status/rig-viewer](status/rig-viewer.md) | — | [tools/rig-viewer](tools/rig-viewer.md) | `launcher-studio` |
| **Launcher / platform** | [status/launcher](status/launcher.md) | [design/unified-project-repo](design/unified-project-repo.md) | [tools/launcher](tools/launcher.md) | `launcher-studio` |
| **Engine & games** (runtime) | [status/engine](status/engine.md) | [design/flow-driven-game](design/flow-driven-game.md) | — | `engine-pixi-svelte` |
| **Hold and Win** (game kind — engine runtime, game modes, Scene Editor template, flow vocab + starter flow, Symbols, Win Text, Game Maker presets built; live Classic/Collector samples (9, owner login) and partner wire (10) open — session hub) | [status/hold-and-win](status/hold-and-win.md) | [design/hold-and-win](design/hold-and-win.md) | — | per phase |
| **Pots overlay** (an add-on on any kind: the 3 Pots pots over the host game's symbols, a pot-cued bonus — Hold and Win, the host's free spins, or an imported bonus; Phases 0–6 merged: authorable in `/config`, `/editor`, `/flow-v2`, `/symbols`, one-click from Game Maker, dealt by the book mock, drawn by the runtime; 7 (import a Hold and Win bonus from another project, re-sync) in review #1022; owner makes `borut-pots-sample` and `hw-classic-sample` next; 8 blocked on partner — session hub) | [status/pots-overlay](status/pots-overlay.md) | [design/pots-overlay](design/pots-overlay.md) | — | per phase |
| **Bonus games** (Hold and Win as a game of its own, any project adds it as one of several bonus modes; the coin overlay — classic / 3 Pots / Collector — is the option that triggers them; planned 2026-10-08, Phase 0 — session hub) | [status/bonus-games](status/bonus-games.md) | [design/bonus-games](design/bonus-games.md) | — | per phase |
| **Invisible Playtester** (automated QA) | [status/playtester](status/playtester.md) | [design/invisible-playtester](design/invisible-playtester.md) | [playtest/](playtest/README.md) | `game-playtester` |
| **Invisible Director** + **Invisible Pipeline Changes** (planned; Phase 0 approved 2026-10-04, Phase 1 in progress) | [director/PLAN](director/PLAN.md) | [director/SPEC](director/SPEC.md) · [ADRs](director/DECISIONS/) | [tools/director](tools/director.md) · [tools/pipeline-changes](tools/pipeline-changes.md) | `director-*`, `platform-integrator`, `regression-guardian` |
| **Infra** (Railway/CF/R2) | [status/infra](status/infra.md) | — | [INFRA.md](INFRA.md) | `infra-railway` |

**Not tracked here (by design):** the third-party **Storybook** keeps its own
upstream docs (we only ship a `docs/tools/` guide for how we host/launch them); **ComfyUI** is
listed above only for our hosting of it. The **desktop Invisible Launcher** (publish-only) is
covered inside [status/launcher](status/launcher.md). **Invisible Blueprints** is an **Atlas Maker
feature**, not a separate tool (no registry entry) — shareable ComfyUI workflows the Atlas Maker
picks from, tracked in [status/atlas-maker](status/atlas-maker.md). **Flow-driven game** is an
initiative on top of Invisible Flow, tracked in [status/flow](status/flow.md) — see
[its design doc](design/flow-driven-game.md).

Cross-cutting design docs (not tools — platform/pipeline plans):
- [multi-user-concurrency](design/multi-user-concurrency.md) — **lost-update prevention**: doc leases + R2 conditional writes, so two users stop overwriting each other. Agent: `pipeline-concurrency`.
- [invisible-blueprints](design/invisible-blueprints.md) — shareable ComfyUI workflows for the Atlas Maker (feature, not a tool).
- [unified-project-repo](design/unified-project-repo.md) — **the live R2 folder layout**: one `<client>/<project>/` tree (by asset type) shared by all tools.
- [r2-client-isolation-and-scaffold](design/r2-client-isolation-and-scaffold.md) — the earlier per-tool R2 layout the unified repo superseded + project scaffolding.
- [live-assets](design/live-assets.md) — the `deploy/` asset contract + export→bake→pull→register chain every authored doc travels.
- [games-deploy](design/games-deploy.md) — one engine repo, shipped games as submodules.
- [delivery-builds](design/delivery-builds.md) — **a build we hand over, hosted by someone else**: the delivery profile, the embeddable `game.js` and the `build-delivery.mjs` handover. Phases 1, 3 and 4 built; Phase 2 (protocol deltas) partly.
- [project-explicit-tool-scoping](design/project-explicit-tool-scoping.md) — how tool capabilities/scopes are gated.
- [unified-tool-bar](design/unified-tool-bar.md) — the shared `ToolTopBar` chrome every tool renders.
- [invisible-debug-framework](design/invisible-debug-framework.md) — the shipped in-game `__IE_DEBUG__` menu framework.
- [play4fun-protocol](reference/play4fun-protocol.md) — **the RGS wire contract** (transport, actions, events, the boot `config`), read off the partner's own reference client. Read it before touching `rgs-translator-eagaming`.
- [model-licences](reference/model-licences.md) — the licence status of every built-in generation model and what a render is stamped with.

## Guides & runbooks

Cross-tool walkthroughs and operations runbooks live in [`docs/guides/`](guides/); each links the
tool guides rather than restating them.

| Guide | Use it when |
|---|---|
| [Build your first game](guides/build-your-first-game.md) | Making a lines / Book-of / ways reskin, Game Maker → Deliver |
| [Add a pots overlay](guides/add-pots-overlay.md) | Laying the 3 Pots (or coins-only) add-on over a game you already have, duplicate → playtest |
| [Publish and deliver](guides/publish-and-deliver.md) | Getting a game's authored content to players, or cutting a delivery build |
| [Publisher runbook](guides/publisher-runbook.md) | Shipping a standalone build from the desktop launcher (☁ Publish / 📦 Deliver) |
| [Release and rollback](guides/release-and-rollback.md) | An engine merge is going out, or a release or a game's content needs rolling back |
| [Rotate a secret](guides/rotate-a-secret.md) | A key or token is due, leaked or lost |
| [Incident first response](guides/incident-first-response.md) | A game is blank or stale, the launcher is down, generation fails, the RGS errors |
| [Backups and restores](guides/backups.md) | Restoring the database or authored files, or running the restore drill |



Per-tool "next" lives in each `docs/status/<tool>.md`; this is the pipeline-wide priority order.

1. **Rigger auto-weights quality** — geodesic/heat skinner + character-mesh validation gate
   ([status/rigger](status/rigger.md)).
2. **Blueprint models reach the rendering machine by themselves.** Resolving a declared model
   against the `comfyui-models/` R2 mirror is built (#604): a missing model is reported with where
   its bytes are. Nothing yet copies it onto the pod or desktop that renders, so a private or trained
   model still travels by a manual **Sync models** / `pull-models.py` run
   ([status/comfyui](status/comfyui.md) open item 9, [status/atlas-maker](status/atlas-maker.md)).
3. **Delivery builds — the rest of Phase 2** ([design](design/delivery-builds.md)). Built: the
   profile + `config.json`, the embeddable `game.js`, server-supplied bet levels + jurisdiction
   locks, every declared operator host setting (2026-09-30 — neutral when absent; field table in
   [the protocol reference](reference/play4fun-protocol.md#host-settings--gamesettingsconfig-2026-09-30)),
   and the handover (`EMBED.md`, `--zip`) in `build-delivery.mjs`. Open: the line/way bet
   encoding, the host-setting meanings only the partner can confirm (`minNormalBet` units,
   `errorPanel`, `historyClient` — the reference's owed list), and the cascade vocabulary (waits on
   a real capture).
4. Smaller: **Rigger Phase 3.6d** (hull-loop reordering — the 3.6c permutation primitive exists,
   no UI yet).

**Recently closed** (2026-10-06): **no third-party licence needed to run a rig** — our own runtime,
`packages/engine-rig`, replaces every third-party rig runtime package and vendored runtime in the games
and tools, parity-gated against the 4.2 reference runtime (`tools/rig-parity`).
([status/rigger](status/rigger.md))

**Recently closed** (2026-09-28 → 09-29, #811–#870):

- **Players boot a frozen published snapshot**, with rollback and an honest boot-failure screen
  (#841, #843, #845, #849); the mock RGS deals players the same published math and Live ↗ the
  saved draft (#870). ([status/game-maker](status/game-maker.md))
- **Versioned engine runtime releases** with a one-click rollback workflow, gated on
  undefined-names/engine/RGS checks and verified by the served bundle (#831, #844, #848, #850).
  ([status/engine](status/engine.md))
- **Resilient RGS transport** — a lost request is resent at the same seq, never double-staked, with
  a reconnecting overlay (#858). ([status/engine](status/engine.md))
- **Version history + undo** — rolling backups with a shared History modal for scenes, flow,
  symbols, config and component defaults; flow-v2 undo/redo; conditional `.irig` saves with rig
  backups; a manual Save checks for a newer save again (#821, #832, #847, #857, #859).
  ([status/flow](status/flow.md), [status/editor](status/editor.md), [status/rigger](status/rigger.md))
- **Publish gates** — an invalid flow, paytable drift, or missing art/rigs now refuse a publish or
  delivery unless overridden (#833, #839, #855). ([status/flow](status/flow.md),
  [status/game-config](status/game-config.md), [status/game-maker](status/game-maker.md))
- **Launcher authorization hardening + security headers** (#811, #812, #814, #818, #826, #827)
  and **secret scanning in CI** (#838). ([status/launcher](status/launcher.md),
  [status/infra](status/infra.md))
- **Signed tool launch tokens** — Atlas and Sheet Maker take their scope from a launcher-signed
  token; live 2026-09-29 (#863, #865). ([status/atlas-maker](status/atlas-maker.md))
- **Desktop publishing goes through the portal**, needs no R2 key, and every build records which
  build it is (#866, desktop launcher v1.0.56). ([status/launcher](status/launcher.md))
- **Play fixes** — hold-Space continuous play, buys priced by the server's bet table on the mocks and
  the facade, a demo session per tab (#813, #820, #824, #829, #840, #846, #853, #854).
  ([status/engine](status/engine.md))
- **Operability** — error tracking, a readiness `/api/health` (reports all migrations, through
  `0019`, current) and nightly encrypted backups with a tested restore, the last two dormant until
  owner setup (#852, #860, #864). ([status/infra](status/infra.md))

**Earlier milestones** (detail in each status file): `ways` as a first-class authoring kind and the
cascade + multiplier-collect mechanics in the shared runtime (2026-08-20,
[status/engine](status/engine.md)); **Invisible Cinematic** Phases 0–3 + Tweak Mode (2026-08-18 —
⏳ its engine half has not yet run in a real game, [status/cinematic](status/cinematic.md));
ComfyUI generation on RunPod (2026-08-18, [status/comfyui](status/comfyui.md)); localization reaching
the game ([status/localization](status/localization.md)); concurrency Phases 0–3 — the Atlas + Sheet Makers' saves compare-and-swapped with a who-saved
conflict prompt and an "X is editing this atlas" banner, 2026-09-30, two-browser live run owed
([design](design/multi-user-concurrency.md)).

## Blocked on owner / external (not code)

- **Secret rotation** — rotate the secrets listed in [INFRA § Security / secret
  rotation](INFRA.md#security--secret-rotation); since launcher v1.0.56 no publisher's desktop holds
  the R2 key. ([status/infra](status/infra.md))
- **Monitoring setup** — Sentry DSNs, the launcher healthcheck path `/api/health`, and the uptime
  monitors ([INFRA § Monitoring](INFRA.md#monitoring--error-tracking-2026-09-29)); dormant until done.
  ([status/infra](status/infra.md))
- **Nightly backups setup** — the owner steps in [guides/backups](guides/backups.md); dormant until
  done. ([status/infra](status/infra.md))
- **Legacy tool-key cut-over, 2026-10-13** — remove the old tool handoff and its secrets once the
  window closes. ([status/atlas-maker](status/atlas-maker.md) item 6,
  [status/sheet-maker](status/sheet-maker.md))
- **Grant `gamePublish`** to `developer` and `pipelineTester` in /admin → Roles.
  ([status/launcher](status/launcher.md))
- **Game Maker → Republish all** so the games published before snapshots stop booting live data.
  ([status/game-maker](status/game-maker.md))
- **Approve the test2–test6 free-spin data migration** (their free-spin intro/outro broke when the
  coded screens were retired). ([status/flow](status/flow.md))
- **Confirm the license-free rig runtime** — have counsel confirm `engine-rig`'s clean-room
  position, and live-look at the Rigger, `/rig-viewer`, the editor, `/fx` and a published game on it.
  ([status/rigger](status/rigger.md))
- **Model licences for shipped art** — decide the switches in the recommendation table; every
  built-in image default is non-commercial as wired today. ([reference/model-licences](reference/model-licences.md))
- **Partner replay check** — run [the checks owed on the live
  node](reference/play4fun-protocol.md#checks-owed-on-the-live-node). ([status/engine](status/engine.md))
- **Delete the old flat `_runtime/lines/**`** once satisfied the versioned pointer is permanent.
  ([status/engine](status/engine.md))
- **Re-publish the imported video blueprint with a pod running** — ＋ Blueprint on the same API
  export bakes in the bounds and lists it lacks. ([status/flipbook](status/flipbook.md))

## History

[`docs/history.md`](history.md) is a **frozen archive** (newest-first) of done work up to
2026-07-29 — the old STATUS changelog plus the done-work narrative of that era. It is **read-only:
nothing gets appended to it any more.** Done-work detail now lives in each tool's
`docs/status/<tool>.md` "Recent changes", which is where it was already being written; the archive
was frozen on 2026-08-18 once it had fallen 270 commits behind and become a stale surface that
looked authoritative. The `([detail in history](history.md))` links in the older status entries
still resolve correctly — leave them.
