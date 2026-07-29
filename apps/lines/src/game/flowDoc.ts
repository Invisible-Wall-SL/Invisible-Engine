/**
 * Invisible Flow — the COMPLETE apps/lines FlowDoc (Phase 5, design doc §7, §9 row 5).
 *
 * This authors the WHOLE apps/lines presentation flow as a declarative FlowDoc: the
 * `basegame` screen node (so the interpreter's generic mounter owns its mount, resolving the
 * above-reel z-order follow-up — see Game.svelte) plus a per-book-event choreography for
 * EVERY event in `bookEventHandlerMap.ts`. When this doc is loaded (via the
 * `window.__IE_FLOW_DOC__` dev hook today; the baked `flow` slot in Phase 6), the game runs
 * ENTIRELY through the interpreter and must match the coded path byte-for-byte.
 *
 * Authoring discipline (parity by construction, §7):
 *  - a coded `eventEmitter.broadcast({type})` ⇒ a Broadcast node (sync);
 *  - an AWAITED `eventEmitter.broadcastAsync({type})` ⇒ Broadcast `{ async: true, await: true }`;
 *  - a FIRE-AND-FORGET `eventEmitter.broadcastAsync({type})` (no `await`) ⇒
 *    Broadcast `{ async: true, await: false }` — the §11.1 three-way split;
 *  - an `await waitForTimeout(ms)` ⇒ a Delay node (the executor divides by `timeScale()`);
 *  - a serial `sequence(list, …)` ⇒ ForEach `{ mode: 'sequence' }`;
 *  - any NON-emitter leaf (state mutation, board op, conditional sound cluster, the resume
 *    snapshot) ⇒ an `effect` node whose body lives in `flowEffects.ts` (lifted verbatim from
 *    the coded handler — so it is identical by construction, not re-derived).
 *
 * The choreography ORDER below is read straight off `bookEventHandlerMap.ts`. Each event's
 * comment cites the coded handler it mirrors.
 */

import type { ChoreographyNode, FlowDoc, FlowGuard, FlowPayload } from 'engine-flow';

// ---------------------------------------------------------------------------
// Small authoring helpers (keep the tree readable; they emit plain FlowDoc nodes).
// ---------------------------------------------------------------------------

/** A synchronous `eventEmitter.broadcast({ type, ...payload })`. */
const broadcast = (event: string, payload?: FlowPayload): ChoreographyNode => ({
	kind: 'broadcast',
	event,
	...(payload ? { payload } : {}),
});

/** An AWAITED `eventEmitter.broadcastAsync({ type, ... })` — blocks the sequence. */
const broadcastAwait = (event: string, payload?: FlowPayload): ChoreographyNode => ({
	kind: 'broadcast',
	event,
	async: true,
	await: true,
	...(payload ? { payload } : {}),
});

/** A named game-side effect (`flowEffects.ts`). */
const effect = (name: string, payload?: FlowPayload): ChoreographyNode => ({
	kind: 'effect',
	name,
	...(payload ? { payload } : {}),
});

const lit = (value: string | number | boolean) => ({ kind: 'literal' as const, value });
const trigger = (path: string) => ({ kind: 'trigger' as const, path });
const item = (path: string) => ({ kind: 'item' as const, path });
const context = (path: string) => ({ kind: 'context' as const, path });
const engine = (key: string) => ({ kind: 'engine' as const, key });
const seq = (...children: ChoreographyNode[]): ChoreographyNode => ({ kind: 'sequence', children });

// ---------------------------------------------------------------------------
// Per-event choreographies — one per `bookEventHandlerMap.ts` entry, in handler order.
// ---------------------------------------------------------------------------

/** `reveal` — bonus record + awaited board spin (effect), then clear the scatter counter sound. */
const revealChoreography: ChoreographyNode = seq(
	effect('revealBoard', {
		bookEvent: trigger(''),
		bookEvents: context('bookEvents'),
	}),
	broadcast('soundScatterCounterClear'),
);

/** `winInfo` — a win level sfx, then a serial ForEach over `$trigger.wins`, each animating
 *  its positions (boardShow + awaited boardWithAnimateSymbols = the `animateSymbols` leaf) and
 *  showing a transient "You win $X with N Bananas" toast for that win (the generic `showMessage`
 *  effect; text assembled in `flowEffects.ts` from the win's `win`/`kind`/`symbol`). */
