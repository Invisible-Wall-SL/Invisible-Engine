# Pots overlay (add-on on any kind) — status + session hub

> Design: [docs/design/pots-overlay.md](../design/pots-overlay.md) · Builds on:
> [status/hold-and-win](hold-and-win.md) · Guide: _none yet (Phase 6)_ · Agents: per phase — see the
> design's build plan.

**One-line state:** Phases 0–1 merged (#1008): the `potsOverlay` Game Config block and the
additive `kindCapabilities`. Phase 3 built (2026-10-02, #1012 in review): `overlayDrop` and the
mode-entry `cause` / `meters` are in the engine contract, and the facade routes each bonus of an
overlay host by its key. Nothing draws a token yet (Phase 4), and no mock deals one yet (Phase 2).
A project without the block, which is every project today, plays exactly as before. Next: Phases 2,
4 and 5a–5d.

## How sessions use this file (the hub)

The work spans several sessions. **This file is the shared memory.** The coordinating ("hub")
session is the Claude Code session titled **"3 pots overlay mechanic"**.

- **Starting a phase:** read the design's §6 build plan and this file. Take the next unclaimed
  phase and put your session title in the Phase board.
- **Finishing (or stopping):** update the Phase board row and add a dated entry to "Recent changes":
  what landed, the PR, what is left, and any surprise. A Claude session also sends the hub a short
  message (`SendMessage` to "3 pots overlay mechanic", or `list_sessions` to find it).
- **Found something that changes the plan** (a contract change, a blocker, a partner answer)? Add it
  to "Decisions & findings" and tell the hub.
- **The committed file wins over any message.** If they disagree, fix the file.
- **Hold and Win parity is a gate here too.** Phases 2–4 touch the Hold and Win mock, the facade and
  the runtime. `check:holdandwin`'s digests and `check:freespins` must not move, and Book of Borut
  plays unchanged.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Plan + hub | in review | 3 pots overlay mechanic | #1008 |
| 1 | Contract: `potsOverlay` config block + validator + presets + `resolveMeters` + additive `kindCapabilities` inputs | built, in review | 3 pots overlay mechanic | #1008 |
| 2 | Mock — composed protocol (`withPotsOverlay` over book, reusable H&W feature generator, free-spin hook, forced beats, wire doc, `check:pots-overlay`) | not started (needs 1) | — | — |
| 3 | Facade + engine event contract (`overlayDrop`, mode-entry `cause`/`meters`, per-bonus routing, pots at boot for any kind) | built, in review | Pots overlay Phase 3 — facade + event contract | #1012 |
| 4 | Engine runtime (overlay layer, timing, lift-off flights, drain on any mode entry, H&W from an overlay host, resume) | not started (needs 3) | — | — |
| 5a | `/config` Add-ons section | not started (needs 1) | — | — |
| 5b | Scene Editor overlay screens + palette/pickers through the capability | not started (needs 1) | — | — |
| 5c | Flow vocabulary composition (editor, publish gate, runtime) + graft | not started (needs 1) | — | — |
| 5d | `/symbols` + `/win-text` + Localization through the capability | not started (needs 1) | — | — |
| 6 | Game Maker add-on action + guides + playbook + `borut-pots-sample` played end to end | not started (needs 2–5) | — | — |
| 7 | Bonus import from another project (provenance, re-sync, pot → imported mode) | not started (needs 6) | — | — |
| 8 | Partner wire | blocked on partner | — | — |

## Current state

What exists, measured 2026-10-02 against `main` e5f94b1. These are the seams the phases change.

- **Runtime — already keyed on the config block, not the kind.**
  - The Hold and Win book-event handlers are always registered (`apps/lines/src/game/bookEventHandlerMap.ts:405-431`).
  - `RespinBoard`, the flight layer, the wheel and the banner are mounted for every game (`Game.svelte:2268, 2552-2558`).
  - The coded pots draw whenever the config declares meters (`HoldAndWinPots.svelte:32`).
  - Pot seeding at boot is a no-op without the global (`holdAndWinMeters.svelte.ts:78-84`).
  - Feature signals are registered only when `getActiveGameConfig().holdAndWin` is set (`Game.svelte:1644`).
  - The `holdAndWin` mode exists when the block does (`packages/game-config/src/modes.ts:69-78`).
  - A flight starts from a cell's seat, not its symbol (`flights.svelte.ts:167-172, 259-306`).
- **Not built — a token on a cell.** `RawSymbol` has `value`/`jackpot`/`factor`/`multiplier` on the
  symbol (`engine-game/src/game/types.ts:19-31`). The coin label is drawn inside `Symbol.svelte`
  (`:83-89, 266-270`). No layer draws a thing over an arbitrary symbol.
- **Not built — a pot that names a bonus.** `HoldAndWinMeter.activates` is a Hold and Win special
  only (`game-config/src/holdAndWin.ts:250-260, 612`). The mock's trigger cause is `'meter'`
  (`mock-rgs-server-holdandwin.mjs:1810-1815`).
- **Facade — a captured `holdAndWin` block takes over every bonus.**
  - Free-spin counters are dropped (`engineFacade.ts:722`).
  - `enterBonus` becomes respins (`:998-1004`).
  - `playedBonusSpin` becomes `holdAndWinState` (`:1029-1033`).
  - Capture happens at `:244-249`.
- **Mock — one protocol per game.**
  - `protocolFor(kind)` (`apps/launcher-api/src/lib/server/mockProtocol.ts:20-34`) and
    `makeMock` (`services/test-server/server.mjs:312-336`).
  - The book mock knows no meters (`scripts/mock-rgs-server-book.mjs`). The H&W mock deals no free spins.
- **Tools — gated on the kind.**
  - `kindCapabilities` sets `holdAndWin`/`coinSymbols` from the kind only
    (`packages/engine-layout/src/lib/kindCapabilities.ts:63-71`). Its helpers follow:
    `symbolStatesForKind`, `engineSignalsForKind` (`componentCatalog.ts:733`) and
    `componentOfferedForKind` (`builtinComponents.ts:2411`).
  - `/config` is the exception: it shows the section when the block exists (`config/+page.svelte:91-93`),
    but has no button to add one, and its presets replace the whole doc
    (`gameConfigDefaults.ts:71`, `+page.svelte:984`).
  - Flow vocabulary is one per `templateId` (`engine-flow-v2/src/reference/registry.ts:19-25`), and
    the Hold and Win vocab's parts are not exported (`reference/holdAndWin.ts:947-958`).
  - The publish gate refuses a Hold and Win ref in a book flow (`flowV2Validation.ts:49-58`).
  - The Scene Editor's "Add missing screens" compares against the kind's set
    (`editor/+page.svelte:1442-1477`), and a scaffold load replaces the layout (`:1196-1240`).
- **Cross-project — no import exists.**
  - `POST /api/game-maker/duplicate` copies a whole project onto a NEW key (`projectDuplicate.ts`).
  - Spines under another project's prefix export nothing (`editorArtExport.ts:929-938`).
  - The runtime holds one `RuntimeBundle` (`apps/lines/src/editor-scenes.ts:496-497`).

## Decisions & findings

- 2026-10-02 — **Phase 3 contract, as built** (session "Pots overlay Phase 3 — facade + event
  contract", #1012). Pinned by `packages/rgs-translator-eagaming/potsOverlay.fixture.ts` (54 checks,
  hand-built wire, auto-discovered by `check:all`) and new `modeStack.fixture.ts` cases.
  - **The engine events** (`engine-game` `potsOverlay.ts`):
    - `overlayDrop {cells: [{reel, row, token, pot?, value?, jackpot?}]}`. Positions are VISIBLE
      0-based, like every Hold and Win position. `token` is the symbol name, mapped through the
      host's mapping (an overlay name passes through). A value coin carries `value` OR `jackpot`.
    - `ModeEntryCause {cause?, meters?}` is on `freeSpinTrigger` and `modeEnter`
      (`holdAndWinTrigger` already had both). The mode layer keeps `cause` on the entry and
      `meters` in its payload, for every entry kind: a `freeSpinTrigger` op now has `cause`, and a
      `modeEnter` with a nested `payload` merges a top-level `meters` into it.
      `modeEntryMeters(entry)` reads them back; Phase 4's drain on any mode entry uses it.
    - `apps/lines` registers `overlayDrop` as a no-op handler. It crosses `recordBookEvent` like
      every event, but nothing records it yet (Phase 4 owns the token picture).
  - **The facade** (`rgs-translator-eagaming` `potsOverlay.ts` + `engineFacade.ts`). Everything
    below happens only under a captured `config.potsOverlay` with `wire: 1`. Another wire is
    refused loudly, and the game then plays as a host without pots.
    - **Boot:** pot levels go out on the existing `__IE_HOLD_AND_WIN_METERS__` global, in
      `resolveMeters` order (the Hold and Win block's own meters first, then the pots), for any
      kind.
    - **Mapping:** with the block, `pickMappingForConfig` keeps the HOST's mapping (book / lines)
      even when a `holdAndWin` block is present. Without it, a Hold and Win block still means
      identity names. The Hold and Win bonus names and token names are in no host's table, so they
      pass through.
    - **Order:** the `overlayDrop` of a spin is emitted right after that spin's `reveal`, before its
      `winInfo`s, wherever the wire put it in that spin. Without a Hold and Win block, `meterUpdate`
      / `meterLevels` are translated by the overlay path (shared builders in `holdAndWin.ts`).
    - **Routing:** `spinTrigger.bonus` → `potsOverlay.bonuses[key]` → `holdAndWin` plays on the
      respin board (`enterBonus` / `playedBonusSpin` → `holdAndWinState`), and anything else plays
      on the reels (free spins). A key the block does not list falls back to the Hold and Win
      block's own key (`config.holdAndWin.bonus`, default `respin`). The route holds from one
      `spinTrigger` to the next, so the free-spin counter only counts reels bonus spins. The
      facade has no Game Config doc, so it reads the route off the wire and never re-derives
      `holdAndWinIsOverlayBonus`.
    - **A pot's free spins:** `spinTrigger {cause, meters}` → `freeSpinTrigger {cause, meters}`
      with `positions: []` (no scatter caused it). The base spin's wins are banked at entry
      (`setTotalWin`), because a pot's trigger arrives after the reveal.
    - **A second bonus in one round:** a `spinTrigger` while free spins are playing ends them with
      a synthesized `freeSpinEnd {amount: round win so far, winLevel}`. That is the `gameEnd` they
      would have had; the round's own `gameEnd` then closes it as a base round. `playOutRound`
      needed no change: it already plays to the `gameEnd` after the LAST `enterBonus`.
    - **Resume:** an overlay host resumes mid-respins at the next respin (as a Hold and Win game
      does) only when the open bonus is respins. A pot's free spins replay whole, as every
      free-spin round does.
  - **Parity:** with no block, the facade is byte-identical to `main`. A throwaway harness ran the
    old facade and this one against 36 seeded rounds (book, book free spins, lines, the three Hold
    and Win presets): 3,905 book events, 0 differences. `check:holdandwin` (1892), `check:resume`,
    `check:freespins`, `check:rgs` and `check:engine-game` pass unchanged. The svelte-check ratchet
    holds (lines 164, engine-game 37, launcher 53). `apps/lines` booted on the local book mock
    (`FORCE_TRIGGER=1`) deals and drives the whole free-spin round exactly as `main` does. In this
    container neither branch's presentation reaches idle (swiftshader, remote art unreachable), so
    the visual pass is left to a real-clock playtest.

- 2026-10-02 — **Phase 1 contract, as built** (session "3 pots overlay mechanic", #1008). Pinned by
  `packages/game-config/potsOverlay.fixture.ts` (115 assertions) and the kind-gating /
  signal-scope / hold-and-win-template gates. A code review's five findings were fixed before
  merge; they are folded in below.
  - **The block** (`packages/game-config/src/potsOverlay.ts`). It is the design's §3.1 shape.
    - `normalizePotsOverlay` is structural: a block with no pot and no drop is no block. A pot
      missing its token or bonus is dropped whole, as a Hold and Win meter is, so the 5a editor
      must keep draft rows client-side.
    - A block with pots but no `drops` stores `chance: 0.1, maxPerSpin: 1`. A drop entry without a
      weight weighs 1.
    - The default dropping modes (`['basegame']`) are not stored. An empty `reels` or `modes` list is
      kept as authored and reported by the validator ("No reel can receive a token" / "No mode
      drops").
  - **Tokens never sit on a strip.** A token on any `paddingReels` strip is an error. A token is
    exempt from the general "in the dictionary but on no strip" warning, but a token with a paytable
    still warns, because it can never pay.
  - **Drops:**
    - A weight must be above 0, which is stricter than the Hold and Win tables (they allow a 0
      entry). The chance is in (0, 1].
    - A dropping mode must play on the `reels`. A respin board, a wheel or `none` has no cell for a
      token.
    - Value coins with no `holdAndWin.trigger.count` → warning: they can never start the feature.
    - Value coins with `maxPerSpin` below `trigger.count.min` → warning. The `threePots` preset
      therefore sets `maxPerSpin` to the trigger's count (6).
  - **`resolveMeters(doc)`** lists the Hold and Win block's meters first (`source: 'symbol'`, bonus
    `{mode: 'holdAndWin', activates}`), then the overlay's pots (`source: 'overlay'`). It returns
    copies. Nothing reads it yet: Phase 4 moves the runtime's `configuredMeters()` onto it, and
    Phase 5 moves the tools.
  - **Bonus or base game: `holdAndWinIsOverlayBonus(doc)`** (`holdAndWin.ts`; it lives there to avoid
    an import cycle). The data decides, in this one place: with an overlay present, the block is the
    BONUS when the base game's strips deal no Hold and Win symbol. The base game's strips are found
    through the mode registry (`gameTypeForMode`). Phases 2–4 must call this helper, never re-derive
    it.
    - **As a bonus** (a Book-of or lines host):
      - The lines-only rule is skipped.
      - The feature starts only from a pot routed to `holdAndWin`, or from value-coin drops with
        `trigger.count`. The no-trigger error says exactly that.
      - `trigger.pattern`, `luckySpin`, `randomMetre`, `buy`, `instantCollectInBaseGame` (on the
        collector and the multiplier) and symbol-filled `meters` are errors ("not built for an
        overlay host yet").
      - A `trigger.count` with no value-coin drop → warning.
    - **As the base game** (a Hold and Win game that adds an overlay): every rule applies unchanged,
      and a pot routed to `holdAndWin` is one more trigger. The fixture validates pots-to-free-spins
      on all three Hold and Win presets clean.
    - The "nothing activates a special" warning counts a pot with `activates`.
  - **Presets** (`potsOverlayPresets.ts`):
    - `potsOverlayPreset(id)` builds a fresh `{potsOverlay, tokens, holdAndWin?}` on each call, so a
      game bundle never carries `HOLD_AND_WIN_PRESETS` (checked with a Rollup probe). Merging a preset
      into a doc is Phase 5a / 6, never a whole-doc reset.
    - `threePots` is built from the 3 Pots meters (red → payer, blue → collector, green →
      multiplier).
    - `holdAndWinBonus(id, host)` gives the paired Hold and Win block, its symbols and its respin
      strips, cycled to the host's `numReels` (3 Pots on a 6-reel host and the 3×3 Collector on a
      5-reel host both validate clean). It drops `luckySpin`, the block's meters and the
      `meterSpecial` tags, and turns instant collect off.
    - `potsToFreeSpins`: one `gold` pot → `{mode: 'freeSpins', spins: 10}`.
  - **`modes.ts`** now exports `HOLD_AND_WIN_MODE` and `GAME_MODE_ID`, the id shape pots share
    because both become anchors and value-source path segments.
  - **Capabilities** (`kindCapabilities.ts`):
    - Two presence flags in, `holdAndWin` and `potsOverlay`.
    - `holdAndWin` and `coinSymbols` = kind OR block. `pots` = `holdAndWin` OR overlay.
      `potsOverlay` = block.
    - `freeSpins`, `stackedPictures`, `bookSymbolVfx`, `tumblePattern` and `symbolTransition` stay
      on the kind.
    - The Pot Meter and the six pot signals (`potFill`, `potLand`, `potLevelUp`, `potStageUp`,
      `potFull`, `potActivate`) moved to `pots`.
    - `symbolStatesForKind`, `engineSignalsForKind` and `componentOfferedForKind` take an optional
      config. No consumer passes one yet.
  - **Parity:** 168 docs normalize and validate identically to `main`. They are every Hold and Win
    preset and fixture plus every committed default, each also under mutations including lucky spin,
    pattern, random metre and instant collect variants. `check:holdandwin` (1892 facade checks) and
    `check:freespins` pass unchanged, and the svelte-check ratchet holds (launcher 53, lines 164,
    engine-layout 291).
- 2026-10-02 — **Owner request + plan** (session "3 pots overlay mechanic").
  - The request: the 3 Pots mechanic as an optional overlay on any game. Coins appear on top of the
    symbols and fly to pots. A full pot cues a bonus: a classic Hold and Win, or "other games I
    already did".
  - The plan is the design doc. Its §7 lists the defaults the hub took for the owner's open
    decisions: tokens and value coins both; one pot per token; no drops in free spins; host feature
    first when both trigger on one spin; import (not live link) for another project's bonus; mock
    first; never test on live Borut.
  - Key structural choice: **an add-on is a config block, not a kind.** Capabilities become "kind OR
    block", and only the overlay's own parts follow the block. `freeSpins`, `bookReveal` and the
    rest stay on the kind.

## Open items / next

0. **Carried into Phase 4 (found in Phase 3):**
   - **Resume of a two-bonus round** cut off mid-respins: the snapshot before the resume point holds
     the free spins' `freeSpinTrigger` AND their `freeSpinEnd`. `createBonusSnapshot` replays the
     last `freeSpinTrigger` whatever follows it, so it would redraw the free-spin intro. Skip it
     when a later `freeSpinEnd` exists (the mode stack already restores correctly).
   - Record `overlayDrop` into a token picture at the play seam (`utils.ts` `recordBookEvent`),
     for the layer, lift-off and resume.
   - The drain on any mode entry reads `modeEntryMeters(entry)`.
   - Phase 2 must emit exactly the wire above. Anything that cannot work as specified goes to the
     hub, not into a silent change.

1. **Merge #1008** (Phases 0–1). Then **Phases 2, 3 and 5a–5d** can start in parallel. Each needs a
   session; see the Phase board.
2. **Carried into later phases (found in Phase 1):**
   - **Phase 4:** `Game.svelte` registers the feature signals, pots included, only when the config
     has a `holdAndWin` block (`featureComponentSignals`, `Game.svelte:1644`). On a pots-only host, an
     authored pot cue would be offered (`pots`) but never fire, so register the pot family under
     `potsOverlay` too. The runtime's `configuredMeters()` must read `resolveMeters`.
   - **Phase 5c:** `packages/engine-flow-v2/src/reference/holdAndWin.ts:936-938` (`unusedByKind`)
     repeats the kind rule as a regex. Make it read the capabilities.
   - **Phase 2:** decide whether a Hold and Win GAME's own count trigger (an H&W kind that adds an
     overlay) also counts dropped value coins, or only landed coin symbols. Record it here.
   - **Phase 5a:** a new pot row without its token or bonus is dropped on save (normalizer rule), so
     keep draft rows client-side until they are complete.
   - **Phase 5d:** tokens are off the strips, so `symbolsInPlay` leaves them out. `/symbols` and the
     published symbol defaults must add them through `resolveMeters`. `symbolStatesForKind` (pinned
     by `check-symbols-kind-gating.ts`) hides `coinLand` / `coinIdle` / `flyToMeter` from a pots-only
     host, but design §4 wants those states for the tokens. Gate them on `pots` there.
   - **Phase 6:** merging `holdAndWinBonus()` symbols into a host's dictionary can clash with the
     host's own names (a host that already has a `BONUS` or a `BLANK`). The add-on needs a rename
     map, or must refuse with a clear message.
   - `pnpm --filter game-config typecheck` already exits 2 on `main` (10 errors: fixtures that import
     `node:*` without Node types). The new fixture adds 4 of the same kind. It is not a gate, and
     `check:all` runs every fixture.

## Owner checklist

1. **Confirm or change the defaults** in the design's §7, especially #5 (import vs live link) and #4
   (host feature and pot bonus in one round).
2. **Phase 6:** duplicate Book of Borut as `borut-pots-sample` (Game Maker → Duplicate, setup
   scope), then publish it once Phase 6 lands. A session cannot sign in.
3. **Phase 8:** ask the partner whether their RGS can deal per-player pots, drops on top of symbols,
   and a bonus routed by pot. The same partner conversation as Hold and Win Phase 10.

## Blocked (owner / external)

- **The partner's RGS** for production play (Phase 8). Authoring and mock play are not blocked.

## Recent changes

- 2026-10-02 — **Phase 3: facade + event contract (#1012).** `overlayDrop` and the mode-entry
  `cause` / `meters` in `engine-game`. The facade under a captured `potsOverlay`: pots seeded at boot
  for any kind, drops and pot meters translated, each bonus routed by its key, a pot's free spins
  marked `cause: 'meter'`, a second bonus in one round, and the resume point. The fixture
  `potsOverlay.fixture.ts` covers all of it on hand-built wire. Byte parity without the block. The
  contract is under Decisions; the Phase 4 follow-ups are under Open items. Agent:
  `engine-pixi-svelte` scope, reviewed by `code-reviewer`.

- 2026-10-02 — **Phase 1: the contract (#1008).** The `potsOverlay` Game Config block with its
  normalizer, validator, `resolveMeters` and two presets (Phase 1a, agent `invisible-game-config`).
  The additive `kindCapabilities` with the new `pots` / `potsOverlay` capabilities (Phase 1b, agent
  `invisible-components`). The rules settled are under Decisions; the follow-ups are under Open
  items. No consumer reads the new block or flags yet, so nothing changes in any tool or game.
- 2026-10-02 — **Plan + hub (Phase 0).** Design `docs/design/pots-overlay.md` and this hub were
  written from three code surveys (runtime, tools, cross-project), with the file references above.
