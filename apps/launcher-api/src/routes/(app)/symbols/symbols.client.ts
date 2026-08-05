/**
 * Client-side helpers for the Invisible Symbols State Machine grid: the cell
 * shape, the override-over-default merge that yields each cell's EFFECTIVE
 * binding, and the save round-trip to the S2 `PUT /api/editor/symbols` endpoint.
 * Kept in step with `$lib/server/symbolsStorage` (the doc schema) and
 * `$lib/server/symbolDefaults` (the coded defaults) — those are server-only, so
 * the structural types are re-declared here for the browser bundle.
 */

import {
	BOOK_SYMBOL_STATES,
	SYMBOL_STATE_LABELS,
	SYMBOL_STATES,
	type SymbolNameEntry,
	type SymbolStateName,
} from 'engine-layout';

export type { SymbolNameEntry };

export { SYMBOL_STATES };
export type SymbolState = SymbolStateName;

/** The book-only states. They mirror new engine states and are valid in the doc for
 *  every game (the schema accepts them), but the grid only SHOWS their columns for a
 *  book game — see {@link visibleStatesFor}. */
export const BOOK_STATES = BOOK_SYMBOL_STATES;
const BOOK_STATE_SET = new Set<SymbolState>(BOOK_STATES);

/** Human labels for the column headers — shared with the Scene Editor's `symbolState`
 *  dropdown so a state reads the same in both tools. */
export const STATE_LABELS: Record<SymbolState, string> = SYMBOL_STATE_LABELS;

/** The columns the grid renders for a given project game type: always the base
 *  states, plus the two book states ONLY for a book game (`gameType === 'bookOf'`).
 *  Mirrors the launcher's `GameKind` ids (`$lib/roles`); kept inline because this
 *  module is browser-side and the roles list is not worth importing for one literal. */
export function visibleStatesFor(gameType: string | undefined): readonly SymbolState[] {
	if (gameType === 'bookOf') return SYMBOL_STATES;
	return SYMBOL_STATES.filter((s) => !BOOK_STATE_SET.has(s));
}

export interface SizeRatios {
	width: number;
	height: number;
}

/** The three binding kinds a cell can take. Derived from ONE exported VALUE rather than a
 *  hand-copied union, so a future kind can't be silently missed by a list that only a type
 *  guards — the launcher build transpiles TS without checking it. Mirrors the server's
 *  `symbolCellSchema.type` enum in `$lib/server/symbolsStorage`. */
export const SYMBOL_CELL_TYPES = ['sprite', 'spine', 'flipbook'] as const;
export type SymbolCellType = (typeof SYMBOL_CELL_TYPES)[number];

/** Human labels for the binding-kind selector. */
export const SYMBOL_CELL_TYPE_LABELS: Record<SymbolCellType, string> = {
	sprite: 'Sprite',
	spine: 'Spine',
	flipbook: 'Flipbook',
};

/** A single symbol×state binding — a static sprite frame, a spine animation, or an Invisible
 *  Flipbook clip. A `sprite` cell is ONE frozen frame, so before flipbooks Spine was the only
 *  way to animate a Spin/Land/Win state. */
export interface SymbolCell {
	type: SymbolCellType;
	assetKey: string;
	animationName?: string;
	/** REQUIRED when `type === 'flipbook'` (the server schema `.refine()`s on it) and never set
	 *  otherwise — the authored clip this cell plays. For a flipbook cell `assetKey` holds the
	 *  clip's PRIMARY sheet manifest key, so the cell is never assetless. */
	clipId?: string;
	/** Tool-only spine resolver hint (`<folder>/<stem>`, e.g. `symbols/h1`) on a
	 *  DEFAULT cell, so the grid previews the specific skeleton of a shared-atlas
	 *  bundle. Display/preview only — `applyDraft` never copies it into an override. */
	previewKey?: string;
	/** Per-cell size override (back-compat read only — the global symbol size now lives on
	 *  the reel grid in the Scene Editor). OPTIONAL on an override cell; always present on a
	 *  DEFAULT cell. */
	sizeRatios?: SizeRatios;
}

/** Symbol name → state → binding (sparse for the override doc, dense for defaults). */
export type SymbolStateMap = Partial<Record<SymbolState, SymbolCell>>;

/** How the global win-frame highlight tints the winning symbols underneath it.
 *  `'fixed'` multiplies by {@link HighlightCell.tintColor}; `'winLine'` multiplies by the paying
 *  line's authored colour (Invisible Game Config `paylineColors`, resolved at win time). Absent ⇒
 *  no tint (the symbol renders untinted, byte-identical to before). */