const winInfoChoreography: ChoreographyNode = seq(
	broadcast('soundOnce', { name: lit('sfx_winlevel_small') }),
	{
		kind: 'forEach',
		list: trigger('wins'),
		mode: 'sequence',
		body: seq(
			broadcast('boardShow'),
			broadcastAwait('boardWithAnimateSymbols', { symbolPositions: item('positions') }),
			effect('showMessage', {
				amount: item('win'),
				kind: item('kind'),
				symbol: item('symbol'),
				messageKind: lit('win'),
			}),
		),
	},
);

/** `setTotalWin` — set the win-meter amount. */
const setTotalWinChoreography: ChoreographyNode = effect('setWinBookEventAmount', {
	amount: trigger('amount'),
});

/** `setExpandingSymbol` — set the special symbol, then await the reveal spine. */
const setExpandingSymbolChoreography: ChoreographyNode = seq(
	effect('setSpecialSymbol', { symbol: trigger('symbol') }),
	broadcastAwait('specialBookReveal', { symbol: trigger('symbol') }),
);

/** `expandBookColumns` — the scatter sfx, then the awaited per-cell column morph (effect). */
const expandBookColumnsChoreography: ChoreographyNode = seq(
	broadcast('soundOnce', { name: lit('sfx_scatter_win_v2') }),
	effect('expandBookColumns', { symbol: trigger('symbol'), reels: trigger('reels') }),
);

/** `freeSpinTrigger` — scatter animation, the intro show + count set, then the counter show. */
const freeSpinTriggerChoreography: ChoreographyNode = seq(
	// animate scatters
	broadcast('soundOnce', { name: lit('sfx_scatter_win_v2') }),
	broadcast('boardShow'),
	broadcastAwait('boardWithAnimateSymbols', { symbolPositions: trigger('positions') }),
	// show free spin intro
	broadcast('soundOnce', { name: lit('sfx_superfreespin') }),
	broadcastAwait('uiHide'),
	broadcastAwait('transition'),
	// Set the awarded-count BEFORE the intro shows.
	effect('setFreeSpinCounterTotal', { total: trigger('totalFs') }),
	broadcast('freeSpinIntroShow'),
	effect('freeSpinIntroShow'),
	broadcast('soundOnce', { name: lit('jng_intro_fs') }),
	broadcast('soundMusic', { name: lit('bgm_freespin') }),
	broadcastAwait('freeSpinIntroUpdate', { totalFreeSpins: trigger('totalFs') }),
	effect('setFreeGameType'),
	broadcast('freeSpinIntroHide'),
	effect('freeSpinIntroHide'),
	broadcast('boardFrameGlowShow'),
	broadcast('freeSpinCounterShow'),
	effect('freeSpinCounterShow'),
	broadcast('freeSpinCounterUpdate', { total: trigger('totalFs') }),
	effect('setFreeSpinCounterTotalOnly', { total: trigger('totalFs') }),
	broadcastAwait('uiShow'),
	broadcastAwait('drawerButtonShow'),
	broadcast('drawerFold'),
);

/** `updateFreeSpin` — show the counter + update its current/total. */
const updateFreeSpinChoreography: ChoreographyNode = seq(
	broadcast('freeSpinCounterShow'),
	effect('freeSpinCounterShow'),
	effect('freeSpinCounterUpdate', { amount: trigger('amount'), total: trigger('total') }),
	effect('updateFreeSpinCounter', { amount: trigger('amount'), total: trigger('total') }),
);

/** `freeSpinEnd` — the outro count-up with its win-level sound bookends, then the cleanup. */
const freeSpinEndChoreography: ChoreographyNode = seq(
	broadcastAwait('uiHide'),
	effect('enterFreeSpinOutro'),
	broadcast('boardFrameGlowHide'),
	broadcast('freeSpinOutroShow'),
	broadcast('soundOnce', { name: lit('sfx_youwon_panel') }),
	effect('winLevelSoundsPlay', { winLevel: trigger('winLevel') }),
	effect('freeSpinOutroCountUp', { amount: trigger('amount'), winLevel: trigger('winLevel') }),
	effect('winLevelSoundsStop'),
	broadcast('freeSpinOutroHide'),
	broadcast('freeSpinCounterHide'),
	broadcast('specialBookHide'),
	effect('exitFreeSpinOutro'),
	broadcastAwait('transition'),
	broadcastAwait('uiShow'),
	broadcastAwait('drawerUnfold'),
	broadcast('drawerButtonHide'),
);

