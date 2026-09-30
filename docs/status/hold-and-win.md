# Hold and Win (game kind) — status + session hub

> Design: [docs/design/hold-and-win.md](../design/hold-and-win.md) · Guide: _none yet (per-tool
> guides get a Hold and Win section as each phase ships)_ · Agents: per phase — see the design's
> build plan.

**One-line state:** planned (2026-09-30). Mechanics researched, engine + tooling inventoried, plan
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
| 0 | Hub + plan | in review | Hold and win game pipeline | — |
| 1 | Kind plumbing + `kindCapabilities()` | not started | — | — |
| 2 | Game Config `holdAndWin` block | not started | — | — |
| 3 | Mock RGS `holdAndWin` protocol | not started | — | — |
| 4 | Engine runtime (RespinBoard, coin labels, events, facade, resume) | not started | — | — |
| 5 | Flow vocabulary + driven seed | not started | — | — |
| 6 | Scene Editor template + components | not started | — | — |
| 7 | Symbols SM (coin roles/states, value label, kind gating) | not started | — | — |
| 8 | Win Text (jackpot + respin copy, gating) | not started | — | — |
| 9 | Game Maker presets + docs + playtest, sample games | not started | — | — |
| 10 | Variants round 2 (wheel, metre, super buy, expansion, platform jackpot) | not started | — | — |

## Current state

- **The research is recorded in the design doc.** §1 covers the mechanics and the two reference games, §2 what we carry, and §3 the partner protocol.
- **The upstream `apps/price` `superspin` sample is the only existing respin code.** It has sticky prize coins, a reset counter and a collect event. It is the reference for Phase 4, to be rebuilt on engine-game primitives rather than forked.

## Decisions & findings

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

1. **Phase 1:** kind plumbing and `kindCapabilities()`, with no behaviour change for existing kinds.
2. **Owner decision:** which preset is the first real game (Classic sticky / Grand-like, or Collector streak / Hotfire-like)? It sets the Phase 4 order.
3. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2).

## Blocked (owner / external)

- **Partner Hold and Win wire format.** This blocks production RGS play only. Authoring and mock play are not blocked.

## Recent changes

- 2026-09-30 — **Plan and hub created** (session "Hold and win game pipeline").
  - Researched 3 Oaks *Grand* and *Super Hotfire Diamonds* from their server config and rules strings.
  - Read the partner core's respin and jackpot handling.
  - Inventoried the engine: found the `apps/price` superspin loop.
  - Inventoried every tool's kind plumbing.
  - Wrote the design doc and this hub.