export type HighlightTintMode = 'fixed' | 'winLine';

/** The global win-frame highlight cell. A spine {@link SymbolCell} plus an optional MULTIPLY tint
 *  the frame applies to the winning symbols it loops over. Lives ONLY on `doc.highlight` — the
 *  generic per-cell `SymbolCell` grid schema is deliberately untouched. */
export type HighlightCell = SymbolCell & {
	tintMode?: HighlightTintMode;
	/** `#rrggbb`, used only when `tintMode === 'fixed'`. */
	tintColor?: string;
};

/** The four kinds a Book-symbol VFX layer can take. Derived from ONE exported VALUE (the
 *  `SYMBOL_CELL_TYPES` / `COMPONENT_PARAM_KINDS` precedent) so the kind toggle can't drift from a
 *  hand-copied union the launcher build never type-checks. Mirrors the server's `bookVfxLayerSchema`
 *  `kind` enum in `$lib/server/symbolsStorage`. */
export const BOOK_VFX_KINDS = ['sprite', 'spine', 'flipbook', 'fx'] as const;
export type BookVfxKind = (typeof BOOK_VFX_KINDS)[number];

/** Human labels for the Book-VFX kind toggle. */
export const BOOK_VFX_KIND_LABELS: Record<BookVfxKind, string> = {
	sprite: 'Sprite',
	spine: 'Spine',
	flipbook: 'Flipbook',
	fx: 'FX',
};

/** The two Book-VFX layer slots (drawn behind / in front of the book symbol). */
export const BOOK_VFX_SLOTS = ['background', 'foreground'] as const;
export type BookVfxSlot = (typeof BOOK_VFX_SLOTS)[number];

/** A single Book-symbol VFX layer. Only the field its `kind` needs is set (the server `.refine()`
 *  enforces this): sprite ⇒ `assetKey`, spine ⇒ `assetKey`+`animationName`, flipbook ⇒ `clipId`
 *  (`assetKey` optionally its primary sheet), fx ⇒ `effectId`. `sizeRatios`/`offset` are optional
 *  × cell fit hints. Mirrors the server `bookVfxLayerSchema`. */
export interface BookVfxLayer {
	kind: BookVfxKind;
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	effectId?: string;
	sizeRatios?: SizeRatios;
	offset?: { x: number; y: number };
}

/** The Book-symbol VFX doc-global — background + foreground layers, both sparse. Mirrors the server
 *  `bookVfxSchema`. */
export interface BookVfxConfig {
	background?: BookVfxLayer;
	foreground?: BookVfxLayer;
}

/** Win-line overlay style — the line drawn across paying symbols. All optional/sparse:
 *  unset fields fall through to the game's coded defaults. Colours are CSS hex strings;
 *  `width` is a multiple of the symbol size; `speed` is a draw-speed multiplier. */
export interface WinLineLineStyle {
	color?: string;
	width?: number;
	glow?: boolean;
	glowColor?: string;
	animated?: boolean;
	speed?: number;
	/** Trace the WHOLE payline (all reels), not just the winning segment. Absent ⇒ off ⇒
	 *  the line stops at the win's end (byte-identical to before). */
	fullPayline?: boolean;
	/** Colour of the full-payline underlay (its only style option). Unset ⇒ coded default. */
	fullPaylineColor?: string;
}

/** Win-amount text style (a bitmap font, so `color` is a tint multiply). `size` is a
 *  multiple of the symbol size. */
export interface WinLineTextStyle {
	font?: string;
	size?: number;
	color?: string;
}

/** Global win-line overlay config. Sparse: `enabled` absent = ON; only `{ enabled: false }`
 *  persists the OFF state; `line`/`text` carry only the fields the author changed. */
export interface WinLineConfig {
	enabled?: boolean;
	line?: WinLineLineStyle;
	text?: WinLineTextStyle;
}

/** The three anticipation escalation tiers (big → mega → massive). Mirrors `utils-slots`'
 *  `AnticipationTier` and the server `anticipationSchema` tier keys. */
export const ANTICIPATION_TIERS = ['big', 'mega', 'massive'] as const;
export type AnticipationTier = (typeof ANTICIPATION_TIERS)[number];

/** Human labels for the per-tier column headers. */
export const ANTICIPATION_TIER_LABELS: Record<AnticipationTier, string> = {
	big: 'Big',
	mega: 'Mega',
	massive: 'Massive',
};

