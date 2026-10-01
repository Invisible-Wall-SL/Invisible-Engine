# Hold and Win (game kind) — status + session hub

> Design: [docs/design/hold-and-win.md](../design/hold-and-win.md) · Guide: _none yet (per-tool
> guides get a Hold and Win section as each phase ships)_ · Agents: per phase — see the design's
> build plan.

**One-line state:** Phase 3 (2026-09-30) — the mock RGS deals the whole Hold and Win feature
for all three presets from the project's Game Config, on our own documented wire
([hold-and-win-wire.md](../reference/hold-and-win-wire.md)), with every beat forceable. The engine
does not render it yet (Phase 4): today's runtime plays a Hold and Win round to its end as
partner-shaped free spins and settles the right balance, but shows no coins. Production is blocked
on the partner's Hold and Win wire format; authoring is not (mock-first).

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
| 1 | Kind plumbing + `kindCapabilities()` | merged | Hold and Win Phase 1: register the kind everywhere | #917 |
| 2 | Game Config `holdAndWin` block (full option space, 3 presets) | merged | Hold and Win Phase 2 — Game Config block | #919 |
| 3 | Mock RGS `holdAndWin` protocol + wire contract (swap seam) | merged | Hold and Win Phase 3 — mock RGS + wire | #924 |
| 4 | Engine runtime (RespinBoard, coin labels, events, facade, resume) | in progress — 4a (event contract) in review | Hold and Win Phase 4 — engine runtime | 4a: — |
| 4M | Game modes: registry, mode stack + queue, per-mode flow graphs, resume | not started | — | — |
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

## What each kind resolves to (Phase 1, pinned by `check:flow-publish-gate` §4)

| Kind | Starter flow (`freshDrivenSeedDoc`) | Flow vocabulary (`templateVocabulary`) | Mock protocol → mock that deals it | `/flow` emitter vocab |
|---|---|---|---|---|
| `lines` | bookOf seed (`DRIVEN_SEED_FALLBACKS`) | bookOf (`VOCABULARY_FALLBACKS`) | `lines` → lines | lines |
| `ways` | ways seed | ways | `ways` → lines mock, ways evaluator | lines |
| `cluster` | cluster seed (since 2026-10-01; a project scaffolded before keeps its stored `bookOf` flow) | cluster | `cluster` | default |
| `scatter` | scatter seed (since 2026-10-01; same caveat) | scatter | `scatter` | default |
| `bookOf` | bookOf seed | bookOf | `book` | lines |
| `holdAndWin` | → `lines` → bookOf seed | → `lines` → bookOf | `holdAndWin` → **Hold and Win mock** (Phase 3); the lines mock, with a logged warning, only when the contract carries no `holdAndWin` block | lines |
| custom kind / absent | bookOf seed (`UNREGISTERED_TEMPLATE_FALLBACK`) | bookOf | `lines` | default |

Existing kinds resolve exactly as before Phase 1. `holdAndWin` follows `lines` by alias, so Phase 5
only has to register its own vocab + seed.

## Decisions & findings

- 2026-10-01 — **Phase 4a: the engine's Hold and Win event contract is code, not a table.** One home:
  `HoldAndWinEventFields` in `packages/engine-game/src/game/holdAndWin.ts`; `apps/lines`
  `typesBookEvent.ts` spells each arm out from it. Where it differs from the design's §4.3 sketch
  (the design table now points here): **positions are VISIBLE 0-based** (no padding row — the respin
  board has none; a base-board consumer adds it); a coin's value / jackpot label / factor ride on the
  cell's `RawSymbol` (`value`, `jackpot`, `factor`), so every event carries cells as
  `{reel, row, symbol}`; `holdAndWinTrigger` is `{mode: 'holdAndWin', cause, payload: {cells,
  respins, stickiness, activeModifiers, meters?}}` and `holdAndWinEnd` is `{mode: 'holdAndWin',
  total, payload: {cells, banked}}` — the §4.5 `modeEnter`/`modeExit` shape, so Phase 4M aliases
  them without a payload change; `cause` is `count|pattern|meter|luckySpin|randomMetre|buy` with the
  meter ids in `payload.meters`. Added beyond §4.3, because the wire carries them and the client
  must show them: `meterLevels` (the server restating every meter after each `play`),
  `randomMetreTrigger`, `cellsCleared`, and `holdAndWinState` (the server's whole picture of an open
  feature after every respin — the resume snapshot).