/** `setWin` — the win panel show + awaited count-up with win-level sound bookends, then hide. */
const setWinChoreography: ChoreographyNode = seq(
	broadcast('winShow'),
	effect('winShow', { winLevel: trigger('winLevel') }),
	effect('winLevelSoundsPlay', { winLevel: trigger('winLevel') }),
	effect('winUpdate', { amount: trigger('amount'), winLevel: trigger('winLevel') }),
	effect('winLevelSoundsStop'),
	broadcast('winHide'),
	effect('winHide'),
);

// `finalWin` is a no-op in the coded handler — we DELIBERATELY leave it UN-authored so it
// falls through to its coded (no-op) handler, proving the fall-through path stays live during
// migration (§7). Authoring it as an empty choreography would also be parity-correct, but
// leaving it out keeps the fall-through exercised end-to-end.

// `createBonusSnapshot` (resume-only, §11.5 follow-up B.2) replays the reserved book events
// through the play path. It is intentionally LEFT to its coded handler (it calls back into
// `playBookEvent`, which already routes through the interpreter when active — so the replayed
// `freeSpinTrigger`/`updateFreeSpin`/`setTotalWin` get the SAME authored choreography). See
// the resume parity check in the harness; authoring snapshot itself as choreography would
// duplicate the `_.findLast` selection logic, which is exactly the bounded-VM line we don't
// cross. Fall-through here is the faithful, minimal change.

// ---------------------------------------------------------------------------
// The basegame screen node — the ONE authored exclusive screen (§5). Authoring it makes the
// interpreter's generic mounter own the basegame mount, which is what lets the above-reel
// z-order be reproduced (Game.svelte renders below-reel + above-reel passes around the board
// even when authored — the Phase-5 B.1 fix). No enter/exit choreography: the basegame's
// presentation is entirely the per-event choreographies above + feed-driven overlays (§5
// "feed-driven overlays are NOT nodes"). The free-spin intro/outro/counter/specialBook/win
// are overlays gated by `visibleSource`, not exclusive screen swaps, so they are NOT screen
// nodes — they stay feed-driven, exactly as coded.
// ---------------------------------------------------------------------------

export const LINES_FLOW_DOC: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [{ id: 'basegame', initial: true }],
	transitions: [],
	events: [
		{ event: 'reveal', choreography: revealChoreography },
		{ event: 'winInfo', choreography: winInfoChoreography },
		{ event: 'setTotalWin', choreography: setTotalWinChoreography },
		{ event: 'setExpandingSymbol', choreography: setExpandingSymbolChoreography },
		{ event: 'expandBookColumns', choreography: expandBookColumnsChoreography },
		{ event: 'freeSpinTrigger', choreography: freeSpinTriggerChoreography },
		{ event: 'updateFreeSpin', choreography: updateFreeSpinChoreography },
		{ event: 'freeSpinEnd', choreography: freeSpinEndChoreography },
		{ event: 'setWin', choreography: setWinChoreography },
	],
};

// ---------------------------------------------------------------------------
// Phase 1 (flow-driven-game §1) — the loading→basegame entry-leg fixture.
//
// A SEPARATE committed fixture (NOT folded into `LINES_FLOW_DOC`, which authors only
// `basegame` so the default boot stays parity-inert, §7). It promotes the loading splash to
// a Flow screen node (`loading`, `initial: true`) and authors a `complete` edge to
// `basegame`, fired by the existing tap-to-continue overlay (`TapToContinue.svelte` →
// `completeActiveScreen()`). The asset-load gate is unchanged: the tap only arms after the
// coded `<LoadingScreen>` press-to-continue appears (gated on `stateApp.loaded`).
//
// Reached ONLY via the dev hook `window.__IE_FLOW_LOADING__` (see `flowRuntime.svelte.ts`),
// never on a normal boot — so the default game is byte-identical to current `main`. The
// `basegame` node + per-event choreographies are reused from `LINES_FLOW_DOC` so this fixture
// drives the full game, not just the entry leg.
// ---------------------------------------------------------------------------