/** The FX values a single anticipation tier can override. All sparse: an unset field falls through
 *  to the coded {@link ANTICIPATION_FX_DEFAULTS}. `overlayTint` is a `#rrggbb` hex (the picker value);
 *  the engine converts it to the `0xRRGGBB` number `ANTICIPATION_TIER_FX` uses. Mirrors the server
 *  `anticipationTierFxSchema`. */
export interface AnticipationTierFx {
	zoom?: number;
	overlayScale?: number;
	overlayAlpha?: number;
	overlayTint?: string;
	soundVolume?: number;
}

/** The reel-anticipation presentation config — the editable twin of the engine's coded
 *  `ANTICIPATION_TIER_FX`. `spineKey` optionally swaps the per-reel overlay spine (a full R2 bundle
 *  prefix, default the coded `anticipation` spine); `tiers` overrides the per-tier escalation FX.
 *  Sparse: absent ⇒ the game keeps its coded FX (byte-parity). Mirrors the server `anticipationSchema`. */
export interface AnticipationConfig {
	spineKey?: string;
	tiers?: Partial<Record<AnticipationTier, AnticipationTierFx>>;
}

/** The coded per-tier FX defaults — a hex-string mirror of the engine's `ANTICIPATION_TIER_FX`
 *  (`apps/lines/src/game/anticipationPresentation.ts`), shown as the input values when the author
 *  hasn't overridden a field. Kept in step with that constant (the launcher can't import from a game
 *  package; the same duplication as the page's `WL_DEFAULTS`). */
export const ANTICIPATION_FX_DEFAULTS: Record<AnticipationTier, Required<AnticipationTierFx>> = {
	big: { zoom: 1.1, overlayScale: 1, overlayAlpha: 0.85, overlayTint: '#ffffff', soundVolume: 0.7 },
	mega: {
		zoom: 1.2,
		overlayScale: 1.12,
		overlayAlpha: 0.95,
		overlayTint: '#ffcf4d',
		soundVolume: 0.85,
	},
	massive: {
		zoom: 1.32,
		overlayScale: 1.24,
		overlayAlpha: 1,
		overlayTint: '#ff5a3c',
		soundVolume: 1,
	},
};

/** The free-spin board-glow override. Mirrors the server `boardGlowSchema`. */
export interface BoardGlowConfig {
	type: 'spine';
	assetKey: string;
	/** Sparse — an unset track keeps its coded `reelhouse_glow_*` name. */
	animations?: { start?: string; idle?: string; exit?: string };
	/** The asset's own fit ratio against the board box; unset = the coded 0.62 × 0.66. */
	sizeRatios?: { width: number; height: number };
}

export interface SymbolsDoc {
	version: 1;
	symbols: Record<string, SymbolStateMap>;
	/** Symbol id → the human word the game says for it (`H1` → "Banana"). Sparse: an unnamed
	 *  symbol is absent and every sentence falls back to printing its id. Read by Invisible Win
	 *  Text as `{symbolName}`; the shared resolution lives in `engine-layout/symbolNames.ts`. */
	names?: Record<string, SymbolNameEntry>;
	/** Global win-frame spine that loops over winning symbols. Absent = the game's
	 *  built-in default (a local `payframe` spine). Set ONLY when the user overrides
	 *  it with an R2 spine bundle; never written for the default. Carries an optional
	 *  MULTIPLY tint (`tintMode`/`tintColor`) applied to the symbols it frames. */
	highlight?: HighlightCell;
	/** Global free-spin board-glow spine — the reel-house backdrop behind the reels. Absent =
	 *  the game's coded `reelhouse` glow. Set ONLY when the user swaps in an R2 spine bundle
	 *  (a Rigger `.irig` rig included); never written for the default. `animations` renames the
	 *  coded start/idle/exit tracks (the engine still owns the chaining); `sizeRatios` is the
	 *  swapped asset's own fit ratio against the board box. */
	boardGlow?: BoardGlowConfig;
	/** Global win-line overlay config (on/off + line + text style). A pure-config field,
	 *  no asset. Absent = the game defaults (overlay ON, gold line). The effective on/off
	 *  is `doc.winLine?.enabled ?? true`; every style field falls through to coded
	 *  defaults when unset. */
	winLine?: WinLineConfig;
	/** Resting-board replay of the winning SYMBOLS. Sparse (`enabled` absent = ON); a sibling of
	 *  `winLine`, never a field inside it — the replay is about the SYMBOLS, and `showLine` only
	 *  opts the line back into each pass. Was USED by the helpers below without ever being
	 *  declared here, which type-checks nowhere because the launcher build only transpiles. */
	winCycle?: {
		enabled?: boolean;
		delay?: number;
		showLine?: boolean;
		showText?: boolean;
		showMessage?: boolean;
		dimNonWinning?: boolean;
	};
	/** Book-symbol VFX — background/foreground presentation layers the game draws behind/in front of
	 *  the book symbol during free spins. Sparse: an absent config, or an absent slot, ships nothing
	 *  and renders byte-identical. Passed through verbatim to `bundle.symbols.bookVfx`. */
	bookVfx?: BookVfxConfig;
	/** Reel-anticipation presentation FX (the escalating tease mode) — the editable twin of the coded
	 *  `ANTICIPATION_TIER_FX`. Sparse: absent ⇒ the game keeps its coded per-tier FX + overlay spine
	 *  (byte-parity with Phase 4). Passed through verbatim to `bundle.symbols.anticipation`. */
	anticipation?: AnticipationConfig;
	updatedAt?: string;
}

