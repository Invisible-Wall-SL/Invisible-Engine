# Bonus games — family knowledge

The add-ons that go on any slot kind: the pots overlay (coin overlay) and bonus modes.
Owner agent: `bonus-games`.

## What it is and must stay

- **The coin overlay** is an option a base game switches on: Classic, 3 Pots or Collector, 0–5
  pots. Tokens and value coins drop on top of the host's symbols, fly into pots, and a full pot (or
  enough coins) starts a bonus. The host keeps its own lines, book and free spins.
- **Bonus modes** are games a project plays inside itself: a Hold and Win respin mode, or a spins
  mode (N spins of lines / scatter / ways / cluster). A project has 0..n. Each trigger in Game
  Config names the mode it starts. Routing is config the server deals, never Flow.
- **Import and re-sync**: Game Maker copies a mode from another same-client project as a NEW mode
  (a clash takes `_2`), with provenance. It is a copy, not a live link: nothing changes until
  **Re-sync**.
- **The boundary.** The Hold and Win respin game itself (its board, coins, jackpots, wheel, the
  `holdAndWin` base kind and the coin board) belongs to `hold-and-win-games`. This family owns what
  is added to a host: the overlay, the routes, the mode stack around a bonus, import and re-sync.
  A bug inside the respin board's own rules goes to `hold-and-win-games`; a bug in how a pot or
  route reaches it stays here. A host kind's own bug goes to `lines-games`, `ways-games`,
  `cluster-games` or `scatter-games`.
- **Must never change:** a project without the block plays byte for byte as before; the live
  `bookofborutremake` is never given the overlay (its sample is a duplicate); math is locked.

## Invariants

- **The doc's split form is canonical.** `coinOverlay` plus declared modes. The legacy
  `holdAndWin` / `potsOverlay` keys are read only by `normalizeGameConfigDoc` and
  `migrateLegacyBonus` (`packages/game-config/src/bonusGames.ts`). Readers use the views
  `primaryHoldAndWin(doc)` and `potsOverlayOf(doc)`. Enforced by `scripts/check-bonus-migration.mts`.
- **Old baked bundles boot.** The runtime normalizes the baked config
  (`packages/engine-game/src/game/gameConfig.ts`). Same gate, §4.
- **No block, no change.** Mock, facade and runtime gate every overlay path on the block. The wire
  carries `bonusModes` and a per-context `mode` only when the respin set is not the lone default.
  Pinned by the `MAIN_DIGESTS` in `scripts/check-holdandwin-protocol.mjs`,
  `scripts/check-pots-overlay-protocol.mjs` and `scripts/check-bonus-modes-protocol.mjs`.
- **The wire is ours, a swap seam.** The boot block is still named `potsOverlay` on the wire
  (`packages/rgs-translator-eagaming/src/potsOverlay.ts`), even though the doc says `coinOverlay`.
  `potsOverlay.modes` and `freeSpinTrigger.mode` exist only on our wire (Phase 8 waits on the
  partner). Contract: `docs/reference/hold-and-win-wire.md` "Pots overlay" and "Several respin
  modes".
- **Only routes the mock deals are saved.** `modeRouteRefusal` (`packages/game-config/src/imports.ts`)
  is read by both the import and the Game Maker dialog. Zero pots need a coin count trigger:
  `zeroPotsRefusal` (`packages/game-config/src/addOns.ts`).
- **One respin mode plays at a time**; nesting is refused in config. Two respin modes may not share
  a strip key (`check:bonus-modes` §3).
- **A pot drains once per entry**, wherever the first ask comes from (`claimDrainedMeters`,
  `apps/lines/src/game/holdAndWinMeters.svelte.ts`).
- **An import never writes the source** and leaves every other part of the host byte-identical
  (`apps/launcher-api/scripts/check-bonus-import.ts`).

## Where the code lives

- **Config:** `packages/game-config/src/` — `coinOverlay.ts`, `potsOverlay.ts`,
  `potsOverlayPresets.ts` (`threePots`, `coinsOnly`, `collector`), `addOns.ts`, `imports.ts`,
  `bonusGames.ts`, `bonusModes.ts`, `spinsModes.ts`, `spinsGame.ts`, `potsOverlayMock.ts`.
