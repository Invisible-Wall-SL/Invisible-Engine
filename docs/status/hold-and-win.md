# Hold and Win (game kind) — status + session hub

> Design: [docs/design/hold-and-win.md](../design/hold-and-win.md) · Guide: _none yet (per-tool
> guides get a Hold and Win section as each phase ships)_ · Agents: per phase — see the design's
> build plan.

**One-line state:** Phase 2 merged (2026-09-30) — the Game Config `holdAndWin` block and the
three presets exist; nothing plays the feature yet. Mechanics researched, engine + tooling inventoried, plan
written. Nothing built yet. Production is blocked on the partner's Hold and Win wire format;
authoring is not (mock-first).

## How sessions use this file (the hub)

This work spans many sessions. **This file is the shared memory. It is committed, so every session
and every teammate sees it.** The coordinating ("hub") session is the Claude Code desktop session
titled **"Hold and win game pipeline"**.

- **Starting a phase:** read the design doc's §6 build plan and this file. Take the next unclaimed
  phase and put your session title next to it in the Phase board below.
- **Finishing (or stopping):** update the Phase board row and add a dated entry to "Recent changes":
  what landed, the PR, what is left, and any surprise. If you are a Claude session, also send the
  hub session a short message so it can re-plan. Use `SendMessage` to the session titled "Hold and
  win game pipeline", or `list_sessions` to find it.
- **Found something that changes the plan** (a contract change, a blocker, a partner answer)? Add it
  to "Decisions & findings" and tell the hub.
- **The committed file wins over any message.** If they disagree, fix the file.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Hub + plan | merged | Hold and win game pipeline | #900 |
| 1 | Kind plumbing + `kindCapabilities()` | not started | — | — |
| 2 | Game Config `holdAndWin` block (full option space, 3 presets) | merged | Hold and Win Phase 2 — Game Config block | #919 |
| 3 | Mock RGS `holdAndWin` protocol + wire contract (swap seam) | not started | — | — |
| 4 | Engine runtime (RespinBoard, coin labels, events, facade, resume) | not started | — | — |
| 5 | Flow vocabulary + driven seed | not started | — | — |
| 6 | Scene Editor template + components | not started | — | — |
| 7 | Symbols SM (coin roles/states, value label, kind gating) | not started | — | — |
| 8 | Win Text (jackpot + respin copy, gating) | not started | — | — |
| 9 | Game Maker presets + docs + playtest, sample games (3 Pots first) | not started | — | — |
| 10 | Partner wire (facade + mock brought in line) | blocked on partner | — | — |
| 11 | Beyond the references (expansion, add-respins/upgrade, platform jackpot) | not started | — | — |

## Current state

- **The research is recorded in the design doc.** §1 covers the mechanics and the three reference games, §2 what we carry, and §3 the partner protocol.
- **The upstream `apps/price` `superspin` sample is the only existing respin code.** It has sticky prize coins, a reset counter and a collect event. It is the reference for Phase 4, to be rebuilt on engine-game primitives rather than forked.

## Decisions & findings

- 2026-09-30 — **Phase 2: the config shape Phase 3 generates from** is `doc.holdAndWin`
  (`packages/game-config/src/holdAndWin.ts`; detail in [game-config.md](game-config.md)). Roles are
  `special_properties` values: `coin`, `jackpot`, `collector`, **`coinMultiplier`** (not
  `multiplier` — the lines mock contract already deals multiplier cells for that tag), `payer`,
  `mystery`, `meterSpecial`, `blank`. Specials never name their symbol; meters do. A cash coin
  draws as the `coin` symbol, a jackpot coin as the `jackpot` symbol (or the coin symbol if there is
  none). A buy tier's price is its bet mode's `cost`. Reel indices are 0-based. Every preset has a
  `respin` padding strip set (coins/specials/blank) beside `basegame`.
- 2026-09-30 — **Preset numbers the design doesn't give are placeholders**: line pays, every draw
  weight, the payer's and leave-behind coin's steps (2–10 as 2,3,…,10), the mystery table, Pots'
  `fromTriggeringSpecials: true`, and Hotfire's wheel coin boost (×2).
- 2026-09-30 — **Normalization drops half-typed entries on save** (a jackpot with no name, a meter
  with no symbol, letters with no word, a buy with no mode), consistent with the rest of the config.
  A reference to a dropped jackpot then shows as a validator error. Revisit if authors trip on it.

