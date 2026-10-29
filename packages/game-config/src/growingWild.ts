import {
	boardRewriteIssues,
	landingWildProblem,
	nameList,
	reelsDealing,
	rewritesBoard,
} from './expandingWilds';
import { symbolsInPlay } from './inPlay';
import {
	GROWING_WILD_PATTERNS,
	type GameConfigDoc,
	type GrowingWildConfig,
	type GrowingWildPattern,
} from './types';
import type { GameConfigIssue } from './validate';

/**
 * THE GROWING WILD (`docs/design/expanding-and-growing-wilds.md` §1–§2) — a wild that copies itself
 * onto the cells around it when it lands, after every expanding wild has expanded and before any win
 * is counted. It never overwrites a scatter or a Hold and Win symbol, and a copy does not grow again.
 */

/** The growing wild as the game plays it, every default applied. */
export type ResolvedGrowingWild = {
	symbol: string;
	reels: number[];
	freeSpinReels: number[];
	pattern: GrowingWildPattern;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Distinct whole reel indices of 0 or more, ascending; `undefined` when `raw` is not a list. */
const reelList = (raw: unknown): number[] | undefined =>
	Array.isArray(raw)
		? [...new Set(raw.filter((v): v is number => Number.isInteger(v) && v >= 0))].sort(
				(a, b) => a - b,
			)
		: undefined;

const isPattern = (v: unknown): v is GrowingWildPattern =>
	GROWING_WILD_PATTERNS.includes(v as GrowingWildPattern);

/** The neighbour offsets `[dReel, dRow]` each pattern copies onto. */
const OFFSETS: Record<GrowingWildPattern, [number, number][]> = {
	plus: [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
	],
	vertical: [
		[0, -1],
		[0, 1],
	],
	horizontal: [
		[-1, 0],
		[1, 0],
	],
	all8: [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	],
};

/**
 * The cells a growing wild at `origin` copies onto, in the order the presentation morphs them,
 * clipped at the board edge (`rows[reel]` is each reel's height). The caller drops the cells it may
 * not overwrite. The mock's `growCells` mirrors this; `check:growing-wilds` holds them equal.
 */
export const growCells = (
	origin: { reel: number; row: number },
	pattern: GrowingWildPattern,
	rows: readonly number[],
): { reel: number; row: number }[] =>
	OFFSETS[pattern]
		.map(([dReel, dRow]) => ({ reel: origin.reel + dReel, row: origin.row + dRow }))
		.filter(({ reel, row }) => reel >= 0 && reel < rows.length && row >= 0 && row < rows[reel]);

/**
 * Normalize an authored block. Its PRESENCE is the feature, so any object normalizes to a block
 * (`symbol: ''` when it names none, the validator's error); anything else is `undefined`. Reels are
 * stored only as given lists (an empty one is dropped, so the default applies), and the pattern only
 * when it is a known one other than the `plus` default.
 */
export function normalizeGrowingWild(raw: unknown): GrowingWildConfig | undefined {
	if (!isRecord(raw)) return undefined;
	const reels = reelList(raw.reels);
	const freeSpinReels = reelList(raw.freeSpinReels);
	return {
		symbol: nameList([raw.symbol])[0] ?? '',
		...(reels?.length ? { reels } : {}),
		...(freeSpinReels?.length ? { freeSpinReels } : {}),
		...(isPattern(raw.pattern) && raw.pattern !== 'plus' ? { pattern: raw.pattern } : {}),
	};
}

/** The reel a growing wild lands on when the block names none: the centre one. */
export const defaultGrowingReels = (numReels: number): number[] => [
	Math.floor(Math.max(1, numReels) / 2),
];

/**
 * The growing wild this game plays, or `undefined` when it has none: no block, a game that does not
 * pay by lines or tumbles, or a symbol that cannot grow. Reels off the grid are dropped; a list left
 * empty falls back to the default.
 */
export function resolveGrowingWild(
	doc: GameConfigDoc | undefined,
): ResolvedGrowingWild | undefined {
	const block = doc?.growingWild;
	if (!doc || !block || !rewritesBoard(doc) || landingWildProblem(doc, block.symbol)) {
		return undefined;
	}
	const reelCount = doc.numReels;
	const onGrid = (reels: number[] | undefined) => reels?.filter((reel) => reel < reelCount);
	const base = onGrid(block.reels);
	const reels = base?.length ? base : defaultGrowingReels(reelCount);
	const free = onGrid(block.freeSpinReels);
	return {
		symbol: block.symbol,
		reels,
		freeSpinReels: free?.length ? free : reels,
		pattern: block.pattern ?? 'plus',
	};
}

/** The block against the rest of the doc. Paths `growingWild…`. */
export const validateGrowingWild = (doc: GameConfigDoc): GameConfigIssue[] => {
	const block = doc.growingWild;
	if (!block) return [];
	const path = 'growingWild';
	const issues = boardRewriteIssues(doc, path, 'A growing wild');
	if (!block.symbol) {
		issues.push({
			severity: 'error',
			path: `${path}.symbol`,
			message: 'No wild is named to grow. Pick a wild, or remove the growing wild.',
		});
	} else {
		const why = landingWildProblem(doc, block.symbol, new Set(symbolsInPlay(doc)));
		if (why) {
			issues.push({
				severity: 'error',
				path: `${path}.symbol`,
				message: `${block.symbol} ${why}, so it cannot be the growing wild. Pick another symbol.`,
			});
		}
	}
	const reelCount = doc.numReels;
	for (const key of ['reels', 'freeSpinReels'] as const) {
		const off = (block[key] ?? []).filter((reel) => reel >= reelCount);
		if (off.length) {
			issues.push({
				severity: 'error',
				path: `${path}.${key}`,
				message: `Reel ${off.map((r) => r + 1).join(', ')} is not on the board, which has ${reelCount} reels. Remove it.`,
			});
		}
	}
	const resolved = resolveGrowingWild(doc);
	if (resolved && !reelsDealing(doc, resolved.symbol).some((r) => resolved.reels.includes(r))) {
		issues.push({
			severity: 'warning',
			path: `${path}.reels`,
			message: `The base game's reel strips never deal ${resolved.symbol} on the reels it may grow from, so it never grows there. Put it on one of those strips, or change its reels.`,
		});
	}
	return issues;
};
