import { bonusCapabilityInputs, respinModeIds } from './bonusGames';
import { HOLD_AND_WIN_MODE } from './modes';
import { resolveMeters } from './potsOverlay';
import type { GameConfigDoc } from './types';

/**
 * The add-on facts Invisible Flow composes a vocabulary from (`engine-flow-v2` `FlowAddOns`, declared
 * structurally here so this package stays dependency-free), read off the split form
 * (`bonusCapabilityInputs`): is there a respin mode with rules, does the coin overlay drop tokens,
 * its meter ids, and — only when they are not the lone `holdAndWin` — the respin modes, the primary
 * first, so a project with one default respin mode resolves what it always did. No doc ⇒ no add-ons.
 */
export interface ConfigFlowAddOns {
	holdAndWin: boolean;
	potsOverlay: boolean;
	meters: string[];
	respinModes?: string[];
}

export function flowAddOnsOf(
	doc:
		Pick<GameConfigDoc, 'holdAndWin' | 'potsOverlay' | 'coinOverlay' | 'modes'> | null | undefined,
): ConfigFlowAddOns {
	const inputs = doc ? bonusCapabilityInputs(doc) : undefined;
	const respinModes = doc ? respinModeIds(doc) : [];
	const loneDefault = respinModes.length === 1 && respinModes[0] === HOLD_AND_WIN_MODE;
	return {
		holdAndWin: !!inputs?.respinMode,
		potsOverlay: !!inputs?.potsOverlay,
		meters: resolveMeters(doc ?? undefined).map((meter) => meter.id),
		...(respinModes.length && !loneDefault ? { respinModes } : {}),
	};
}
