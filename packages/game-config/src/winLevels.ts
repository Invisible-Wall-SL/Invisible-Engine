/**
 * Invisible Game Config — resolving the AUTHORED win tiers ({@link GameConfigDoc.winLevels}) into
 * the shapes the runtime needs: a levelled tier list, a win→level map (replacing the facade's
 * hardcoded threshold ladder), and the sequential-escalation chain.
 *
 * This is the single home for the tier math so neither the RGS facade, the engine, nor the `/config`
 * tool re-invents it (the `COMPONENT_PARAM_KINDS` lesson: one answer, imported, not copied).
 *
 * Every function returns `undefined` when the config has NOT authored win tiers, which is the whole
 * fallback contract: an un-authored project routes NOTHING through here and keeps its coded
 * `winLevelMap` + coded ladder, byte-identical to before. Dependency-free, like the rest of the
 * package — the runtime maps the resolved tiers into its own `WinLevelData`.
 */

import type { GameConfigDoc, ResolvedWinTier, WinLevelTier } from './types';

/**
 * The coded 10-tier table (`apps/lines/src/game/winLevelMap.ts`) + the facade's threshold ladder
 * (`stakeFacade.ts` `computeWinLevel`), expressed as an authored `winLevels` list. This is what the
 * `/config` tool's "Load default tiers" button seeds so an author starts from today's behaviour and
 * edits DOWN (rename, drop tiers, retune thresholds) rather than from a blank slate.
 *
 * `threshold` is the win as a multiple of the total bet — the lower bound for each tier, matching the
 * coded ladder (<1.5×→standard, <3×→small, <6×→nice, <10×→substantial, <20×→big, <40×→super,
 * <70×→mega, <120×→epic, ≥120×→max). `zero`/`standard` both sit at 0: a positive win resolves to
 * `standard` (the later equal-threshold tier wins) while a zero win short-circuits to `zero` in
 * `resolveWinLevel`. Only the five `big` tiers carry animation/bgm, exactly as the coded table does.
 *
 * NOTE: this is a SEED, not the fallback — an un-authored config never touches it and keeps the coded
 * table verbatim. Kept here (the one tier-math home) so the tool and any future generator share it.
 */
export const DEFAULT_WIN_LEVELS: WinLevelTier[] = [
	{ alias: 'zero', name: 'ZERO', threshold: 0, type: 'small', durationMs: 0 },
	{ alias: 'standard', name: 'STANDARD', threshold: 0, type: 'small', durationMs: 600 },
	{ alias: 'small', name: 'SMALL', threshold: 1.5, type: 'small', durationMs: 1000 },
	{ alias: 'nice', name: 'NICE', threshold: 3, type: 'medium', durationMs: 1500 },
	{ alias: 'substantial', name: 'SUBSTANTIAL', threshold: 6, type: 'medium', durationMs: 2000 },
	{
		alias: 'big',
		name: 'BIG WIN',
		threshold: 10,
		type: 'big',
		animation: { intro: 'big_win_intro', idle: 'big_win_idle', outro: 'big_win_exit' },
		sound: { bgm: 'bgm_winlevel_big' },
		durationMs: 6000,
	},
	{
		alias: 'superwin',
		name: 'SUPER WIN',
		threshold: 20,
		type: 'big',
		animation: { intro: 'super_win_intro', idle: 'super_win_idle', outro: 'super_win_exit' },
		sound: { bgm: 'bgm_winlevel_superwin' },
		durationMs: 18000,
	},
	{
		alias: 'mega',
		name: 'MEGA WIN',
		threshold: 40,
		type: 'big',
		animation: { intro: 'mega_win_intro', idle: 'mega_win_idle', outro: 'mega_win_exit' },
		sound: { bgm: 'bgm_winlevel_mega' },
		durationMs: 20000,
	},
	{
		alias: 'epic',
		name: 'EPIC WIN!',
		threshold: 70,
		type: 'big',
		animation: { intro: 'epic_win_intro', idle: 'epic_win_idle', outro: 'epic_win_exit' },
		sound: { bgm: 'bgm_winlevel_epic' },
		durationMs: 26000,
	},
	{
		alias: 'max',
		name: 'MAX WIN',
		threshold: 120,
		type: 'big',
		animation: { intro: 'max_win_intro', idle: 'max_win_idle', outro: 'max_win_exit' },
		sound: { bgm: 'bgm_winlevel_max' },
		durationMs: 32000,
	},
];

/**
 * The authored tiers with their 1-based `level` assigned (the number the facade emits and the engine
 * looks up), in authored order. `undefined` when the config authors no tiers — the un-authored
 * fallback signal every consumer checks.
 */
export const resolveWinLevels = (doc: GameConfigDoc): ResolvedWinTier[] | undefined => {
	const tiers = doc.winLevels;
	if (!tiers || !tiers.length) return undefined;
	return tiers.map((tier, index) => ({ ...tier, level: index + 1 }));
};

/**
 * The tier LEVEL a given win lands on — `betMultiplier` is the win as a multiple of the total bet
 * (the same quantity the facade's coded ladder tests). Picks the highest tier whose `threshold` is
 * `<= betMultiplier`; a zero/negative win resolves to the first tier. `undefined` when un-authored,
 * so the facade falls back to its coded ladder.
 */
export const resolveWinLevel = (doc: GameConfigDoc, betMultiplier: number): number | undefined => {
	const tiers = resolveWinLevels(doc);
	if (!tiers) return undefined;
	let level = tiers[0].level;
	if (betMultiplier <= 0) return level;
	for (const tier of tiers) {
		if (betMultiplier >= tier.threshold) level = tier.level;
	}
	return level;
};

/** The `type` of a resolved tier by its `level`, or `undefined` when un-authored / out of range —
 *  the facade's big-win gate keys off `=== 'big'` instead of a magic `level >= 6`. */
export const winLevelType = (
	doc: GameConfigDoc,
	level: number,
): ResolvedWinTier['type'] | undefined =>
	resolveWinLevels(doc)?.find((tier) => tier.level === level)?.type;

/** The level escalation starts from: the `escalateFrom` alias' tier if set, else the first `big`
 *  tier. `undefined` when escalation is off, un-authored, or no start tier can be found. */
const escalationStartLevel = (doc: GameConfigDoc, tiers: ResolvedWinTier[]): number | undefined => {
	if (!doc.escalateTiers) return undefined;
	if (doc.escalateFrom) {
		const named = tiers.find((tier) => tier.alias === doc.escalateFrom);
		if (named) return named.level;
	}
	return tiers.find((tier) => tier.type === 'big')?.level;
};

/**
 * The ordered chain of tiers a win on `level` plays when sequential escalation is ON: every tier
 * from the escalation start up to (and including) the winning tier. `undefined` when escalation is
 * OFF or un-authored (the caller then plays only the single winning tier — today's path). A win
 * BELOW the escalation start plays just its own tier (a single-element chain).
 */
export const resolveWinLevelChain = (
	doc: GameConfigDoc,
	level: number,
): ResolvedWinTier[] | undefined => {
	const tiers = resolveWinLevels(doc);
	if (!tiers) return undefined;
	const start = escalationStartLevel(doc, tiers);
	if (start === undefined) return undefined;
	if (level < start) {
		const single = tiers.find((tier) => tier.level === level);
		return single ? [single] : undefined;
	}
	return tiers.filter((tier) => tier.level >= start && tier.level <= level);
};
