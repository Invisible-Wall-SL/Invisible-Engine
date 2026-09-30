import type { InfoManifest, InfoSymbolIcon } from 'components-ui-pixi';
import { infoRulesWithFigures } from 'engine-layout';
import { infoPageFigures } from 'game-config';
import { DEFAULT_DENOM } from 'delivery-profile';
import { stateConfig, stateI18n, stateOperator } from 'state-shared';
import { numberToCurrencyString } from 'utils-shared/amount';

import { getActiveGameConfig, getNumRows, getPaylines, paylineColor } from './gameConfig';
import { numLines, paytable } from './paytable';
import { getSymbolInfo } from './utils';
import { SYMBOL_SIZE } from 'engine-game';
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

/**
 * The operator's money figures: the bet range (the ladder the player can actually pick from, after
 * any operator clamp) and what one credit is worth. Each only when the operator asked for it.
 */
const operatorFigures = (): { betRange?: string; creditValue?: string } => {
	const levels = stateConfig.betAmountOptions.filter((level) => level > 0);
	const betRange =
		stateOperator.showBetRanges && levels.length
			? `${numberToCurrencyString(Math.min(...levels))} – ${numberToCurrencyString(Math.max(...levels))}`
			: undefined;
	const denom = stateOperator.denom ?? DEFAULT_DENOM;
	// A credit may be worth less than a cent (0.001), and printing it to the cent would state a
	// wrong value on a regulated surface — so it gets as many decimals as it has (a valid denom has
	// at most six).
	const creditDecimals = Math.min(6, `${denom}`.split('.')[1]?.length ?? 0);
	const creditValue = stateOperator.showCreditValue
		? numberToCurrencyString(denom, creditDecimals)
		: undefined;
	return { ...(betRange ? { betRange } : {}), ...(creditValue ? { creditValue } : {}) };
};

/**
 * The rules page with the game's own figures. Each payback appears only where the operator allows
 * it: the RTP on `jurisdiction.displayRTP` (the Play4Fun facade sets it from the embed page's
 * `showTheoreticalPayback`), a bought feature's on `showBuyBonusPayback` — and never while the
 * launch forbids buying one — and the ante's on `showHighChancePayback`.
 */
const rules = () =>
	infoRulesWithFigures({
		...infoPageFigures(
			getActiveGameConfig(),
			stateConfig.jurisdiction.displayRTP,
			(n) => stateI18n.i18n.number(n),
			{
				buy: stateOperator.showBuyBonusPayback && !stateConfig.jurisdiction.disabledBuyFeature,
				ante: stateOperator.showHighChancePayback,
			},
		),
		...operatorFigures(),
	});

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
	// The rules copy lives in `engine-layout`'s shared UI-text registry so `/localization` can
	// harvest it — these strings render through `translate()`, with the figures filled in after.
	get rules() {
		return rules();
	},
};
