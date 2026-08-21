# Game-type templates — a game type is data + a mechanic, not an app fork

> Status: living state in **[docs/status/engine.md](../status/engine.md)** (the extraction and the
> runtime) and **[docs/status/game-config.md](../status/game-config.md)** (the `winModel` schema).
> The authoring-kind work is tracked in [status/flow.md](../status/flow.md) and
> [status/editor.md](../status/editor.md). Read those for how far this plan got — this file is the
> plan, not the progress. Related: [invisible-game-config.md](invisible-game-config.md),
> [invisible-editor.md](invisible-editor.md), [games-deploy.md](games-deploy.md).

## Why this exists

The repo ships six upstream sample apps — `apps/{lines,cluster,ways,scatter,number-picker,price}` —
but only ONE of them has ever been developed. `apps/lines` carries the whole Invisible layer: the
flow-v2 interpreter, editor scenes, the symbols registry, the game-config resolver, the HUD, win
presentation, anticipation, live assets. Roughly 26k lines of it. `apps/ways`, `apps/cluster` and
`apps/scatter` are still vanilla upstream — a few thousand lines each, and none of that layer.

So "build a ways game" has exactly two obvious routes, and both are bad:

- **Develop `apps/ways` up to parity.** That is a second copy of 26k lines which then drifts from
  the first. This repo has already paid for that failure twice (the engine/tools/launcher split,
  and the frozen game-repo copy of `apps/lines/src`), and the shared `_runtime/lines` bundle exists
  precisely because per-game copies stop receiving fixes.
- **Fork `apps/lines` per type.** Same drift, with the added problem that every online project is
  served by one prebuilt runtime bundle, so a fork has nowhere to be served from.

The way out is to stop treating a game type as a folder. Almost everything in `apps/lines` is
type-agnostic — a reel board, a spin, a win count-up, a config resolver and a HUD are the same
machinery whether the game pays by lines, by ways, by cluster or by scatter. What actually differs
is (a) **how a win is decided**, which is data the project can state, and (b) a small **mechanic**
(the Book-of expanding special, a tumble board) that most types do not have at all.

## The shape

A game type becomes **`{ data, mechanic }`**:

- **Data** — the project's authored Game Config (symbols, strips, grid, and now the **win model**),
  its authored layout, its authored flow, its art. All of it already travels the live-asset chain
  and is read at runtime by the shared bundle.
- **Mechanic** — the small, genuinely type-specific code that stays in an app: the book-event
  handlers a type receives that others do not, its own components, its own symbol content.

Everything else — the type-agnostic ~80% of `apps/lines/src` — moves into **`packages/engine-game`**
so there is exactly one copy of it. `apps/lines` keeps its compiled config, i18n, routes, stories
and the `lines` mechanic.

Two constraints shape every phase below and are worth stating once:

1. **A package must never import from an app.** Every seam is therefore an _inversion_: the app
   stays the composition root and hands the engine what it needs, or hands it a type through
   declaration merging. There is no direction in which `engine-game` can reach back.
2. **Parity is the gate.** None of this is a feature; it is a rearrangement of code that a live
   game already runs. A slice is only acceptable if the shipped game is provably unchanged by it.

### How a slice is proved

Part of the plan, not an afterthought — the discipline is what makes a 26k-line rearrangement safe
to do incrementally:

- A **relocation** slice (code moves, nothing rewires) is proved by comparing the built bundle's
  MODULE SET and per-module content hashes (`scripts/bundle-modules.mjs`), not its bytes.
- A slice that changes runtime **wiring** is additionally booted against the mock RGS and compared
  on the live scene graph.
- A **contract** slice (schema, normalizer, runtime reads) is proved offline by the spikes in
  `tools/` — `game-config-spike run doc` for the doc contract, `run winmodel` for the runtime's read
  of it, `pnpm check:ways` for the mock protocol.
- Because `tools/` reaches into app source by relative path and nothing in `pnpm build` reads it,
  moving a module can leave those harnesses dead while every gate stays green.
  `pnpm check:path-imports` exists to catch exactly that.

The gate lessons learned while building it are recorded in
[status/engine.md](../status/engine.md), not here.

