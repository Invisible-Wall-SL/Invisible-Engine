import type { AnticipationTier } from 'utils-slots';

import { SYMBOL_SIZE, REEL_PADDING } from './constants';
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
 * Built-in tier → FX escalation defaults (big → mega → massive). These are the Phase-3 defaults; Phase 5
 * makes them authorable from the Symbols SM editor (per anticipation spine + tier), so keep this the ONE
 * seam a per-symbol/per-tier override map will replace — do NOT hardcode these values elsewhere.
 */
export const ANTICIPATION_TIER_FX: Record<AnticipationTier, AnticipationTierFx> = {
	big: { zoom: 1.1, overlayScale: 1, overlayAlpha: 0.85, overlayTint: 0xffffff, soundVolume: 0.7 },
	mega: { zoom: 1.2, overlayScale: 1.12, overlayAlpha: 0.95, overlayTint: 0xffcf4d, soundVolume: 0.85 }, // prettier-ignore
	massive: { zoom: 1.32, overlayScale: 1.24, overlayAlpha: 1, overlayTint: 0xff5a3c, soundVolume: 1 }, // prettier-ignore
};

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
