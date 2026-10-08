# Bonus games (Hold and Win as its own game, coin overlay as an option) — status + session hub

> Design: [docs/design/bonus-games.md](../design/bonus-games.md) · Builds on:
> [status/hold-and-win](hold-and-win.md), [status/pots-overlay](pots-overlay.md) · Guide: _per phase_
> · Agents: per phase — see the design's build plan.

**One-line state:** Phase 1 (config split + migration) is in review as PR #1133. Normalized docs carry the
split form plus a legacy compat mirror; no consumer outside game-config reads the split yet. Next:
Phases 2, 3, 5a and 5b, once Phase 1 is merged.

## How sessions use this file (the hub)

**This file is the shared memory**, and the committed file wins over any message. The coordinating
("hub") session is the Claude Code session titled **"Hold and Wins as standalone project"**. It
starts the phase sessions, reviews their PRs and merges them.

- **Starting a phase:** read the design's §3 and this file, and claim your row in the Phase board.
- **Finishing (or stopping):** update your Phase board row and add a dated entry under "Recent
  changes" (what landed, the PR, what's left, any surprise). Then message the hub session
  (`SendMessage` / `send_message` to "Hold and Wins as standalone project").
- **Found something that changes the plan?** Add it to "Decisions & findings" and tell the hub.
- **Parity is the gate:**
  - `check:holdandwin` and `check:pots-overlay` digests don't move;
  - `check:all` is green;
  - the three Hold and Win samples and `borut-pots-sample` play unchanged.
- **Don't merge your own PR.** The hub reviews and merges.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Plan + hub | merged | Hold and Wins as standalone project | #1131 |
| 1 | Contract: config split + migration | merged | Bonus games Phase 1 — config split + migration | #1133 |
| 2 | Mock: per-mode engines | in review | Bonus games Phase 2: Mock RGS, one Hold and Win engine per respin mode | #TBD |
| 3 | Facade + wire + event types | not started (needs 1) | — | — |
| 4 | Engine runtime: active-mode rules | not started (needs 3) | — | — |
| 5a | `/config` Bonus modes + Coin overlay | not started (needs 1) | — | — |
| 5b | Scene Editor + capabilities + `/symbols` | not started (needs 1) | — | — |
| 5c | Flow v2 vocabulary by board | not started (needs 1, 4) | — | — |
| 5d | Win Text + Localization per mode | not started (needs 1, 4) | — | — |
| 6 | Game Maker: template + Add a bonus mode… | not started (needs 2–5) | — | — |
| 7 | Migrate and prove (samples, current-games) | not started (needs 6) | — | — |

## Decisions & findings

- 2026-10-08 — **The owner's model** (hub session): the coin overlay (classic / 3 Pots / Collector)
  is an option a base game turns on, and it only triggers. The bonus stage is a game of its own,
  and a project can have several bonus modes. A Hold and Win project is editable, duplicable and
  reskinnable, and any project can add it as a bonus mode. The owner confirmed design §6 4–6:
  the `coinOverlay` rename, retiring the `holdAndWin` kind (it stays as a template), and overlay +
  buy triggers only (no scatter → Hold and Win).
- 2026-10-08 — **Seams measured** against `main` 72f7a0c. The single-Hold-and-Win assumptions are
  listed in design "What is wrong today".