export interface SymbolDefaults {
	version: number;
	gameType: string;
	symbols: Record<string, SymbolStateMap>;
	/** The game's built-in win-frame default — display only, so the tool can show
	 *  "current = default (payframe)". Never forced into an override doc. */
	highlight?: HighlightCell;
}

/** The effective binding for a cell = override ?? coded default (may be absent). */
export function effectiveCell(
	doc: SymbolsDoc,
	defaults: SymbolDefaults,
	symbol: string,
	state: SymbolState,
): { cell: SymbolCell | undefined; overridden: boolean } {
	const override = doc.symbols[symbol]?.[state];
	if (override) return { cell: override, overridden: true };
	// Book states (`bookIntro`/`bookIdle`) inherit the symbol's EFFECTIVE win binding
	// (authored override > published/coded default) unless explicitly bound — mirroring
	// the engine's `getSymbolInfo`, so the preview matches what ships in-game.
	if (BOOK_STATE_SET.has(state)) {
		const win = doc.symbols[symbol]?.['win'] ?? defaults.symbols[symbol]?.['win'];
		return { cell: win, overridden: false };
	}
	return { cell: defaults.symbols[symbol]?.[state], overridden: false };
}

/** Set an override cell, returning a NEW doc (immutable update for `$state`). */
export function setOverride(
	doc: SymbolsDoc,
	symbol: string,
	state: SymbolState,
	cell: SymbolCell,
): SymbolsDoc {
	const states: SymbolStateMap = { ...(doc.symbols[symbol] ?? {}), [state]: cell };
	return { ...doc, symbols: { ...doc.symbols, [symbol]: states } };
}

/** Remove an override (reset-to-default), pruning a now-empty symbol. New doc. */
export function clearOverride(doc: SymbolsDoc, symbol: string, state: SymbolState): SymbolsDoc {
	const current = doc.symbols[symbol];
	if (!current || !(state in current)) return doc;
	const states: SymbolStateMap = { ...current };
	delete states[state];
	const symbols = { ...doc.symbols };
	if (Object.keys(states).length === 0) delete symbols[symbol];
	else symbols[symbol] = states;
	return { ...doc, symbols };
}

/** The effective global highlight = override ?? coded default (may be absent). */
export function effectiveHighlight(
	doc: SymbolsDoc,
	defaults: SymbolDefaults,
): { cell: HighlightCell | undefined; overridden: boolean } {
	if (doc.highlight) return { cell: doc.highlight, overridden: true };
	return { cell: defaults.highlight, overridden: false };
}

/** Set the global highlight override, returning a NEW doc (immutable update). The `cell` carries
 *  its own `tintMode`/`tintColor`, so the tint choice travels with the frame binding. */
export function setHighlight(doc: SymbolsDoc, cell: HighlightCell): SymbolsDoc {
	return { ...doc, highlight: cell };
}

/** Clear the global highlight override (reset to the built-in default). New doc. */
export function clearHighlight(doc: SymbolsDoc): SymbolsDoc {
	if (!doc.highlight) return doc;
	const next = { ...doc };
	delete next.highlight;
	return next;
}

/** Set the global board-glow override, returning a NEW doc (immutable update). */
export function setBoardGlow(doc: SymbolsDoc, glow: BoardGlowConfig): SymbolsDoc {
	return { ...doc, boardGlow: glow };
}

/** Clear the board-glow override (reset to the coded `reelhouse` glow). New doc. */
export function clearBoardGlow(doc: SymbolsDoc): SymbolsDoc {
	if (!doc.boardGlow) return doc;
	const next = { ...doc };
	delete next.boardGlow;
	return next;
}

/** Drop blank tier fields + empty tier objects and a now-empty `anticipation`, returning a sparse
 *  config (or undefined). Keeps the doc minimal so an untouched/reset project ships no
 *  `anticipation`. */
