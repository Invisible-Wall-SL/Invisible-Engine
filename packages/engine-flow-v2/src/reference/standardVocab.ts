/**
 * Invisible Flow v2 — the STANDARD template vocabulary of the SHARED RUNTIME (`apps/lines`).
 *
 * A `TemplateVocabulary` is the CONTRACT a flow is authored against (schema §7): the events it can
 * react to, the actions/cues it can fire, the collections it can loop, and the types those carry.
 * It is DECLARED BY THE TEMPLATE, not authored in the editor. This file holds everything the shared
 * runtime backs for EVERY game type built on it, so the palette and the strict type-checking are
 * identical wherever the mechanic is identical.
 *
 * Everything here is transcribed VERBATIM from the reference game's real code, so the vocabulary is
 * honest (never an invented contract):
 *  - **enums** — `GameType` = `paddingReels` keys. `SymbolName` is the ONE per-type value, passed in:
 *    a game's symbol set is a property of its config, not of the runtime (lines ships `L5`, ways
 *    ships `H5`), so it is a parameter rather than a constant.
 *  - **events** — the `BookEvent` union (`typesBookEvent.ts`); each event node's data-outs are the
 *    author-relevant payload fields. The game dispatches `runFlowEvent(bookEvent.type, bookEvent)`.
 *  - **actions** — the `flowEffect` registry keys (`flowEffects.ts`), each a state mutation / awaited
 *    op the game implements; category `effect`, plus the `command` mechanic ops (`stopReel`). The
 *    game's env resolves these through `flowEffect(name)`.
 *  - **cues** — the presentation signals components bind (the `EmitterEvent*` unions, transcribed in
 *    v1's `DEFAULT_EMITTER_VOCABULARY`); a `fireCue` node → `eventEmitter.broadcast({ type, ... })`.
 *  - **collections** — `reels` (`$engine.reels`), the iterable a `forEach` walks.
 *
 * Mechanic effects that consume the WHOLE book event (e.g. `revealBoard`) are declared as OPAQUE
 * actions (no typed params): the flow feeds them via `$trigger` (whole payload) + `$context.*`
 * accessors, and the interpreter passes those through to the flowEffect. This lets the flow OWN even
 * the board-spin event so the whole game is flow-driven (event ownership, `game/utils.ts`).
 *
 * A game type whose MECHANIC adds surfaces on top of this (`bookOf`: the expanding-symbol pick, the
 * column expand, the reveal splash) composes them in with {@link insertAfter} / {@link insertBefore}
 * so its palette keeps its authored order. A type that adds nothing (`ways` — its `BookEvent` union
 * is a strict subset of lines') uses this base as-is. Declaring a surface the runtime would not back
 * is the failure mode this split exists to prevent.
 */

import { CAMERA_EFFECT_KINDS } from 'constants-shared/camera';

import type { TemplateVocabulary, TypeRef } from '../types';
import { MUSIC_NAMES, SOUND_EFFECT_NAMES, SOUND_NAMES } from './soundEnums.generated';

// ---------------------------------------------------------------------------
// Reusable TypeRefs.
// ---------------------------------------------------------------------------

export const INT: TypeRef = { t: 'int' };
const FLOAT: TypeRef = { t: 'float' };
export const SYMBOL: TypeRef = { t: 'enum', name: 'SymbolName' };
const GAME_TYPE: TypeRef = { t: 'enum', name: 'GameType' };
// Sound-cue name enums — a dropdown of the game's REAL sound names in the inspector (vs a free-text
// literal). Their members are codegen'd from `apps/lines/src/game/sound.ts` into `soundEnums.generated`
// (`node scripts/gen-flow-v2-sound-enums.mjs`), so adding a sound updates the dropdown automatically.
const CAMERA_EFFECT: TypeRef = { t: 'enum', name: 'CameraEffectKind' };
const CONFIDENCE: TypeRef = { t: 'enum', name: 'AnticipationConfidence' };
const BOOL: TypeRef = { t: 'bool' };
const MS: TypeRef = { t: 'ms' };
const MUSIC: TypeRef = { t: 'enum', name: 'MusicName' };
const SOUND_EFFECT: TypeRef = { t: 'enum', name: 'SoundEffectName' };
const SOUND: TypeRef = { t: 'enum', name: 'SoundName' };
const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const POSITION: TypeRef = { t: 'struct', name: 'Position' };
const WIN: TypeRef = { t: 'struct', name: 'Win' };
export const list = (of: TypeRef): TypeRef => ({ t: 'list', of });

