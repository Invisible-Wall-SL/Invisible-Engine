/**
 * Invisible Game Config — `GameConfigDoc` canonicalization (design doc `invisible-game-config.md`).
 *
 * The canonicalizer both the save endpoint and every loader run, mirroring
 * `normalizeFlipbookDoc` / `normalizeEffectDoc`. It strips anything outside the schema so
 * tool-only state can never leak into the shipped doc, and it is idempotent: re-normalizing a
 * normalized doc yields an identical doc (the save→reload fixed point the offline fixture asserts).
 *
 * It returns `undefined` — rather than an empty config — when the input cannot describe a game.
 * That is the load-bearing difference from the sparse docs in this pipeline: a sparse doc degrades
 * to "no overrides" and the coded defaults still render, but an EMPTY config has no symbols and no
 * strips, so shipping one would blank the board. `undefined` means "fall through to the compiled
 * template", which is the dev-parity contract (`runtime → baked → compiled template`).
 *
 * Division of labour with {@link validateGameConfigDoc}: normalization is STRUCTURAL and runs at
 * save time, when the author may legitimately be mid-edit. It drops what cannot be interpreted
 * (a payline that isn't a list of numbers) but keeps what is merely wrong (a payline naming row 3
 * on a 3-row reel, a paytable for a symbol no strip deals). Those are reported as issues by the
 * validator — loud at bake and in the tool, never a silent deletion of the author's work.
 */

import {
	GAME_CONFIG_DOC_VERSION,
	type BetMode,
	type GameConfigDoc,
	type GameConfigSymbol,
	type PaddingReels,
	type PaytableRow,
	type Paylines,
	type ReelStrip,
} from './types';

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** A count/index: a finite non-negative integer. */
const count = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * One paytable row. A multi-key object (`{ '5': 20, '4': 10 }`) is SPLIT into one row per key
 * rather than rejected: the Stake export writes single-entry rows, but a hand-written or
 * tool-emitted config reasonably writes one object, and both mean the same thing.
 */
const normalizePaytable = (raw: unknown): PaytableRow[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const rows: PaytableRow[] = [];
	for (const entry of raw) {
		if (!isObject(entry)) continue;
		for (const [key, payout] of Object.entries(entry)) {
			const occurrences = count(Number(key));
			const pays = num(payout);
			// A zero-occurrence row pays for nothing and a non-numeric payout cannot be rendered.
			if (!occurrences || pays === undefined) continue;
			rows.push({ [String(occurrences)]: pays });
		}
	}
	// Ascending by occurrence count so the paytable renders in a stable order regardless of the
	// key order the math export happened to emit.
	rows.sort((a, b) => Number(Object.keys(a)[0]) - Number(Object.keys(b)[0]));
	return rows.length ? rows : undefined;
};

const normalizeSymbol = (raw: unknown): GameConfigSymbol | undefined => {
	if (!isObject(raw)) return undefined;
	const symbol: GameConfigSymbol = {};
	const paytable = normalizePaytable(raw.paytable);
	if (paytable) symbol.paytable = paytable;
	const properties = Array.isArray(raw.special_properties)
		? raw.special_properties.filter((p): p is string => typeof p === 'string' && p.length > 0)
		: [];
	if (properties.length) symbol.special_properties = properties;
	// An entry with neither payouts nor properties is kept: that is a valid dictionary row for a
	// symbol whose whole definition is its art (a low-pay placeholder, a decorative overlay).
	return symbol;
};

const normalizeSymbols = (raw: unknown): Record<string, GameConfigSymbol> => {
	if (!isObject(raw)) return {};
	const symbols: Record<string, GameConfigSymbol> = {};
	for (const [name, entry] of Object.entries(raw)) {
		if (!name) continue;
		const symbol = normalizeSymbol(entry);
		if (symbol) symbols[name] = symbol;
	}
	return symbols;
};

/** One reel's strip. Bare strings are accepted and lifted to `{ name }` — that is how the strips
 *  read in the tool's paste-in box, and rejecting the shorthand would be a needless trap. */
const normalizeStrip = (raw: unknown): ReelStrip => {
	if (!Array.isArray(raw)) return [];
	const strip: ReelStrip = [];
	for (const cell of raw) {
		const name = typeof cell === 'string' ? cell : isObject(cell) ? str(cell.name) : undefined;
		if (name) strip.push({ name });
	}
	return strip;
};

const normalizePaddingReels = (raw: unknown): PaddingReels => {
	if (!isObject(raw)) return {};
	const reels: PaddingReels = {};
	for (const [gameType, strips] of Object.entries(raw)) {
		if (!gameType || !Array.isArray(strips)) continue;
		const normalized = strips.map(normalizeStrip);
		// Trailing empty strips are dropped but interior ones are KEPT: reel index is positional, so
		// removing reel 2 because it happens to be empty would silently shift reels 3+ left.
		while (normalized.length && !normalized[normalized.length - 1].length) normalized.pop();
		if (normalized.length) reels[gameType] = normalized;
	}
	return reels;
};