## Phase A — extract the engine layer

Lift the type-agnostic ~80% of `apps/lines/src` into `packages/engine-game`, one provable slice at a
time, with every call site in the app left untouched.

`engine-game` is deliberately a **source-entry** package (`main`/`types` point at `index.ts`, no
build step), like `components-pixi` and unlike `engine-layout`: a prebuilt `dist/` is what lets a
game bundle silently ship stale engine code, which has already cost this project a debugging
session.

The slices are ordered by how much they can be proved: leaves first, then the seams that cannot be a
pure move.

### Phase A0 — scaffold and the parity gate

Create the package, move a type-only slice through it, and build the verification the rest of the
phase depends on. Type-only first because it is the one slice whose emitted bundle can be compared
directly — it establishes the baseline before any real relocation reshuffles the graph.

### Phase A1 — the generic leaf modules

Move the modules with no app-ward imports at all: the win-level table, win ownership, the free-spin
counter values, and the runes wrappers that back authored value/text/signal sources. Rewrite the
import sites, and add **no shims** — a compatibility re-export would hide whether the move was
complete.

A leaf is defined by the real import graph, not by how generic the file reads. Three files that look
like leaves are not: `utils.ts` and `symbolMap.ts` reach the book-event handlers, the flow effects
and `../editor-scenes`; `constants.ts` is genuinely mixed. Those need splitting or a later slice
(A3.5 does one of them).

### Phase A2 — the context inversion

**This is the keystone, and it could not be a move.** The Svelte context is the thing every
component reads, so nothing else can migrate until it is available package-side. But four things in
it are bound to the app and cannot be generalised away:

- `eventEmitter` is typed by an event union whose game half is **assembled from the components**,
  mechanic events included, and the components rely on that exact typing;
- `stateApp` is built from this game's assets and its baked editor art;
- `stateLayout` carries this game's background ratios and main sizes;
- `stateGame` / `i18nDerived` are the app's own.

So the context is **inverted** rather than relocated: `createGameContext()` in the package owns the
_wiring_ — which Svelte context keys get set, and the exact shape and precedence of what
`getContext()` returns — while `apps/lines/src/game/context.ts` becomes a thin composition root that
builds the instances and passes them in. The factory is fully generic in the app's own types, so
nothing is widened or erased; the returned context is inferred.

This is the dependency inversion the extraction turned out to need, and it is **Phase B's mechanic
contract arriving early** — for state and events rather than for the win model. Phase A therefore
cannot fully precede Phase B, which is a deliberate change to the original ordering.

### Phase A3 — the package-side accessor, and the first components

A component that has moved into the package still needs the app's context with full typing. The seam
is `getGameContext()` plus **declaration merging**: the app writes
`declare module 'engine-game' { interface GameContext extends LinesContext {} }`. That is the only
direction available, given constraint 1.

Then move components. The set that can move is not "components that never mention the mechanic" — it
is the set **closed under sibling imports** that reaches no unmoved app module. Most components
still reach `stateGame`, `constants`, `utils`, `gameConfig`, `../editor-scenes` or the flow-v2
interpreter holder, so the queue is gated by the module slices below rather than by the components
themselves.

### Phase A3.5 — split `constants.ts`

`apps/lines/src/game/constants.ts` mixed two unrelated things: the engine's **feel knobs** (symbol
size, spine fill, reel padding, dim tint, the initial symbol state, the spin option presets) and
**this game's content** (its symbol/art bindings, stacked-picture map, scatter-land sounds). Only
the first half is shared by every game type, so only it moves.

The feel knobs stay shared constants rather than becoming another arm of the authored config,
because [invisible-game-config.md](invisible-game-config.md) already records that they rarely need
per-game values. A game type that genuinely needs its own belongs in the mechanic, not in a fork of
that file.

**Hard constraint the split creates:** the app's `constants.ts` now has ZERO imports and must keep
it that way. `apps/launcher-api/scripts/publish-symbol-defaults.mjs` imports it standalone under
Node type-stripping to read `SYMBOL_INFO_MAP`, and the `engine-game` barrel re-exports `.svelte`
components that type-stripping cannot parse — so a value import from the package would silently
break the symbol-defaults publish.

