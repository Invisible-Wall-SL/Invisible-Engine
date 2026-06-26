import type { InfoManifest, InfoSymbolIcon } from 'components-ui-pixi';

import config from './config';
import { PAYTABLE, NUM_LINES } from './paytable';
import { getSymbolInfo } from './utils';
import { SYMBOL_SIZE } from './constants';
import type { SymbolName } from './types';

// Build the symbol-id -> static icon map for the symbols shown in the paytable, from the
// game's own getSymbolInfo. This is the only game-specific glue; the shared <InfoOverlay>
// stays generic.
//
// LAZY by design: a `get symbols()` accessor, NOT a top-level loop. In live runtime mode
// (Invisible Game Maker) the symbol overrides arrive via an async fetch that resolves AFTER
// module evaluation, so reading `getSymbolInfo` at import time would capture the coded
// template bindings (and also memoise the symbol map to them — see `symbolMap.ts`). The
// overlay reads `manifest.symbols` only when the info page opens (a user action, long after
// the runtime bundle is applied), so deferring the build to access time resolves the
// authored bindings. Recomputed per access (PAYTABLE is small); no memo to go stale.
function buildSymbols(): Record<string, InfoSymbolIcon> {
	const symbols: Record<string, InfoSymbolIcon> = {};
	for (const entry of PAYTABLE) {
		const info = getSymbolInfo({
			rawSymbol: { name: entry.on.of as SymbolName },
			state: 'static',
		}) as {
			type: 'sprite' | 'spine';
			assetKey: string;
			animationName?: string;
			sizeRatios: { width: number; height: number };
		};
		symbols[entry.on.of] = {
			type: info.type,
			assetKey: info.assetKey,
			animationName: info.animationName,
			sizeRatios: info.sizeRatios,
		};
	}
	return symbols;
}

export const infoManifest: InfoManifest = {
	paytable: PAYTABLE,
	numLines: NUM_LINES,
	paylines: Object.values(config.paylines) as number[][],
	numRows: config.numRows[0] ?? 3,
	symbolSize: SYMBOL_SIZE,
	get symbols() {
		return buildSymbols();
	},
	rules: [
		{
			heading: 'WILD',
			body: 'The Wild substitutes for all paying symbols to complete winning lines.',
		},
		{
			heading: 'SCATTER',
			body: 'The Scatter is paid anywhere on the reels. 3 or more trigger the Free Spins feature.',
		},
		{
			heading: 'PAYLINES & BET',
			body: 'Line wins pay left to right on adjacent reels. Total bet = bet per line × the number of lines.',
		},
		{
			heading: 'MAX WIN',
			body: 'If the total win of a round reaches the win cap, the round ends and the win is awarded up to the cap.',
		},
	],
};
