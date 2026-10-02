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

/**
 * The respin counter's line. `note` is the beat it is announcing: the award as the feature opens
 * ("3 RESPINS", until the first respin rolls) and a reset while its pulse plays ("RESPINS RESET");
 * otherwise it counts, and the last respin reads as such ("LAST RESPIN"). An authored note left
 * empty falls back to the count.
 */
export const respinCounterText = (left: number, note: 'award' | 'reset' | null = null) => {
	const { respins } = bakedWinText();
	const template =
		note === 'award'
			? respins.award
			: note === 'reset'
				? respins.reset
				: left === 1
					? respins.last
					: '';
	return formatWinText(template || respins.counter, { count: left });
};

/** An add-respins special joining the counter ("+2 RESPINS"); `count` is the respins it added. */
export const respinsAddedText = (count: number) =>
	formatWinText(bakedWinText().respins.added, { count });

/** An upgrade special raising coins ("UPGRADE"). */
export const upgradeText = () => formatWinText(bakedWinText().feature.upgrade);

/** A jackpot coin an upgrade stepped up a tier, named by its NEW tier ("MINOR UPGRADE"). */
export const jackpotUpgradeText = (tier: string) => {
	const resolved = bakedWinText();
	return formatWinText(resolved.jackpots.upgrade, { jackpot: jackpotCaption(resolved, tier) });
};

/** The feature's total over the board once the Total Win bar has landed ("BONUS WIN $20.00"). */
export const featureTotalText = (amount: string) =>
	formatWinText(bakedWinText().feature.total, { amount });

/** The feature's intro and outro lines — empty by default, so nothing is drawn unless authored. */
export const featureIntroText = (respins: number) =>
	formatWinText(bakedWinText().feature.intro, { count: respins });

export const featureOutroText = (amount: string) =>
	formatWinText(bakedWinText().feature.outro, { amount });

/** A pot that filled, named by what it activates ("PAYER ACTIVATED"). */
export const meterFullText = (kind: string) =>
	formatWinText(bakedWinText().feature.meterFull, {
		meter: specialDisplayName(bakedWinText(), kind),
	});

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