### Phase A4 — the board state

`stateGame` is the board and reel machinery: the board lattice, spin profiles, anticipation flags,
stacked-picture runs, the win-dim set. That machinery is identical for any reel game and is exactly
what a `ways` or `cluster` build would otherwise fork, so it becomes `createGameState(deps)`.

What is NOT the same, and is injected: where the grid comes from (the project's config), which
layout it measures against, and what a landing symbol sounds like. The last one is game content — it
hardcodes this game's symbol ids and cue names — and stays in the app.

Two rules the seam must respect:

- Types that depend on factory internals are **derived from the factory's return type** rather than
  re-declared, so they cannot drift from the board builder.
- The real risk is array **identity**, not typing: the enhanced board closes over the board array at
  module init and the rebuild splices rather than reassigns, so the factory must be called exactly
  once, at app module scope.

### Phase A5 — the config resolver

The `runtime → baked → compiled` resolution, its memo, the win-tier ladder, the board grid and the
config warnings are identical for every game type. Only the two **sources** differ per game — the
app's baked bundle and its compiled template — so those are the entire seam of
`createGameConfig(deps)`.

`getPaylines` / `getNumLines` / `paylineColor` move across **unchanged and still lines-shaped**, on
purpose: they are precisely what Phase C turns into an arm of the win model, and touching them here
would have cost the slice its provability. The `__IE_SERVER_CONFIG__` / `__IE_WIN_LEVELS__` globals
need nothing — they are deliberately decoupled bridges to the Play4Fun facade.

### What Phase A deliberately does not move

- **The mechanic components.** Roughly a dozen components in `apps/lines` are lines/book mechanic
  components — the expanding special, the book reveal, their gates. They must never move, so a raw
  "components remaining" count overstates how much of Phase A is left.
- **Bet mode and game type.** They stay bound to the compiled config, unlike the symbol vocabulary,
  so they stay in the app.
- **`utils` and `symbolMap`**, until `editor-scenes` and `assets` have seams of their own.

## Phase B — the mechanic contract

Once Phase A has lifted the shared layer, what remains in an app _is_ the mechanic. Phase B is the
definition of the seam between the two: the named set of things a game type must supply to the
engine, and the named set the engine gives back.

The contract has two halves.

- **State and events** — the per-game dependencies the board state and the config resolver need, the
  emitter event union (whose game half is assembled from the components), and the Svelte context
  itself. This half is what Phase A2 pulled forward, because the context could not be relocated
  without it.
- **Book events and presentation** — which book events a type receives, and what handling each one
  means. This half is what decides whether a candidate type is a _template_ at all: `lines`,
  `bookOf` and `ways` share one book-event union (a ways `BookEvent` union is a strict subset of
  lines', and its `winInfo` is identical field-for-field), which is why `ways` adds no mechanic. A
  type that introduces new board events is a new mechanic, not a template — see
  [Scoped out](#scoped-out--cluster-and-scatter-templates-will-not-be-built).

The contract is expressed as **injected deps plus declaration merging**, not as an abstract base
class or a registry of mechanic objects. The reasons are the two constraints above: a package cannot
import from an app, and the app must stay the composition root so the precise typing the components
already rely on survives the move instead of being widened to satisfy a shared interface.

What B still owes: the seam is currently discovered one slice at a time as a `deps` object per
factory, rather than declared once as a single mechanic interface. That is fine while `lines` is the
only mechanic; it becomes the thing to consolidate the moment a second one exists.

## Phase C — the config states how a game pays

Turn "game type" from an editor hint into something the project's config actually **states**, so the
runtime and the validator can both act on it.

`GameConfigDoc` gains a **`winModel`** discriminated union (`packages/game-config/src/types.ts`,
`winModel.ts`):

| arm       | fields                                                 | meaning                                    |
| --------- | ------------------------------------------------------ | ------------------------------------------ |
| `lines`   | _(none)_                                               | pays along declared paylines — the default |
| `ways`    | `direction` (`ltr` \| `both`), `minKind`               | pays on adjacent-reel participation        |
| `cluster` | `minCluster`, `adjacency` (`orthogonal` \| `diagonal`) | pays on connected groups                   |
| `scatter` | `minCount`                                             | pays on total count anywhere on the board  |

The decisions, and why they are what they are:

- **The `lines` arm carries no payline data.** The plan's first sketch had it own `paylines`. It does
  not, because `paylines`/`paylineColors` already live at the top level of the doc and moving them
  would have meant a real migration of every authored doc in R2 for no functional gain.
- **`lines` is the default and is never stored.** The normalizer _drops_ it. The invariant is "store
  only what departs from the default", and the payoff is that every config authored before this
  field existed normalizes **byte-identically** — not one stored doc is rewritten.
- **Read it through `resolveWinModel()`, never `doc.winModel`.** "Absent means lines" is a rule that
  gets re-implemented, and eventually mis-implemented, at every site that reads the raw field.
- **Validation follows the model.** A non-lines doc _skips_ the payline checks — that table is inert,
  not wrong, for a game that never reads it — and gets its own bounds checks instead (more adjacent
  reels than the grid is wide; a cluster bigger than the board). The generic symbol checks still run
  for every model.
- **Per-type defaults derive their minimum from the game's own paytable** rather than hardcoding it,
  because the two are the same fact: a cluster game whose smallest paying row is 5 has
  `minCluster: 5` by definition. Hardcoding lets the declared model drift from the payouts it
  describes.
- **The `/config` picker must mirror the normalizer.** Choosing Lines _deletes_ the field rather than
  writing `{type:'lines'}`; each other arm is seeded with exactly the defaults the normalizer would
  fill in. Otherwise the doc looks dirty, saves, and comes back changed.

## Phase D — the runtime honours the declared model

The config can now say how a game pays; Phase D is the engine acting on it. `activeWinModel()` is
the runtime's single read of the model, and every adaptation below keys off it in exactly one place.

**Payline-shaped surfaces stand down off-lines.**

- `getPaylines()` returns `[]`, so the info page draws no payline grid. Without this a ways game
  renders the RGS's `availablePayLines` as twenty diagrams for lines that decide nothing.
- `paylineColor()` returns `undefined` — gated inside the resolver rather than at its two call sites,
  so the rule has one home. A non-lines win's `meta.lineIndex` is not a payline id, and the ordinal
  mapping would otherwise colour a win from an unrelated line's swatch.
- **Anticipation stands down.** Reachability is computed _per payline_ — "could this reel still
  complete a paying run on some line". A ways board's remaining potential is a product of per-reel
  counts, not a walk along fixed rows: a genuinely different calculation, and feeding line maths a
  model it does not fit is how a tease goes quietly wrong. The guard is explicit rather than
  incidental (it would already degrade that way via the empty payline list) so it survives someone
  later "fixing" that list. Anticipation is opt-in per flow, so off is correct degradation, not a
  lost feature.

**The paytable's divisor follows the model.** Every non-scatter paytable row is priced against "what
one spin buys one of", which is a payline count only for a lines game. `payoutDivisor()` returns the
line count for `lines`, `activeWaysCount()` for `ways`, and `1` for `cluster`/`scatter` (their
multipliers apply to the whole bet — already how scatter-mode rows were priced). The ways analogue is
exact rather than invented: a spin buys every way, so the per-way stake is `totalBet / waysCount`
precisely as the per-line stake is `totalBet / numLines`. `activeWaysCount()` is the product of each
reel's visible rows read from the config, so a stepped or resized grid counts correctly instead of
assuming uniform — a 5×3 pays 243. `InfoManifest.numLines` keeps its name: the field is declared in
that contract, is only ever used as a divisor, and is never rendered as a label, which is what makes
repointing it safe.

**The win line's shape comes from the model, not from counting reels.** `winLineShapeFor()` picks one
of three shapes, because a duplicate reel means something different in each model:

| model                 | shape                                        | drawn as                                                                             |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lines`               | duplicate-reel heuristic → `path` or `cells` | the connected polyline; `cells` only for an expanding special that fills whole reels |
| `ways`                | `reels`                                      | one merged bar per winning reel, spanning that reel's winning cells                  |
| `cluster` / `scatter` | `cells`                                      | a bar per paying cell — now stated rather than inferred                              |

A ways win pays by whole-reel participation, so the reel is the readable unit; cells on one reel join
into a single bar even when they are not adjacent. The duplicate-reel heuristic survives only inside
the `lines` arm, which is the case it was written for.

**The serving side.** A `ways` project is dealt by the **lines mock with its ways evaluator** — a
`winModel` option, not a third forked mock — because the two differ only in how a win is decided;
session, seq, round lifecycle, the scatter pass and the event vocabulary are identical. The
load-bearing wire detail: a ways win covers several cells per reel, which a payline cannot express,
so positions travel as a **flat `{reel,row}` array** (the facade reads a bare array or
`context.payline`; an object wrapper yields no positions, and the win would pay while lighting up
nothing).

**Every game type shares ONE runtime bundle** — a decision, not a gap, and it replaces an earlier
"add a runtime per type" TODO that Phase D found to be the wrong shape. `runtime-release.yml` builds
a runtime FROM `apps/<id>`, so a `_runtime/ways` would be built from vanilla `apps/ways`: no flow-v2
interpreter, no editor scenes, no symbols registry, no config resolver. It cannot consume a runtime
bundle at all, so pointing a ways project at it would not give that project a ways game — it would
break it. The shared bundle adapts instead, via everything above. The bundle id stays `lines` for
compatibility; the name is historical and means "the shared engine runtime". Revisit per-type bundles
only for a type that needs bespoke COMPILED code the shared bundle cannot carry.

**What Phase D still owes:** the engine READS the model but does not yet **evaluate** a non-lines win
— it presents whatever the RGS reports. A project can therefore declare itself ways, validate as ways
and be dealt ways wins by the mock, and still be _played_ as lines by the client. The config resolver
says exactly that at boot rather than letting the symptom (line wins on a ways config) look like a
math bug. Closing this is the phase's real gate, together with a ways project actually published and
played end-to-end.

## Phase E — a game type as a first-class authoring kind

A type that the runtime can play is still not a type an owner can BUILD. Every authoring surface is
keyed by the project's game type, and each one falls back to something wrong when the type is
unregistered:

- **The editor slot template** (`GameTemplate`) — without one, a project resolves no template at all,
  so the editor surfaces no named drop targets and the launcher has nothing to seed or validate
  against.
- **The `/flow` emitter vocabulary** — without an entry, a project gets the generic default instead of
  the real cue list, and its codegen palette drifts.
- **The `/flow-v2` node vocabulary and its starter seed** — the vocabulary falls back to the Book-of
  contract, so a project is offered book surfaces its book events never fire and a symbol set it does
  not deal; the seed then opens the canvas on validation errors over beats the runtime would never
  send.
- **A FILLED (art-bearing) reference layout** — without one, a project scaffolds from a bare skeleton
  and is not offered in "Import composed reference". Cheaper than it looks when the type shares the
  reference art: it is the same generator, told a second game type.

The design rule for all four is **split, don't copy**. The screen set is a property of the RUNTIME,
not of how a game pays, and the flow vocabulary was already the shared runtime's surface transcribed
verbatim — so the shared part becomes a parameterised builder (`standardTemplate(gameType)`,
`standardVocabulary({ templateId, symbolNames })`, and a seed projected onto a target vocabulary),
and the type that genuinely has a mechanic splices its own surfaces back in at the positions authors
navigate by. Each builder returns a fresh object per call, so composing one type's palette can never
mutate another's. Copying instead would produce parallel scene lists and palettes that could only
drift.

The safety argument here is again byte-identity: these modules produce Book of Borut's shipped flow
document, so the existing `bookOf` values must serialize unchanged after the split.

Where it stands: **Phase E is complete on `main`** — the slot template, `/flow` palette, `/flow-v2`
vocabulary and per-template seed (#361–#364), and the FILLED reference layout (#367).

The fourth surface resolved more cheaply than this plan assumed, and the assumption is worth
recording because it was wrong for a day: the filled layout was believed to be blocked on ways art
that did not exist. It did exist. `apps/ways` and `apps/lines` ship byte-identical `reelsFrame`
atlases — the same eight frames with the same source rectangles — on top of the same 5x3@120 board.
So "split, don't copy" applied here too: `defaultLayout` stopped hardcoding `'lines'` rather than a
second generator being written, and the ONE thing that varies is the `specialBook` scene, which a
type without the expanding-symbol mechanic omits. Believing a blocker instead of checking it is the
cost this paragraph is meant to stop the next person paying.

The detail is owned by [status/flow.md](../status/flow.md) and [status/editor.md](../status/editor.md).

## Phase F — the cascade mechanic (`cluster`)

**Owner decision, 2026-08-20**, reversing the 2026-08-19 scope-out below. The analysis that produced
that decision was right about the SHAPE — a cascade is a board mechanic, not a template — and wrong
about the cost. Reading the reference implementation rather than its event list showed why:

- **The tumble is an OVERLAY, not a change to the board.** `TumbleBoard` mounts for the duration of a
  cascade and unmounts again: `boardHide` → show → explode → remove → slide → `boardSettle` →
  `boardShow`. A game that never tumbles never mounts it. That seam is what let the mechanic land in
  the shared runtime without putting its risk on lines or book-of.
- **`explosion` is already an authorable symbol state.** It has been in `SYMBOL_STATES` all along and
  is not gated as book-only, so a cascade's defining animation is authored in `/symbols` like any
  other state. The mechanic needed no symbol tooling of its own.

**Phases 1–2 are on `main`:** the tumble state and overlay, three book events (`tumbleBoard`,
`updateTumbleWin`, `updateGlobalMult`) and their handlers, seven cues in the regenerated `/flow`
palette, and a registered `/flow-v2` `cluster` vocabulary that is the standard palette plus exactly
the cascade surfaces.

One thing did NOT port: the reference game seats symbols at `(index + 0.5) * SYMBOL_SIZE`, which this
runtime outgrew when the reel grid became authorable (row pitch, lead, per-cell alignment, nudge). A
cascade must drop a symbol onto the SAME seat a settled reel would give it, so `getSymbolY` was added
beside `getSymbolX` as the shared resting-seat expression — the one `createReelForSpinning` already
computes — and the tumble reads it. Matching a constant would have worked until the first project
resized its grid.

**What Phase F still owes**, and why a cluster game cannot yet be published:

1. **The wire.** No RGS the engine talks to sends `tumbleBoard`. (Since 2026-08-21 the test
   server's own fixture DOES, by default, for `cluster`/`scatter` — a project can also state
   `cascade` in its Game Config. That makes the mechanic exercisable; it does not make the wire
   captured, and the paragraph below still holds for a real provider.) Both mocks speak the Play4Fun
   vocabulary and `stakeFacade` translates it, and every piece of that stack was verified against a
   real capture. There is no capture of a cascade game, so the wire representation would be INVENTED
   rather than transcribed — then implemented twice (mock generation, facade translation), and
   discovered wrong the first time a real provider sends one. Held deliberately: get a capture first
   if the game comes from a provider; if the math is ours, the wire is ours to define.
2. **The math.** `apps/cluster` ships empty-placeholder `paddingReels`, so there is no committed
   config default to seed a project from — the same gap as the ways math export, one step worse.
   Cascade RTP is chain-dependent, so the ways verifier does not cover it either.
3. **`scatter` phases 1–2 are on `main` too** (2026-08-20). It cost roughly a third of cluster,
   which is the prediction the shared-core argument was making: scatter is the cascade PLUS a
   multiplier collect, so `SCATTER_VOCAB` is built ON `CLUSTER_VOCAB` rather than beside it, and the
   only new surfaces are `boardMultiplierInfo` and six cues. Two things fell out of the reference
   rather than being written: `stateGame.multiplierBoard` was ALREADY in the shared board state from
   the Phase A extraction — scatter's model, lifted and then left with no consumer — and the collect
   test became `RawSymbol.multiplier !== undefined` instead of the reference's hardcoded
   `name === 'M'`, which would have collected nothing in a project that renamed its symbol.

   It shares cluster's blockers exactly (no wire, no capture), and is one step better off in one
   respect: it ships a committed config default (`gameConfig/scatter.json`), where cluster's upstream
   strips are empty placeholders.

   **The collect beat has a wire as of 2026-08-21** (`multiplierCollect` → `boardMultiplierInfo`),
   on the same terms as `tumbleStep`: ours, fixture-only, labelled at both ends, to be REPLACED by
   a real provider's shape rather than bent to fit. Scatter is therefore exercisable end to end —
   tumble AND collect — while the capture blocker is unchanged.

## Scoped out — the 2026-08-19 decision (superseded for `cluster` by Phase F)

**Owner decision, 2026-08-19.** Neither template will be built, and the reason is structural rather
than a matter of priority.

Both upstream apps are **tumble/cascade** games. Their book-event unions carry events the shared
runtime has never had: `tumbleBoard`, `updateTumbleWin` and `updateGlobalMult` in both, plus
`updateGrid` in `cluster` and `boardMultiplierInfo` in `scatter`. A tumble board removes winning
symbols, drops the survivors, refills and re-evaluates — a different board lifecycle, not a different
way of reading the same settled board. By the Phase B test that makes them **a new board mechanic,
not a template**, so they fall outside this plan.

What they keep: their win models stay **declared** in `game-config` (the union has `cluster` and
`scatter` arms, and both validate) and are **correctly priced** (divisor 1 — their multipliers apply
to the whole bet). A project can state that it is a cluster game and be paid correctly by the
paytable; it simply has no template to build from.

`cluster` also cannot ship a config default at all today: its upstream sample config has
empty-placeholder `paddingReels`, and the strips are the in-play gate, so a config without them would
seed every new project of that type with a blank board.

If a tumble game is ever wanted, the route is a **mechanic** — the first genuine candidate for a
per-type bundle with bespoke compiled code, which is the one case Phase D left open.

## What is left

The honest list of what this plan has not delivered, in the order it matters:

1. **A ways project published and played end-to-end.** The Phase D gate. Everything else is verified
   offline or against the mock.
2. **Cluster/scatter presentation in the client.** `ways` is now honoured everywhere the client reads
   the model — priced per way (#357), drawn as merged per-reel bars (#360), and, as of
   `createWaysReach`, teased by reel anticipation with a reach that converges on the board's real
   payout. `cluster`/`scatter` remain declaration-only: every model-aware surface falls back to line
   behaviour, and the boot warning now names only those two. Closing them is a board MECHANIC
   (tumble/cascade), not a reach implementation — see the scoped-out section above.

   Worth knowing: the client still never DETERMINES wins. It receives `winInfo` with positions from
   the RGS. The only place it evaluates a board is anticipation, which is why that was the whole of
   the work here.

3. **The remaining Phase A slices** — `utils` and `symbolMap`, which need `editor-scenes` and
   `assets` seams of their own, and the components gated behind them.
4. **A real math export for `apps/ways`.** Its strips are cosmetic and evenly weighted. Legitimate for
   a client that never computes wins, but a ways default currently seeds a plausible-looking board
   whose symbol frequencies mean nothing — not fine shipped for money.

   The export itself has to come from a math engine; authoring frequencies in a client repo would be
   fabricating game math, which is exactly what `apps/ways/src/game/config.ts` says it is refusing to
   do. What DOES exist now is the check that receives one: `pnpm --filter game-config-spike run
waysmath` deals boards off any doc's strips, scores them with the engine's ways rule and reports
   RTP, hit rate, scatter-trigger rate and per-symbol contribution — so an arriving export can be
   held against what the provider claims, instead of being trusted. Run against the current
   placeholder it reports the state plainly: **0.13% RTP against a declared 0.97**, a scatter trigger
   on **1 board in 6**, and a declared wild that never appears on a strip and so can never land.
   `waysCrosscheck` pins the scorer to `mock-rgs-server`'s `evaluateWays` over 40,000 boards, so the
   measurement describes the engine's rule rather than a second opinion about it.
