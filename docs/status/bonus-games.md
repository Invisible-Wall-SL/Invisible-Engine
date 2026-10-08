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
| 2 | Mock: per-mode engines | not started (needs 1) | — | — |
| 3 | Facade + wire + event types | in review | Bonus games Phase 3: Facade, wire and event types, per mode | #1139 |
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

- 2026-10-08 — **Phase 3: what the facade reads, for Phase 2 and Phase 4.** The facade follows the
  wire the hub agreed with Phase 2 (`hold-and-win-wire.md` "Several respin modes").
  - **Routing.** `context.mode` (on the six naming contexts), else the overlay's
    `bonuses[spinTrigger.bonus]`, else the primary, which is the first `bonusModes` entry. A named
    mode holds until the next `spinTrigger`, because the events inside a feature are untagged.
  - **Book events.** All four (`holdAndWinTrigger`, `respinReveal`, `holdAndWinState`,
    `holdAndWinEnd`) carry the resolved mode, `holdAndWin` for a legacy game. `engine-game` keeps
    `mode` optional on `respinReveal` / `holdAndWinState` (absent = `holdAndWin`), so hand-built
    books (stories, the emitter vocabularies) stay valid.
  - **Open for the hub.** `jackpotLevels` and `meterLevels` name no mode. In a round they apply to
    the round's mode; the heartbeat's progressive pools apply to the primary only. Two modes with
    separate progressive pools would need `mode` on `jackpotLevels`.
  - **Boot globals stay primary-only.** The boot meters and pools published to the game still come
    from the legacy (primary) block. Per-mode pools are Phase 4's.
  - **For Phase 4.** The runtime should key the board on the mode on top of the stack; every board
    event now names it.

## Recent changes

- 2026-10-08 — **Phase 3: the facade reads respin rules per mode** (PR #1139, packages
  `rgs-translator-eagaming` and `engine-game`, plus the Flow v2 vocabulary that mirrors the types).
  - **Boot capture.** The facade captures `config.bonusModes` per mode (`readHoldAndWinModes`, the
    first entry is the primary). A boot without it reads the legacy `holdAndWin` block as mode
    `holdAndWin`.
  - **Routing.** Each Hold and Win event translates under its own mode's rules (`respinModesOf`).
    The overlay's `bonusRoutes` now returns `{ respins: mode } | 'reels'`. `expansion.maxRows` and
    `blank` are read per mode.
  - **Events.** The four book events carry the resolved mode. The `engine-game` event `mode` fields
    are `string`. The runtime is unchanged (Phase 4).
  - **Gates:**
    - `check:holdandwin`: 1892/0, with digests unchanged;
    - the new `bonusModes.fixture.ts`: 237/0. It covers a two-mode boot with rounds in B and in the
      primary, a lone non-default mode, legacy boots read byte for byte, the reader and the
      overlay routes;
    - `check:pots-overlay`: 112/0, with digests unchanged;
    - `check:freespins`, `check:engine-game` 11/11, `check:all` 411/411 and `check:svelte` at
      baseline all pass.
  - **Cross-checked against Phase 2's real mock** (`bonus-games-phase2` merged in a scratch
    worktree), on its two-mode lines host:
    - red pot → `holdAndWin` (allCoins);
    - green pot → `holdAndWin_2` (collectorsOnly);
    - both pots in one round, played in turn.

    Each round is translated with its own mode on all four events, and every snapshot is rebuilt.
    Nothing is left untranslated.

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