- 2026-10-01 — **Phase 4a: resume = the last `holdAndWinState` + the last `meterLevels`.** Kept by
  name in the engine's resume snapshot (`HOLD_AND_WIN_SNAPSHOT_EVENTS`, with `holdAndWinEnd`) and
  replayed by `createBonusSnapshot`, so a reload rebuilds the board from the server's picture without
  replaying the trigger's intro — unless a `holdAndWinEnd` follows that snapshot, when the feature
  stays closed. Meters are NOT part of a feature snapshot: they have their own events and survive it.
  The facade emits `holdAndWinState` from the wire's bonus snapshots (4b), computing `total` and
  taking `stickiness` from the boot config (the wire snapshot carries neither).
- 2026-10-01 — **Phase 4a: the client's picture is a pure reducer** (`applyHoldAndWinEvent`,
  pinned by `packages/engine-game/fixtures/holdAndWinState.fixture.ts` in `check:engine-game`), held
  in `apps/lines` `stateHoldAndWin`. Every Hold and Win handler records into it and presents nothing
  until its beat ships; the server's `holdAndWinState` replaces it wholesale after each respin, so a
  misread step self-corrects. `total` is never summed client-side.
- 2026-10-01 — **`flightArrive` is an emitter cue, not a book event** (`EmitterEventFlight` in
  `engine-game/src/game/flight.ts`, `{flight, target, index}`), in the `/flow` palette under
  "Flights". Nothing broadcasts it until `flyTo` ships.

- 2026-09-30 — **Phase 3: the wire is ours and documented as the swap seam**
  ([hold-and-win-wire.md](../reference/hold-and-win-wire.md)). The respin scaffolding is the
  partner's own model (`spinTrigger bonus: "respin"`, `enterBonus`, one context-less `play` per
  respin, `playedBonusSpin {played, left}`, `gameEnd`, `collect`); only the Hold and Win events are
  invented. Consequence worth knowing for Phase 4: the CURRENT facade already drives a whole round and
  settles the balance, so the engine work is presentation, not round plumbing.
- 2026-09-30 — **Phase 3: symbols travel in the project's OWN names** (`BONUS`, `BOOST`, …), not the
  lines `PIC*` vocabulary, and a value rides on its cell (`BONUS:1.5`, `JACKPOT:MINI*2`). Phase 4's
  facade needs an identity mapping for this protocol and a `parseCell` that reads a jackpot label.
- 2026-09-30 — **Phase 3 rules the design left open**, now fixed in the mock (change them in the wire
  doc + mock together): triggering specials do not stick (they activate their kind when
  `fromTriggeringSpecials`); payers/multipliers stay on the board inert after applying (they count
  for a full board and for column letters); a sticky-coins collector collects the cash coins once when
  it lands and keeps that value; a streak collector takes coins AND jackpot coins every respin; a
  mystery that reveals a coin counts as a new coin for the reset; the wheel's coin boost applies to the
  held coins and every later coin; all letters lit ends the feature; meters fill in the base game only.
- 2026-09-30 — **Phase 3: `jackpotWin` never adds money.** Banked jackpots (wheel, letters, full
  board) are in `holdAndWinEnd.banked`; every other `jackpotWin` is presentation of an amount already
  inside a tally cell, a collector, a column or an instant collect.
- 2026-09-30 — **Phase 3: a forced full meter says `forced: true`** on its `meterUpdate` — the force
  sets the level one short first, so the level is not the last one plus `from`.
