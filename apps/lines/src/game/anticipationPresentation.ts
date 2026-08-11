import type { AnticipationTier } from 'utils-slots';

import { bakedAnticipation } from '../editor-scenes';
import { activeBigTiers, boardDimensions } from './gameConfig';
import type { SoundEffectName } from './sound';
import { getSymbolX, stateGame, stateGameDerived } from './stateGame.svelte';

/**
 * Presentation state for the client-computed reel-anticipation MODE (`docs/design/reel-anticipation.md`,
 * Phase 3 — the escalating tease). Pure, config-agnostic readers over the per-reel arming Phase 2 writes
 * (`reelState.anticipationLevel` / `anticipationTier`); the components (`Anticipations`,
 * `AnticipationCamera`) drive the spine stack, grey-out, zoom and SFX off these. No runes here — every
 * function reads the `$state` board directly, so a caller in a reactive context tracks it (same shape as
 * `stateGameDerived`).
 */

export type AnticipationTierFx = {
	/** Camera zoom scale toward the armed span (gentler at the low tiers, stronger as they climb). */
	zoom: number;
	/** Extra scale on the per-reel overlay spine. */
	overlayScale: number;
	/** Overlay spine alpha. */
	overlayAlpha: number;
	/** MULTIPLY tint on the overlay spine (`0xRRGGBB`) — hotter as the tier climbs. */
	overlayTint: number;
	/** Anticipation LOOP target volume (0..1) — the `sfx_anticipation` (or authored `loopSound`) fade-in
	 *  target while this tier is the active max. */
	soundVolume: number;
	/** Activation STING volume (0..1) — the per-play volume of the one-shot `sfx_anticipation_start` (or
	 *  authored `activationSound`) fired when a reel arms this tier. Its own escalation, alongside the
	 *  loop's `soundVolume`. */
	stingVolume: number;
};

/** The coded FX RAMP endpoints — the low (first / smallest big tier) and high (last / largest big
 *  tier) ends of each escalating field. {@link codedTierFx} interpolates across however many big tiers
 *  the config has, so the escalation stays generic (big → … → max) instead of a fixed triple. */
const RAMP_LOW = {
	zoom: 1.1,
	overlayScale: 1,
	overlayAlpha: 0.85,
	soundVolume: 0.7,
	stingVolume: 0.7,
} as const;
const RAMP_HIGH = {
	zoom: 1.32,
	overlayScale: 1.24,
	overlayAlpha: 1,
	soundVolume: 1,
	stingVolume: 1,
} as const;
/** Overlay tint ramps white (cool, lowest tier) → hot orange (highest tier), lerped per channel. */
const TINT_LOW = 0xffffff;
const TINT_HIGH = 0xff5a3c;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpTint = (t: number): number => {
	const r = Math.round(lerp((TINT_LOW >> 16) & 0xff, (TINT_HIGH >> 16) & 0xff, t));
	const g = Math.round(lerp((TINT_LOW >> 8) & 0xff, (TINT_HIGH >> 8) & 0xff, t));
	const b = Math.round(lerp(TINT_LOW & 0xff, TINT_HIGH & 0xff, t));
	return (r << 16) | (g << 8) | b;
};

/**
 * The coded FX for a big tier at 0-based `rank` among `count` configured big tiers — a generic
 * escalation interpolated across the ramp (rank 0 = the low end, rank `count-1` = the high end;
 * `count === 1` collapses to the low end). THE ONE CODED FALLBACK: {@link resolveTierFx} merges the
 * authored per-tier override over this, so an un-authored project resolves to these bytes exactly.
 * Keep this the only place the coded escalation lives — do NOT hardcode tier FX elsewhere, and do NOT
 * read the authored config anywhere but the resolvers below.
 */
export const codedTierFx = (rank: number, count: number): AnticipationTierFx => {
	const clamped = Math.min(Math.max(rank, 0), Math.max(count - 1, 0));
	const t = count <= 1 ? 0 : clamped / (count - 1);
	return {
		zoom: lerp(RAMP_LOW.zoom, RAMP_HIGH.zoom, t),
		overlayScale: lerp(RAMP_LOW.overlayScale, RAMP_HIGH.overlayScale, t),
		overlayAlpha: lerp(RAMP_LOW.overlayAlpha, RAMP_HIGH.overlayAlpha, t),
		overlayTint: lerpTint(t),
		soundVolume: lerp(RAMP_LOW.soundVolume, RAMP_HIGH.soundVolume, t),
		stingVolume: lerp(RAMP_LOW.stingVolume, RAMP_HIGH.stingVolume, t),
	};
};

