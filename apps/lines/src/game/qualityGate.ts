/**
 * WHEN THE RENDER QUALITY LADDER MEASURES AND SWITCHES (`pixi-svelte` `configureRenderQuality`).
 * A slot game says it with its machine: measured while a round plays, switched when quiet; this
 * hands that gate back unchanged. An arcade game never leaves the machine's idle, so it is measured
 * while its 2D play field ticks (`<ArcadeStage>` notes each frame), except the first
 * {@link ARCADE_SETTLE_MS} after a level mounts (`arcadePerf.mount`: the room joined, its art
 * landed), and switched in that settling time or while the field is not ticking (a title, a menu):
 * the level is being built then anyway. A 3D field (`<ArcadeStage3D>`) notes no frames, so it is
 * not measured. Imports nothing, so `qualityGate.fixture.ts` runs it in Node.
 */

/** How long after a level mounts the field settles: not measured, and quiet. ms. */
export const ARCADE_SETTLE_MS = 1000;

/** A field tick older than this is a field that stopped (a frame over 250 ms is no frame). ms. */
export const FIELD_STALE_MS = 250;

/** The arcade field's clock: now, its last tick, and its level's last mount (page clock, ms). */
export type FieldClock = { now: number; tickedAt?: number; mountedAt?: number };

export type QualityGate = { measuring: () => boolean; quiet: () => boolean };

let fieldTickedAt: number | undefined;

/** `<ArcadeStage>` ticked the play field this frame. */
export const noteFieldTick = (now: number): void => {
	fieldTickedAt = now;
};

export const lastFieldTick = (): number | undefined => fieldTickedAt;

/** The arcade field is being played: ticking, past its level's settling time. */
export const arcadePlaying = ({ now, tickedAt, mountedAt }: FieldClock): boolean =>
	tickedAt !== undefined &&
	now - tickedAt < FIELD_STALE_MS &&
	!(mountedAt !== undefined && now - mountedAt < ARCADE_SETTLE_MS);

/** The gate for a game: the slot's as given, or the arcade field's read off `clock`. */
export function qualityGate(
	arcade: boolean,
	slot: QualityGate,
	clock: () => FieldClock,
): QualityGate {
	if (!arcade) return slot;
	return {
		measuring: () => arcadePlaying(clock()),
		quiet: () => !arcadePlaying(clock()),
	};
}