// ---------------------------------------------------------------------------
// Composition helpers — a game type splices its own mechanic's surfaces into the
// standard palette WITHOUT disturbing the authored order of everything around them.
// Both throw on a missing anchor: a silently-appended entry would reorder an
// author's palette the next time the standard list is edited.
// ---------------------------------------------------------------------------

/** Splice `extras` in directly after the named entry. */
export const insertAfter = <T extends { name: string }>(
	entries: T[],
	after: string,
	extras: T[],
): T[] => {
	const at = entries.findIndex((entry) => entry.name === after);
	if (at === -1) throw new Error(`insertAfter: no entry named "${after}"`);
	return [...entries.slice(0, at + 1), ...extras, ...entries.slice(at + 1)];
};

/** Splice `extras` in directly before the named entry. */
export const insertBefore = <T extends { name: string }>(
	entries: T[],
	before: string,
	extras: T[],
): T[] => {
	const at = entries.findIndex((entry) => entry.name === before);
	if (at === -1) throw new Error(`insertBefore: no entry named "${before}"`);
	return [...entries.slice(0, at), ...extras, ...entries.slice(at)];
};

// ---------------------------------------------------------------------------
// The standard vocabulary.
// ---------------------------------------------------------------------------

/**
 * The shared runtime's vocabulary for one game type. `symbolNames` are that type's real
 * `config.symbols` keys — the dropdown an author picks a symbol from.
 *
 * Returns a FRESH object per call, so composing one type's palette can never mutate another's.
 */
