import type { AnticipationTier } from 'utils-slots';

import { SYMBOL_SIZE, REEL_PADDING } from './constants';
import { bakedAnticipation } from '../editor-scenes';
import { stateGame, stateGameDerived } from './stateGame.svelte';

/**
 * Presentation state for the client-computed reel-anticipation MODE (`docs/design/reel-anticipation.md`,
 * Phase 3 — the escalating tease). Pure, config-agnostic readers over the per-reel arming Phase 2 writes
 * (`reelState.anticipationLevel` / `anticipationTier`); the components (`Anticipations`,
 * `AnticipationCamera`) drive the spine stack, grey-out, zoom and SFX off these. No runes here — every
 * function reads the `$state` board directly, so a caller in a reactive context tracks it (same shape as
 * `stateGameDerived`).
 */

export type AnticipationTierFx = {
	/** Camera zoom scale toward the armed span (gentle for `big`, stronger for `mega`/`massive`). */
	zoom: number;
	/** Extra scale on the per-reel overlay spine. */
	overlayScale: number;
	/** Overlay spine alpha. */
	overlayAlpha: number;
	/** MULTIPLY tint on the overlay spine (`0xRRGGBB`) — hotter as the tier climbs. */
	overlayTint: number;
	/** `sfx_anticipation` loop target volume (0..1). */
	soundVolume: number;
};

/**
 * Built-in tier → FX escalation defaults (big → mega → massive). The CODED FALLBACK: Phase 5 makes the
 * values authorable from the Symbols SM editor, and {@link resolveTierFx} merges the authored override
 * over this map — an un-authored project resolves to these bytes exactly (byte-parity with Phase 4). So
 * keep this the ONE fallback seam; do NOT hardcode these values elsewhere, and do NOT read the authored
 * config anywhere but the resolvers below.
 */
export const ANTICIPATION_TIER_FX: Record<AnticipationTier, AnticipationTierFx> = {
	big: { zoom: 1.1, overlayScale: 1, overlayAlpha: 0.85, overlayTint: 0xffffff, soundVolume: 0.7 },
	mega: { zoom: 1.2, overlayScale: 1.12, overlayAlpha: 0.95, overlayTint: 0xffcf4d, soundVolume: 0.85 }, // prettier-ignore
	massive: { zoom: 1.32, overlayScale: 1.24, overlayAlpha: 1, overlayTint: 0xff5a3c, soundVolume: 1 }, // prettier-ignore
};

/** The coded default overlay spine key — a LOCAL game asset (no R2 bundle prefix). The author can swap
 *  it for an R2 spine bundle via `anticipation.spineKey`; the engine still owns the intro→loop→out
 *  chaining, so a swapped rig must expose those animation names. */
export const DEFAULT_ANTICIPATION_SPINE_KEY = 'anticipation';

/** `#rrggbb` → `0xRRGGBB`, or undefined for anything that isn't a 6-digit hex (so a malformed authored
 *  tint falls back to the coded number rather than tinting black). */
const hexToTint = (hex: string): number | undefined => {
	const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
	return m ? parseInt(m[1], 16) : undefined;
};

/**
 * The FX for a tier = the AUTHORED override (Invisible Symbols State Machine, via `bakedAnticipation`)
 * ?? the coded {@link ANTICIPATION_TIER_FX}. THE SINGLE CHOKE POINT: every component reads its FX
 * through this (never `ANTICIPATION_TIER_FX` directly), so an authored value applies everywhere the
 * coded map used to, and an un-authored project resolves byte-identically to Phase 4. Each field falls
 * through independently — a tier that only overrides `zoom` keeps the coded scale/alpha/tint/volume.
 */
export const resolveTierFx = (tier: AnticipationTier): AnticipationTierFx => {
	const coded = ANTICIPATION_TIER_FX[tier];
	const authored = bakedAnticipation()?.tiers?.[tier];
	if (!authored) return coded;
	const tint = authored.overlayTint ? hexToTint(authored.overlayTint) : undefined;
	return {
		zoom: authored.zoom ?? coded.zoom,
		overlayScale: authored.overlayScale ?? coded.overlayScale,
		overlayAlpha: authored.overlayAlpha ?? coded.overlayAlpha,
		overlayTint: tint ?? coded.overlayTint,
		soundVolume: authored.soundVolume ?? coded.soundVolume,
	};
};

/** The per-reel overlay spine key = the authored `anticipation.spineKey` ?? the coded
 *  {@link DEFAULT_ANTICIPATION_SPINE_KEY}. The other choke point (alongside {@link resolveTierFx}):
 *  the overlay component reads this rather than hardcoding `'anticipation'`. */
export const resolveAnticipationSpineKey = (): string =>
	bakedAnticipation()?.spineKey || DEFAULT_ANTICIPATION_SPINE_KEY;

const TIER_RANK: Record<AnticipationTier, number> = { big: 1, mega: 2, massive: 3 };

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

/** Strongest tier across the actively-anticipating reels — the escalation driver for zoom depth + SFX
 *  volume. `null` when nothing is active. */
export const activeMaxTier = (): AnticipationTier | null => {
	let best: AnticipationTier | null = null;
	for (const reel of stateGame.board) {
		if (reel.reelState.anticipationLevel <= 0 || reel.reelState.motion === 'stopped') continue;
		const tier = reel.reelState.anticipationTier;
		if (tier && (!best || TIER_RANK[tier] > TIER_RANK[best])) best = tier;
	}
	return best;
};

/**
 * A reel's symbol-centre X in game (main) space — the coded/default board geometry the recovered overlay
 * used (`boardLayout` + `(reelIndex + REEL_PADDING) · SYMBOL_SIZE`). Exact at board scale 1 (the shipped /
 * dev Borut board); an editor-scaled/gapped board is a Phase-3 seam (design §Non-goals — pixel-accurate
 * framing of a non-default board).
 */
export const reelCenterX = (reelIndex: number): number => {
	const layout = stateGameDerived.boardLayout();
	return layout.x - layout.width * 0.5 + (reelIndex + REEL_PADDING) * SYMBOL_SIZE;
};
