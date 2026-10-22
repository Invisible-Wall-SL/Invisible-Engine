import {
	elementFxEnterEnds,
	readElementFxEntries,
	type ElementFxEntry,
} from 'constants-shared/elementFx';

import { bakedSymbolFx } from '../editor-scenes';
import type { SymbolState } from './types';
import { hasAuthoredSymbolState } from './utils';

/**
 * The Element FX a symbol plays in a state (Invisible Symbols State Machine → a state's Element FX):
 * its `enter` and `always` entries. A state plays only its own list, never the one of the state
 * whose art it borrows.
 */
export const symbolStateFx = (symbolName: string, state: SymbolState): ElementFxEntry[] =>
	readElementFxEntries(bakedSymbolFx()[symbolName]?.[state]).filter(
		(entry) => !entry.disabled && (entry.trigger === 'enter' || entry.trigger === 'always'),
	);

/**
 * Does a symbol's state have a beat that ends on its own: art bound for it, or an `enter` effect
 * that plays out (`stateFxGate`). The board's question before it gives a cell a beat — an explosion
 * with only a melt authored still explodes, and a win with only a glow gets the authored cap —
 * where {@link hasAuthoredSymbolState} asks about the art alone.
 */
export const symbolStateHasBeat = (symbolName: string, state: SymbolState): boolean =>
	hasAuthoredSymbolState(symbolName, state) ||
	symbolStateFx(symbolName, state).some(elementFxEnterEnds);
