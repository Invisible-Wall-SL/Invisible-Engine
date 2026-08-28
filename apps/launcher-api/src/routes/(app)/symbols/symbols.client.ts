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
	CASCADE_SYMBOL_STATES,
	SWAP_SYMBOL_STATES,
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
/** The `stacked` state is NEVER a grid column: the stacked-picture reel mode's tall art is authored in
 *  the dedicated "Stacked pictures" section of the `/symbols` page (height + which-symbols + art), not
 *  per-cell. The member stays in `engine-layout`'s `SYMBOL_STATES`/labels (the engine still uses it as a
 *  fallback) — it is just filtered out of {@link visibleStatesFor} here. */
const NON_GRID_STATE_SET = new Set<SymbolState>(['stacked']);

/** The cascade-only states. Same deal as {@link BOOK_STATES}: the doc accepts them for every game,
 *  but the grid only shows their columns for a project that actually tumbles — see
 *  {@link visibleStatesFor}. */
export const CASCADE_STATES = CASCADE_SYMBOL_STATES;
const CASCADE_STATE_SET = new Set<SymbolState>(CASCADE_STATES);

/** The swap-only states. Same deal again: the doc accepts `intro` for every game, but the grid only
 *  shows its column for a project whose board actually EMERGES — see {@link visibleStatesFor}. */
export const SWAP_STATES = SWAP_SYMBOL_STATES;
const SWAP_STATE_SET = new Set<SymbolState>(SWAP_STATES);

/** Human labels for the column headers — shared with the Scene Editor's `symbolState`
 *  dropdown so a state reads the same in both tools. */
export const STATE_LABELS: Record<SymbolState, string> = SYMBOL_STATE_LABELS;

/**
 * Column-header tooltips, for the states whose NAME does not carry the whole rule.
 *
 * Partial on purpose: a state gets an entry only when leaving it out would mislead. `Tumble
 * explosion` needs one because an EMPTY cell there is not a gap — it inherits `Explosion` — and a
 * blank column that silently works is exactly the kind of thing an author re-authors by hand.
 */
export const STATE_HINTS: Partial<Record<SymbolState, string>> = {
	intro:
		'The animation this symbol plays when it APPEARS on its seat, under the Emerge swap style — rising out of water, fading up, growing. Nothing travels: this animation IS the arrival. Leave a cell empty to fall back to this symbol’s Land binding.',
	tumbleExplosion:
		'The explosion played when the cascade REMOVES this symbol, as opposed to the Explosion played when something morphs it in place on the reel. Leave a cell empty to reuse this symbol’s Explosion binding.',
};

/** The columns the grid renders for a given project: always the base states, plus the two book states
 *  ONLY for a book game (`gameType === 'bookOf'`), the cascade state for a project that tumbles OR
 *  clears its board on a swap, and the swap state (`intro`) ONLY for a project that emerges. Every
 *  gate is RESOLVED server-side (`resolveCascade` / `resolveReelBehaviour`), so an authored
 *  `/config` answer beats the win model's default and a lines game that turned the tumble ON gets
 *  the column. The `stacked` state is never a column (see {@link NON_GRID_STATE_SET}). Mirrors the
 *  launcher's `GameKind` ids (`$lib/roles`); kept inline because this module is browser-side and the
 *  roles list is not worth importing for one literal. */
export function visibleStatesFor(
	gameType: string | undefined,
	gates: { cascade?: boolean; emerge?: boolean; clears?: boolean } = {},
): readonly SymbolState[] {
	return SYMBOL_STATES.filter((s) => {
		if (NON_GRID_STATE_SET.has(s)) return false;
		if (BOOK_STATE_SET.has(s)) return gameType === 'bookOf';
		// The cascade state is played by TWO things, not one: a tumble removing a symbol, and the
		// swap-in-place CLEAR step (`clearOutgoingSymbols`) emptying the board before the new symbols
		// arrive. Gating it on `cascade` alone hid the column from exactly the projects authoring the
		// second — a swapping lines game — which then had to bind it through `Explosion`'s silent
		// inheritance. Either reason earns the column.
		if (CASCADE_STATE_SET.has(s)) return Boolean(gates.cascade || gates.clears);
		if (SWAP_STATE_SET.has(s)) return Boolean(gates.emerge);
		return true;
	});
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
	/** Repeat this state's animation instead of holding on its last frame. Absent ⇒ loop. */
	loop?: boolean;
	/**
	 * `flipbook` cells only — PER-STATE overrides of the bound clip's own playback. Absent ⇒ the
	 * clip decides, so a clip re-authored in /flipbook still moves every state that never
	 * overrode it. The mirror flags are genuinely tri-state: an explicit `false` un-mirrors a
	 * clip that IS mirrored, which is why they are booleans and not just "set or unset".
	 *
	 * Mirrors `FlipbookNode`'s block in `engine-layout` and `SymbolCellInfo`'s in `engine-game`;
	 * the server's `symbolCellSchema` is the one that has to agree, since it is `.strict()`.
	 */
	fps?: number;
	direction?: 'forward' | 'reverse' | 'pingpong';
	flipX?: boolean;
	flipY?: boolean;
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
	/** Draw the line in the winning payline's colour from the Invisible Game Config (when it has
	 *  one), falling back to the `color` swatch. Absent ⇒ ON (the historic behaviour: config colour
	 *  wins, swatch is the fallback). Persist ONLY the OFF override (`false`), which makes the
	 *  `color` swatch authoritative and ignores the config colour. */
	useConfigColor?: boolean;
	/** Show EVERY paying line of the round at the same time (each appearing a beat after the last,
	 *  all staying on screen together) instead of one after another. Absent ⇒ OFF ⇒ the default
	 *  narration. Only the ON override persists. */
	allAtOnce?: boolean;
	/** Seconds between two lines appearing in all-at-once mode. Unset ⇒ coded default. */
	allAtOnceDelay?: number;
}

