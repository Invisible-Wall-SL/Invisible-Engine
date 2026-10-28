import { primaryRespinMode } from './bonusGames';
import { holdAndWinIsOverlayBonus, isHoldAndWinSymbol } from './holdAndWin';
import { symbolsInPlay } from './inPlay';
import { resolveCascade } from './mechanics';
import { isScatterSymbol } from './serverPaytable';
import type { ExpandingWildsConfig, GameConfigDoc } from './types';
import type { GameConfigIssue } from './validate';
import { resolveWinModel } from './winModel';

/**
 * EXPANDING WILDS (`docs/design/expanding-and-growing-wilds.md` §1–§2) — a wild that fills its whole
 * reel when it lands, before any win is counted. The block names the wilds; which reels each lands
 * on stays a fact of the reel strips. The RGS owns the outcome: on the Invisible Test Server the mock
 * deals from it, a partner server by its own math.
 */

/** The expanding wilds as the game plays them. */
export type ResolvedExpandingWilds = {
	/** Each wild that expands, in the order the block names them, with the 0-based reels the base
	 *  game's strips deal it on. */
	symbols: { symbol: string; reels: number[] }[];
	onlyOnWin: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Distinct, trimmed, non-empty names, in the order given. */
export const nameList = (raw: unknown): string[] =>
	Array.isArray(raw)
		? [
				...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim())),
			].filter(Boolean)
		: [];

/**
 * Normalize an authored block. Its PRESENCE is the feature, so any object normalizes to a block,
 * with an empty `symbols` list when none survives (the validator's error); anything else is
 * `undefined`. `onlyOnWin` is stored only when `true`, its departure from the default.
 */
export function normalizeExpandingWilds(raw: unknown): ExpandingWildsConfig | undefined {
	if (!isRecord(raw)) return undefined;
	return { symbols: nameList(raw.symbols), ...(raw.onlyOnWin === true ? { onlyOnWin: true } : {}) };
}

/** The 0-based reels the `gameType` strips deal `symbol` on. */
export const reelsDealing = (
	doc: Pick<GameConfigDoc, 'paddingReels'>,
	symbol: string,
	gameType = 'basegame',
): number[] =>
	(doc.paddingReels[gameType] ?? []).flatMap((strip, reel) =>
		strip.some((cell) => cell.name === symbol) ? [reel] : [],
	);

/** Can the board rewrite cells before the count? Only a lines game that does not tumble. */
export const rewritesBoard = (
	doc: Pick<GameConfigDoc, 'winModel' | 'cascade' | 'family' | 'match3'>,
): boolean => resolveWinModel(doc).type === 'lines' && !resolveCascade(doc);

/**
 * Why `name` cannot be a wild that expands or grows, or `undefined` when it can: it must be in the
 * dictionary, dealt, wild, and neither a scatter (a Book-of book expands by its own rule) nor a Hold
 * and Win symbol.
 */
export const landingWildProblem = (
	doc: GameConfigDoc,
	name: string,
	inPlay: ReadonlySet<string> = new Set(symbolsInPlay(doc)),
): string | undefined => {
	const symbol = doc.symbols[name];
	if (!symbol) return 'is not in the symbol dictionary';
	if (!inPlay.has(name)) return 'appears on no reel strip, so it is never dealt';
	if (!symbol.special_properties?.includes('wild')) return 'is not a wild';
	if (isScatterSymbol(symbol)) return 'is a scatter';
	if (isHoldAndWinSymbol(symbol)) return 'is a Hold and Win symbol';
	return undefined;
};

/**
 * The expanding wilds this game plays, or `undefined` when it has none: no block, a game that does
 * not pay by lines or tumbles, or no named symbol that can expand. The ONE reader — the mock
 * contract, `/config` and the fixtures all go through here.
 */
export function resolveExpandingWilds(
	doc: GameConfigDoc | undefined,
): ResolvedExpandingWilds | undefined {
	const block = doc?.expandingWilds;
	if (!doc || !block || !rewritesBoard(doc)) return undefined;
	const inPlay = new Set(symbolsInPlay(doc));
	const symbols = block.symbols
		.filter((name) => !landingWildProblem(doc, name, inPlay))
		.map((symbol) => ({ symbol, reels: reelsDealing(doc, symbol) }));
	return symbols.length ? { symbols, onlyOnWin: block.onlyOnWin === true } : undefined;
}

/**
 * The checks every block that rewrites the board shares: a lines game that does not tumble and is
 * not a Hold and Win game.
 */
export const boardRewriteIssues = (
	doc: GameConfigDoc,
	path: string,
	what: string,
): GameConfigIssue[] => {
	const issues: GameConfigIssue[] = [];
	if (resolveWinModel(doc).type !== 'lines') {
		issues.push({
			severity: 'error',
			path,
			message: `${what} changes cells before the line wins are counted, so it needs a game that pays by lines. Choose Lines under How wins are decided, or remove it.`,
		});
	} else if (resolveCascade(doc)) {
		issues.push({
			severity: 'error',
			path,
			message: `${what} cannot play in a game that tumbles: a tumble replaces the cells it changed. Turn the tumble off, or remove it.`,
		});
	}
	if (primaryRespinMode(doc.modes) && !holdAndWinIsOverlayBonus(doc)) {
		issues.push({
			severity: 'error',
			path,
			message: `A Hold and Win game has no reels for ${what.toLowerCase()} to play on. Remove it.`,
		});
	}
	return issues;
};

/** The block against the rest of the doc. Paths `expandingWilds…`. */
export const validateExpandingWilds = (doc: GameConfigDoc): GameConfigIssue[] => {
	const block = doc.expandingWilds;
	if (!block) return [];
	const path = 'expandingWilds';
	const issues = boardRewriteIssues(doc, path, 'An expanding wild');
	if (!block.symbols.length) {
		issues.push({
			severity: 'error',
			path: `${path}.symbols`,
			message: 'No wild is named to expand. Pick at least one wild, or remove expanding wilds.',
		});
	}
	const inPlay = new Set(symbolsInPlay(doc));
	block.symbols.forEach((name, index) => {
		const why = landingWildProblem(doc, name, inPlay);
		if (why) {
			issues.push({
				severity: 'error',
				path: `${path}.symbols.${index}`,
				message: `${name} ${why}, so it cannot be an expanding wild. Remove it from the list.`,
			});
		} else if (name === doc.growingWild?.symbol) {
			issues.push({
				severity: 'error',
				path: `${path}.symbols.${index}`,
				message: `${name} is also the growing wild. A wild either expands or grows; pick one.`,
			});
		}
	});
	return issues;
};