/** The coded default overlay spine key — a LOCAL game asset (no R2 bundle prefix). The author can swap
 *  it for an R2 spine bundle via `anticipation.spineKey`; the engine still owns the intro→loop→out
 *  chaining, so a swapped rig must expose those animation names. */
export const DEFAULT_ANTICIPATION_SPINE_KEY = 'anticipation';

/** The coded default overlay animation BASE — the engine appends `_intro`/`_loop`/`_out` to it, so this
 *  resolves to the unnumbered `anticipation_intro/_loop/_out` set the mode has always played. The author
 *  can swap it for another set the spine exposes (e.g. `anticipation3`) via `anticipation.animationSet`;
 *  an unset field resolves back to this, so an un-authored project is byte-identical. */
export const DEFAULT_ANTICIPATION_ANIMATION_BASE = 'anticipation';

/** The coded default activation-STING and LOOP sound names — the audiosprite regions the tease has
 *  always used. The author can swap either for another project sound via `anticipation.activationSound`
 *  / `anticipation.loopSound`; an unset field resolves back to these, so an un-authored project is
 *  byte-identical. */
export const DEFAULT_ANTICIPATION_ACTIVATION_SOUND: SoundEffectName = 'sfx_anticipation_start';
export const DEFAULT_ANTICIPATION_LOOP_SOUND: SoundEffectName = 'sfx_anticipation';

/** `#rrggbb` → `0xRRGGBB`, or undefined for anything that isn't a 6-digit hex (so a malformed authored
 *  tint falls back to the coded number rather than tinting black). */
const hexToTint = (hex: string): number | undefined => {
	const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
	return m ? parseInt(m[1], 16) : undefined;
};

/**
 * The FX for a tier ALIAS = the AUTHORED override (Invisible Symbols State Machine, via
 * `bakedAnticipation().tiers[alias]`) merged per-field over the coded {@link codedTierFx} ramp. THE
 * SINGLE CHOKE POINT: every component reads its FX through this (never the ramp directly), so an
 * authored value applies everywhere and an un-authored project resolves byte-identically. The coded
 * default comes from the alias' RANK among the config big tiers (`activeBigTiers`) and how many there
 * are — so escalation stays keyed to the config, not a fixed triple. An unknown/`null` alias (e.g. a
 * trigger-only arm with no big tier) falls to the ramp's lowest step. Each field falls through
 * independently — a tier that only overrides `zoom` keeps the coded scale/alpha/tint/volume.
 */
export const resolveTierFx = (tier: AnticipationTier | null): AnticipationTierFx => {
	const bigTiers = activeBigTiers();
	const rank = tier ? bigTiers.findIndex((t) => t.alias === tier) : -1;
	const coded = codedTierFx(rank < 0 ? 0 : rank, Math.max(bigTiers.length, 1));
	const authored = tier ? bakedAnticipation()?.tiers?.[tier] : undefined;
	if (!authored) return coded;
	const tint = authored.overlayTint ? hexToTint(authored.overlayTint) : undefined;
	return {
		zoom: authored.zoom ?? coded.zoom,
		overlayScale: authored.overlayScale ?? coded.overlayScale,
		overlayAlpha: authored.overlayAlpha ?? coded.overlayAlpha,
		overlayTint: tint ?? coded.overlayTint,
		soundVolume: authored.soundVolume ?? coded.soundVolume,
		stingVolume: authored.stingVolume ?? coded.stingVolume,
	};
};

/** The per-reel overlay spine key = the authored `anticipation.spineKey` ?? the coded
 *  {@link DEFAULT_ANTICIPATION_SPINE_KEY}. The other choke point (alongside {@link resolveTierFx}):
 *  the overlay component reads this rather than hardcoding `'anticipation'`. */
export const resolveAnticipationSpineKey = (): string =>
	bakedAnticipation()?.spineKey || DEFAULT_ANTICIPATION_SPINE_KEY;

