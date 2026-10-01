import {
	collectorLevelCaption,
	formatWinText,
	jackpotCaption,
	potCaption,
	specialDisplayName,
} from 'engine-layout';
import type { HoldAndWinWheelPrize } from 'engine-game';

import { bakedWinText } from '../editor-scenes';

/**
 * Every player-facing Hold and Win line, read from the project's Invisible Win Text templates
 * (`bakedWinText()`, the coded `WIN_TEXT_DEFAULTS` when unauthored — equal to the literals these
 * replaced). Each one localizes the TEMPLATE, then interpolates (`formatWinText`); the names it drops
 * in (tier, special, collector level, pot) are localized at their own source.
 */

export const respinCounterText = (left: number) =>
	formatWinText(bakedWinText().respins.counter, { count: left });

/** Special names for a toast, joined with ", ". */
export const modifiersText = (kinds: readonly string[]) => {
	const resolved = bakedWinText();
	return kinds.map((kind) => specialDisplayName(resolved, kind)).join(', ');
};

/** The counter's modifier line, joined with " · "; a raised collector is named by its level. */
export const modifierLineText = (kinds: readonly string[], collectorLevel: number) => {
	const resolved = bakedWinText();
	return kinds
		.map((kind) =>
			kind === 'collector' && collectorLevel > 1
				? formatWinText(resolved.feature.collectorLevel, {
						level: collectorLevelCaption(resolved, collectorLevel),
					})
				: specialDisplayName(resolved, kind),
		)
		.join(' · ');
};

export const modifiersActiveText = (kinds: readonly string[]) =>
	formatWinText(bakedWinText().feature.modifiersActive, { modifiers: modifiersText(kinds) });

export const modifiersUnlockedText = (kinds: readonly string[]) =>
	formatWinText(bakedWinText().feature.modifiersUnlocked, { modifiers: modifiersText(kinds) });

export const luckySpinText = () => formatWinText(bakedWinText().feature.luckySpin);

export const instantCollectText = () => formatWinText(bakedWinText().feature.instantCollect);

/** A banked jackpot's banner: its title and the amount (or full-board) line under it. */
export const jackpotBannerText = (tier: string, amount: string, fullBoard: boolean) => {
	const resolved = bakedWinText();
	return {
		title: formatWinText(resolved.jackpots.award, { jackpot: jackpotCaption(resolved, tier) }),
		detail: formatWinText(
			fullBoard ? resolved.jackpots.fullBoardDetail : resolved.jackpots.awardDetail,
			{ amount },
		),
	};
};

/** The small banner over a jackpot coin in the tally. */
export const jackpotCoinText = (tier: string) => {
	const resolved = bakedWinText();
	return formatWinText(resolved.jackpots.coin, { jackpot: jackpotCaption(resolved, tier) });
};

/** A wheel segment's label. */
export const wheelPrizeText = (prize: HoldAndWinWheelPrize) => {
	const resolved = bakedWinText();
	switch (prize.type) {
		case 'coinBoost':
			return formatWinText(resolved.wheel.coinBoost, { count: prize.multiplier });
		case 'extraCollect':
			return formatWinText(resolved.wheel.extraCollect, { count: prize.count });
		case 'jackpot':
			return jackpotCaption(resolved, prize.jackpot);
	}
};

/** What a wheel prize's banner says under its label; `collectorLevel` is the level it raised to. A
 *  jackpot prize has no banner (the `jackpotWin` after it is the celebration). */
export const wheelPrizeDetailText = (
	prize: Exclude<HoldAndWinWheelPrize, { type: 'jackpot' }>,
	collectorLevel: number,
) => {
	const resolved = bakedWinText();
	return prize.type === 'coinBoost'
		? formatWinText(resolved.wheel.coinBoostDetail, { count: prize.multiplier })
		: formatWinText(resolved.wheel.extraCollectDetail, {
				level: collectorLevelCaption(resolved, collectorLevel),
			});
};

/** A pot's label over its bar. */
export const potLabelText = (meterId: string, level: number, max: number) => {
	const resolved = bakedWinText();
	return formatWinText(resolved.feature.potLabel, {
		pot: potCaption(resolved, meterId),
		level,
		max,
	});
};

/** What a full pot activates, under its bar. */
export const potActivatesText = (kind: string) => specialDisplayName(bakedWinText(), kind);