/** Win-amount text style (a bitmap font, so `color` is a tint multiply). `size` is a
 *  multiple of the symbol size. */
export interface WinLineTextStyle {
	/** Whether the amount is stamped at all — the text's OWN switch, independent of the line's, so
	 *  a project can stamp the amount with no line under it. Absent ⇒ it follows the line's switch
	 *  (what a pre-split doc's single toggle meant). */
	enabled?: boolean;
	font?: string;
	size?: number;
	color?: string;
	/** WHERE the amount is stamped: at the winning line's end (`'line'`, absent ⇒ the default) or in
	 *  the middle of the reel window (`'boardCenter'`). Only the non-default value persists. */
	placement?: 'line' | 'boardCenter';
}

/** Global win-line overlay config. Sparse: `enabled` is the LINE's switch — absent = ON, only
 *  `{ enabled: false }` persists the OFF state; the amount text has its own `text.enabled`.
 *  `line`/`text` carry only the fields the author changed. */
export interface WinLineConfig {
	enabled?: boolean;
	line?: WinLineLineStyle;
	text?: WinLineTextStyle;
}

/** One stacked symbol's authored config — the tall picture that fills `height` cells for the
 *  stacked-picture reel mode. `art` is a {@link SymbolCell} (sprite frame / spine bundle+animation /
 *  flipbook clip), authored with the SAME picker the grid cells use. The tall picture is the ONLY thing
 *  a stacked symbol renders. Mirrors the server `stackedSymbolSchema`. */
export interface StackedSymbol {
	name: string;
	/** How many CELLS tall the picture is (≥ 1) — the crop denominator. */
	height: number;
	art: SymbolCell;
	/** The WINNING variant of the tall picture — what the stack shows while it is part of a paying line
	 *  (typically the spine/flipbook that animates the payout, where `art` is a still). Optional and
	 *  INHERITING: absent ⇒ the stack keeps showing `art` through the win. */
	winArt?: SymbolCell;
}

/** Stacked-picture config. `enabled` is the per-project master toggle (default OFF, the INVERSE of
 *  {@link WinLineConfig}): it shows the "Stacked pictures" config block AND gates whether the stacked
 *  config bakes. `symbols` is the authored per-symbol tall art + height — the editable twin of the old
 *  coded `STACKED_PICTURE.heights`, shipped through the normal symbol export/bake chain as
 *  `bundle.symbols.stacked`. Sparse: a disabled/un-authored project persists nothing. Mirrors the server
 *  `stackedPicturesSchema`. */
export interface StackedPicturesConfig {
	enabled?: boolean;
	/** When true, a tall picture shows ONLY at full stack height; a landed run shorter than the
	 *  symbol's authored height falls back to the normal single icons. Absent/false ⇒ a partial run
	 *  shows the top N/M crop (default). Mirrors the server `stackedPicturesSchema`. */
	fullHeightOnly?: boolean;
	/** When true, a partial run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF tall
	 *  picture (the visible slice of a symbol scrolled partly off-screen) regardless of
	 *  `fullHeightOnly` — any run length, even 1. Independent toggle. Mirrors the server schema. */
	edgeCutoffs?: boolean;
	/** How long (ms) a stacked cell holds its win beat — the knob that matches that beat to an authored
	 *  {@link StackedSymbol.winArt} animation. Absent ⇒ the game's coded default. */
	winHoldMs?: number;
	symbols?: StackedSymbol[];
}

/** The default height (cells) a symbol gets when first made stacked — a picture spanning two cells is
 *  the minimal "stacked". The author re-picks it in the height input. */
export const STACKED_HEIGHT_DEFAULT = 2;