function pruneAnticipation(config: AnticipationConfig | undefined): AnticipationConfig | undefined {
	if (!config) return undefined;
	const next: AnticipationConfig = {};
	if (config.spineKey) next.spineKey = config.spineKey;
	const tiers: Partial<Record<AnticipationTier, AnticipationTierFx>> = {};
	for (const tier of ANTICIPATION_TIERS) {
		const fx = config.tiers?.[tier];
		if (!fx) continue;
		const kept = Object.fromEntries(
			Object.entries(fx).filter(([, v]) => v !== undefined && v !== null && v !== ''),
		) as AnticipationTierFx;
		if (Object.keys(kept).length) tiers[tier] = kept;
	}
	if (Object.keys(tiers).length) next.tiers = tiers;
	return Object.keys(next).length ? next : undefined;
}

/** Replace the doc's `anticipation` with a pruned copy (or remove it). New doc. */
function withAnticipation(doc: SymbolsDoc, config: AnticipationConfig): SymbolsDoc {
	const pruned = pruneAnticipation(config);
	const next = { ...doc };
	if (pruned) next.anticipation = pruned;
	else delete next.anticipation;
	return next;
}

/** Merge a patch into one anticipation tier's FX. Pass a field as `undefined` (or the tool's blank)
 *  to reset it to the coded default. Kept sparse via {@link withAnticipation}. New doc. */
export function setAnticipationTierFx(
	doc: SymbolsDoc,
	tier: AnticipationTier,
	patch: Partial<AnticipationTierFx>,
): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	const tiers = { ...(config.tiers ?? {}) };
	tiers[tier] = { ...(tiers[tier] ?? {}), ...patch };
	config.tiers = tiers;
	return withAnticipation(doc, config);
}

/** Set (or, with an empty/undefined key, clear) the overlay spine bundle. Clearing resets to the
 *  coded `anticipation` spine. New doc. */
export function setAnticipationSpineKey(doc: SymbolsDoc, spineKey: string | undefined): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	if (spineKey) config.spineKey = spineKey;
	else delete config.spineKey;
	return withAnticipation(doc, config);
}

/** Reset ALL anticipation FX (per-tier + overlay spine) to the coded defaults — removes the key. */
export function clearAnticipation(doc: SymbolsDoc): SymbolsDoc {
	if (!doc.anticipation) return doc;
	const next = { ...doc };
	delete next.anticipation;
	return next;
}

/** The effective FX value for one tier field = the authored override ?? the coded default. Used by
 *  the tool to show the current value in each input. */
export function anticipationFieldValue<K extends keyof AnticipationTierFx>(
	doc: SymbolsDoc,
	tier: AnticipationTier,
	field: K,
): NonNullable<AnticipationTierFx[K]> {
	const authored = doc.anticipation?.tiers?.[tier]?.[field];
	return (authored ?? ANTICIPATION_FX_DEFAULTS[tier][field]) as NonNullable<AnticipationTierFx[K]>;
}

/** Set one Book-symbol VFX layer (background or foreground), returning a NEW doc (immutable
 *  update). The caller passes a layer already reduced to its kind's fields (the server `.refine()`
 *  rejects a half-authored one). */
export function setBookVfxLayer(
	doc: SymbolsDoc,
	slot: BookVfxSlot,
	layer: BookVfxLayer,
): SymbolsDoc {
	const bookVfx: BookVfxConfig = { ...(doc.bookVfx ?? {}) };
	bookVfx[slot] = layer;
	return { ...doc, bookVfx };
}

/** Clear one Book-symbol VFX layer, pruning a now-empty `bookVfx` so an untouched/reset project
 *  ships nothing (sparse). New doc. */
export function clearBookVfxLayer(doc: SymbolsDoc, slot: BookVfxSlot): SymbolsDoc {
	if (!doc.bookVfx?.[slot]) return doc;
	const bookVfx: BookVfxConfig = { ...doc.bookVfx };
	delete bookVfx[slot];
	const next = { ...doc };
	if (Object.keys(bookVfx).length) next.bookVfx = bookVfx;
	else delete next.bookVfx;
	return next;
}

/** The effective "show win lines" flag = the doc's value ?? `true` (game default). */
export function winLineEnabled(doc: SymbolsDoc): boolean {
	return doc.winLine?.enabled ?? true;
}

/** The effective "keep the winning SYMBOLS animating until the next spin" flag — the game's
 *  `winSymbolCycle`. Defaults to `true`, matching the engine's resolved default. Independent of
 *  {@link winLineEnabled}: the replay never draws the line. */