- 2026-09-30 — **Phase 3: a `bet` over an open round opens a new round** (the partner's behaviour);
  the mock plays the abandoned feature out and credits it. Every batch is atomic (a refusal stores
  and charges nothing), fresh actions must go to the next free `seq`, and a played round's
  `play`/`collect` must carry its `gid` — found in review, pinned by the gate.
- 2026-09-30 — **Phase 3: forcing is an authoring tool.** On the test server a runtime game's PLAYER
  mock refuses forces; its authoring twin (`/api/<key>/authoring/force?…`) allows them. A playtest
  must boot through an authoring link to force a beat.
- 2026-09-30 — **Phase 3 pacing:** an empty respin cell lands something 6% of the time. At 10%, Grand
  (letters that sweep their column, so the board never fills) ran 25+ respin features.
- 2026-09-30 — **Owner: a bonus is a different game mode, and modes must queue.** A bonus-game signal can switch to a completely different mode, and two modes can be queued up to play one after another. Measured: nothing like this exists today. There is only `gameType` = `basegame | freegame`, a flat FlowDoc, strictly ordered book events, no feature queue, and a free-spin-only resume. Planned as design §4.5 / **Phase 4M**: a mode registry, a mode stack with a nest-or-queue policy, `modeEnter`/`modeExit` with the free-spin events as aliases, per-mode flow graphs shown as tabs, a scene role `mode`, and a mode-aware resume. It is a shared-runtime change, so parity is the gate.
- 2026-09-30 — **Flights (things that travel from a cell to a target, e.g. coins/specials into pots): one `flyTo` primitive, planned in design §4.4.** It computes a Bézier route at runtime that bends around the cells showing a win. The trail is an `/fx` emitter following the moving head (the moving-owner mechanism already exists for Rigger bones). A cue fires on arrival. Authoring is a `flights` block in the Symbols doc. Phase 4 builds the primitive, Phase 7 the authoring, Phase 5 the flow action.
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
- 2026-09-30 — **Phase 1: the kind list lives in `constants-shared/gameKinds.ts`**, not engine-layout or game-spec. That package is dependency-free and already imported by the launcher, engine-layout and engine-flow-v2, so nothing gains a package→app import. game-spec gained the dependency. `gen-flow-vocabulary.mjs` now imports it and runs under `node --experimental-strip-types`, which CI's Lint job now passes.
- 2026-09-30 — **Phase 1: cluster/scatter projects never reach their own flow vocabularies.** Their starter flow is the bookOf seed, whose `templateId` is `bookOf`, so `CLUSTER_VOCAB`/`SCATTER_VOCAB` are registered but unused by any scaffolded project. Parity kept on purpose; it is a separate fix, outside this initiative.
- 2026-09-30 — **Phase 1: `kindCapabilities()` is wired only where it is a drop-in.** That means `/symbols` `visibleStatesFor` (book + cascade columns) and the `gameProfile` detectors (cascade, multiplier collect, expanding book, and the new "Hold and Win respins" chip). For every existing kind `freeSpins` and `stackedPictures` are `true`, the flags nothing gated before. `holdAndWin` has them `false`, but no tool reads them yet: Phases 6–8 do.
- 2026-09-30 — **Desktop builds are unverified for `holdAndWin`.** A desktop build of a `holdAndWin` project is stamped `protocol: 'holdAndWin'`. `resolveActiveMapping()` maps an unknown `PUBLIC_RGS_GAME` to the lines mapping, so that is safe. The desktop launcher's own (Python) handling of an unknown protocol was not checked.

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

1. **Phase 4 (engine runtime)** builds on the wire doc: facade identity mapping + `parseCell`
   jackpots, `gameType: 'respin'`, the §4.3 events. Force any beat with
   `/api/<key>/authoring/force?sid=<sid>&beat=<spec>` (wire doc, "Forcing a beat").
2. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2).
3. **A playtest playbook** per preset (Phase 9) can drive every beat through the force endpoint.

## Blocked (owner / external)

- **Partner Hold and Win wire format.** This blocks production RGS play only. Authoring and mock play are not blocked.

## Recent changes

- 2026-10-01 — **Phase 4a: the Hold and Win book-event contract** (session "Hold and Win Phase 4 —
  engine runtime"). The §4.3 events as typed arms of the shared runtime's union (payloads in
  `engine-game` `holdAndWin.ts`), `RawSymbol` `value`/`jackpot`/`factor`, the `HoldAndWinSnapshot`
  resume shape, state-only default handlers into `stateHoldAndWin`, `flightArrive` cue, regenerated
  flow vocabulary (20 book events + `flightArrive`; the codegen now resolves a `.ts` re-export from a
  package). No game changes: no RGS sends these events yet — the facade still passes the wire's
  Hold and Win events through as `_name` until 4b maps them. A runtime release on merge.