const normalizeBetMode = (raw: unknown): BetMode | undefined => {
	if (!isObject(raw)) return undefined;
	const cost = num(raw.cost);
	// Cost is what the bet selector multiplies by; without it the mode cannot be priced at all.
	if (cost === undefined) return undefined;
	return {
		cost,
		feature: bool(raw.feature, false),
		buyBonus: bool(raw.buyBonus, false),
		rtp: num(raw.rtp) ?? 0,
		max_win: num(raw.max_win) ?? 0,
	};
};

const normalizeBetModes = (raw: unknown): Record<string, BetMode> => {
	if (!isObject(raw)) return {};
	const modes: Record<string, BetMode> = {};
	for (const [name, entry] of Object.entries(raw)) {
		if (!name) continue;
		const mode = normalizeBetMode(entry);
		if (mode) modes[name] = mode;
	}
	return modes;
};

const normalizePaylines = (raw: unknown): Paylines => {
	if (!isObject(raw)) return {};
	const lines: Paylines = {};
	for (const [id, rows] of Object.entries(raw)) {
		if (!id || !Array.isArray(rows)) continue;
		const parsed = rows.map(count);
		// A hole in the middle of a line has no drawable meaning, so the whole line goes rather
		// than a partial line that would render as a broken path.
		if (!parsed.length || parsed.some((r) => r === undefined)) continue;
		lines[id] = parsed as number[];
	}
	return lines;
};

/** A `#rgb` / `#rrggbb` hex colour, expanded to the canonical 6-digit lower-case form. Anything
 *  else is dropped — a malformed colour must not reach the renderer, where it would throw. */
const hexColor = (v: unknown): string | undefined => {
	const s = str(v)?.trim().toLowerCase();
	if (!s) return undefined;
	if (/^#[0-9a-f]{6}$/.test(s)) return s;
	if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
	return undefined;
};

/**
 * Per-payline colours. Kept only for a line that actually EXISTS (`validIds`) and only when the
 * value is a real hex colour — a colour for a deleted line, or a typo, is silently dropped rather
 * than shipped to the renderer. Returns `undefined` (the field is then omitted) when nothing valid
 * survives, so an un-coloured config stays byte-identical to before.
 */
const normalizePaylineColors = (
	raw: unknown,
	validIds: Set<string>,
): Record<string, string> | undefined => {
	if (!isObject(raw)) return undefined;
	const colors: Record<string, string> = {};
	for (const [id, value] of Object.entries(raw)) {
		if (!validIds.has(id)) continue;
		const color = hexColor(value);
		if (color) colors[id] = color;
	}
	return Object.keys(colors).length ? colors : undefined;
};

/**
 * Rows per reel. Accepts a scalar (`3` ⇒ every reel 3 rows) as well as the per-reel list, and
 * pads/truncates to `numReels` so the grid is always fully described — a short `numRows` would
 * otherwise leave the last reels with `undefined` height at the consumer.
 */
const normalizeNumRows = (raw: unknown, numReels: number): number[] => {
	const scalar = count(raw);
	if (scalar !== undefined) return Array.from({ length: numReels }, () => scalar);
	const list = Array.isArray(raw) ? raw.map(count) : [];
	const fallback = list.find((r): r is number => r !== undefined && r > 0) ?? 3;
	return Array.from({ length: numReels }, (_unused, i) => list[i] ?? fallback);
};

/**
 * Canonicalize an arbitrary value into a {@link GameConfigDoc}, or `undefined` when it cannot
 * describe a game — i.e. it has no symbol dictionary or no strips. Both are required because the
 * dictionary is what the board can draw and the strips are what the game actually deals; a config
 * missing either would ship a blank or unpayable board.
 *
 * `numReels` is derived from the strips when absent or inconsistent, because the strips are the
 * only self-describing statement of reel count — a stale `numReels` next to a 6-strip
 * `paddingReels` is a config the author edited halfway, and the strips are the half they meant.
 */
export const normalizeGameConfigDoc = (raw: unknown): GameConfigDoc | undefined => {
	if (!isObject(raw)) return undefined;

	const symbols = normalizeSymbols(raw.symbols);
	const paddingReels = normalizePaddingReels(raw.paddingReels);
	if (!Object.keys(symbols).length || !Object.keys(paddingReels).length) return undefined;

	const stripReels = Math.max(...Object.values(paddingReels).map((strips) => strips.length));
	const declaredReels = count(raw.numReels);
	const numReels = declaredReels && declaredReels > 0 ? declaredReels : stripReels;

	const paylines = normalizePaylines(raw.paylines);

	const doc: GameConfigDoc = {
		version: GAME_CONFIG_DOC_VERSION,
		providerName: str(raw.providerName) ?? '',
		gameName: str(raw.gameName) ?? '',
		gameID: str(raw.gameID) ?? '',
		rtp: num(raw.rtp) ?? 0,
		numReels,
		numRows: normalizeNumRows(raw.numRows, numReels),
		betModes: normalizeBetModes(raw.betModes),
		paylines,
		symbols,
		paddingReels,
	};

	const paylineColors = normalizePaylineColors(raw.paylineColors, new Set(Object.keys(paylines)));
	if (paylineColors) doc.paylineColors = paylineColors;

	const updatedAt = str(raw.updatedAt);
	if (updatedAt) doc.updatedAt = updatedAt;
	return doc;
};
