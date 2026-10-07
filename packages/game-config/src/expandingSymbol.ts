import { holdAndWinIsOverlayBonus, isHoldAndWinSymbol } from './holdAndWin';
import { symbolsInPlay, symbolsInPlayFromStrips } from './inPlay';
import { isScatterSymbol } from './serverPaytable';
import type { ExpandingSymbolConfig, GameConfigDoc, GameConfigSymbol } from './types';
import type { GameConfigIssue } from './validate';
import { resolveWinModel } from './winModel';

/**
 * THE EXPANDING SPECIAL — the Book-of mechanic as a Game Config feature
 * (`GameConfigDoc.freeSpins.expandingSymbol`, `docs/design/book-feature.md` §3.1–§3.2).
 *
 * When free spins start, the server draws one paying symbol; on each free spin, once it covers
 * `minReels` reels it expands over them and pays scatter-style. The block states the draw weights
 * and the thresholds. The RGS owns the outcome: on the Invisible Test Server the mock deals from
 * it, a partner server by its own math.
 */

/** Fewest reels the special must cover to expand, when the block names no threshold for it. */
export const DEFAULT_EXPAND_MIN_REELS = 3;

/** One symbol the special may be: its draw weight and how many reels it must cover to expand. */
export type ExpandingCandidate = { symbol: string; weight: number; minReels: number };