- **Mock:** `scripts/mock-pots-overlay.mjs` (`withPotsOverlay`) composed over
  `scripts/mock-rgs-server-book.mjs` or `scripts/mock-rgs-server.mjs`; per-mode engines in
  `scripts/mock-holdandwin-engine.mjs`; selected in `services/test-server/makeMock.mjs`.
- **Facade:** `packages/rgs-translator-eagaming/src/potsOverlay.ts`, `holdAndWin.ts` (per-mode
  routing), `engineFacade.ts`.
- **Event types:** `packages/engine-game/src/game/potsOverlay.ts`, `modeStack.ts`, `modeEvents.ts`.
- **Runtime (`apps/lines/src/`):** `game/stateOverlay.svelte.ts`, `game/overlayPresentation.ts`,
  `game/overlayRiders.ts`, `game/holdAndWinMeters.svelte.ts`, `game/flowV2PotsScreen.ts`,
  `game/stateModes.svelte.ts`, `game/activeRespinMode.svelte.ts`, `game/respinModes.ts`,
  `game/symbolPlaceholder.ts`, `components/OverlayToken.svelte`, `components/OverlayTokens.svelte`,
  `components/PotMeter.svelte`, `components/HoldAndWinPots.svelte`.
- **Tools:** `/config` `apps/launcher-api/src/routes/(app)/config/CoinOverlaySection.svelte` and
  `BonusModesSection.svelte`; Game Maker add-on and import in
  `apps/launcher-api/src/lib/server/projectAddOn.ts` and `projectBonusImport.ts`; capabilities in
  `packages/engine-layout/src/lib/kindCapabilities.ts`; Flow fragments in
  `packages/engine-flow-v2/src/reference/addOns.ts`.

## Known failure modes

- **Symptom:** after a pot-started Hold and Win the base reels showed the held coins and empty
  cells. **Cause:** the end beat settled the reels on the respin board's cells; an overlay host has
  no art for `BLANK` (`apps/lines/src/game/holdAndWinPresentation.ts`). **Guard:** settle only when
  `holdAndWinIsOverlayBonus` is false; real-clock play only.
