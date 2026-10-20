import { respinHeldDrawState, respinStopState, type SymbolState } from 'engine-game';

import { bakedRespinLandOnStop } from '../editor-scenes';
import { HELD_REST } from './stateRespinBoard.svelte';
import { hasAuthoredSymbolState } from './utils';

/**
 * This game's answers to "where does a coin play its `land` on the respin board" — the pure rules in
 * `engine-game` (`respinStopState`, `respinHeldDrawState`) fed this project's switch (Invisible
 * Symbols → "Play Land as each cell stops") and its symbol map.
 */

/** What a respin cell draws as its own reel stops on symbol `name`. */
export const respinCellStopState = (name: string): SymbolState =>
	respinStopState(bakedRespinLandOnStop(), (state) => hasAuthoredSymbolState(name, state));

/** Does that stop draw art someone bound, i.e. an animation worth letting finish? */
export const respinCellStopAuthored = (name: string): boolean =>
	hasAuthoredSymbolState(name, respinCellStopState(name));

/** What a held cell draws for its beat `state` — see `respinHeldDrawState`. */
export const respinHeldState = (
	state: SymbolState,
	name: string,
	landedOnStop: boolean,
): SymbolState =>
	respinHeldDrawState(state, {
		landedOnStop,
		authored: (candidate) => hasAuthoredSymbolState(name, candidate),
		rest: HELD_REST,
	});