/** The special as the game plays it — every symbol it may be drawn as, in dictionary order. */
export type ResolvedExpandingSymbol = { candidates: ExpandingCandidate[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const wholeCount = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** `entries` kept where `keep` holds for the value, on a non-empty key; `undefined` when none is. */
const keptMap = (
	raw: unknown,
	keep: (v: unknown) => v is number,
): Record<string, number> | undefined => {
	if (!isRecord(raw)) return undefined;
	const out = Object.fromEntries(
		Object.entries(raw).filter(([key, value]) => key.trim().length > 0 && keep(value)),
	) as Record<string, number>;
	return Object.keys(out).length ? out : undefined;
};

/**
 * Normalize an authored block. Its PRESENCE is the feature, so any object normalizes to a block
 * (`{}` when nothing in it survives); anything else is `undefined`. Weights that are not positive
 * numbers and thresholds that are not whole numbers of 1 or more are dropped, and so is an empty map.
 */
export function normalizeExpandingSymbol(raw: unknown): ExpandingSymbolConfig | undefined {
	if (!isRecord(raw)) return undefined;
	const weights = keptMap(raw.weights, positive);
	const minReels = keptMap(raw.minReels, wholeCount);
	return { ...(weights ? { weights } : {}), ...(minReels ? { minReels } : {}) };
}

/**
 * Can `name` be the special? It must be dealt (on the strips), pay on a line, and carry no role
 * that pays some other way: not a scatter (its `paytable` is its scatter pay), not a wild, not a
 * Hold and Win role or a pots-overlay token.
 */
const eligible = (
	name: string,
	symbol: GameConfigSymbol | undefined,
	inPlay: ReadonlySet<string>,
): boolean =>
	Boolean(symbol) &&
	inPlay.has(name) &&
	Boolean(symbol?.paytable?.length) &&
	!isScatterSymbol(symbol) &&
	!symbol?.special_properties?.includes('wild') &&
	!isHoldAndWinSymbol(symbol);

/**
 * The expanding special this game plays, or `undefined` when it has none: no block, or free spins
 * off (the block is then kept but inert). The ONE reader — the mock contract, `/config`, the tools'
 * capabilities and the fixtures all go through here.
 *
 * Candidates are the eligible symbols in dictionary order. Without `weights` each is drawn equally
 * (weight 1); with them, only the symbols they name. Each threshold is its `minReels` entry, else
 * {@link DEFAULT_EXPAND_MIN_REELS}.
 */
export function resolveExpandingSymbol(
	doc: Pick<GameConfigDoc, 'freeSpins' | 'symbols' | 'paddingReels'> | undefined,
): ResolvedExpandingSymbol | undefined {
	const block = doc?.freeSpins?.expandingSymbol;
	if (!doc || !block || doc.freeSpins?.enabled === false) return undefined;
	const inPlay = new Set(symbolsInPlayFromStrips(doc.paddingReels));
	const candidates = Object.entries(doc.symbols).flatMap(([name, symbol]) => {
		if (!eligible(name, symbol, inPlay)) return [];
		const weight = block.weights ? (block.weights[name] ?? 0) : 1;
		if (!(weight > 0)) return [];
		return [{ symbol: name, weight, minReels: block.minReels?.[name] ?? DEFAULT_EXPAND_MIN_REELS }];
	});
	return { candidates };
}

/** Every symbol that is both scatter and wild — a Book-of book. A game has at most one. */
export const bookSymbols = (doc: Pick<GameConfigDoc, 'symbols'>): string[] =>
	Object.entries(doc.symbols)
		.filter(([, symbol]) => isScatterSymbol(symbol) && symbol.special_properties?.includes('wild'))
		.map(([name]) => name);

/**
 * The expanding special against the rest of the doc (`docs/design/book-feature.md` §3.2), plus the
 * one rule about the book symbol itself: a game has one book. Paths `freeSpins.expandingSymbol…`.
 */
export const validateExpandingSymbol = (doc: GameConfigDoc): GameConfigIssue[] => {
	const issues: GameConfigIssue[] = [];
	const books = bookSymbols(doc);
	if (books.length > 1) {
		issues.push({
			severity: 'error',
			path: 'symbols',
			message: `${books.join(' and ')} are each both scatter and wild — a game has one book. Take "wild" off all but one.`,
		});
	}

	const block = doc.freeSpins?.expandingSymbol;
	if (!block) return issues;
	const path = 'freeSpins.expandingSymbol';
	if (doc.freeSpins?.enabled === false) {
		issues.push({
			severity: 'warning',
			path,
			message:
				'Free spins are off, so the expanding symbol never plays. It is kept for when you switch them back on.',
		});
		return issues;
	}
	if (resolveWinModel(doc).type !== 'lines') {
		issues.push({
			severity: 'error',
			path,
			message:
				'An expanding symbol pays on every line of the reels it fills, so it needs a game that pays by lines. Choose Lines under How wins are decided, or remove the expanding symbol.',
		});
	}
	if (doc.holdAndWin && !holdAndWinIsOverlayBonus(doc)) {
		issues.push({
			severity: 'error',
			path,
			message:
				'A Hold and Win game has no free spins for a symbol to expand in. Remove the expanding symbol.',
		});
	}

	const inPlay = new Set(symbolsInPlay(doc));
	for (const [name, weight] of Object.entries(block.weights ?? {})) {
		const symbol = doc.symbols[name];
		const why = !symbol
			? 'is not in the symbol dictionary'
			: !inPlay.has(name)
				? 'appears on no reel strip, so it is never dealt'
				: !eligible(name, symbol, inPlay)
					? 'is not a paying line symbol (a scatter, a wild, a coin, or one with no line pays)'
					: undefined;
		if (why && weight > 0) {
			issues.push({
				severity: 'error',
				path: `${path}.weights.${name}`,
				message: `${name} has a draw weight but ${why}, so it can never be the expanding symbol. Remove its weight.`,
			});
		}
	}

	const resolved = resolveExpandingSymbol(doc);
	const candidates = resolved?.candidates ?? [];
	if (!candidates.length) {
		issues.push({
			severity: 'error',
			path,
			message:
				'No symbol can be the expanding symbol: none of the paying line symbols on the strips has a draw weight above 0. Weight at least one.',
		});
	}

	const drawn = new Set(candidates.map((c) => c.symbol));
	for (const [name, reels] of Object.entries(block.minReels ?? {})) {
		if (reels > doc.numReels) {
			issues.push({
				severity: 'error',
				path: `${path}.minReels.${name}`,
				message: `${name} must cover ${reels} reels to expand, but the board has ${doc.numReels}, so it never would. Lower it to ${doc.numReels} or fewer.`,
			});
		} else if (!drawn.has(name)) {
			issues.push({
				severity: 'warning',
				path: `${path}.minReels.${name}`,
				message: `${name} has a reel threshold but can never be drawn as the expanding symbol, so the threshold does nothing.`,
			});
		}
	}

	for (const { symbol, minReels } of candidates) {
		if (minReels > doc.numReels) continue;
		const pays = (doc.symbols[symbol].paytable ?? []).some(
			(row) => (row[String(minReels)] ?? 0) > 0,
		);
		if (!pays) {
			issues.push({
				severity: 'warning',
				path: `${path}.minReels.${symbol}`,
				message: `${symbol} expands once it covers ${minReels} reels, but its line pays have nothing for ${minReels} of a kind, so that expansion pays nothing. Add a ${minReels}-of-a-kind pay or raise its threshold.`,
			});
		}
	}
	return issues;
};
