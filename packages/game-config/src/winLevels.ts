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

import type {
	GameConfigDoc,
	ResolvedWinTier,
	WinLevelTier,
	WinTierAnimation,
	WinTierType,
} from './types';

/**
 * One entry of a coded `winLevelMap` (`apps/<game>/src/game/winLevelMap.ts`), structurally — the
 * shape {@link winLevelMapToTiers} reads. Kept loose (dependency-free) so this package never imports
 * a game module; the generator passes the real table in.
 */
export type CodedWinLevelEntry = {
	level: number;
	alias: string;
	type: WinTierType;
	threshold?: number;
	text?: string | null;
	presentDuration?: number;
	sound?: { sfx?: string; bgm?: string };
	animation?: WinTierAnimation | null;
};

/**
 * Convert a game's coded `winLevelMap` into an authored `winLevels` list — the per-TEMPLATE default
 * the Game Config defaults generator writes into `<gameType>.json`, so each template's default tiers
 * come from that template's own coded table (NOT one shared constant). The `/config` "Load default
 * tiers" button then seeds from the loaded template default, and a template-seeded project's panel
 * shows the template's tiers with no extra step.
 *
 * Sparse on purpose so the emitted JSON is minimal and round-trips through {@link normalizeWinLevels}
 * unchanged: `name` falls back to the tier's `text` (the coded caption) then its uppercased alias;
 * `sound`/`animation` are dropped when empty; `durationMs` is omitted for a zero-duration tier.
 * Entries are taken in ascending `level`.
 *
 * NOTE: this is a SEED, not the fallback — an un-authored project never ships these (the bundle uses
 * the authored doc only) and keeps the coded table verbatim, byte-identical to before.
 */
export const winLevelMapToTiers = (
	map: Record<string | number, CodedWinLevelEntry>,
): WinLevelTier[] =>
	Object.values(map)
		.slice()
		.sort((a, b) => a.level - b.level)
		.map((entry) => {
			const tier: WinLevelTier = {
				alias: entry.alias,
				name: entry.text ?? entry.alias.toUpperCase(),
				threshold: entry.threshold ?? 0,
				type: entry.type,
			};
			if (entry.animation) tier.animation = { ...entry.animation };
			const sfx = entry.sound?.sfx;
			const bgm = entry.sound?.bgm;
			if (sfx || bgm) tier.sound = { ...(sfx ? { sfx } : {}), ...(bgm ? { bgm } : {}) };
			if (entry.presentDuration) tier.durationMs = entry.presentDuration;
			return tier;
		});

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
