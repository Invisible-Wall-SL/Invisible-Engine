/**
 * Invisible Flow v2 — the REFERENCE TEMPLATE vocabulary (`book-of` / apps/lines), Phase 4c.
 *
 * A `TemplateVocabulary` is the CONTRACT a flow is authored against (schema §7): the events it can
 * react to, the actions/cues it can fire, the collections it can loop, and the types those carry.
 * It is DECLARED BY THE TEMPLATE, not authored in the editor. This is the reference book-of
 * template's REAL vocabulary — the single source of truth loaded by BOTH the `/flow-v2` editor
 * (palettes + strict type-checking) AND the apps/lines runtime (which BACKS each declared surface).
 *
 * Everything here is transcribed VERBATIM from the reference game's real code, so the vocabulary is
 * honest (never an invented contract):
 *  - **enums** — `SymbolName` = `apps/lines` `config.symbols` keys; `GameType` = `paddingReels` keys.
 *  - **events** — the `BookEvent` union (`typesBookEvent.ts`); each event node's data-outs are the
 *    author-relevant payload fields. The game dispatches `runFlowEvent(bookEvent.type, bookEvent)`.
 *  - **actions** — the `flowEffect` registry keys (`flowEffects.ts`), each a state mutation / awaited
 *    op the game implements; category `effect`, plus the `command` mechanic ops (`stopReel`,
 *    `expandBookColumns`). The game's env resolves these through `flowEffect(name)`.
 *  - **cues** — the presentation signals components bind (the `EmitterEvent*` unions, transcribed in
 *    v1's `DEFAULT_EMITTER_VOCABULARY`); a `fireCue` node → `eventEmitter.broadcast({ type, ... })`.
 *  - **collections** — `reels` (`$engine.reels`), the iterable a `forEach` walks.
 *
 * Mechanic effects that consume the WHOLE book event (e.g. `revealBoard`) are declared as OPAQUE
 * actions (no typed params): the flow feeds them via `$trigger` (whole payload) + `$context.*`
 * accessors, and the interpreter passes those through to the flowEffect. This lets the flow OWN even
 * the board-spin event so the whole game is flow-driven (event ownership, `game/utils.ts`).
 */

import type { TemplateVocabulary, TypeRef } from '../types';

// ---------------------------------------------------------------------------
// Reusable TypeRefs.
// ---------------------------------------------------------------------------

const INT: TypeRef = { t: 'int' };
const FLOAT: TypeRef = { t: 'float' };
const SYMBOL: TypeRef = { t: 'enum', name: 'SymbolName' };
const GAME_TYPE: TypeRef = { t: 'enum', name: 'GameType' };
const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const POSITION: TypeRef = { t: 'struct', name: 'Position' };
const WIN: TypeRef = { t: 'struct', name: 'Win' };
const list = (of: TypeRef): TypeRef => ({ t: 'list', of });

// ---------------------------------------------------------------------------
// The reference template vocabulary.
// ---------------------------------------------------------------------------