- 2026-09-30 — **Phase 3 merged (#924): mock RGS `holdAndWin` protocol + wire contract** (session "Hold and Win
  Phase 3 — mock RGS + wire").

  - `scripts/mock-rgs-server-holdandwin.mjs`: deals from `doc.holdAndWin` + symbols + paylines only
    (base game through the lines evaluator), all three presets — count / pattern / meter / Lucky Spin /
    random metre / buy triggers, `allCoins` and `collectorsOnly`, both reset rules and the cap, full
    board, column letters with clear, payer / multiplier (+ leave-behind, + jackpots) / collector /
    mystery (+ unlock) in `applyOrder`, active modifiers, the wheel, base-game instant collect,
    persistent meters per session (at boot, on every `play`, across a contract swap), resume + replay.
  - Forced outcomes for every beat: `play.context = "force:<spec>"`, the test server's
    `/api/<key>/force?sid=&beat=`, or `FORCE=`.
  - Test server: `holdAndWin` gets its own mock from the contract (`MOCK_FALLBACKS` removed); the
    launcher's mock contract carries `holdAndWinMockInputs(doc)` (new in game-config) for both the
    published and the authoring mock (`check:mock-contract` pins the split).
  - `pnpm check:holdandwin` (in `check:rgs` and `check:all`): 240 rounds per preset rebuilt cell by cell
    from the events and compared with the server's snapshot after every respin — counter, stickiness,
    special order, payout sums, meters, `seq`/`gid` — plus every forced beat, meters, resume/replay and
    close rules. Eight planted mock bugs each fail it.
  - game-spec's `SymbolKindSchema` now imports the Hold and Win roles from game-config (`jackpot`,
    `coinMultiplier`), closing the Phase 1/2 naming mismatch.
- 2026-09-30 — **Phase 2 merged (#919)** (session "Hold and Win Phase 2 — Game Config block").
  - `packages/game-config`: the `holdAndWin` block, its normalizer and validator, and the three presets
    `pots` / `classic` / `collector` (numbers per design §1.2).
  - Committed defaults: `data/gameConfig/holdAndWin.<preset>.json`. `holdAndWin` defaults to `pots`.
  - `/config`: a Hold and Win section and "Reset to preset", gated on `kindCapabilities().holdAndWin`.
  - Game Maker: ten profile detectors.
  - Left for later phases: nothing reads the block at runtime yet (Phase 4), the mock doesn't generate
    from it (Phase 3), and the roles aren't offered in `/symbols` (Phase 7).
  - **Role-name mismatch with Phase 1:** game-spec's `SymbolKindSchema` (#917) says `jackpotCoin` and
    reuses `multiplier`, while the config's `special_properties` roles are `jackpot` and
    `coinMultiplier`. Phase 7 (Symbols) should align game-spec to the config names.
- 2026-09-30 — **Phase 1: kind plumbing + `kindCapabilities()`** — merged as #917, a runtime release (session "Hold and Win Phase 1: register the kind everywhere").
  - **One kind list.** `GAME_KINDS` lives in `packages/constants-shared/gameKinds.ts`. These now derive from it: roles.ts (its copy removed), `kindStorage`, `projects.ts`, the editor template picker, game-spec `GameTypeSchema`, the publish gate, `verify-launcher-profile` and `gen-flow-vocabulary.mjs`, which gives lines' emitter vocab to every kind except cluster/scatter.
  - **`kindCapabilities(gameType, config?)`** is in `engine-layout`.
  - **game-spec symbol roles:** `coin`, `jackpotCoin`, `collector`, `payer`, `mystery`, `meterSpecial` and `blank` (`multiplier` already existed).
  - **Mock protocol:** `protocolFor('holdAndWin') = 'holdAndWin'`. It is in `MOCK_PROTOCOLS` (launcher, test server, the two publish scripts). The test server deals it with the lines mock through the named `MOCK_FALLBACKS`, and `mockContract` requires paylines for it as for lines.
  - **Flow fallbacks** are explicit and named (table above).
  - **Scene set:** a 5×3 engine-skeleton `holdAndWin` set ("Hold and Win") is in `FULL_SCENE_SOURCES`, so the Game Maker/admin picker offers it and the kind chip reads "Hold and Win".
  - **Left for later phases:** `TEMPLATES`, `SCENE_ROLE_LABELS`, `DRIVEN_SEEDS`/`TEMPLATE_VOCABULARIES` entries, config/symbol defaults and the runtime/facade.

- 2026-09-30 — **Owner decisions recorded** (one template / three presets, 3 Pots first, mock-first with a swap seam). Build plan re-cut: Phase 10 is now the partner wire and Phase 11 covers what goes beyond the three references.

- 2026-09-30 — **Plan and hub created** (session "Hold and win game pipeline").
  - Researched 3 Oaks *Grand*, *Super Hotfire Diamonds* and *3 Pots of Egypt* from their server config and rules strings.
  - Read the partner core's respin and jackpot handling.
  - Inventoried the engine: found the `apps/price` superspin loop.
  - Inventoried every tool's kind plumbing.
  - Wrote the design doc and this hub.
