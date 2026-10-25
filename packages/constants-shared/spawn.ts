/**
 * A spawn layer's cap (`docs/design/game-families.md` §3.3) — shared by the live set
 * (`engine-flow-v2` `spawn.ts`), the layer's own reading of its node (`engine-layout`) and the
 * Scene Editor, so all three hold a layer to the same number.
 */

/** The cap a layer gets when it states none. */
export const SPAWN_DEFAULT_CAP = 32;
/** No layer holds more than this, whatever its `cap` says. */
export const SPAWN_HARD_CAP = 256;

/** The cap a layer actually holds: a whole number in 1 … {@link SPAWN_HARD_CAP}. */
export const effectiveSpawnCap = (cap: unknown): number => {
	const n = typeof cap === 'number' && Number.isFinite(cap) ? Math.floor(cap) : SPAWN_DEFAULT_CAP;
	return Math.min(Math.max(1, n), SPAWN_HARD_CAP);
};