export const BOOK_OF_VOCAB: TemplateVocabulary = {
	templateId: 'bookOf',

	// Structs — the payload shapes an author reads a member off (`$item.index`, a Win's fields).
	structs: [
		{ name: 'Reel', fields: [{ name: 'index', type: INT }] },
		{
			name: 'Position',
			fields: [
				{ name: 'reel', type: INT },
				{ name: 'row', type: INT },
			],
		},
		{
			name: 'Win',
			fields: [
				{ name: 'symbol', type: SYMBOL },
				{ name: 'kind', type: INT },
				{ name: 'win', type: FLOAT },
				{ name: 'positions', type: list(POSITION) },
			],
		},
	],

	// Enums — `SymbolName` = the real `config.symbols` keys; `GameType` = the `paddingReels` keys.
	enums: [
		{
			name: 'SymbolName',
			values: ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5', 'S', 'W'],
		},
		{ name: 'GameType', values: ['basegame', 'freegame'] },
	],

	// Events — the game dispatches any of these into the flow via `runFlowEvent(name, payload)`. Three
	// families (Phase A parity with v1's triggers): BOOK events (the RGS `BookEvent` union), LIFECYCLE
	// + SIGNAL events (boot/loading/tap), and INTENT events (button presses). Each field name IS the
	// event's data-out pin. The flow OWNS an event → drives it (its coded/v1 twin suppressed).
	events: [
		// --- lifecycle + UI signals (v1's `complete`/loading triggers → events the game dispatches) ---
		{ name: 'load', payload: [], category: 'lifecycle' }, // assets loaded — enter the game (hide loading, show basegame).
		{ name: 'tapToStart', payload: [], category: 'lifecycle' }, // the loading press-to-continue tap.
		{ name: 'idle', payload: [], category: 'lifecycle' }, // round settled, ready for the next spin.
		// --- intents (v1's `action` button edges → events; the flow reacts + invokes the mechanic) ---
		{ name: 'spin', payload: [], category: 'intent' },
		{ name: 'stop', payload: [], category: 'intent' },
		{ name: 'buyBonus', payload: [], category: 'intent' },
		// Standard HUD buttons every book-of game ships — the flow can react to any of them.
		{ name: 'increase', payload: [], category: 'intent' }, // bet up
		{ name: 'decrease', payload: [], category: 'intent' }, // bet down
		{ name: 'turbo', payload: [], category: 'intent' },
		{ name: 'autoSpin', payload: [], category: 'intent' },
		{ name: 'settings', payload: [], category: 'intent' },
		{ name: 'soundToggle', payload: [], category: 'intent' },
		{ name: 'gameRules', payload: [], category: 'intent' },
		// --- book events (the RGS `BookEvent` union) ---
		{ name: 'reveal', payload: [{ name: 'gameType', type: GAME_TYPE }], category: 'book' },
		{ name: 'setExpandingSymbol', payload: [{ name: 'symbol', type: SYMBOL }], category: 'book' },
		{
			name: 'expandBookColumns',
			payload: [
				{ name: 'symbol', type: SYMBOL },
				{ name: 'reels', type: list(INT) },
			],
			category: 'book',
		},
		{
			name: 'winInfo',
			payload: [
				{ name: 'totalWin', type: FLOAT },
				{ name: 'wins', type: list(WIN) },
			],
			category: 'book',
		},
		{
			name: 'setWin',
			payload: [
				{ name: 'amount', type: FLOAT },
				{ name: 'winLevel', type: INT },
			],
			category: 'book',
		},
		{ name: 'setTotalWin', payload: [{ name: 'amount', type: FLOAT }], category: 'book' },
		{ name: 'finalWin', payload: [{ name: 'amount', type: FLOAT }], category: 'book' },
		{
			name: 'freeSpinTrigger',
			payload: [
				{ name: 'totalFs', type: INT },
				{ name: 'positions', type: list(POSITION) },
			],
			category: 'book',
		},
		{
			name: 'updateFreeSpin',
			payload: [
				{ name: 'amount', type: INT },
				{ name: 'total', type: INT },
			],
			category: 'book',
		},
		{
			name: 'freeSpinEnd',
			payload: [
				{ name: 'amount', type: FLOAT },
				{ name: 'winLevel', type: INT },
			],
			category: 'book',
		},
	],

	// Actions — the `flowEffect` registry keys the game implements. `effect` = a state mutation /
	// awaited op; `command` = a mechanic op. Every name here MUST resolve in `flowEffects.ts`.
	actions: [
		// --- state / presentation effects ---
		{ name: 'setSpecialSymbol', params: [{ name: 'symbol', type: SYMBOL }], category: 'effect' },
		{
			name: 'setWinBookEventAmount',
			params: [{ name: 'amount', type: FLOAT }],
			category: 'effect',
		},
		{ name: 'setFreeGameType', params: [], category: 'effect' },
		// Free-spin sequential reel stop — reels settle consecutively. `gaps`/`speeds` are OPTIONAL
		// PER-REEL arrays (entry 0 = leftmost reel; a missing/short entry ⇒ the coded SPIN_OPTIONS
		// constant): `gaps[i]` = reel i's `reelPaddingMultiplierSequential` (higher = longer beat
		// before that reel stops), `speeds[i]` = reel i's `reelSpinSpeedSequential` (higher = that
		// reel spins faster). e.g. `speeds: [2, 3, 4, 5, 6]` = accelerating cascade. Leave both unset
		// ⇒ the uniform coded constants.
		{
			name: 'enableSequentialReelStop',
			params: [
				{ name: 'gaps', type: { t: 'list', of: FLOAT } },
				{ name: 'speeds', type: { t: 'list', of: FLOAT } },
			],
			category: 'effect',
		},
		{ name: 'disableSequentialReelStop', params: [], category: 'effect' },
		{ name: 'setFreeSpinCounterTotal', params: [{ name: 'total', type: INT }], category: 'effect' },
		{
			name: 'setFreeSpinCounterTotalOnly',
			params: [{ name: 'total', type: INT }],
			category: 'effect',
		},
		{ name: 'freeSpinIntroShow', params: [], category: 'effect' },
		{ name: 'freeSpinIntroHide', params: [], category: 'effect' },
		{ name: 'freeSpinCounterShow', params: [], category: 'effect' },
		{
			name: 'freeSpinCounterUpdate',
			params: [
				{ name: 'amount', type: INT },
				{ name: 'total', type: INT },
			],
			category: 'effect',
		},
		{
			name: 'updateFreeSpinCounter',
			params: [
				{ name: 'amount', type: INT },
				{ name: 'total', type: INT },
			],
			category: 'effect',
		},
		{ name: 'enterFreeSpinOutro', params: [], category: 'effect' },
		{ name: 'exitFreeSpinOutro', params: [], category: 'effect' },
		{
			name: 'freeSpinOutroCountUp',
			params: [
				{ name: 'amount', type: FLOAT },
				{ name: 'winLevel', type: INT },
			],
			category: 'effect',
		},
		{ name: 'winLevelSoundsPlay', params: [{ name: 'winLevel', type: INT }], category: 'effect' },
		{ name: 'winLevelSoundsStop', params: [], category: 'effect' },
		{ name: 'winShow', params: [{ name: 'winLevel', type: INT }], category: 'effect' },
		{
			name: 'winUpdate',
			params: [
				{ name: 'amount', type: FLOAT },
				{ name: 'winLevel', type: INT },
			],
			category: 'effect',
		},
		{ name: 'winHide', params: [], category: 'effect' },
		// Generic transient-message ("toast") effect — populates `stateMessage.current`, the feed the
		// Info Bar's `message` value + `messageShow` gate read. The TEXT is assembled game-side from the
		// structured params (the accessor model can't template a string): `amount` (a book-event amount)
		// formats through the win-meter's currency formatter, `kind` appends "N of a kind", `messageKind`
		// selects the toast style. Any flow can invoke it; `winInfo` fires it per win.
		{
			name: 'showMessage',
			params: [
				{ name: 'amount', type: FLOAT },
				{ name: 'kind', type: INT },
				{ name: 'messageKind', type: { t: 'string' } },
			],
			category: 'effect',
		},
		// --- mechanic commands ---
		// `revealBoard` is the board SPIN — it consumes the WHOLE reveal event + the surrounding
		// book-event list (the bonus-game check), so it takes no clean typed params: the flow feeds it
		// via `$trigger` (whole payload) + `$context.bookEvents` accessors (the node's `inputs`), and
		// the interpreter passes those through to the `revealBoard` flowEffect. (Opaque by design —
		// the mechanic; the editor doesn't expose typed pins for it.)
		{ name: 'revealBoard', params: [], category: 'command' },
		{ name: 'stopReel', params: [{ name: 'index', type: INT }], category: 'command' },
		// Intent-invoking commands — the flow reacts to a `spin`/`stop`/`buyBonus` button event and
		// invokes the TEMPLATE's mechanic (start the bet, stop the reels, open buy-bonus). Opaque like
		// `revealBoard`; the game backs them (they run the same coded intent the button did).
		{ name: 'startSpin', params: [], category: 'command' },
		{ name: 'stopSpin', params: [], category: 'command' },
		{ name: 'confirmBuyBonus', params: [], category: 'command' },
		// The standard HUD buttons every book-of game ships — wiring a fused container-event pin
		// (onIncrease/onDecrease/…) to one of these fires the same coded body the button press runs.
		{ name: 'increaseBet', params: [], category: 'command' },
		{ name: 'decreaseBet', params: [], category: 'command' },
		{ name: 'toggleTurbo', params: [], category: 'command' },
		{ name: 'openGameRules', params: [], category: 'command' },
		{ name: 'openSettings', params: [], category: 'command' },
		{ name: 'toggleSound', params: [], category: 'command' },
		{ name: 'autoSpin', params: [], category: 'command' },
		{
			name: 'expandBookColumns',
			params: [
				{ name: 'symbol', type: SYMBOL },
				{ name: 'reels', type: list(INT) },
			],
			category: 'command',
		},
	],

	// Cues — the presentation signals a `fireCue` node broadcasts; components in shown containers
	// bind them (transcribed from the real `EmitterEvent*` unions). Backed by `eventEmitter.broadcast`.
	cues: [
		// Special book (the book-of reveal).
		{ name: 'specialBookReveal', payload: [{ name: 'symbol', type: SYMBOL }] },
		{ name: 'specialBookHide', payload: [] },
		// Board.
		{ name: 'boardShow', payload: [] },
		{ name: 'boardHide', payload: [] },
		{
			name: 'boardWithAnimateSymbols',
			payload: [{ name: 'symbolPositions', type: list(POSITION) }],
		},
		{ name: 'boardFrameGlowShow', payload: [] },
		{ name: 'boardFrameGlowHide', payload: [] },
		{ name: 'reelStop', payload: [{ name: 'index', type: INT }] },
		// Win panel (fired as cues; the state flags are the same-named `effect` actions above).
		{ name: 'winShow', payload: [] },
		{ name: 'winHide', payload: [] },
		// Free-spin intro / counter / outro (fired as cues alongside the same-named state effects).
		{ name: 'freeSpinIntroShow', payload: [] },
		{ name: 'freeSpinIntroUpdate', payload: [{ name: 'totalFreeSpins', type: INT }] },
		{ name: 'freeSpinIntroHide', payload: [] },
		{ name: 'freeSpinCounterShow', payload: [] },
		// The CUE carries only `total` (the intro fires it total-only; coded leaves `current`
		// undefined). The per-step `current` update is the `freeSpinCounterUpdate` EFFECT (action).
		{ name: 'freeSpinCounterUpdate', payload: [{ name: 'total', type: INT }] },
		{ name: 'freeSpinCounterHide', payload: [] },
		{ name: 'freeSpinOutroShow', payload: [] },
		{ name: 'freeSpinOutroHide', payload: [] },
		// Sound.
		{ name: 'soundMusic', payload: [{ name: 'name', type: { t: 'string' } }] },
		{ name: 'soundOnce', payload: [{ name: 'name', type: { t: 'string' } }] },
		{ name: 'soundLoop', payload: [{ name: 'name', type: { t: 'string' } }] },
		{ name: 'soundStop', payload: [{ name: 'name', type: { t: 'string' } }] },
		{ name: 'soundScatterCounterIncrease', payload: [] },
		{ name: 'soundScatterCounterClear', payload: [] },
		// UI / drawer / transition.
		{ name: 'uiShow', payload: [] },
		{ name: 'uiHide', payload: [] },
		{ name: 'drawerFold', payload: [] },
		{ name: 'drawerUnfold', payload: [] },
		{ name: 'drawerButtonShow', payload: [] },
		{ name: 'drawerButtonHide', payload: [] },
		{ name: 'stopButtonEnable', payload: [] },
		{ name: 'transition', payload: [] },
	],

	// Collections — the engine-readable iterables a `forEach` walks (`$engine.reels`).
	collections: [{ name: 'reels', of: REEL }],
};
