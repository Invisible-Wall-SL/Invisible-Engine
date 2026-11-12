/**
 * A rig KEPT between plays instead of unmounted and mounted again (`<RigProvider parked restart>`):
 * a reel view's symbol art and win frame, handed one play after another (`apps/lines`
 * `Symbol.svelte`). Each play must draw what a newly mounted rig would, frame for frame, so what a
 * mount does is done again in place, and what an unmount stops is stopped.
 *
 * - **Put away** ({@link putRigAway}): neither updated nor drawn. Its update leaves the ticker, as a
 *   destroyed view's does, so it fires no events and moves no clock while away.
 * - **Brought back** ({@link bringRigBack}): drawn, and its update registered again at the END of
 *   the ticker, where a new view's constructor puts it. Ticker order is observable: a rig event
 *   fires the effect bound to it, whose emitter draws `Math.random`, and the order the rigs update
 *   in is the order those effects start in.
 * - **Started again** ({@link restartRigPose}): the pose and the tracks a new view starts with, the
 *   setup pose and no track, so the animation applied next starts from its first frame with nothing
 *   to mix from. A screen played again in place (`setContextRestart`) uses it too.
 *
 * What `<BaseRigProvider>` measures at a mount it measures again at each play — its size and, for a
 * rig with no authored box, its pivot, both from the first pose — as do its skin and locale, which
 * the setup pose undoes.
 */

/** The parts of a `RigView` this touches. */
export type KeptRig = {
	autoUpdate: boolean;
	visible: boolean;
	state: { clearTracks(): void };
	skeleton: {
		time: number;
		setToSetupPose(): void;
		physicsConstraints: readonly { reset(): void }[];
	};
};

/** Neither updated nor drawn until it is brought back. */
export const putRigAway = (rig: KeptRig): void => {
	rig.autoUpdate = false;
	rig.visible = false;
};

/**
 * Drawn again. `restarted`: a new play starts, so its update goes to the end of the ticker, where a
 * new view's would; otherwise it stays where it is (it is already registered there).
 */
export const bringRigBack = (rig: KeptRig, restarted: boolean): void => {
	if (restarted) rig.autoUpdate = false;
	rig.autoUpdate = true;
	rig.visible = true;
};

/** The setup pose with no track, the skeleton clock at 0 and physics at rest: a new view's start. */
export const restartRigPose = (rig: KeptRig): void => {
	rig.state.clearTracks();
	rig.skeleton.setToSetupPose();
	rig.skeleton.time = 0;
	for (const constraint of rig.skeleton.physicsConstraints) constraint.reset();
};