export function winCycleEnabled(doc: SymbolsDoc): boolean {
	return doc.winCycle?.enabled ?? true;
}

/** The engine's default pause (seconds) between two win-symbol replay passes. */
export const WIN_CYCLE_DELAY_DEFAULT = 0.4;

/** The effective "also redraw the win LINE on each replay pass" flag. Defaults to `true` — the
 *  replay narrates each line the way the spin did unless the author turns it off. */
export function winCycleShowLine(doc: SymbolsDoc): boolean {
	return doc.winCycle?.showLine ?? true;
}

/** The effective "also re-stamp the win AMOUNT TEXT on each replay pass" flag. Defaults to `true`
 *  (the text repeated before this switch existed). Independent of {@link winCycleShowLine}: the
 *  author can keep the line replaying while dropping the stamped amount. */
export function winCycleShowText(doc: SymbolsDoc): boolean {
	return doc.winCycle?.showText ?? true;
}

/** The effective "also re-show that win's INFO TOAST on each replay pass" flag. Defaults to `false`,
 *  UNLIKE its `showLine`/`showText` siblings: the toast never replayed before this switch existed, so
 *  an unset project keeps the message to the round's first presentation (byte-identical). */
export function winCycleShowMessage(doc: SymbolsDoc): boolean {
	return doc.winCycle?.showMessage ?? false;
}

/** The effective "darken the non-winning symbols during the win celebration" flag. Defaults to
 *  `false` (byte-parity — the board stayed full-bright before this switch). Independent of
 *  {@link winCycleEnabled}: the dim is about the whole board, not the replay, so it applies even
 *  when the replay cycle is off. */
export function winCycleDimNonWinning(doc: SymbolsDoc): boolean {
	return doc.winCycle?.dimNonWinning ?? false;
}

/** Drop blank style fields (empty string / undefined / null) and empty `line`/`text`
 *  objects, returning a sparse `winLine` (or undefined when nothing remains). Keeps the
 *  doc minimal so an untouched/reset project ships no `winLine`. */
function pruneWinLine(winLine: WinLineConfig | undefined): WinLineConfig | undefined {
	if (!winLine) return undefined;
	const prune = <T extends object>(style: T | undefined): T | undefined => {
		if (!style) return undefined;
		const out = Object.fromEntries(
			Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== ''),
		);
		return Object.keys(out).length ? (out as T) : undefined;
	};
	const next: WinLineConfig = {};
	if (winLine.enabled === false) next.enabled = false;
	const line = prune(winLine.line);
	const text = prune(winLine.text);
	if (line) next.line = line;
	if (text) next.text = text;
	return Object.keys(next).length ? next : undefined;
}

/** Replace the doc's `winLine` with a pruned copy (or remove it). New doc. */
function withWinLine(doc: SymbolsDoc, winLine: WinLineConfig): SymbolsDoc {
	const pruned = pruneWinLine(winLine);
	const next = { ...doc };
	if (pruned) next.winLine = pruned;
	else delete next.winLine;
	return next;
}

/** Set the global "show win lines" flag, returning a NEW doc (immutable update). Kept
 *  sparse: turning it ON drops the `enabled` field (preserving any style); only OFF
 *  persists `enabled: false`. */
export function setWinLineEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	if (enabled) delete winLine.enabled;
	else winLine.enabled = false;
	return withWinLine(doc, winLine);
}

/** Drop a now-empty `winCycle` so an untouched/reset project ships nothing (sparse). */
function withWinCycle(doc: SymbolsDoc, winCycle: NonNullable<SymbolsDoc['winCycle']>): SymbolsDoc {
	const next = { ...doc };
	if (Object.keys(winCycle).length) next.winCycle = winCycle;
	else delete next.winCycle;
	return next;
}

/** Set the "keep the winning symbols animating until the next spin" flag. Kept sparse: ON drops
 *  the field. New doc. */
export function setWinCycleEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (enabled) delete winCycle.enabled;
	else winCycle.enabled = false;
	return withWinCycle(doc, winCycle);
}

/** Set the pause (seconds) between two win-symbol replay passes. `undefined` resets to the
 *  engine default. New doc. */
export function setWinCycleDelay(doc: SymbolsDoc, seconds: number | undefined): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (seconds === undefined) delete winCycle.delay;
	else winCycle.delay = seconds;
	return withWinCycle(doc, winCycle);
}

/** Set the "also redraw the win line on each replay pass" flag. Kept sparse: ON (the default)
 *  drops the field, only OFF persists `showLine: false`. New doc. */