/** A small enter/exit choreography so the swap's order is observable in the harness (and a
 *  hook for real loading/basegame intro beats later). Mirrors the coded transition feel via
 *  the emitter `transition` event the coded `<LoadingScreen>` shell already broadcasts. */
const loadingExitChoreography: ChoreographyNode = broadcast('flowLoadingExit');
const basegameEnterChoreography: ChoreographyNode = broadcast('flowBasegameEnter');

export const LINES_FLOW_LOADING_DOC: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'loading', initial: true, choreography: { exit: loadingExitChoreography } },
		{ id: 'basegame', choreography: { enter: basegameEnterChoreography } },
	],
	transitions: [
		{ id: 'loading→basegame', from: 'loading', to: 'basegame', trigger: { kind: 'complete' } },
	],
	events: LINES_FLOW_DOC.events,
};

// ---------------------------------------------------------------------------
// Phase 2 (flow-driven-game §2) — author win-presentation TRANSITIONS (the win-branch leg).
//
// A SEPARATE committed fixture (NOT folded into `LINES_FLOW_DOC`, which authors zero
// transitions so the default boot stays parity-inert, §7). Reached ONLY via the dev hook
// `window.__IE_FLOW_WIN__` (see `flowRuntime.svelte.ts`), never on a normal boot.
//
// The owner-approved "recommended split" (§2):
//  - BIG win + FREE-SPIN INTRO celebrations TAKE OVER the screen ⇒ they become EXCLUSIVE
//    Flow screen nodes (`bigWin`, `freeSpinIntro`), reached by a guarded `bookEvent`
//    transition out of `basegame`. The presentation is lifted VERBATIM into the screen's
//    `enter` choreography (identical by construction, not re-derived).
//  - SMALL / idle win READOUTS stay FEED-DRIVEN overlays — they keep presenting via the
//    `setWin` EVENT choreography (the overlay show/update/hide, exactly as coded).
//
// Avoiding double-presentation (the §6.1 orthogonality crux): `dispatchBookEvent` runs the
// event choreography AND fires a `bookEvent` transition INDEPENDENTLY (interpreter.ts). So
// the fixture's `setWin` EVENT choreography is BRANCHED on the win tier — a BIG win runs a
// no-op (the `basegame→bigWin` transition + `bigWin.enter` owns the presentation), a SMALL
// win runs the overlay presentation (no transition fires — the guard rejects it). The
// `freeSpinTrigger` EVENT is removed entirely (the `freeSpinIntro` screen owns it). Exactly
// one path presents per case.
// ---------------------------------------------------------------------------

/** The `winLevel` numbers whose `winLevelMap` `type === 'big'` (levels 6–10: BIG/SUPER/MEGA/
 *  EPIC/MAX WIN). The SINGLE source of truth shared by the `basegame→bigWin` transition guard
 *  AND the `setWin` event-choreography branch, so the two never diverge. `setWin.winLevel` is
 *  a number (`typesBookEvent.ts`), so the tier test is a numeric `in` membership. */
const BIG_WIN_LEVELS = [6, 7, 8, 9, 10];

/** Guard: the triggering `setWin` payload's `winLevel` is in the big-win tier (6–10). */
const bigWinGuard: FlowGuard = {
	all: [
		{
			left: trigger('winLevel'),
			op: 'in',
			right: lit(BIG_WIN_LEVELS),
		},
	],
};

/** The fixture's `setWin` EVENT choreography — feed-driven overlay for SMALL wins only.
 *  Branched on the big-win tier: BIG ⇒ no-op (`bigWin.enter` owns it via the screen swap);
 *  otherwise ⇒ the lifted small-win overlay presentation (`setWinChoreography`, verbatim). */
const setWinBranchedChoreography: ChoreographyNode = {
	kind: 'branch',
	guard: bigWinGuard,
	then: seq(), // BIG win ⇒ the screen swap presents; the overlay path is a no-op (no double-fire).
	otherwise: setWinChoreography, // SMALL win ⇒ the feed-driven overlay (exactly as coded).
};

