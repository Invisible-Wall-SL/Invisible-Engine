import type { InfoManifest, InfoSymbolIcon } from 'components-ui-pixi';

import config from './config';
import { PAYTABLE, NUM_LINES } from './paytable';
import { getSymbolInfo } from './utils';
import { SYMBOL_SIZE } from './constants';
import type { SymbolName } from './types';

// Build the symbol-id -> static icon map for the symbols shown in the paytable,
// from the game's own getSymbolInfo. This is the only game-specific glue; the
// shared <InfoOverlay> stays generic.
const symbols: Record<string, InfoSymbolIcon> = {};
for (const entry of PAYTABLE) {
	const info = getSymbolInfo({ rawSymbol: { name: entry.on.of as SymbolName }, state: 'static' }) as {
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

export const infoManifest: InfoManifest = {
	paytable: PAYTABLE,
	numLines: NUM_LINES,
	paylines: Object.values(config.paylines) as number[][],
	numRows: config.numRows[0] ?? 3,
	symbolSize: SYMBOL_SIZE,
	symbols,
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
			body: `Line wins pay left to right on adjacent reels. Total bet = bet per line × ${NUM_LINES}.`,
		},
		{
			heading: 'MAX WIN',
			body: 'If the total win of a round reaches the win cap, the round ends and the win is awarded up to the cap.',
		},
	],
};