/** The overlay animation BASE = the authored `anticipation.animationSet` ?? the coded
 *  {@link DEFAULT_ANTICIPATION_ANIMATION_BASE}. The overlay component builds its
 *  `${base}_intro`/`_loop`/`_out` names from this rather than hardcoding `anticipation_*`, so an author
 *  can select a differently-sized anticipation the spine exposes; the engine still owns the
 *  intro→loop→out chaining. */
export const resolveAnticipationAnimationBase = (): string =>
	bakedAnticipation()?.animationSet || DEFAULT_ANTICIPATION_ANIMATION_BASE;

/** The activation-STING sound name = the authored `anticipation.activationSound` ?? the coded
 *  {@link DEFAULT_ANTICIPATION_ACTIVATION_SOUND}. Sound choke point (alongside {@link resolveLoopSound}):
 *  `Anticipations.svelte` reads this rather than hardcoding the name. A name absent from the game's
 *  audiosprite is declined silently by howler (inaudible), so an author-typo never errors. */
export const resolveActivationSound = (): SoundEffectName =>
	bakedAnticipation()?.activationSound ?? DEFAULT_ANTICIPATION_ACTIVATION_SOUND;

/** The anticipation LOOP sound name = the authored `anticipation.loopSound` ?? the coded
 *  {@link DEFAULT_ANTICIPATION_LOOP_SOUND}. Read by `Anticipations.svelte` for the loop start / fade /
 *  stop, so a swapped loop travels through all three. */
export const resolveLoopSound = (): SoundEffectName =>
	bakedAnticipation()?.loopSound ?? DEFAULT_ANTICIPATION_LOOP_SOUND;

/**
 * Reels currently ARMED (`anticipationLevel > 0`). Kept through the reel settle (the level clears only at
 * the next spin / on a slam), so the per-reel overlay spine stays mounted long enough to play its `out`.
 */
export const armedReelIndices = (): number[] =>
	stateGame.board
		.filter((reel) => reel.reelState.anticipationLevel > 0)
		.map((reel) => reel.reelIndex);

/**
 * Reels ACTIVELY anticipating — armed AND still in motion (not yet settled). Drives the grey-out, the zoom
 * target and the SFX, so all three release the instant the last held reel lands (rather than lingering on
 * the retained level until the next spin).
 */
export const activeReelIndices = (): number[] =>
	stateGame.board
		.filter((reel) => reel.reelState.anticipationLevel > 0 && reel.reelState.motion !== 'stopped')
		.map((reel) => reel.reelIndex);

export const isAnticipationActive = (): boolean => activeReelIndices().length > 0;

/** The tier ALIAS of the actively-anticipating reel with the highest stack level (`anticipationLevel`
 *  = the config big-tier rank) — the escalation driver for zoom depth + SFX volume. `null` when
 *  nothing is active, or the highest reel armed on the trigger axis alone (no big-tier alias). */
export const activeMaxTier = (): AnticipationTier | null => {
	let best: AnticipationTier | null = null;
	let bestLevel = 0;
	for (const reel of stateGame.board) {
		const level = reel.reelState.anticipationLevel;
		if (level <= 0 || reel.reelState.motion === 'stopped') continue;
		if (level > bestLevel) {
			bestLevel = level;
			best = reel.reelState.anticipationTier;
		}
	}
	return best;
};

/**
 * A reel's symbol-centre X in game (main / world) space. The overlay stack renders as a SIBLING of
 * `<Board/>` inside `MainContainer` (world space), so this world-maps the SAME reactive board-local
 * `getSymbolX` the real reel symbols use through the board container transform
 * (`world = layout.x + (local − pivot) · scale`). This makes the overlay/dim follow a resized, gapped
 * or nudged board automatically (the owner's bigger-cell board). On the DEFAULT board (no `reelGrid`
 * override) `getSymbolX` reproduces `SYMBOL_SIZE · (reelIndex + REEL_PADDING)`, `scale === 1` and
 * `pivot.x === width/2`, so this is byte-identical to the previous
 * `layout.x − layout.width·0.5 + (reelIndex + REEL_PADDING)·SYMBOL_SIZE`.
 */
export const reelCenterX = (reelIndex: number): number => {
	const layout = stateGameDerived.boardLayout();
	return layout.x + (getSymbolX(reelIndex) - layout.pivot.x) * layout.scale;
};

