# Pots overlay (add-on on any kind) — status + session hub

> Design: [docs/design/pots-overlay.md](../design/pots-overlay.md) · Builds on:
> [status/hold-and-win](hold-and-win.md) · Guide: _none yet (Phase 6)_ · Agents: per phase — see the
> design's build plan.

**One-line state:** Planned (2026-10-02). Phase 1 (the config contract + additive capabilities) is in
progress. Nothing reaches a game yet: a project without a `potsOverlay` block, which is every project
today, plays exactly as before.

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
| 0 | Plan + hub | in review | 3 pots overlay mechanic | — |
| 1 | Contract: `potsOverlay` config block + validator + presets + `resolveMeters` + additive `kindCapabilities` inputs | in progress | 3 pots overlay mechanic | — |
| 2 | Mock — composed protocol (`withPotsOverlay` over book, reusable H&W feature generator, free-spin hook, forced beats, wire doc, `check:pots-overlay`) | not started (needs 1) | — | — |
| 3 | Facade + engine event contract (`overlayDrop`, mode-entry `cause`/`meters`, per-bonus routing, pots at boot for any kind) | not started (needs 1; parallel with 2) | — | — |
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

1. **Phase 1** — in progress on this branch.
2. Then **Phases 2, 3 and 5a–5d** can start in parallel; each needs a session (see the Phase board).

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

- 2026-10-02 — **Plan + hub (Phase 0).** Design `docs/design/pots-overlay.md` and this hub were
  written from three code surveys (runtime, tools, cross-project), with the file references above.
