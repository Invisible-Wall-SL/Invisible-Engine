import type { CharacterClips } from '../types';

/**
 * The clips each Salmons character plays once they are in the project (`characterClips.ts`), by
 * character id, drawn at its body's width: `salmon_pink_*` (the golden salmon's are
 * `salmon_golden_*` if made, else the pink ones drawn gold), `bear_*` and `fisherman_*`. The bear
 * and the fisherman walk the banks any way, so theirs are drawn in eight facings (five drawn,
 * three mirrored); the salmon keeps the four diagonals. With none, the code look or the
 * placeholder is drawn.
 *
 * The export writes each into its character's component (`./salmons.ts`); a room drawn in Salmons'
 * art plays them for a character whose published component carries none (`salmonsArt/index.ts`),
 * and the launcher ships the clips under these prefixes for such a project (`clipReachability.ts`).
 * Plain literals, no top-level calls: a runtime that never plays Salmons tree-shakes this module
 * away (`check:runtime-bytes`).
 */
export const SALMONS_CHARACTER_CLIPS = {
	salmon: {
		prefixes: { base: 'salmon_pink', marked: 'salmon_golden' },
		displayWidth: 90,
		idle: 'swim',
		on: { jumped: 'hop', climbed: 'hop', caught: 'caught' },
	},
	bear: {
		prefixes: { base: 'bear' },
		displayWidth: 92,
		idle: 'idle',
		facings: 8,
		walk: 'walk',
		on: { ability: 'swipe' },
	},
	fisherman: {
		prefixes: { base: 'fisherman' },
		displayWidth: 56,
		idle: 'idle',
		facings: 8,
		walk: 'walk',
		holding: 'reel',
		on: { ability: 'cast' },
	},
} as const satisfies Record<string, CharacterClips>;