/**
 * A single reel column's VISIBLE cell width in world space — the live `cellWidthLocal` mapped through
 * the board scale, so the overlay/dim fill the ACTUAL cell on a resized/gapped board. Default board:
 * `SYMBOL_SIZE · 1 === SYMBOL_SIZE` (byte-parity with the old fixed dim width).
 */
export const reelColumnWidth = (): number => {
	const layout = stateGameDerived.boardLayout();
	return stateGameDerived.boardGeometry().cellWidthLocal * layout.scale;
};

/**
 * The full reel-column HEIGHT in world space — the ACTUAL visible-cluster span mapped through the board
 * scale. The exact span is `(rows − 1) · rowPitch + cellHeight` (row centres span `(rows−1)·pitch`, plus
 * half a cell each end), so it grows with enlarged cells / row gaps instead of assuming a gap-less
 * `SYMBOL_SIZE`-per-cell column — the old `layout.height` (= `SYMBOL_SIZE · rows`) understated the height
 * on a resized/gapped board, so the dim didn't reach the top/bottom rows. Default board:
 * `(rows−1)·SYMBOL_SIZE + SYMBOL_SIZE === SYMBOL_SIZE · rows`, i.e. byte-parity with the old dim.
 */
export const boardColumnHeight = (): number => {
	const layout = stateGameDerived.boardLayout();
	const { rowPitchLocal, cellHeightLocal } = stateGameDerived.boardGeometry();
	const rows = boardDimensions().y;
	return ((rows - 1) * rowPitchLocal + cellHeightLocal) * layout.scale;
};

/** The board's vertical CENTRE in world space (the container `y`, since its anchor is {0.5, 0.5}). */
export const boardCenterYWorld = (): number => stateGameDerived.boardLayout().y;

/** The per-reel overlay spine's base box, as a fraction of ONE cell — the original coded beam
 *  proportions (a tall narrow glow, NOT the full column: the grey-out fills the column, the spine is a
 *  beam over it). THE CODED DEFAULT: the author can override either via `anticipation.overlayWidthCells`
 *  / `overlayHeightCells` (e.g. a full-column ~1×5 box for a 5-tile animation instead of this beam);
 *  `fx.overlayScale` still multiplies on top per tier. */
export const DEFAULT_OVERLAY_WIDTH_CELLS = 0.56;
export const DEFAULT_OVERLAY_HEIGHT_CELLS = 1.6;

/** The overlay box size in CELLS = the authored `anticipation.overlayWidthCells`/`overlayHeightCells`
 *  ?? the coded {@link DEFAULT_OVERLAY_WIDTH_CELLS}/{@link DEFAULT_OVERLAY_HEIGHT_CELLS}. A non-positive
 *  authored value is ignored (falls back to the coded default), so a cleared/blank field never collapses
 *  the overlay. The engine scales the chosen animation to fit this box, so a taller box renders a
 *  full-column anticipation at its intended size instead of squeezed into the beam. */
const resolveOverlayWidthCells = (): number => {
	const v = bakedAnticipation()?.overlayWidthCells;
	return typeof v === 'number' && v > 0 ? v : DEFAULT_OVERLAY_WIDTH_CELLS;
};
const resolveOverlayHeightCells = (): number => {
	const v = bakedAnticipation()?.overlayHeightCells;
	return typeof v === 'number' && v > 0 ? v : DEFAULT_OVERLAY_HEIGHT_CELLS;
};

/** The overlay spine's world-space WIDTH — the resolved width-in-cells of the live cell width. Unset ⇒
 *  `SYMBOL_SIZE · 0.56`, byte-identical to the original overlay (before it followed the board). */
export const overlayBaseWidth = (): number => reelColumnWidth() * resolveOverlayWidthCells();

/** The overlay spine's world-space HEIGHT — the resolved height-in-cells of the live cell height. Unset
 *  ⇒ `SYMBOL_SIZE · 1.6`, byte-identical to the original overlay. Scales with a resized cell instead of
 *  filling the whole column (which doubled the beam on a bigger board). */
export const overlayBaseHeight = (): number => {
	const layout = stateGameDerived.boardLayout();
	return (
		stateGameDerived.boardGeometry().cellHeightLocal * layout.scale * resolveOverlayHeightCells()
	);
};