export const standardVocabulary = ({
	templateId,
	symbolNames,
}: {
	templateId: string;
	symbolNames: readonly string[];
}): TemplateVocabulary => ({
	templateId,

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
			values: [...symbolNames],
		},
		{ name: 'GameType', values: ['basegame', 'freegame'] },
		// The full-screen camera effects the engine implements. Shared verbatim with the runtime
		// (`constants-shared/camera` → `pixi-svelte`'s `cameraEffects`), so the dropdown can never
		// offer a kind the game would silently no-op.
		{ name: 'CameraEffectKind', values: [...CAMERA_EFFECT_KINDS] },
		// Reel-anticipation confidence (docs/design/reel-anticipation.md): `possible` teases on the
		// reachable-win MAX bound (near-misses), `guaranteed` fires only once the win is locked in (MIN).
		{ name: 'AnticipationConfidence', values: ['possible', 'guaranteed'] },
		// Sound-name enums — codegen'd from `sound.ts` (see the `MUSIC`/`SOUND` TypeRefs above).
		{ name: 'MusicName', values: MUSIC_NAMES },
		{ name: 'SoundEffectName', values: SOUND_EFFECT_NAMES },
		{ name: 'SoundName', values: SOUND_NAMES },
	],

	// Events — the game dispatches any of these into the flow via `runFlowEvent(name, payload)`. Three
	// families (Phase A parity with v1's triggers): BOOK events (the RGS `BookEvent` union), LIFECYCLE
	// + SIGNAL events (boot/loading/tap), and INTENT events (button presses). Each field name IS the
	// event's data-out pin. The flow OWNS an event → drives it (its coded/v1 twin suppressed).
	events: [
		// --- lifecycle + UI signals (v1's `complete`/loading triggers → events the game dispatches) ---
		{
			name: 'load',
			payload: [],
			category: 'lifecycle',
			description:
				'Fires once, when all assets have finished loading. The entry point of the whole flow — wire it to leave the loading screen and reveal the game (e.g. Hide "Loading" → Show "Base game").',
		},
		{
			name: 'tapToStart',
			payload: [],
			category: 'lifecycle',
			description:
				'The player pressed the loading "tap to continue" prompt. Fires after Load, once the player first interacts. Use it to dismiss the splash and start play (often also the moment to unlock audio).',
		},
		{
			name: 'idle',
			payload: [],
			category: 'lifecycle',
			description:
				'The round has fully settled and the game is ready for the next spin. Fires at the end of every round. Use it to re-arm the idle state — show the spin button, stop win loops, reset per-round presentation.',
		},
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
		{ name: 'payTable', payload: [], category: 'intent' },
		{ name: 'gameRules', payload: [], category: 'intent' },
		// --- book events (the RGS `BookEvent` union) ---
		{
			name: 'reveal',
			payload: [
				{
					name: 'gameType',
					type: GAME_TYPE,
					description:
						'Which mode this spin belongs to — `basegame` or `freegame`. Branch on it to swap background, music, or win presentation between the two.',
				},
			],
			category: 'book',
			description:
				'The spin result has arrived — the board is about to show its final symbols. The heart of a round: wire it to spin/stop the reels. `gameType` lets you branch base-game vs free-game presentation.',
		},
		{
			name: 'winInfo',
			payload: [
				{
					name: 'totalWin',
					type: FLOAT,
					description: "The round's total win amount, in game currency.",
				},
				{
					name: 'wins',
					type: list(WIN),
					description:
						'Every winning combination this round (each with symbol, kind, amount, positions). Loop it with ForEach to highlight each win line.',
				},
			],
			category: 'book',
			description:
				'The win breakdown for the round. Use it to drive win-line highlights, per-win toasts, and the win meter — loop `wins` to present each line, read `totalWin` for the round total.',
		},
		{
			name: 'setWin',
			payload: [
				{ name: 'amount', type: FLOAT, description: 'The win amount to display on the meter.' },
				{
					name: 'winLevel',
					type: INT,
					description:
						'The celebration tier (higher = bigger win). Selects the win animation and sound.',
				},
			],
			category: 'book',
			description:
				'Set the current win readout to a specific amount at a given celebration tier. Use it to update the win meter and trigger the matching big/mega-win presentation.',
		},
		{
			name: 'setTotalWin',
			payload: [
				{
					name: 'amount',
					type: FLOAT,
					description: 'The accumulated total-win amount to display.',
				},
			],
			category: 'book',
			description:
				'Set the running total-win readout (accumulated across the round / free-spin session). Use it to update the total-win meter.',
		},
		{
			name: 'finalWin',
			payload: [
				{
					name: 'amount',
					type: FLOAT,
					description: 'The final, settled win amount for the round.',
				},
			],
			category: 'book',
			description:
				"The round's final settled win, emitted as the round closes. Use it for the closing count-up / total presentation before the game returns to idle.",
		},
		{
			name: 'freeSpinTrigger',
			payload: [
				{ name: 'totalFs', type: INT, description: 'How many free spins were awarded.' },
				{
					name: 'positions',
					type: list(POSITION),
					description: 'The board positions of the triggering scatters — highlight these.',
				},
			],
			category: 'book',
			description:
				'Free spins have been won. Use it to play the trigger celebration and enter the free-spin intro. `totalFs` is the count awarded; `positions` are the scatters that triggered it.',
		},
		{
			name: 'updateFreeSpin',
			payload: [
				{
					name: 'amount',
					type: INT,
					description: 'The current free-spin index (spins played or remaining, per your counter).',
				},
				{ name: 'total', type: INT, description: 'The total free spins in this session.' },
			],
			category: 'book',
			description:
				'The free-spin counter advanced. Use it to update the "X of Y" free-spin counter each spin.',
		},
		{
			name: 'freeSpinRetrigger',
			payload: [
				{
					name: 'extraFs',
					type: INT,
					description: 'How many EXTRA free spins were just awarded — the "+N" to celebrate.',
				},
				{
					name: 'total',
					type: INT,
					description: 'The new total free spins for the session, after the extra spins are added.',
				},
			],
			category: 'book',
			description:
				'Extra free spins were won DURING the feature (a retrigger — 3+ scatters landed mid free spin). Use it to layer a "+N extra free spins" celebration; pair the screen with a tap-to-continue hold (`showContainer{awaitComplete}`) to FREEZE the free-spin sequence until the player continues.',
		},
		{
			name: 'freeSpinEnd',
			payload: [
				{ name: 'amount', type: FLOAT, description: "The free-spin session's total win." },
				{ name: 'winLevel', type: INT, description: 'The celebration tier for the outro.' },
			],
			category: 'book',
			description:
				'The free-spin session has finished. Use it to play the free-spin outro / total-win count-up, then hand back to the base game.',
		},
	],

	// Actions — the `flowEffect` registry keys the game implements. `effect` = a state mutation /
	// awaited op; `command` = a mechanic op. Every name here MUST resolve in `flowEffects.ts`.
	actions: [
		// --- full-screen camera effects ---
		// ONE action for every kind rather than one action per effect: the kinds share a payload
		// (how long, how hard) and differ only in how the engine draws them, so a `kind` dropdown
		// keeps the palette from growing an entry per flourish. Kinds come from
		// `constants-shared/camera`; `pixi-svelte`'s `cameraEffects` implements them against the
		// stage — the one transform above the board, the HUD and every overlay.
		{
			name: 'cameraEffect',
			params: [
				{
					name: 'kind',
					type: CAMERA_EFFECT,
					description:
						'Which full-screen effect to play. Shake = a decaying rattle of the whole game; Flash = a white bloom over everything; Zoom punch = a quick push in and settle; Chromatic wobble = an oscillating RGB split.',
				},
				{
					name: 'durationMs',
					type: MS,
					optional: true,
					description:
						"How long the effect runs. Leave unset for the kind's own default (shake 400ms, flash 220ms, zoom punch 320ms, chromatic wobble 500ms).",
				},
				{
					name: 'intensity',
					type: FLOAT,
					optional: true,
					description:
						"How hard it hits, as a multiplier of the effect's reference strength — not pixels. Unset ⇒ 1 (the reference). 0.5 = half as strong, 2 = twice. Capped at 4.",
				},
				{
					name: 'blocking',
					type: BOOL,
					optional: true,
					description:
						'Whether the flow WAITS for the effect to finish before running the next node. Unset ⇒ false: the effect plays underneath the rest of the chain, which is almost always what a flourish wants. Set it true to hold the beat (e.g. flash, THEN reveal).',
				},
			],
			category: 'effect',
		},
		// --- state / presentation effects ---
		// Arm the picked buy-bonus bet mode before the confirm step — the flow analogue of a buy-feature
		// card's `onSelect`. `betModeKey` is a `stateMeta.betModeMeta` key (e.g. `BONUS`/`SUPERSPIN`);
		// `commitBuyBonus` then activates whatever this armed.
		{
			name: 'selectBetMode',
			params: [{ name: 'betModeKey', type: { t: 'string' } }],
			category: 'effect',
		},
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
				{ name: 'gaps', type: { t: 'list', of: FLOAT }, optional: true },
				{ name: 'speeds', type: { t: 'list', of: FLOAT }, optional: true },
			],
			category: 'effect',
		},
		{ name: 'disableSequentialReelStop', params: [], category: 'effect' },
		// Client-computed reel ANTICIPATION mode — reels HOLD + escalating tease FX while a big win /
		// feature trigger is still reachable from the reels not yet stopped. `confidence` picks the
		// reachable-win bound (`possible` = max, teases near-misses; `guaranteed` = min, only once the
		// win is locked in) — unset ⇒ keep the current value. `minAnticipateReel` (default 2) suppresses
		// the trivial early arm; `greyOut`/`zoom` (default true) toggle the dim of the non-anticipating
		// reels and the board zoom-in. Off by default ⇒ leave it unauthored for byte-parity.
		{
			name: 'enableAnticipationMode',
			params: [
				{ name: 'confidence', type: CONFIDENCE, optional: true },
				{ name: 'minAnticipateReel', type: INT, optional: true },
				{ name: 'greyOut', type: BOOL, optional: true },
				{ name: 'zoom', type: BOOL, optional: true },
			],
			category: 'effect',
		},
		{ name: 'disableAnticipationMode', params: [], category: 'effect' },
		// Stacked-picture reel mode (docs/design/stacked-picture-mode.md) — a LINES visual: a contiguous
		// run of a stacked symbol draws one tall picture over it (top `runLength ÷ height`, top-aligned).
		// NO params — WHICH symbols stack, their heights, and the art are authored in the Symbols State
		// Machine; this effect is just the on/off switch (so it can be enabled per screen). Off by
		// default ⇒ leave it unauthored for byte-parity.
		{ name: 'enableStackedPictures', params: [], category: 'effect' },
		{ name: 'disableStackedPictures', params: [], category: 'effect' },
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
				{
					name: 'holdToSpeedUp',
					type: BOOL,
					optional: true,
					description:
						'Let the player HOLD a press (or Space) to fast-forward this count-up — it runs faster while held and eases back on release. Unset ⇒ off. Independent of Tap to skip; enable either, both, or neither.',
				},
				{
					name: 'tapToSkip',
					type: BOOL,
					optional: true,
					description:
						'Let the player TAP once to jump this count-up straight to the final total. Unset ⇒ off. With Hold to speed up also on, a quick tap skips while a press-and-hold speeds up.',
				},
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
				{
					name: 'holdToSpeedUp',
					type: BOOL,
					optional: true,
					description:
						'Let the player HOLD a press (or Space) to fast-forward the win count-up — it runs faster while held and eases back on release. Unset ⇒ off. Independent of Tap to skip; enable either, both, or neither.',
				},
				{
					name: 'tapToSkip',
					type: BOOL,
					optional: true,
					description:
						'Let the player TAP once to jump the win count-up straight to the final total. Unset ⇒ off. With Hold to speed up also on, a quick tap skips while a press-and-hold speeds up.',
				},
			],
			category: 'effect',
		},
		{ name: 'winHide', params: [], category: 'effect' },
		// Generic transient-message ("toast") effect — populates `stateMessage.current`, the feed the
		// Info Bar's `message` value + `messageShow` gate read. The TEXT is assembled game-side from the
		// structured params (the accessor model can't template a string) out of the templates authored
		// in Invisible Win Text: `amount` (a book-event amount) formats through the win-meter's currency
		// formatter, `symbol` + `kind` become "4 Bananas" via the symbol's authored display name, and
		// `messageKind` selects the toast style. Any flow can invoke it; `winInfo` fires it per win.
		{
			name: 'showMessage',
			params: [
				{ name: 'amount', type: FLOAT },
				{ name: 'kind', type: INT },
				{
					name: 'symbol',
					type: SYMBOL,
					description:
						"The win's symbol — the message NAMES it ('4 Bananas') using the display name authored in the Symbols tool. Unwired, the toast can only state the amount.",
				},
				{ name: 'messageKind', type: { t: 'string' } },
			],
			category: 'effect',
		},
		// Light ONLY the paying symbols of a win. Prefer this over the raw `boardWithAnimateSymbols`
		// cue inside a `winInfo` forEach: a win's `positions` is the FULL payline path, but a
		// left-to-right line pays only its leftmost `kind` symbols, so feeding the cue the raw
		// `positions` lights the non-paying tail too. Slices exactly like `showWinLine`, so the lit
		// cells always match the traced line.
		{
			name: 'animateWinSymbols',
			params: [
				{
					name: 'positions',
					type: list(POSITION),
					description:
						"The win's board positions (the FULL payline path) — only the leftmost `kind` are lit.",
				},
				{
					name: 'kind',
					type: INT,
					description: 'How many symbols form the paying combination — the tail is not lit.',
				},
			],
			category: 'effect',
		},
		// Win line — trace the paying combination + stamp its amount. `showWinLine` draws the line
		// through the leftmost `kind` symbols of a win and reveals the amount below its end (awaited:
		// an animated draw completes before the next step); `hideWinLine` clears it. Both no-op for a
		// scatter win / a disabled Symbol-State-Machine overlay. Fed one win's fields from the
		// `winInfo` forEach — pair a Show with a matching Hide around the symbol animation.
		{
			name: 'showWinLine',
			params: [
				{
					name: 'positions',
					type: list(POSITION),
					description:
						"The win's board positions. Only the leftmost `kind` paying symbols are traced (a left-to-right line); wire the current win's `positions`.",
				},
				{
					name: 'kind',
					type: INT,
					description: 'How many symbols form the paying combination — the line stops after these.',
				},
				{
					name: 'symbol',
					type: SYMBOL,
					description:
						"The win's symbol. A scatter ('S') pays anywhere, so it draws no line (no-op).",
				},
				{
					name: 'amount',
					type: FLOAT,
					description: "The win's amount, stamped below the line end (formatted as game currency).",
				},
			],
			category: 'effect',
		},
		{
			name: 'hideWinLine',
			params: [
				{
					name: 'symbol',
					type: SYMBOL,
					description:
						"The win's symbol — matches the Show's gate so a no-op Show has a no-op Hide.",
				},
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
		// Intent-invoking commands — the flow reacts to a `spin`/`stop` button event and invokes the
		// TEMPLATE's mechanic (start the bet, stop the reels). Opaque like `revealBoard`; the game backs
		// them (they run the same coded intent the button did).
		{ name: 'startSpin', params: [], category: 'command' },
		{ name: 'stopSpin', params: [], category: 'command' },
		// Commit the buy-bonus purchase — activate the armed bet mode (`selectBetMode`) and, for a `buy`
		// mode, fire the bet (or, for an `activate` mode, raise the auto-spin limits to infinity). This
		// is the confirm-dialog CONFIRM body, not the buy-BUTTON press (that just opens the select
		// screen); pair a `selectBetMode` (arm) with this (commit).
		{ name: 'commitBuyBonus', params: [], category: 'command' },
		// The standard HUD buttons every book-of game ships — wiring a fused container-event pin
		// (onIncrease/onDecrease/…) to one of these fires the same coded body the button press runs.
		{ name: 'increaseBet', params: [], category: 'command' },
		{ name: 'decreaseBet', params: [], category: 'command' },
		{ name: 'toggleTurbo', params: [], category: 'command' },
		{ name: 'openPayTable', params: [], category: 'command' },
		{ name: 'openGameRules', params: [], category: 'command' },
		{ name: 'openSettings', params: [], category: 'command' },
		{ name: 'toggleSound', params: [], category: 'command' },
		{ name: 'autoSpin', params: [], category: 'command' },
		// Fullscreen must run INSIDE the press's call stack (browsers reject `requestFullscreen`
		// outside a user gesture). The interpreter reaches `env.effect` synchronously from the
		// press, so wire this DIRECTLY off the button's `onFullscreen` pin — putting a `delay`
		// (or any awaiting node) ahead of it spends the gesture and the request is refused.
		{ name: 'toggleFullscreen', params: [], category: 'command' },
	],

	// Cues — the presentation signals a `fireCue` node broadcasts; components in shown containers
	// bind them (transcribed from the real `EmitterEvent*` unions). Backed by `eventEmitter.broadcast`.
	cues: [
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
		// Sound — the `name` inputs are typed as codegen'd enums so the inspector offers a DROPDOWN of
		// the game's real sound names (`MusicName`/`SoundEffectName`/`SoundName`, from `sound.ts`).
		{ name: 'soundMusic', payload: [{ name: 'name', type: MUSIC }] },
		{ name: 'soundOnce', payload: [{ name: 'name', type: SOUND_EFFECT }] },
		{ name: 'soundLoop', payload: [{ name: 'name', type: SOUND_EFFECT }] },
		{ name: 'soundStop', payload: [{ name: 'name', type: SOUND }] },
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
});