- **Symptom:** a tab open while the overlay was switched on got drops and pot bonuses it could not
  draw ("Missing bookEventHandler"), a red-pot round took ~78 s. **Cause:** the facade captures the
  boot config once; the rebuilt mock carried the session over and dealt the new add-on
  (`scripts/mock-pots-overlay.mjs`). **Guard:** the mock pins each session to the add-on it booted
  with; `check:pots-overlay` §5b (#1026). A change inside the overlay (pot count) is still not pinned.
- **Symptom:** the pot drew at the coded spot, not where the Pot Meter was placed. **Cause:** a
  driven v2 flow mounts only what a `showContainer` shows, and nothing showed `pots`.
  **Guard:** `enginePotsScreen` mounts it; `apps/lines/src/game/flowV2PotsScreen.fixture.ts`. Do not
  key it on "declares": `/flow-v2` declares every screen on save.
- **Symptom:** the sample "is broken", Borut's art blank. **Cause:** Duplicate with **Game setup
  only** copies no art, sounds or fonts. **Guard:** guide and playbook say **Everything**; none in code.
- **Symptom:** every overlay project warned that `s.png` / `w.png` "will render blank". **Cause:** the
  symbols export counted built-in frames as missing. **Guard:** `check:pots-overlay-add-on` §6.
- **Symptom:** an imported free-spins round never ended (111 retriggers). **Cause:** the mock dealt it
  from cosmetic padding strips that can land a scatter on every reel
  (`scripts/mock-rgs-server-book.mjs`). **Guard:** `MAX_STRIPS_ROUND_SPINS`; `check:pots-overlay` §4.
- **Symptom:** a mode named like an `Object` property matched wrongly. **Cause:** plain `in` /
  index lookups. **Guard:** `Object.hasOwn` in the facade and mock; none dedicated.
- **Symptom:** the first round after a spins mode rolled forever. **Cause:** `Board.svelte` installed
  the ready-to-spin hook once at mount; a spins mode's rebuild added new reels without it.
  **Guard:** the hook in an `$effect`; `check:spins-modes` §5b (#1159).
- **Symptom:** a bundle baked before the split booted with no respin mode. **Cause:**
  `getActiveGameConfig()` normalized only the compiled template, not the baked doc. **Guard:**
  `check:bonus-migration` §4 (#1158).
- **Symptom:** removing the overlay half-removed a mode added on its own. **Cause:** the old mirror
  re-declared its rules on strips just deleted (`packages/game-config/src/addOns.ts`). **Guard:**
  `packages/game-config/addOns.fixture.ts` Phase 7b section (#1158).
- **Symptom:** a doc would not save after an import with **Replace**. **Cause:** the replaced
  primary's pots still named a mode that was gone. **Guard:** `importBonus` retargets them;
  `addOns.fixture.ts` (#1158).
- **Symptom:** a coins-only overlay saved that could start nothing. **Cause:** the last pot's × skipped
  the zero-pots rule. **Guard:** `zeroPotsRefusal`, read by every writer; `addOns.fixture.ts`.
- **Symptom:** a game published after the 7b launcher misplays on a pinned or rolled-back engine.
  **Cause:** a pre-7b engine reads `potsOverlay` raw; the launcher no longer bakes it. **Guard:**
  none; roll forward or unpin (`docs/guides/release-and-rollback.md` §4).
- **Symptom:** a base-game jackpot coin pays 0. **Cause:** it names a tier only a non-primary respin
  mode has, and the primary's engine deals the base game. **Guard:** a validator warning on
  `coinOverlay.coins.<i>.jackpot`; the mock fix is open.
- **Known, not fixed:** no MINI…GRAND bar under a driven flow that never shows `jackpotBar`; resume
  between a drop and its fills shows no tokens; an imported mode's Flow node ids renamed by the
  import are not re-pointed. See `docs/status/pots-overlay.md` "Open items".

## How to test

- **Root gates:** `pnpm check:pots-overlay` (both hosts plus the config, engine-game and facade
  fixtures), `pnpm check:bonus-modes`, `pnpm check:bonus-migration`, `pnpm check:spins-modes`,
  `pnpm check:respin-modes`. Parity: `pnpm check:holdandwin` and `pnpm check:freespins` digests
  must not move. All run in `pnpm check:rgs` / `pnpm check:all`.
- **Launcher gates** (`pnpm --filter launcher-api <script>`): `check:pots-overlay-add-on`,
  `check:bonus-import`, `check:add-bonus-mode`, `check:bonus-authoring`, `check:config-bonus-modes`,
  `check:bonus-modes-tools`, `check:flow-bonus-modes`, `check:win-text-bonus-modes`,
  `check:spins-modes-contract`, `check:spins-modes-tools`, `check:deal-parity`,
  `check:shared-rig-promote`.
- **Fixtures:** `packages/game-config/addOns.fixture.ts`, `imports.fixture.ts`,
  `bonusGames.fixture.ts`, `potsOverlay.fixture.ts`; `apps/lines/src/game/flowV2PotsScreen.fixture.ts`.
- **Playbooks:** `docs/playtest/borut-pots-sample.md` (never touch the live remake) and the 7c
  report `docs/playtest/bonus-games-7c.md`, driven by `scripts/playtest/sample-play.mjs`.
- **Screens:** add-ons have no screen script of their own. The host kind's script covers them:
  `scripts/current-games/screens/bookOf.json` has a `pots` scenario (`requires: grid.potsOverlay`,
  fixture `cg-bookof-pots`), and `scripts/current-games/screens/holdAndWin.json` covers pot meters.
  `lines.json` has no pots scenario and no script plays a spins bonus mode: a gap.
- **A reviewer looks at:** digests unmoved, a no-block project unchanged, the import report, and the
  pot drain / bonus entry order at real clock (the container renders at ~4 fps).

## Read more

- `docs/status/pots-overlay.md` (Phase board, Open items, Owner checklist, Recent changes)
- `docs/status/bonus-games.md` (Phase board, Decisions & findings)
- `docs/design/pots-overlay.md`, `docs/design/bonus-games.md` (§0 supersedes §1 and §6.4)
- `docs/reference/hold-and-win-wire.md`
- `docs/guides/add-pots-overlay.md`, `docs/guides/pot-from-pieces.md`
