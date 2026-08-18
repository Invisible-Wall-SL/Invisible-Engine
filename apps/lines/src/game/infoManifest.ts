import type { InfoManifest, InfoSymbolIcon } from 'components-ui-pixi';
import { UI_INFO_RULES } from 'engine-layout';

import { getNumRows, getPaylines, paylineColor } from './gameConfig';
import { numLines, paytable } from './paytable';
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
// authored bindings. Recomputed per access (the paytable is small); no memo to go stale.
function buildSymbols(): Record<string, InfoSymbolIcon> {
	const symbols: Record<string, InfoSymbolIcon> = {};
	for (const entry of paytable()) {
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

// Every config-derived field is an ACCESSOR, for the same reason `symbols` already was: this
// module is imported at boot, long before the live runtime bundle's async fetch resolves, so a
// plain value here would capture the compiled template's paytable, line count and paylines and the
// info page would show the sample game's numbers forever. Deferring to access time — the overlay
// only reads these when the player opens the info page — resolves the authored config.
export const infoManifest: InfoManifest = {
	get paytable() {
		return paytable();
	},
	get numLines() {
		return numLines();
	},
	get paylines() {
		return getPaylines();
	},
	// The authored per-line colours (Invisible Game Config), aligned to `paylines` by declaration
	// index — the SAME index `paylineColor` maps to a line id — so the rules-page grid draws each
	// line in the colour its win line uses. `undefined` for an un-coloured line ⇒ the grid falls
	// back to the theme accent, keeping an un-coloured game byte-identical to before.
	get paylineColors() {
		return getPaylines().map((_line, i) => paylineColor(i));
	},
	get numRows() {
		return getNumRows();
	},
	symbolSize: SYMBOL_SIZE,
	get symbols() {
		return buildSymbols();
	},
	// The default rules copy lives in `engine-layout`'s shared UI-text registry so
	// `/localization` can harvest it — these strings render through `translate()`, but while the
	// literals lived here the launcher could not see them and the page stayed English.
	rules: UI_INFO_RULES,
};
