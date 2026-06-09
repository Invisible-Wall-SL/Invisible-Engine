import type { ComponentParam } from './types';

/**
 * Curated, code-owned catalog the editor's variable picker reads. It lists the
 * engine-provided values an author can bind a component {@link ComponentParam}
 * to, and the core signals the engine fires. This is the `declare` side of the
 * `declare ≠ implement` bridge (see `docs/design/invisible-editor.md` §8.5): the
 * editor offers these names; the game owns the runtime wiring. Pure data — no
 * runtime logic.
 */

/** An engine-provided value an author can bind a component param to. */
export interface EngineParamEntry {
	key: string;
	/** Constrained to a {@link ComponentParam} kind so a binding is type-checkable. */
	kind: ComponentParam['kind'];
	label: string;
	note?: string;
}

/** A core signal name the engine fires at a component. */
export interface EngineSignalEntry {
	key: string;
	label: string;
	note?: string;
}

/** Engine-provided values an author can bind a component param to. */
export const ENGINE_PARAM_CATALOG: EngineParamEntry[] = [
	{ key: 'bet', kind: 'number', label: 'Bet', note: 'Current total stake.' },
	{ key: 'win', kind: 'number', label: 'Win', note: 'Win of the current round/spin.' },
	{ key: 'balance', kind: 'number', label: 'Balance', note: 'Player wallet balance.' },
	{ key: 'totalWin', kind: 'number', label: 'Total Win', note: 'Accumulated win for the round.' },
	{ key: 'playerName', kind: 'string', label: 'Player Name' },
	{ key: 'projectName', kind: 'string', label: 'Project Name' },
];

/**
 * The numeric engine value feeds a readout's `source` param can bind to — the
 * keys a game registers via `registerComponentValues` (balance/win/bet/totalWin).
 * Derived from {@link ENGINE_PARAM_CATALOG} (its number-kind entries) so the
 * editor's Source dropdown and the engine feed share ONE list. A game registers
 * the subset it supports; a source with no registered store simply feeds nothing
 * (the readout shows an empty/zero value), same as an unbound param.
 */
export const VALUE_SOURCE_CATALOG: EngineParamEntry[] = ENGINE_PARAM_CATALOG.filter(
	(p) => p.kind === 'number',
);

/** Just the keys of {@link VALUE_SOURCE_CATALOG} — the `options` for a `source` param. */
export const VALUE_SOURCE_KEYS: string[] = VALUE_SOURCE_CATALOG.map((p) => p.key);

/**
 * Canonical HUD button action keys the parametric Button's `action` param selects
 * from — the editor renders the `action` param as a dropdown of these instead of a
 * free-text box (no more silent typos). The GAME must register a matching handler
 * via `registerComponentActions` (declare ≠ implement); an action with no registered
 * handler simply does nothing, same as an unbound param. A custom action key typed
 * elsewhere is preserved (the editor keeps an out-of-catalog value as an option).
 */
export const ENGINE_ACTION_CATALOG: string[] = [
	'spin',
	'decrease',
	'increase',
	'autoSpin',
	'turbo',
	'menu',
	'buyBonus',
];

/** Core signals the engine fires at a component. */
export const ENGINE_SIGNAL_CATALOG: EngineSignalEntry[] = [
	{ key: 'enter', label: 'Enter', note: 'Component mounted / scene entered.' },
	{ key: 'exit', label: 'Exit', note: 'Component about to unmount / scene left.' },
	{ key: 'idle', label: 'Idle', note: 'Resting state between rounds.' },
	{ key: 'win', label: 'Win', note: 'A winning result resolved.' },
	{ key: 'bigWin', label: 'Big Win', note: 'A big-win threshold was crossed.' },
];