export function setWinCycleShowLine(doc: SymbolsDoc, showLine: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (showLine) delete winCycle.showLine;
	else winCycle.showLine = false;
	return withWinCycle(doc, winCycle);
}

/** Set the "also re-stamp the win amount text on each replay pass" flag. Kept sparse: ON (the
 *  default) drops the field, only OFF persists `showText: false`. New doc. */
export function setWinCycleShowText(doc: SymbolsDoc, showText: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (showText) delete winCycle.showText;
	else winCycle.showText = false;
	return withWinCycle(doc, winCycle);
}

/** Toggle re-showing the win's info TOAST on each replay pass. INVERSE persistence to its siblings:
 *  `showMessage` defaults OFF, so ON persists `showMessage: true` and OFF drops the field. New doc. */
export function setWinCycleShowMessage(doc: SymbolsDoc, showMessage: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (showMessage) winCycle.showMessage = true;
	else delete winCycle.showMessage;
	return withWinCycle(doc, winCycle);
}

/** Toggle darkening the non-winning symbols during the win celebration. Same INVERSE persistence as
 *  `showMessage` — `dimNonWinning` defaults OFF, so ON persists `dimNonWinning: true` and OFF drops
 *  the field (sparse). New doc. */
export function setWinCycleDimNonWinning(doc: SymbolsDoc, dimNonWinning: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (dimNonWinning) winCycle.dimNonWinning = true;
	else delete winCycle.dimNonWinning;
	return withWinCycle(doc, winCycle);
}

/**
 * Set one form of a symbol's display name. Blank clears that form, and an entry left with no
 * forms is dropped entirely — so clearing the boxes returns the symbol to speaking as its id
 * rather than persisting `{ singular: '' }` (the server prunes identically; both sides must agree
 * or the page reads dirty right after a clean save). New doc.
 */
export function setSymbolName(
	doc: SymbolsDoc,
	symbol: string,
	form: 'singular' | 'plural',
	value: string,
): SymbolsDoc {
	const names = { ...(doc.names ?? {}) };
	const entry: SymbolNameEntry = { ...(names[symbol] ?? {}) };
	const trimmed = value.trim();
	if (trimmed) entry[form] = trimmed;
	else delete entry[form];
	if (Object.keys(entry).length) names[symbol] = entry;
	else delete names[symbol];
	const next = { ...doc };
	if (Object.keys(names).length) next.names = names;
	else delete next.names;
	return next;
}

/** Merge a patch into `winLine.line` (line style). Pass a field as `undefined` to reset
 *  it to the coded default. New doc. */
export function setWinLineLine(doc: SymbolsDoc, patch: Partial<WinLineLineStyle>): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.line = { ...(winLine.line ?? {}), ...patch };
	return withWinLine(doc, winLine);
}

/** Merge a patch into `winLine.text` (win-amount text style). New doc. */
export function setWinLineText(doc: SymbolsDoc, patch: Partial<WinLineTextStyle>): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.text = { ...(winLine.text ?? {}), ...patch };
	return withWinLine(doc, winLine);
}

/** Reset the win-line STYLE to defaults (clears `line`/`text`), keeping the on/off
 *  state. New doc. */
export function clearWinLineStyle(doc: SymbolsDoc): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	delete winLine.line;
	delete winLine.text;
	return withWinLine(doc, winLine);
}