/** The fixture's `freeSpinTrigger` EVENT choreography — a NO-OP. EVERY `freeSpinTrigger`
 *  swaps to the `freeSpinIntro` screen, whose `enter` owns the presentation. This MUST stay an
 *  authored (no-op) event, NOT be dropped from `events`: a dropped event falls THROUGH to the
 *  coded `bookEventHandlerMap.freeSpinTrigger` (the full intro presentation) which, together
 *  with the screen swap's `enter` (the same presentation), would DOUBLE-present (§6.1 — the
 *  dispatch + transition are orthogonal). The no-op event is the same no-double-fire discipline
 *  the big-win `setWin` branch uses. */
const freeSpinTriggerNoopChoreography: ChoreographyNode = seq();

export const LINES_FLOW_WIN_DOC: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'basegame', initial: true },
		// The big-win celebration screen — its ENTER is the lifted `setWin` presentation VERBATIM.
		{ id: 'bigWin', choreography: { enter: setWinChoreography } },
		// The free-spin-intro screen — its ENTER is the lifted `freeSpinTrigger` presentation VERBATIM.
		{ id: 'freeSpinIntro', choreography: { enter: freeSpinTriggerChoreography } },
	],
	transitions: [
		// BIG win ⇒ swap to the bigWin screen (its `enter` presents); the tap returns.
		{
			id: 'basegame→bigWin',
			from: 'basegame',
			to: 'bigWin',
			trigger: { kind: 'bookEvent', event: 'setWin' },
			guard: bigWinGuard,
		},
		{ id: 'bigWin→basegame', from: 'bigWin', to: 'basegame', trigger: { kind: 'complete' } },
		// Free-spin trigger ⇒ swap to the freeSpinIntro screen (its `enter` presents); tap returns.
		{
			id: 'basegame→freeSpinIntro',
			from: 'basegame',
			to: 'freeSpinIntro',
			trigger: { kind: 'bookEvent', event: 'freeSpinTrigger' },
		},
		{
			id: 'freeSpinIntro→basegame',
			from: 'freeSpinIntro',
			to: 'basegame',
			trigger: { kind: 'complete' },
		},
	],
	// Reuse the full per-event choreographies for a realistic flow, overriding only the win
	// moments: `setWin` is BRANCHED (small overlay vs big no-op) and `freeSpinTrigger` is
	// authored as a NO-OP (the `freeSpinIntro` screen owns its presentation via the transition +
	// `enter`). Both win events stay AUTHORED — never dropped — so dispatch never falls through
	// to their coded handler and double-presents alongside the screen swap (§6.1 orthogonality).
	events: [
		...LINES_FLOW_DOC.events.filter((e) => e.event !== 'setWin' && e.event !== 'freeSpinTrigger'),
		{ event: 'setWin', choreography: setWinBranchedChoreography },
		{ event: 'freeSpinTrigger', choreography: freeSpinTriggerNoopChoreography },
	],
};

// ---------------------------------------------------------------------------
// Phase 3 (flow-driven-game §3) — REVIVE engine-state transitions (state-driven branching).
//
// A SEPARATE committed fixture (NOT folded into `LINES_FLOW_DOC`, which authors zero
// transitions so the default boot stays parity-inert, §7). Reached ONLY via the dev hook
// `window.__IE_FLOW_COND__` (see `flowRuntime.svelte.ts`), never on a normal boot.
//
// It demonstrates the `condition` trigger — the leg that was DEAD before Phase 3 (no app
// injected an `$engine` reader, so `$engine.*` guards resolved `undefined`, and no app ever
// called `interpreter.evaluate()`). Now `createLinesFlow` injects the bounded `linesEngineReader`
// AND `Game.svelte` pings `flow.evaluate()` whenever an exposed engine value changes, so a
// `condition` edge re-checks its `$engine.*` guard on a LIVE state change (not a book-event
// payload — that is the `bookEvent` trigger, Phase 2).
//
// The graph (active-SET model): `basegame` --condition `$engine.freeSpinsRemaining >= 1`-->
// `freeGame`, which LAYERS the free game over the persistent base (condition edges layer, they do
// not swap). The counter is LIVE engine state (`stateUi.freeSpinCounterTotal/Current`, the same
// fields the `freeSpins` value feed reads), so `freeGame` activates when the counter crosses the
// threshold and `evaluate()` is pinged. The RETURN is a `complete` HANDOFF — `freeGame` fires its
// own Complete pin (`completeActiveScreen()`) once the free game ends, which dismisses it and
// leaves the persistent base. (Under the active-set model a screen leaves only by its Complete pin;
// a condition-return onto the still-active base would be a layer no-op.) The `basegame` per-event
// choreographies are reused for a realistic flow.
// ---------------------------------------------------------------------------