- 2026-10-08 — **Phase 1: how the split form and the legacy keys live together.** The Phase 1
  session proposed this and the hub approved it as option (A). The canonical rules are in design
  §2.1, "Transition (Phases 1–6)".
  - No equality test decides which side wins. Applying an unchanged mirror is a no-op, and a stale
    mirror always wins.
  - So a split-form writer must delete the legacy keys before it saves.
  - Hold and Win is removed only through `removeHoldAndWin(doc)`. `takeOutHoldAndWinBonus` uses
    it.
  - A Hold and Win mode stays on the respin board, whatever an override says (hub review of
    #1133).
  - Until Phase 5a, a respin mode without rules or strips is a warning, not an error. Phase 5a
    raises it to an error once `/config` can author them. The reason is that `prepareGameConfigDoc`
    refuses to save a doc with errors.
  - Base-game flags for a special that no respin mode configures are pruned on normalize.
  - An import brings the source mode's `blank`.
  - The mirror is dropped in Phase 7.
  - `bonusGames.fixture.ts` §4b and §4c pin this. About 80 files outside game-config read `doc.holdAndWin` /
  `doc.potsOverlay` directly. That includes the `.mjs` mocks and `test-server`, which read the
  stored JSON. So a normalized doc stores the split form (`coinOverlay`, and the declared
  `holdAndWin` mode with its `holdAndWin` rules) **and** both legacy keys as a compat mirror derived
  from it. The rule (`bonusGames.ts` header):
  - When the input carries a legacy key, the legacy pair wins for everything the mirror shows. That
    is the primary respin mode's rules, the pots, drops and timing, the routes to that mode and the
    base-game flags. Everything else in the split form is kept.
  - When the input carries neither key, the split form wins.
  - **What later phases must follow:**
    - A writer of the split form (5a, 6) deletes both legacy keys before it saves. Otherwise its
      edit is overwritten by the stale mirror.
    - The mirror shows one respin mode: `holdAndWin`, else the first respin mode with rules.
    - Drop the mirror in Phase 7, once no reader is left.
  - Inside game-config, the writers (`addOns`, `imports`) call `withLegacyPair` first and
    `syncBonusSplit` last, so their results are already normalize fixed points.
- 2026-10-08 — **Phase 1: `BuyTier.mode` is the BET mode** (`betModes` key), not the bonus mode it
  starts. In the split form a buy route is `{ betMode, mode, guaranteed, boostedSpecials }`. Every
  route's `mode` is the game mode it starts:
  - `count`: `{ min, roles, mode }`;
  - `pattern`: `{ mode, requirements }`;
  - `randomMetre`: `{ name, mode }`;
  - `luckySpin`: `{ mode }`;
  - a meter: `HoldAndWinMeter & { mode }`.
- 2026-10-08 — **Phase 1: two things derived rather than stored.**
  - "Coins land on the reels" is not a field. It is what the base strips deal, as
    `holdAndWinIsOverlayBonus` decides today, so it cannot disagree with the strips.
  - `coinOverlay.coins` (the base-game coin values) is sparse. Absent means the started respin
    mode's table, so the migration does not copy it.
  - `coinOverlay.style` is stored. A legacy doc gets an inferred style: `pots` with pots or
    meters, `collector` when a collector pattern starts it, else `classic`.
- 2026-10-08 — **Phase 1: what the later phases inherit.**
  - `builtinGameModes()` no longer takes a doc and no longer lists `holdAndWin`. Its three callers
    changed only their call: the Scene Editor suggestions add `holdAndWinModeDecl()`,
    `GameModesSection` and `stateModes`.
  - `resolveGameModes` still lists `holdAndWin` for an unnormalized legacy doc, by reading the
    block.
  - `/config` → Game modes now lists Hold and Win as a mode of the project's own, with a "Hold and
    Win" chip. Its fields stay editable, but its board is locked and it has no ×. It goes with its
    block. Phase 5a replaces this section.
  - A `respinBoard` mode without rules or strips is a **warning** in Phase 1. Before, an own respin
    mode added in Game modes was inert; Phase 5a raises it to an error.
  - Mode-level validation of a SECOND respin mode's rules is still owed. Only the mirrored primary
    goes through `validateHoldAndWin`; Phase 2 or 5a should run it per mode.

- 2026-10-08 — **Phase 2: the wire emit rule and the "classic overlay over lines"** (hub-approved).
  - **Emit rule:** `bonusModes` and `mode` are sent only when the respin set is not the lone default,
    so every existing game is byte-identical. Phase 7 deletes the condition.
  - **Routing order for readers:** `context.mode`, else `bonuses[spinTrigger.bonus]`, else the
    primary.
  - **"The classic overlay composes over the lines mock"** is done by contract, not by wrapping
    `createLinesMock`. A `holdAndWin`-kind project now gets a `lines` contract carrying its base-game
    Hold and Win inputs, and is dealt on the Hold and Win engine, whose base game IS the lines
    evaluator plus the classic overlay. Truly composing it over `createLinesMock` would change the RNG
    streams and so every dealt board. That is deferred to Phase 7, and only if the owner wants it.
  - **Decided by the doc, not the kind:** a lines-KIND project whose Hold and Win is base-game (not an
    overlay bonus) is now also dealt by the Hold and Win engine. Before, the lines mock ignored its
    block.
  - **Limits on the game mock** (coins on the base reels):
    - base-game coins and specials are the primary mode's, whichever mode a route starts;
    - a route that two modes both claim goes to the first mode that has it;
    - jackpot tiers that share a name share one progressive pool, with the first mode's numbers;
    - a full meter starts its own mode and consumes only that mode's meters, so a full meter of
      another mode waits until its symbol lands again;
    - dropped value coins are the coin mode's symbols, so they ride only that mode's feature.

## Recent changes

- 2026-10-08 — **Phase 2: the mock has one Hold and Win engine per respin mode** (PR #TBD, scripts,
  `test-server`, game-config's mock inputs, the launcher's mock protocol).
  - **Inputs:** `holdAndWinMockInputs(doc).modes` lists each respin mode, primary first, as
    `{ mode, gameType, block, blank, symbols }`. `block` is the mode's rules joined with its routes.
    `symbols` are the role symbols on its own strip (the primary's on the base strip too), so two
    modes' coins never mix. The field is absent for the lone default mode.
  - **Engine** (`mock-holdandwin-engine.mjs`): `mode`, `bonus` (the strip key), `blank` and `wire`
    options replace the hard-coded `mode: 'holdAndWin'` and `RESPIN_BONUS`. `setRouter` lets the
    base engine start another mode's engine on the dealt board.
  - **Game mock** (`createRespinEngines`): the primary deals the base game with every mode's routes
    on its trigger. Count, pattern, Lucky Spin, random metre, a buy tier and a meter each start the
    mode that owns the route. Respins dispatch by `round.feature.mode`.
  - **Overlay** (`mock-pots-overlay.mjs`): one engine per mode. Each pot starts its own mode, and
    the coins start the first mode with a count route. `bonuses` maps each strip key to its mode. A
    round plays each respin mode at most once, in turn.
  - **Wire:** `bonusModes` and `mode` on six contexts, under the emit rule (design §2.2, wire
    reference "Several respin modes").
  - **Protocol:** `protocolFor('holdAndWin')` is gone (`mockProtocol.ts`, `current-games/lib/plan.mjs`).
    - A lines contract carries the Hold and Win inputs when the coins land on the base reels, and
      the test server deals it on the Hold and Win engine.
    - Stored `protocol: 'holdAndWin'` entries deal as before, and the game card no longer calls one
      a drift.
  - **Validator:** `validateBonusModes` refuses two respin modes on one strip key, and so does the
    mock.
  - **Gates:**
    - New `check:bonus-modes` (in `check:rgs`) runs the two-mode host on the book and lines mocks:
      each pot deals its own mode's rules on its own symbols, and every context is tagged. It also
      covers the lone default (no new keys), a lone non-default mode, a buy route to a second mode,
      and one strip key shared.
    - `check:holdandwin` (1892/0) and `check:pots-overlay` (112/0): `MAIN_DIGESTS` unchanged.
    - A seeded comparison against main on the real test server: the three Hold and Win samples (on
      the stored `holdAndWin` path AND the new `lines` path) and `borut-pots-sample` (book and lines
      hosts) deal byte-identical answers. Their mock inputs are byte-identical.
    - `check:mock-contract` is extended (the `lines` protocol, per-mode inputs). `check:freespins`,
      `check:bonus-import`, `check:pots-overlay-add-on`, `check:game-config-defaults`,
      `check:symbols-kind-gating`, lint and `check:undefined-names` all pass.

- 2026-10-08 — **Phase 1: the hub's review fixes** (PR #1133).
  - **Blocking 1:** a `reels` / `none` override of the Hold and Win mode no longer drops its block.
    The mode is forced onto the respin board, and Game modes takes a new entry's board from the
    resolved mode.
  - **Blocking 2:** a respin mode without rules or strips is a warning, not an error.
  - **Should-fix 3:** the Hold and Win row has a locked board and no ×.
  - **Should-fix 4:** there is one `removeHoldAndWin` helper.
  - **Nits:** orphan base-game flags are pruned; an import brings the source's `blank`; the
    expanding-symbol pin strips only the `holdAndWin` mode.
  - Pinned in `bonusGames.fixture.ts` §5 and §7.
- 2026-10-08 — **Phase 1: the config split and migration** (PR #1133, `packages/game-config` plus
  fixtures). No consumer outside game-config reads the split yet.
  - **New modules:**
    - `holdAndWinGame.ts`: `HoldAndWinGame`, the respin half with no base-game flags and an
      optional `blank`, plus a lossless `splitHoldAndWin` / `joinHoldAndWin`.
    - `coinOverlay.ts`: `CoinOverlay`, which holds style, pots, drops, timing, base-game `coins`,
      `baseGame` flags, `trigger` routes and `meters`, each route naming its mode.
    - `bonusGames.ts`:
      - `normalizeBonusGames` (the migration plus the mirror);
      - the compat accessors `legacyHoldAndWin` / `legacyPotsOverlay`, plus `withLegacyPair`,
        `syncBonusSplit` and `bonusSplitOf`;
      - `resolveBonusModes`, `bonusCapabilityInputs` and `respinModeBlank`;
      - `validateBonusModes`.
  - `GameModeDecl.holdAndWin` carries a respin mode's rules. `builtinGameModes` no longer invents
    `holdAndWin`.
  - `holdAndWinBonusFrom` now uses the split instead of stripping the flags by hand.
  - The mock inputs, `resolveMeters`, the add-ons, the import and the presets read the legacy
    blocks through the accessors.
  - The committed `holdAndWin.<preset>.json` defaults were regenerated. The change is additions
    only: the legacy blocks are byte-identical.
  - **Gates:**
    - The new `bonusGames.fixture.ts` proves legacy ≡ split (the doc, the mirror byte for byte,
      both mock inputs, modes, meters, bonus modes and issues) for the three presets
      (`hw-*-sample`), the five test fixtures, the three overlay presets on a book host,
      `borut-pots-sample`, a 3 Pots game with pots, and an imported bonus. It also covers the
      compat rule, two respin modes and the validators.
    - `check:holdandwin`: 1892/0 facade checks, with the `MAIN_DIGESTS` unchanged.
    - `check:pots-overlay`: 112/0, plus its fixtures, with its `MAIN_DIGESTS` unchanged.
    - `check:freespins` passes.
    - `check:engine-game` and the launcher's `check:bonus-import`, `check:pots-overlay-add-on`,
      `check:mock-contract`, `check:flow-publish-gate`, `check:game-config-defaults` and
      `check:symbols-kind-gating` pass.
    - `check:all`: 409/409.
  - **What's left:** Phases 2, 3, 5a and 5b can start. See "Decisions & findings" for the rules
    they inherit.
- 2026-10-08 — Phase 0: design + hub written (hub session).