/** The coded win-beat hold (ms) a stacked cell uses when `winHoldMs` is unset — mirrors the game's
 *  `STACKED_WIN_HOLD_MS`. Shown as the placeholder in the tool so the author knows what they inherit. */
export const STACKED_WIN_HOLD_MS_DEFAULT = 650;

/** An anticipation escalation tier — the ALIAS of a config-authored big-win tier (`/config`). The
 *  panel renders ONE FX column per configured big tier, keyed by alias (no longer a fixed
 *  big/mega/massive triple). Mirrors `utils-slots`' `AnticipationTier` and the server schema. */
export type AnticipationTier = string;

/** The FX values a single anticipation tier can override. All sparse: an unset field falls through
 *  to the coded {@link codedTierFx} ramp. `overlayTint` is a `#rrggbb` hex (the picker value); the
 *  engine converts it to the `0xRRGGBB` number it uses. Mirrors the server `anticipationTierFxSchema`. */
export interface AnticipationTierFx {
	zoom?: number;
	overlayScale?: number;
	overlayAlpha?: number;
	overlayTint?: string;
	/** Anticipation LOOP target volume (0..1). */
	soundVolume?: number;
	/** Activation STING per-play volume (0..1) — the one-shot arm cue, escalating alongside the loop. */
	stingVolume?: number;
}

/** The reel-anticipation presentation config — the editable twin of the engine's coded FX ramp.
 *  `spineKey` optionally swaps the per-reel overlay spine (a full R2 bundle prefix, default the coded
 *  `anticipation` spine); `tiers` overrides the per-tier escalation FX, keyed by the config big-win
 *  tier ALIAS. Sparse: absent ⇒ the game keeps its coded FX (byte-parity). Mirrors the server
 *  `anticipationSchema`. */
export interface AnticipationConfig {
	spineKey?: string;
	/** The overlay animation SET — the base name the engine appends `_intro`/`_loop`/`_out` to
	 *  (e.g. `anticipation3` → `anticipation3_intro/_loop/_out`). Lets the author pick among the spine's
	 *  differently-sized anticipations. Absent ⇒ the coded unnumbered `anticipation_*` set. */
	animationSet?: string;
	/** The per-reel overlay box size, in CELLS (1 = one symbol). The engine scales the chosen animation
	 *  to fit, so a taller box shows a full-column anticipation instead of the coded beam. Absent ⇒ the
	 *  coded `0.56 × 1.6` beam. */
	overlayWidthCells?: number;
	overlayHeightCells?: number;
	/** GLOBAL authored sound names — one activation STING + one LOOP for the whole mode (NOT per-tier).
	 *  Absent ⇒ the game's coded `sfx_anticipation_start` / `sfx_anticipation`. */
	activationSound?: string;
	loopSound?: string;
	tiers?: Record<string, AnticipationTierFx>;
}

/** Ramp endpoints — a hex-string mirror of the engine's `codedTierFx`
 *  (`apps/lines/src/game/anticipationPresentation.ts`). Kept in step with that function (the launcher
 *  can't import from a game package; the same duplication as the page's `WL_DEFAULTS`). */
