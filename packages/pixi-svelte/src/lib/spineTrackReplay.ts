/**
 * The `<SpineTrack>` re-apply decision, extracted as a pure function so it can be exercised
 * without a renderer (see `packages/pixi-svelte/fixtures/spineTrackReplay.fixture.ts`).
 *
 * The track is applied from a VALUE comparison — "is the live track already playing what the
 * props ask for?" — which is right for a declarative animation binding but wrong for an EVENT.
 * A signal cue ("Plays on signal") fires the SAME animation name repeatedly: the second fire is
 * value-identical to the first, so the comparison says "already playing" and the spine sits on
 * the finished track's last frame forever. `replay` carries a monotonic fire token alongside the
 * name so a repeat fire is distinguishable from a no-op re-render.
 *
 * `replay: undefined` (every non-cued spine) short-circuits to the original comparison, so a
 * spine driven only by `defaultAnimation` / a button state animation is byte-identical.
 */
export type SpineTrackSnapshot = {
	trackIndex: number;
	animationName: string | null | undefined;
} | null;

export const shouldApplySpineAnimation = ({
	trackIndex,
	animationName,
	then,
	replay,
	appliedReplay,
	track,
}: {
	trackIndex: number;
	animationName: string | null;
	then: string | undefined;
	replay: number | undefined;
	appliedReplay: number | undefined;
	track: SpineTrackSnapshot;
}): boolean => {
	// An event fired again — re-apply even though the name is unchanged.
	if (replay !== undefined && replay !== appliedReplay) return true;
	if (!track || trackIndex !== track.trackIndex) return true;
	// Not when the live track has merely advanced to the queued `then` animation, which would
	// otherwise restart the primary in a loop.
	return animationName !== track.animationName && then !== track.animationName;
};