/** Guard: the LIVE engine free-spins-remaining counter has at least one spin left (free game on). */
const freeGameActiveGuard: FlowGuard = {
	all: [{ left: engine('freeSpinsRemaining'), op: 'gte', right: lit(1) }],
};

/** Small enter/exit beats so the layer + handoff order is observable in the harness. */
const freeGameEnterChoreography: ChoreographyNode = broadcast('flowFreeGameEnter');
const freeGameExitChoreography: ChoreographyNode = broadcast('flowFreeGameExit');

export const LINES_FLOW_COND_DOC: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'basegame', initial: true },
		{
			id: 'freeGame',
			choreography: { enter: freeGameEnterChoreography, exit: freeGameExitChoreography },
		},
	],
	transitions: [
		// LIVE engine-state branch: LAYER the free game over the base when the counter arms (≥ 1),
		// re-checked on `evaluate()` (the §6.3 condition trigger). NOT a book-event trigger.
		{
			id: 'basegame→freeGame',
			from: 'basegame',
			to: 'freeGame',
			trigger: { kind: 'condition' },
			guard: freeGameActiveGuard,
		},
		// Return: `freeGame`'s Complete pin HANDS OFF back to the base (dismisses the overlay). Fired
		// by `completeActiveScreen()` when the free game ends — a handoff, not a condition swap.
		{
			id: 'freeGame→basegame',
			from: 'freeGame',
			to: 'basegame',
			trigger: { kind: 'complete' },
		},
	],
	// Reuse the full per-event choreographies for a realistic flow (the condition branch is the
	// new mechanism Phase 3 proves; the events are unaffected by it).
	events: LINES_FLOW_DOC.events,
};