- 2026-09-30 — **Owner: one template makes all three reference games.** Grand, Super Hotfire Diamonds and 3 Pots of Egypt are presets of the same kind. Every option any of them uses is core scope (design §6).
- 2026-09-30 — **Owner: 3 Pots of Egypt is the first real game.** It sets the Phase 4 build order.
- 2026-09-30 — **Owner: build against our own mock now.** The partner delivers their wire later. The mock's wire is a documented **swap seam**, to be rewritten when their format arrives (Phase 10). Nothing above the facade may depend on it.
- 2026-09-30 — **Third reference, 3 Pots of Egypt** (user-supplied). It adds these to the design's option space: persistent per-player pot meters (server state), a feature entered with specific modifiers active, specials counting toward the trigger, a payer, a multiplier that becomes a coin, a mystery that unlocks modifiers, per-special value tables, apply order, a server-announced Lucky Spin, and decimal coin values. Game Maker gets a third preset, **Pots**.
- 2026-09-30 — **`holdAndWin` is a kind + a mechanic. It is not a new `winModel`.** The base game pays by `lines`.
- 2026-09-30 — **The feature runs on a dedicated per-cell `RespinBoard`.** The shared column-strip reel board is left untouched: rewriting it would put every live game at risk.
- 2026-09-30 — **Mock-first contract.** We define the engine book events (design §4.3) and the mock speaks an invented wire for them. The facade maps them. Only the facade changes when the partner confirms their format.
- 2026-09-30 — **The partner core has a generic respin but no Hold and Win data.** It has one `play` per respin and the `playedBonusSpin` counters. It has no coin values, sticky cells or collector. Its Mini/Minor/Major/Grand jackpot is the operator **platform** jackpot (`platform.jackpots[]`), not our fixed coin jackpots. That is out of scope for the first build.
- 2026-09-30 — **"Hide options per kind" needs one capability source (`kindCapabilities`).** Today only `/symbols` state columns, scene sets, the flow vocab and config-by-winModel gate at all.
- 2026-09-30 — **Trap to fix in Phase 1:** flow vocab and driven seed fall back to **bookOf** silently. Lines, cluster, scatter and custom kinds are all scaffolded with `templateId: 'bookOf'`.

## Touch list (every place a new kind must be registered — from the 2026-09-30 inventory)

- `apps/launcher-api/src/lib/roles.ts:47-55` (`GameKind`/`GAME_KINDS`)
- `apps/launcher-api/src/routes/(app)/editor/+page.svelte:~2119` (`GAME_TYPES`)
- `packages/game-spec/src/schema.ts:25` (`GameTypeSchema`) and `:28` (`SymbolKindSchema`), `scaffold.ts:52`
- `apps/launcher-api/scripts/check-flow-publish-gate.ts:32`
- `scripts/gen-flow-vocabulary.mjs:70` → regenerates `lib/emitterVocabularies.ts` (`/fx` suggestions)
- `apps/launcher-api/src/lib/server/mockProtocol.ts` `protocolFor()`; `testServerManifest.ts:217` + `services/test-server/server.mjs:483` `MOCK_PROTOCOLS`; `server.mjs` `makeMock` / `hydrateOnce`
- `packages/engine-layout/src/lib/referenceLayouts/index.ts` `FULL_SCENE_SOURCES`; `templates/index.ts` `TEMPLATES`; `sceneRole.ts` `SCENE_ROLE_LABELS` + `types.ts` role union
- `packages/engine-flow-v2/src/reference/registry.ts` `TEMPLATE_VOCABULARIES`; `drivenSeed.ts` `DRIVEN_SEEDS`
- `apps/launcher-api/src/lib/server/gameProfile.ts` `FEATURE_DETECTORS`
- `apps/launcher-api/src/lib/server/gameConfigDefaults.ts` + `scripts/generate-game-config-defaults.ts`
- `apps/launcher-api/src/lib/server/symbolDefaults.ts` (only `lines.json` exists)
- `apps/launcher-api/src/routes/(app)/symbols/symbols.client.ts` `visibleStatesFor`
- runtime: `apps/lines/src/game/{typesBookEvent,bookEventHandlerMap,flowEffects}.ts`, `engine-game/src/game/{types,bookEvents}.ts`
- facade: `packages/rgs-translator-eagaming/src/{engineFacade,gameMappings,sessionState}.ts`

## Open items / next

1. **Phases 1 and 2 start now, in parallel sessions.** Phase 3 (mock) follows Phase 2.
2. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2).

## Blocked (owner / external)

- **Partner Hold and Win wire format.** This blocks production RGS play only. Authoring and mock play are not blocked.

## Recent changes

- 2026-09-30 — **Phase 2 merged (#919)** (session "Hold and Win Phase 2 — Game Config block").
  - `packages/game-config`: the `holdAndWin` block, its normalizer and validator, and the three presets
    `pots` / `classic` / `collector` (numbers per design §1.2).
  - Committed defaults: `data/gameConfig/holdAndWin.<preset>.json`. `holdAndWin` defaults to `pots`.
  - `/config`: a Hold and Win section and "Reset to preset". The section is gated on the project kind
    and switches to `kindCapabilities()` when Phase 1 lands.
  - Game Maker: ten profile detectors.
  - Left for later phases: nothing reads the block at runtime yet (Phase 4), the mock doesn't generate
    from it (Phase 3), and the roles aren't offered in `/symbols` (Phase 7).
  - Phase 1 must add `holdAndWin` to `GAME_KINDS` before a project can actually be that kind.

- 2026-09-30 — **Owner decisions recorded** (one template / three presets, 3 Pots first, mock-first with a swap seam). Build plan re-cut: Phase 10 is now the partner wire and Phase 11 covers what goes beyond the three references.

- 2026-09-30 — **Plan and hub created** (session "Hold and win game pipeline").
  - Researched 3 Oaks *Grand*, *Super Hotfire Diamonds* and *3 Pots of Egypt* from their server config and rules strings.
  - Read the partner core's respin and jackpot handling.
  - Inventoried the engine: found the `apps/price` superspin loop.
  - Inventoried every tool's kind plumbing.
  - Wrote the design doc and this hub.
