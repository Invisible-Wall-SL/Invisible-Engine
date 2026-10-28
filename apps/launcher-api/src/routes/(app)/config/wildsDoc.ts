import {
	isHoldAndWinSymbol,
	isScatterSymbol,
	type GameConfigDoc,
	type GrowingWildConfig,
	type GrowingWildPattern,
} from 'game-config';

/**
 * How `/config` edits the expanding wilds and the growing wild
 * (`docs/design/expanding-and-growing-wilds.md` §1, §5). Every setter writes what
 * `normalizeGameConfigDoc` would store and nothing else — a default is DELETED rather than written —
 * so the page never looks dirty for a value a save would drop. `check:game-config-family` runs each
 * setter and re-normalizes, so the mirror is gated.
 */

/** The dictionary's wilds that can land and change the board: wild, and neither a scatter nor a
 *  Hold and Win symbol. Whether the strips deal one is shown beside it, not filtered here. */
export const wildChoices = (doc: Pick<GameConfigDoc, 'symbols'>): string[] =>
	Object.entries(doc.symbols)
		.filter(
			([, symbol]) =>
				symbol.special_properties?.includes('wild') &&
				!isScatterSymbol(symbol) &&
				!isHoldAndWinSymbol(symbol),
		)
		.map(([name]) => name);

/** Turn expanding wilds on (naming `first`, when given) or off. The block's presence is the
 *  feature. */
export function setExpandingWildsOn(doc: GameConfigDoc, on: boolean, first?: string): void {
	if (!on) delete doc.expandingWilds;
	else if (!doc.expandingWilds) doc.expandingWilds = { symbols: first ? [first] : [] };
}

/** Add or remove one wild from the expanding list, keeping the others' order. */
export function setExpandingWild(doc: GameConfigDoc, name: string, on: boolean): void {
	const block = doc.expandingWilds;
	if (!block) return;
	const others = block.symbols.filter((s) => s !== name);
	block.symbols = on ? [...others, name] : others;
}

/** `onlyOnWin` is stored only when true, its departure from the default. */
export function setOnlyOnWin(doc: GameConfigDoc, on: boolean): void {
	const block = doc.expandingWilds;
	if (!block) return;
	if (on) block.onlyOnWin = true;
	else delete block.onlyOnWin;
}

/** Turn the growing wild on (naming `first`, or none yet) or off. */
export function setGrowingWildOn(doc: GameConfigDoc, on: boolean, first?: string): void {
	if (!on) delete doc.growingWild;
	else if (!doc.growingWild) doc.growingWild = { symbol: first ?? '' };
}

export function setGrowingSymbol(doc: GameConfigDoc, name: string): void {
	if (doc.growingWild) doc.growingWild.symbol = name.trim();
}

export type GrowingReelsKey = 'reels' | 'freeSpinReels';

/** Tick or untick one 0-based reel. The list keeps only reels on the board, ascending; an empty
 *  list is deleted, so the default applies. */
export function setGrowingReel(
	doc: GameConfigDoc,
	key: GrowingReelsKey,
	reel: number,
	on: boolean,
): void {
	const block = doc.growingWild;
	if (!block) return;
	const kept = (block[key] ?? []).filter((r) => r !== reel && r < doc.numReels);
	const reels = (on ? [...kept, reel] : kept).sort((a, b) => a - b);
	if (reels.length) block[key] = reels;
	else delete block[key];
}

/** `plus` is the default, so it deletes the field. */
export function setGrowingPattern(doc: GameConfigDoc, pattern: GrowingWildPattern): void {
	const block: GrowingWildConfig | undefined = doc.growingWild;
	if (!block) return;
	if (pattern === 'plus') delete block.pattern;
	else block.pattern = pattern;
}