// ---------------------------------------------------------------------------
// FS-1 + FS-6 (design doc §14) — the FREE-SPIN lifecycle as author-controlled Flow overlays.
//
// A SEPARATE committed fixture (NOT folded into `LINES_FLOW_DOC`, which authors zero
// transitions so the default boot stays parity-inert, §7). Reached ONLY via the dev hook
// `window.__IE_FLOW_FREESPIN__` (see `flowRuntime.svelte.ts`), never on a normal boot; the ship
// path is the baked `flow` slot. Ownership is decided PER STEP by the auto-derived
// `resolveFreeSpinOwnership` (see `flowRuntime.svelte.ts`) — an un-owned step's event falls through
// to its coded handler exactly as today (byte-parity), an owned step's stays authored.
//
// THE MODEL (owner decision 2026-07-03, "same basegame + overlays"): there is NO distinct
// `freeGame` screen node. The `basegame` screen PERSISTS throughout free spins; the free-spin
// phase is expressed purely by intro / counter / retrigger / outro screens LAYERED over the
// persistent base via the active-SET model. So §14's `intro --complete--> freeGame` is
// reinterpreted: the intro dismisses ITSELF on its Complete pin (basegame remains active
// underneath), and every free-spin screen returns to the plain base the same way.
//
// ACTIVE-SET EDGE SEMANTICS — worked out so NO edge ever deactivates `basegame`:
//   - `basegame --freeSpinTrigger (bookEvent, LAYER)--> freeSpinIntro` — layers the intro over
//     the persistent base (a bookEvent edge activates the target and LEAVES the source active).
//   - `freeSpinIntro --complete--> basegame` — the intro fires its OWN Complete pin: it runs its
//     exit + deactivates ITSELF; `activate('basegame')` is an idempotent no-op (base is already
//     active underneath), so the base stays in place. (This is the exact return-to-base pattern
//     `LINES_FLOW_COND_DOC`'s `freeGame → basegame` uses.)
//   - `basegame --updateFreeSpin (bookEvent, LAYER)--> freeSpinCounter` — layers the counter. The
//     counter is meant to PERSIST across every free spin: once layered, a later `updateFreeSpin`
//     is a `changesActiveSet` no-op (the target is already active), so its `enter` never replays
//     and the counter stays up. Its displayed NUMBER updates through the `updateFreeSpin` event
//     choreography + the `freeSpins` value pin, NOT a re-enter — the correct active-set behaviour.
//   - `basegame --freeSpinRetrigger (bookEvent, LAYER)--> freeSpinRetrigger` — layers the "extra
//     free spins" flourish. `freeSpinRetrigger` is the FS-4 dedicated event (LANDED — emitted by
//     the facade when 3+ scatters land mid free spin); the step is owned only when the owner places
//     the screen + wires this edge + authors the scene, else stripped to the coded no-op (parity).
//   - `freeSpinRetrigger --complete--> basegame` — dismisses the flourish back to the base.
//   - `basegame --freeSpinEnd (bookEvent, LAYER)--> freeSpinOutro` — layers the outro.
//   - `freeSpinOutro --complete--> basegame` — dismisses the outro back to the plain base.
// `basegame` has NO outgoing `complete` edge, so it is PERSISTENT (never removes itself) — the
// base-game invariant. Every free-spin edge is a LAYER (leaves the source) or a self-`complete`
// (removes only the overlay), so `basegame` is active from the loading handoff onward, unbroken.
//
// SCENE-ID CONTRACT (owner authors these four scenes online with these EXACT ids):
//   - `freeSpinIntro`     — the "you won N free spins" intro flourish (id already used by the
//                           reference layout's feed-driven intro overlay).
//   - `freeSpinCounter`   — the "X OF Y" persistent counter panel (reference-layout id; its
//                           `freeSpinCounter` component reads `source:'freeSpins'`).
//   - `freeSpinRetrigger` — NEW: the "extra free spins" retrigger flourish (owner authors it).
//   - `freeSpinOutro`     — the free-spin total count-up outro (reference-layout id).
//
// FS-6 — FLOW OWNS THE VISUALS (owner decision 2026-07-03, corrected). The free-spin events ARE
// AUTHORED here, with the FULL, unmodified Phase-5 choreographies (`freeSpinTriggerChoreography` /
// `updateFreeSpinChoreography` / `freeSpinEndChoreography` above — byte-parity-proven at 29/8/27
// ops, turbo on/off, by `phase5Migration.ts`). These are NOT presentation-stripped: they KEEP
// broadcasting `freeSpinIntroShow`/`Hide`/`Update` + `freeSpinOutroShow`/`Hide`/`CountUp`, which is
// LOAD-BEARING — those events ARM the engine-owned round-gates (`FreeSpinIntroGate`/
// `FreeSpinOutroGate`: the dim + the round-blocking `waitForResolve` press-to-continue + the outro
// count-up), which FS-6 KEEPS. They also carry the load-bearing `gameType`/counter/sound state.
//
// PER-STEP ownership (owner direction 2026-07-03): each overlay step — intro (`freeSpinTrigger` /
// `freeSpinIntro`), counter (`updateFreeSpin` / `freeSpinCounter`), outro (`freeSpinEnd` /
// `freeSpinOutro`) — is owned INDEPENDENTLY (`freeSpinOwnership.ts` `resolveFreeSpinOwnership`). A
// step is flow-owned only when ITS screen is placed AND ITS bookEvent edge is wired AND ITS scene has
// authored content. For an OWNED step the authored event runs + the coded scene is mount-gated off;
// for an UN-OWNED step the event is STRIPPED (falls through to the coded handler) + the coded scene
// mounts as today. MIXED states are valid (authored intro + coded outro, …). No-double is achieved
// WITHOUT touching these choreographies: `Game.svelte` PER-SCENE mount-gates each coded VISUAL/COUNTER
// off ITS step's ownership (the SAME per-step ownership that authored that step's event — an ATOMIC
// per-step flip). Load-bearing state runs regardless: each event runs EITHER its authored choreography
// OR its coded handler, each of which does THAT step's own `gameType`/counter/sound state, so the
// cross-event chain (intro → `freegame`, outro → `basegame`) holds under any mix. Deletes NO plumbing
// (stateUi / registrations / `bookEventHandlerMap` remain, re-activatable).
//
// FS-7 (future, NOT this pass): move the round-blocking gate + outro count-up OWNERSHIP itself into
// the authored screens (a flow-driven `waitForResolve` / press-to-continue / count-up), retiring the
// engine-owned `FreeSpinIntroGate`/`FreeSpinOutroGate`. Only then would the `*Show`/`*CountUp`
// broadcasts become droppable. Deliberately deferred — the schema doesn't express it yet.
// ---------------------------------------------------------------------------