/** Stable JSON for dirty-tracking (key order is fixed by `SYMBOL_STATES`). */
export function docSignature(doc: SymbolsDoc): string {
	const symbols: Record<string, SymbolStateMap> = {};
	for (const name of Object.keys(doc.symbols).sort()) {
		const states = doc.symbols[name];
		const ordered: SymbolStateMap = {};
		for (const state of SYMBOL_STATES) if (states[state]) ordered[state] = states[state];
		symbols[name] = ordered;
	}
	const highlight = doc.highlight
		? {
				type: doc.highlight.type,
				assetKey: doc.highlight.assetKey,
				animationName: doc.highlight.animationName ?? '',
				tintMode: doc.highlight.tintMode ?? '',
				tintColor: doc.highlight.tintColor ?? '',
			}
		: null;
	// Sort style keys so the signature is stable regardless of how fields were merged in.
	const sortKeys = (style: object | undefined): Record<string, unknown> | null => {
		if (!style) return null;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(style).sort()) out[k] = (style as Record<string, unknown>)[k];
		return out;
	};
	const winLine = doc.winLine
		? {
				enabled: doc.winLine.enabled ?? null,
				line: sortKeys(doc.winLine.line),
				text: sortKeys(doc.winLine.text),
			}
		: null;
	const winCycle = doc.winCycle
		? {
				enabled: doc.winCycle.enabled ?? null,
				delay: doc.winCycle.delay ?? null,
				showLine: doc.winCycle.showLine ?? null,
				showText: doc.winCycle.showText ?? null,
				showMessage: doc.winCycle.showMessage ?? null,
				dimNonWinning: doc.winCycle.dimNonWinning ?? null,
			}
		: null;
	// Listed here or an edit never marks the page dirty and Save stays disabled.
	const boardGlow = doc.boardGlow
		? {
				type: doc.boardGlow.type,
				assetKey: doc.boardGlow.assetKey,
				animations: sortKeys(doc.boardGlow.animations),
				sizeRatios: sortKeys(doc.boardGlow.sizeRatios),
			}
		: null;
	// Sorted, so a name typed into an arbitrary row order still yields a stable signature.
	const names: Record<string, unknown> = {};
	for (const symbol of Object.keys(doc.names ?? {}).sort()) {
		const entry = doc.names![symbol];
		names[symbol] = { singular: entry.singular ?? null, plural: entry.plural ?? null };
	}
	// Listed here or an edit to a Book-VFX layer never marks the page dirty and Save stays disabled.
	const bookVfxLayer = (l: BookVfxLayer | undefined): Record<string, unknown> | null =>
		l
			? {
					kind: l.kind,
					assetKey: l.assetKey ?? null,
					animationName: l.animationName ?? null,
					clipId: l.clipId ?? null,
					effectId: l.effectId ?? null,
					sizeRatios: sortKeys(l.sizeRatios),
					offset: sortKeys(l.offset),
				}
			: null;
	const bookVfx = doc.bookVfx
		? {
				background: bookVfxLayer(doc.bookVfx.background),
				foreground: bookVfxLayer(doc.bookVfx.foreground),
			}
		: null;
	// Listed here or an edit to an anticipation tier / the overlay spine never marks the page dirty
	// and Save stays disabled. Tier keys are sorted so the signature is stable.
	const anticipation = doc.anticipation
		? {
				spineKey: doc.anticipation.spineKey ?? null,
				tiers: doc.anticipation.tiers
					? Object.fromEntries(
							ANTICIPATION_TIERS.filter((t) => doc.anticipation!.tiers![t]).map((t) => [
								t,
								sortKeys(doc.anticipation!.tiers![t]),
							]),
						)
					: null,
			}
		: null;
	return JSON.stringify({
		symbols,
		names,
		highlight,
		boardGlow,
		winLine,
		winCycle,
		bookVfx,
		anticipation,
	});
}

/** Raised when a save lost to a concurrent author, so the page can offer a choice
 * instead of surfacing a generic failure. See `docs/design/multi-user-concurrency.md`. */
export class SymbolsConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SymbolsConflictError';
	}
}

/**
 * Persist the doc to R2 via the S2 endpoint; returns the stamped doc + its new ETag.
 *
 * `baseEtag` is the ETag the page loaded — a stale one throws
 * {@link SymbolsConflictError} rather than overwriting a concurrent author. `force`
 * is the author's explicit "overwrite theirs".
 */
export async function saveSymbolsDoc(
	project: string,
	doc: SymbolsDoc,
	baseEtag: string | null,
	force = false,
): Promise<{ doc: SymbolsDoc; etag: string | null }> {
	const res = await fetch(`/api/editor/symbols?project=${encodeURIComponent(project)}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		// The WHOLE doc goes on the wire — deliberately a spread, never a hand-copied field list.
		// It used to enumerate `symbols`/`highlight`/`boardGlow`/`winLine`, so `winCycle` (added
		// later) was silently dropped on every save: the tool showed the author's choice, the PUT
		// never carried it, and the server's response put the default back. Any doc-level field
		// added from here on would have rotted the same way. The server re-validates and rebuilds
		// the doc from its own whitelist (`normalizeSymbolsDoc`, schema `.strip()`), so sending
		// extra keys — `updatedAt`, and the `baseEtag`/`force` envelope below — is safe.
		body: JSON.stringify({
			...doc,
			version: 1,
			...(force ? { force: true } : { baseEtag }),
		}),
	});
	if (res.status === 409) {
		const body = (await res.json().catch(() => ({}))) as { message?: string };
		throw new SymbolsConflictError(
			body.message ?? 'Someone else saved these symbols while you were editing.',
		);
	}
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(msg || `Save failed (${res.status})`);
	}
	const body = (await res.json()) as { doc: SymbolsDoc; etag: string | null };
	return { doc: body.doc, etag: body.etag };
}
