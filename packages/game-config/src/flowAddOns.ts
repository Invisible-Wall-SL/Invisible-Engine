import { resolveMeters } from './potsOverlay';
import type { GameConfigDoc } from './types';

/**
 * The add-on facts Invisible Flow composes a vocabulary from (`engine-flow-v2` `FlowAddOns`, declared
 * structurally here so this package stays dependency-free): which add-on blocks the config carries,
 * and its meter ids. Read off the NORMALIZED doc the consumer already holds; no doc ⇒ no add-ons.
 */
export interface ConfigFlowAddOns {
	holdAndWin: boolean;
	potsOverlay: boolean;
	meters: string[];
}

export function flowAddOnsOf(
	doc: Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay'> | null | undefined,
): ConfigFlowAddOns {
	return {
		holdAndWin: !!doc?.holdAndWin,
		potsOverlay: !!doc?.potsOverlay,
		meters: resolveMeters(doc ?? undefined).map((meter) => meter.id),
	};
}