/** A layer edge INTO a free-spin overlay: a `bookEvent` trigger that activates the overlay over
 *  the persistent `basegame` and LEAVES the base active (the active-set LAYER semantics). */
const freeSpinLayerEdge = (event: string, to: string): FlowDoc['transitions'][number] => ({
	id: `basegame→${to}`,
	from: 'basegame',
	to,
	trigger: { kind: 'bookEvent', event },
});

/** A return edge OUT of a free-spin overlay: the overlay fires its OWN Complete pin, dismissing
 *  itself and leaving the persistent `basegame` active underneath (the active-set HANDOFF, whose
 *  `activate('basegame')` is an idempotent no-op since the base never left). */
const freeSpinReturnEdge = (from: string): FlowDoc['transitions'][number] => ({
	id: `${from}→basegame`,
	from,
	to: 'basegame',
	trigger: { kind: 'complete' },
});

/** Tiny enter/exit beats so the layer + handoff order is observable in the harness. The screen's
 *  VISUAL is the owner's authored scene content (mounted by the generic mounter) + the kept gate;
 *  the presentation TIMELINE (broadcasts + state) is the authored EVENT choreography below. These
 *  beats are just active-set lifecycle markers, distinct from the presentation. */
const fsBeat = (event: string): ChoreographyNode => broadcast(event);

export const LINES_FLOW_FREESPIN_DOC: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [
		{ id: 'basegame', initial: true },
		{
			id: 'freeSpinIntro',
			choreography: { enter: fsBeat('flowFsIntroEnter'), exit: fsBeat('flowFsIntroExit') },
		},
		{
			id: 'freeSpinCounter',
			choreography: { enter: fsBeat('flowFsCounterEnter'), exit: fsBeat('flowFsCounterExit') },
		},
		{
			id: 'freeSpinRetrigger',
			choreography: {
				enter: fsBeat('flowFsRetriggerEnter'),
				exit: fsBeat('flowFsRetriggerExit'),
			},
		},
		{
			id: 'freeSpinOutro',
			choreography: { enter: fsBeat('flowFsOutroEnter'), exit: fsBeat('flowFsOutroExit') },
		},
	],
	transitions: [
		// LAYER edges INTO the overlays (basegame persists under each).
		freeSpinLayerEdge('freeSpinTrigger', 'freeSpinIntro'),
		freeSpinLayerEdge('updateFreeSpin', 'freeSpinCounter'),
		freeSpinLayerEdge('freeSpinRetrigger', 'freeSpinRetrigger'), // FS-4 (landed) — the retrigger flourish.
		freeSpinLayerEdge('freeSpinEnd', 'freeSpinOutro'),
		// HANDOFF (self-complete) edges back to the persistent base.
		freeSpinReturnEdge('freeSpinIntro'),
		freeSpinReturnEdge('freeSpinCounter'),
		freeSpinReturnEdge('freeSpinRetrigger'),
		freeSpinReturnEdge('freeSpinOutro'),
	],
	// FS-6 — the free-spin events ARE AUTHORED with the FULL Phase-5 choreographies (unmodified, so
	// they still arm the kept round-gates + do the load-bearing gameType/counter/sound state). The
	// full set of `LINES_FLOW_DOC.events` is reused verbatim, including `freeSpinTrigger`/
	// `updateFreeSpin`/`freeSpinEnd` — the flow now OWNS the free-spin presentation timeline while
	// `Game.svelte` mount-gates the coded visual/counter scenes off (no double). A step's event is
	// only engaged when `resolveFreeSpinOwnership` owns it PER STEP; otherwise it is stripped.
	events: LINES_FLOW_DOC.events,
};