const RAMP_LOW = {
	zoom: 1.1,
	overlayScale: 1,
	overlayAlpha: 0.85,
	soundVolume: 0.7,
	stingVolume: 0.7,
};
const RAMP_HIGH = {
	zoom: 1.32,
	overlayScale: 1.24,
	overlayAlpha: 1,
	soundVolume: 1,
	stingVolume: 1,
};
const TINT_LOW = 0xffffff;
const TINT_HIGH = 0xff5a3c;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpTintHex = (t: number): string => {
	const chan = (shift: number): number =>
		Math.round(lerp((TINT_LOW >> shift) & 0xff, (TINT_HIGH >> shift) & 0xff, t));
	return `#${[chan(16), chan(8), chan(0)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

/** The coded FX shown in a tier's inputs when the author hasn't overridden a field — the ramp step
 *  for the tier at 0-based `rank` among `count` configured big tiers (rank 0 = low end, `count-1` =
 *  high end; `count === 1` collapses to the low end). Mirrors the engine's `codedTierFx`. */
export function codedTierFx(rank: number, count: number): Required<AnticipationTierFx> {
	const clamped = Math.min(Math.max(rank, 0), Math.max(count - 1, 0));
	const t = count <= 1 ? 0 : clamped / (count - 1);
	return {
		zoom: lerp(RAMP_LOW.zoom, RAMP_HIGH.zoom, t),
		overlayScale: lerp(RAMP_LOW.overlayScale, RAMP_HIGH.overlayScale, t),
		overlayAlpha: lerp(RAMP_LOW.overlayAlpha, RAMP_HIGH.overlayAlpha, t),
		overlayTint: lerpTintHex(t),
		soundVolume: lerp(RAMP_LOW.soundVolume, RAMP_HIGH.soundVolume, t),
		stingVolume: lerp(RAMP_LOW.stingVolume, RAMP_HIGH.stingVolume, t),
	};
}

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
	/** PER-SYMBOL SOUND: symbol id → state → audiosprite key, the cue THIS symbol plays entering
	 *  THAT state. Sparse at both levels; a symbol/state with no entry falls through to the
	 *  game-wide sound SLOT for that moment (Invisible Game Config → Sounds), which is where the
	 *  engine's shipped defaults live. A separate section rather than a field on the state cell
	 *  because the doc merges cell-by-cell over the coded map — a cell carrying only a sound would
	 *  replace the binding and take the state's ART with it. */
	symbolSounds?: Record<string, Record<string, string>>;
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
	/** Stacked-picture reel-mode config — the master toggle (`enabled`, default OFF) plus the authored
	 *  per-symbol tall art + height (`symbols`). Sparse: a disabled/un-authored project persists nothing.
	 *  When enabled with ≥1 symbol it bakes as `bundle.symbols.stacked`, each `art` asset riding the same
	 *  export/bake chain as a per-cell binding. */
	stackedPictures?: StackedPicturesConfig;
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
		holdAfterBigWin?: boolean;
	};
	/** Book-symbol VFX — background/foreground presentation layers the game draws behind/in front of
	 *  the book symbol during free spins. Sparse: an absent config, or an absent slot, ships nothing
	 *  and renders byte-identical. Passed through verbatim to `bundle.symbols.bookVfx`. */
	bookVfx?: BookVfxConfig;
	/** Reel-anticipation presentation FX (the escalating tease mode) — the editable twin of the coded
	 *  `codedTierFx` ramp. Sparse: absent ⇒ the game keeps its coded per-tier FX + overlay spine
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

/** Which state a cell INHERITS its binding from when it has none of its own. Mirrors the engine's
 *  `resolveSymbolState` (`apps/lines/src/game/symbolCell.ts`) — the ONE rule that decides what a
 *  symbol actually draws — so the grid shows what ships instead of an empty cell the game fills in.
 *
 *  Deliberately stops short of that rule's LAST resort (any unauthored state falls back to `static`).
 *  That arm is a crash-guard, not an authoring rule: mirroring it here would paint every unbound cell
 *  with the symbol's resting art and destroy the grid's only signal for "nothing is bound here". The
 *  arms below are different — each is advertised in the UI (the `Tumble explosion` and `Intro` column
 *  hints, the book-state docs), so the preview owes the author a matching picture. */
const INHERITS_FROM = (state: SymbolState): SymbolState | null => {
	// Book states (`bookIntro`/`bookIdle`) mirror the live win art.
	if (BOOK_STATE_SET.has(state)) return 'win';
	// A project that binds ONE explosion keeps the cascade it already had — the second binding
	// exists only so a game CAN use a different skeleton when the tumble removes a symbol.
	if (state === 'tumbleExplosion') return 'explosion';
	// An emerge with no authored intro plays the symbol's ordinary LAND animation, so the grid shows
	// that rather than an empty cell — the column hint advertises the inheritance, so the preview
	// owes the author the matching picture.
	if (state === 'intro') return 'land';
	return null;
};

/** A cell only renders if it names the asset to render — the engine's `isUsableCell`. */
const usable = (cell: SymbolCell | undefined): boolean => Boolean(cell?.assetKey);

/**
 * The effective binding for a cell = override ?? coded default ?? the state it INHERITS from
 * ({@link INHERITS_FROM}), any of which may be absent.
 *
 * `inheritedFrom` names the donor state when the cell has no binding of its own, so the grid can
 * say so rather than presenting borrowed art as if it were authored here.
 */
export function effectiveCell(
	doc: SymbolsDoc,
	defaults: SymbolDefaults,
	symbol: string,
	state: SymbolState,
): { cell: SymbolCell | undefined; overridden: boolean; inheritedFrom?: SymbolState } {
	/** A state's own binding: the authored override first, then the published/coded default. */
	const own = (s: SymbolState): SymbolCell | undefined =>
		doc.symbols[symbol]?.[s] ?? defaults.symbols[symbol]?.[s];

	const mine = own(state);
	const overridden = Boolean(doc.symbols[symbol]?.[state]);
	// The state's OWN binding wins, exactly as `resolveSymbolState` checks `states[state]` first.
	// (Book states used to skip this and jump straight to `win`, so a published default `bookIntro`
	// showed the win art here while the game played the bookIntro one.)
	if (usable(mine)) return { cell: mine, overridden };

	const donor = INHERITS_FROM(state);
	if (donor) {
		const inherited = own(donor);
		if (usable(inherited)) return { cell: inherited, overridden: false, inheritedFrom: donor };
	}
	return { cell: mine, overridden };
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
	if (config.animationSet) next.animationSet = config.animationSet;
	if (typeof config.overlayWidthCells === 'number' && config.overlayWidthCells > 0)
		next.overlayWidthCells = config.overlayWidthCells;
	if (typeof config.overlayHeightCells === 'number' && config.overlayHeightCells > 0)
		next.overlayHeightCells = config.overlayHeightCells;
	if (config.activationSound) next.activationSound = config.activationSound;
	if (config.loopSound) next.loopSound = config.loopSound;
	// Per-tier fields survive the generic Object.entries filter below (blank/undefined dropped), so a new
	// tier field like `stingVolume` needs no allowlist entry here — the whitelist that matters is the
	// config-level one above (spineKey/activationSound/loopSound).
	const tiers: Record<string, AnticipationTierFx> = {};
	for (const [alias, fx] of Object.entries(config.tiers ?? {})) {
		if (!fx) continue;
		const kept = Object.fromEntries(
			Object.entries(fx).filter(([, v]) => v !== undefined && v !== null && v !== ''),
		) as AnticipationTierFx;
		if (Object.keys(kept).length) tiers[alias] = kept;
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
	const tiers: Record<string, AnticipationTierFx> = { ...(config.tiers ?? {}) };
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

/** Set (or, with an empty/undefined base, clear) the overlay ANIMATION SET — the base name the engine
 *  appends `_intro`/`_loop`/`_out` to. Clearing resets to the coded unnumbered `anticipation_*` set.
 *  New doc. */
export function setAnticipationAnimationSet(
	doc: SymbolsDoc,
	animationSet: string | undefined,
): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	if (animationSet) config.animationSet = animationSet;
	else delete config.animationSet;
	return withAnticipation(doc, config);
}

/** Set (or, with a non-positive/undefined value, clear) an overlay box dimension in CELLS. Clearing
 *  resets to the coded default (`0.56` wide / `1.6` tall). New doc. */
export function setAnticipationOverlayCells(
	doc: SymbolsDoc,
	axis: 'width' | 'height',
	cells: number | undefined,
): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	const key = axis === 'width' ? 'overlayWidthCells' : 'overlayHeightCells';
	if (typeof cells === 'number' && cells > 0) config[key] = cells;
	else delete config[key];
	return withAnticipation(doc, config);
}

/** Set (or, with an empty/undefined name, clear) the GLOBAL activation-STING sound. Clearing resets to
 *  the coded `sfx_anticipation_start`. New doc. */
export function setAnticipationActivationSound(
	doc: SymbolsDoc,
	name: string | undefined,
): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	if (name) config.activationSound = name;
	else delete config.activationSound;
	return withAnticipation(doc, config);
}

/** Set (or, with an empty/undefined name, clear) the GLOBAL anticipation LOOP sound. Clearing resets to
 *  the coded `sfx_anticipation`. New doc. */
export function setAnticipationLoopSound(doc: SymbolsDoc, name: string | undefined): SymbolsDoc {
	const config: AnticipationConfig = { ...(doc.anticipation ?? {}) };
	if (name) config.loopSound = name;
	else delete config.loopSound;
	return withAnticipation(doc, config);
}

/** Reset ALL anticipation FX (per-tier + overlay spine) to the coded defaults — removes the key. */
export function clearAnticipation(doc: SymbolsDoc): SymbolsDoc {
	if (!doc.anticipation) return doc;
	const next = { ...doc };
	delete next.anticipation;
	return next;
}

/** The effective FX value for one tier field = the authored override ?? the coded ramp default for the
 *  tier at 0-based `rank` among `count` configured big tiers. Used by the tool to show the current
 *  value in each input. */
export function anticipationFieldValue<K extends keyof AnticipationTierFx>(
	doc: SymbolsDoc,
	tier: AnticipationTier,
	rank: number,
	count: number,
	field: K,
): NonNullable<AnticipationTierFx[K]> {
	const authored = doc.anticipation?.tiers?.[tier]?.[field];
	return (authored ?? codedTierFx(rank, count)[field]) as NonNullable<AnticipationTierFx[K]>;
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

/** The effective "draw the win LINE" flag = the doc's value ?? `true` (game default). Governs the
 *  traced line only — the stamped amount is {@link winLineTextEnabled}. */
export function winLineEnabled(doc: SymbolsDoc): boolean {
	return doc.winLine?.enabled ?? true;
}

/** The effective "stamp the win AMOUNT" flag. Falls back to {@link winLineEnabled} when unset, so
 *  every doc authored before the two were split reads exactly as its single toggle meant; once the
 *  author touches this section it stands on its own (text with no line, or a line with no amount). */
export function winLineTextEnabled(doc: SymbolsDoc): boolean {
	return doc.winLine?.text?.enabled ?? winLineEnabled(doc);
}

/** The effective stamp PLACEMENT: at the winning line's end, or centred in the reel window. */
export function winLineTextPlacement(doc: SymbolsDoc): 'line' | 'boardCenter' {
	return doc.winLine?.text?.placement ?? 'line';
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

/** The effective "after a big win in free spins, wait for a SPIN press before the next free spin"
 *  flag. Defaults to `false` (byte-parity — the feature ran unbroken before this switch).
 *  Independent of {@link winCycleEnabled}, which only decides whether the held board also replays
 *  its paying lines. */
export function winCycleHoldAfterBigWin(doc: SymbolsDoc): boolean {
	return doc.winCycle?.holdAfterBigWin ?? false;
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
	if (line) {
		// `useConfigColor` defaults ON (absent ⇒ config colour wins), so ONLY its OFF override
		// persists — a `true` is the default and must drop to keep an untouched doc byte-identical.
		if (line.useConfigColor !== false) delete line.useConfigColor;
		// `allAtOnce` defaults OFF, so only the ON override persists — and its delay is meaningless
		// without it, so that drops with it.
		if (line.allAtOnce !== true) {
			delete line.allAtOnce;
			delete line.allAtOnceDelay;
		}
		if (Object.keys(line).length) next.line = line;
	}
	if (text) {
		// The amount's switch DEFAULTS to the line's, and its placement defaults to the line's end —
		// so a value equal to its default drops, keeping an untouched project shipping no `winLine`.
		if (text.enabled === (winLine.enabled ?? true)) delete text.enabled;
		if (text.placement === 'line') delete text.placement;
		if (Object.keys(text).length) next.text = text;
	}
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

/** Set the "draw the win LINE" flag, returning a NEW doc (immutable update). Kept
 *  sparse: turning it ON drops the `enabled` field (preserving any style); only OFF
 *  persists `enabled: false`.
 *
 *  The amount's switch DEFAULTS to this one, so flipping the line would silently drag the text with
 *  it — unless the text is pinned first. Pinning its current effective value keeps the amount
 *  exactly where the author left it; `pruneWinLine` then drops the pin again whenever it happens to
 *  agree with the new line state, so the doc stays sparse. */
export function setWinLineEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.text = { ...(winLine.text ?? {}), enabled: winLineTextEnabled(doc) };
	if (enabled) delete winLine.enabled;
	else winLine.enabled = false;
	return withWinLine(doc, winLine);
}

/** Set the "stamp the win AMOUNT" flag, returning a NEW doc. Sparse via `pruneWinLine`: the flag
 *  persists only while it DISAGREES with the line's, since that is its default. */
export function setWinLineTextEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.text = { ...(winLine.text ?? {}), enabled };
	return withWinLine(doc, winLine);
}

/** The effective "author stacked-picture art" flag = the doc's value ?? `false`. Defaults OFF (the
 *  INVERSE of {@link winLineEnabled}), so an un-toggled project hides the "Stacked picture" column and
 *  ships nothing. */
export function stackedPicturesEnabled(doc: SymbolsDoc): boolean {
	return doc.stackedPictures?.enabled === true;
}

/** Drop a stacked symbol with no valid art + a now-empty `stackedPictures`, then replace the doc's
 *  config (or remove it). New doc. Keeps the config sparse so a disabled/un-authored project ships
 *  nothing, and — mirroring the server's `pruneStackedPictures` — never lets a blank-art entry through
 *  (the schema's `art.assetKey` is required, so a blank one would 400 the save). */
function withStackedPictures(doc: SymbolsDoc, config: StackedPicturesConfig): SymbolsDoc {
	const next: StackedPicturesConfig = {};
	if (config.enabled === true) next.enabled = true;
	if (config.fullHeightOnly === true) next.fullHeightOnly = true;
	if (config.edgeCutoffs === true) next.edgeCutoffs = true;
	if (config.winHoldMs !== undefined) next.winHoldMs = config.winHoldMs;
	// Mirrors the server's `pruneStackedPictures`: a half-picked `winArt` is dropped (an absent win
	// picture is legal — the stack just keeps showing `art` while it pays).
	const symbols = (config.symbols ?? [])
		.filter((s) => s.name && s.art?.assetKey)
		.map((s) => (s.winArt?.assetKey ? s : { name: s.name, height: s.height, art: s.art }));
	if (symbols.length) next.symbols = symbols;
	const out = { ...doc };
	if (Object.keys(next).length) out.stackedPictures = next;
	else delete out.stackedPictures;
	return out;
}

/** Set the stacked-picture master toggle, returning a NEW doc. Kept sparse (the INVERSE of
 *  {@link setWinLineEnabled}): ON persists `enabled: true`; OFF drops the flag. Any authored `symbols`
 *  are PRESERVED across a toggle (so an accidental off doesn't discard the author's work) — they just
 *  stop baking while the toggle is off, since {@link withStackedPictures} keeps them but the exporter
 *  gates on `enabled`. */
export function setStackedPicturesEnabled(doc: SymbolsDoc, enabled: boolean): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	if (enabled) config.enabled = true;
	else delete config.enabled;
	return withStackedPictures(doc, config);
}

/** Set the global "full-height only" flag, returning a NEW doc. Sparse (like the master toggle):
 *  ON persists `fullHeightOnly: true`; OFF drops the flag (default ⇒ partial runs crop the picture).
 *  Routes through {@link withStackedPictures} so the flag survives every rebuild — a direct mutation
 *  would be stripped the next time any other stacked control edits the config. */
export function setStackedFullHeightOnly(doc: SymbolsDoc, value: boolean): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	if (value) config.fullHeightOnly = true;
	else delete config.fullHeightOnly;
	return withStackedPictures(doc, config);
}

/** Set the global "edge cut-offs" flag, returning a NEW doc. Sparse (like the master toggle): ON
 *  persists `edgeCutoffs: true`; OFF drops the flag (default ⇒ edge partials follow `fullHeightOnly`).
 *  Independent of `fullHeightOnly` — a partial run at the top/bottom edge renders a cut-off tall
 *  picture. Routes through {@link withStackedPictures} so the flag survives every rebuild. */
export function setStackedEdgeCutoffs(doc: SymbolsDoc, value: boolean): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	if (value) config.edgeCutoffs = true;
	else delete config.edgeCutoffs;
	return withStackedPictures(doc, config);
}

/** The authored stacked symbols (empty when none). */
export function stackedSymbols(doc: SymbolsDoc): StackedSymbol[] {
	return doc.stackedPictures?.symbols ?? [];
}

/** Add (or replace) a stacked symbol with its seeded tall `art` + `height`. New doc. Re-adding an
 *  existing name replaces it, so the caller never creates a duplicate. */
export function addStackedSymbol(
	doc: SymbolsDoc,
	name: string,
	art: SymbolCell,
	height: number = STACKED_HEIGHT_DEFAULT,
): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	const symbols = (config.symbols ?? []).filter((s) => s.name !== name);
	symbols.push({ name, height, art });
	config.symbols = symbols;
	return withStackedPictures(doc, config);
}

/** Remove a stacked symbol (un-stack it), pruning a now-empty config. New doc. */
export function removeStackedSymbol(doc: SymbolsDoc, name: string): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	config.symbols = (config.symbols ?? []).filter((s) => s.name !== name);
	return withStackedPictures(doc, config);
}

/** Set one stacked symbol's height (cells tall, clamped to ≥ 1). New doc. */
export function setStackedSymbolHeight(doc: SymbolsDoc, name: string, height: number): SymbolsDoc {
	const clamped = Math.max(1, Math.round(height) || 1);
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	config.symbols = (config.symbols ?? []).map((s) =>
		s.name === name ? { ...s, height: clamped } : s,
	);
	return withStackedPictures(doc, config);
}

/** One stacked symbol's two picture SLOTS: the resting picture every stack shows by default, and the
 *  optional winning variant it swaps to while it pays. Named so the tool's one picker panel can write
 *  either without a second set of setters. */
export type StackedArtSlot = 'art' | 'winArt';

/** Set one stacked symbol's tall art for a slot (the picker "Apply"). New doc. */
export function setStackedSymbolArt(
	doc: SymbolsDoc,
	name: string,
	art: SymbolCell,
	slot: StackedArtSlot = 'art',
): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	config.symbols = (config.symbols ?? []).map((s) =>
		s.name !== name ? s : slot === 'winArt' ? { ...s, winArt: art } : { ...s, art },
	);
	return withStackedPictures(doc, config);
}

/** Clear one stacked symbol's WIN picture, so the stack falls back to showing `art` while it pays.
 *  Only the optional slot can be cleared — `art` is what the entry exists for. New doc. */
export function clearStackedSymbolWinArt(doc: SymbolsDoc, name: string): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	config.symbols = (config.symbols ?? []).map((s) =>
		s.name === name ? { name: s.name, height: s.height, art: s.art } : s,
	);
	return withStackedPictures(doc, config);
}

/** Set the stacked win-beat hold (ms) — how long a stacked cell stays in its win state, so the beat can
 *  match an authored `winArt` animation. `undefined` (or a negative value) drops the key ⇒ the game's
 *  coded default. New doc. */
export function setStackedWinHoldMs(doc: SymbolsDoc, value: number | undefined): SymbolsDoc {
	const config: StackedPicturesConfig = { ...(doc.stackedPictures ?? {}) };
	if (value === undefined || !Number.isFinite(value) || value < 0) delete config.winHoldMs;
	else config.winHoldMs = Math.round(value);
	return withStackedPictures(doc, config);
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

/** Toggle waiting for a SPIN press after a big win inside a free-spin feature. Same INVERSE
 *  persistence as `dimNonWinning` — defaults OFF, so ON persists `holdAfterBigWin: true` and OFF
 *  drops the field (sparse). New doc. */
export function setWinCycleHoldAfterBigWin(doc: SymbolsDoc, hold: boolean): SymbolsDoc {
	const winCycle = { ...(doc.winCycle ?? {}) };
	if (hold) winCycle.holdAfterBigWin = true;
	else delete winCycle.holdAfterBigWin;
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

/** Reset the LINE style to defaults (clears `line`), keeping every on/off state and the amount
 *  text untouched — the two are separate sections in the tool, so each resets only its own. New doc. */
export function clearWinLineLineStyle(doc: SymbolsDoc): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	delete winLine.line;
	return withWinLine(doc, winLine);
}

/** Reset the win-amount TEXT style to defaults (font/size/colour/placement), keeping the section's
 *  own on/off state. New doc. */
export function clearWinLineTextStyle(doc: SymbolsDoc): SymbolsDoc {
	const winLine: WinLineConfig = { ...(doc.winLine ?? {}) };
	winLine.text =
		winLine.text?.enabled === undefined ? undefined : { enabled: winLine.text.enabled };
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
	// Listed here or a stacked-picture edit (toggle / symbol / height / art) never marks the page dirty
	// and Save stays disabled. Symbols sorted by name so an arbitrary add order still hashes stable.
	const stackedPictures = doc.stackedPictures
		? {
				enabled: doc.stackedPictures.enabled ?? null,
				fullHeightOnly: doc.stackedPictures.fullHeightOnly ?? null,
				edgeCutoffs: doc.stackedPictures.edgeCutoffs ?? null,
				symbols: doc.stackedPictures.symbols
					? [...doc.stackedPictures.symbols]
							.sort((a, b) => a.name.localeCompare(b.name))
							.map((s) => ({
								name: s.name,
								height: s.height,
								art: {
									type: s.art.type,
									assetKey: s.art.assetKey,
									animationName: s.art.animationName ?? null,
									clipId: s.art.clipId ?? null,
								},
							}))
					: null,
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
				animationSet: doc.anticipation.animationSet ?? null,
				overlayWidthCells: doc.anticipation.overlayWidthCells ?? null,
				overlayHeightCells: doc.anticipation.overlayHeightCells ?? null,
				activationSound: doc.anticipation.activationSound ?? null,
				loopSound: doc.anticipation.loopSound ?? null,
				tiers: doc.anticipation.tiers
					? Object.fromEntries(
							Object.keys(doc.anticipation.tiers)
								.sort()
								.map((t) => [t, sortKeys(doc.anticipation!.tiers![t])]),
						)
					: null,
			}
		: null;
	// Listed here or binding a per-symbol sound never marks the page dirty and Save stays disabled —
	// the same trap every sibling above carries a warning about. Both levels sorted, so a cue picked
	// in an arbitrary row order still hashes stable.
	const symbolSounds: Record<string, unknown> = {};
	for (const symbol of Object.keys(doc.symbolSounds ?? {}).sort()) {
		const states = doc.symbolSounds![symbol];
		const ordered: Record<string, string> = {};
		for (const state of SYMBOL_STATES) if (states[state]) ordered[state] = states[state];
		symbolSounds[symbol] = ordered;
	}
	return JSON.stringify({
		symbols,
		names,
		symbolSounds,
		highlight,
		boardGlow,
		winLine,
		stackedPictures,
		winCycle,
		bookVfx,
		anticipation,
	});
}

/**
 * Bind (or clear) ONE symbol's cue for ONE state. New doc, sparse at both levels: a blank name drops
 * the state, and a symbol left with no states drops entirely — so clearing every dropdown round-trips
 * to no `symbolSounds` key at all rather than leaving an empty object that reads as "authored".
 * Mirrors the server's prune in `symbolsStorage.ts`.
 */
export function withSymbolSound(
	doc: SymbolsDoc,
	symbol: string,
	state: string,
	name: string,
): SymbolsDoc {
	const all = { ...(doc.symbolSounds ?? {}) };
	const states = { ...(all[symbol] ?? {}) };
	if (name) states[state] = name;
	else delete states[state];
	if (Object.keys(states).length) all[symbol] = states;
	else delete all[symbol];
	const next = { ...doc };
	if (Object.keys(all).length) next.symbolSounds = all;
	else delete next.symbolSounds;
	return next;
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
