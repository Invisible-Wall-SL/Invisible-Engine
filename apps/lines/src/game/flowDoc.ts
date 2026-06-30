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
 *  its positions (boardShow + awaited boardWithAnimateSymbols = the `animateSymbols` leaf). */
const winInfoChoreography: ChoreographyNode = seq(
	broadcast('soundOnce', { name: lit('sfx_winlevel_small') }),
	{
		kind: 'forEach',
		list: trigger('wins'),
		mode: 'sequence',
		body: seq(
			broadcast('boardShow'),
			broadcastAwait('boardWithAnimateSymbols', { symbolPositions: item('positions') }),
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
