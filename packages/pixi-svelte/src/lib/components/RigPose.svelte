<script lang="ts" module>
	import type { RigBoneOffset } from '../rigBoneOffset';

	/** Hold `animation` at `time`: a share of its length (0 = its first frame, 1 = its last), or,
	 *  with `unit: 'seconds'`, a clip-local time clamped to the clip (a timeline strip's time).
	 *  `fromSetup` poses from the SETUP pose each frame (a timeline strip: the rig shows this clip
	 *  and nothing else, as a track does — a bone the previous clip keyed and this one does not
	 *  returns to setup, as `AnimationState` mixes it out); absent ⇒ on top of what is playing. */
	export type RigPoseScrub = {
		animation: string;
		time: number;
		unit?: 'share' | 'seconds';
		fromSetup?: boolean;
	};
	/** Offset `bone` on top of whatever poses it — see `rigBoneOffset.ts`. */
	export type RigPoseBone = { bone: string; offset: RigBoneOffset };

	export type Props = { scrubs?: RigPoseScrub[]; bones?: RigPoseBone[] };
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import * as RIG from 'engine-rig/pixi';

	import { getContextRig } from '../context.svelte';
	import { applyRigBoneOffset, isIdentityBoneOffset } from '../rigBoneOffset';
	import { emitRigPoseClips, emitRigPoseEvent } from '../rigPoseEvents';

	/**
	 * Pose a playing rig on top of its animation, every frame — the rig half of a layout value
	 * binding (`engine-layout` targets `animTime` and `bone`).
	 *
	 * It runs on the rig's world-transform hooks, after the animation state has applied:
	 * 1. Each SCRUB applies its animation at the held time, replacing the channels that animation keys.
	 *    It goes through `Animation.apply`, so a value binding's scrub fires none of the animation's
	 *    events (a track entry would replay every event up to the time on each new entry, and those
	 *    reach the game bus through `rebroadcastEvents`). A timeline STRIP (`unit: 'seconds'`) plays
	 *    its clip, so the events its playhead crosses go to the rig's bound content only
	 *    (`rigPoseEvents.ts`) — the effects and clips keyed on them play, the game bus hears nothing.
	 * 2. Each BONE offset is applied on top of that.
	 * After the world transform the offsets are undone, last first, so an unkeyed channel never
	 * compounds.
	 *
	 * Scrubs come before bones, in one place, so a bone can grow on top of a scrubbed pose; two
	 * separate hooks would run in mount order instead. Props are read untracked at frame time: the
	 * hook can fire inside another component's effect (`RigTrack` calls `rig.update(0)`). The
	 * hooks are chained, not replaced, and unlinked on unmount while still at the head of the chain
	 * (else left inert).
	 */
	const props: Props = $props();
	const rig = getContextRig();

	const warned: Record<string, true> = {};
	const warnOnce = (key: string, message: string): void => {
		if (warned[key]) return;
		warned[key] = true;
		console.warn(`[RigPose] ${message}`);
	};

	/** Where a scrub's events land: dropped for a value binding, reported for a strip. */
	const droppedEvents: RIG.Event[] = [];
	/** A strip's last applied time per animation: the next apply reports the events between. */
	const stripTimes: Record<string, number> = {};
	/** The clips the strips played on the last pose, as a key, reported when it changes. */
	let stripClips = '';
	let restores: (() => void)[] = [];
	const pose = (): void =>
		untrack(() => {
			const skeleton = rig.skeleton;
			const scrubs = props.scrubs ?? [];
			// A strip scrub owns the rig: reset to the setup pose first, so a bone, slot colour or
			// attachment keyed by an earlier clip (the intro) and not by this one (the idle) does not
			// linger — `AnimationState` resets those to setup when it mixes the old entry out, and a
			// `replace` apply alone would keep them (measured: the authored idle drifted from the
			// coded one from the intro's end on, `check:win-parity` base).
			if (scrubs.some((scrub) => scrub.fromSetup)) skeleton.setToSetupPose();
			const clips = scrubs.filter((s) => s.unit === 'seconds').map((s) => s.animation);
			const clipsKey = [...new Set(clips)].sort().join('\n');
			if (clipsKey !== stripClips) {
				stripClips = clipsKey;
				emitRigPoseClips(rig, new Set(clips));
			}
			for (const { animation: name, time, unit } of scrubs) {
				const animation = skeleton.data.findAnimation(name);
				if (!animation) {
					warnOnce(
						`a:${name}`,
						`no animation "${name}" on this skeleton — the scrub does nothing.`,
					);
					continue;
				}
				const at =
					unit === 'seconds'
						? Math.min(animation.duration, Math.max(0, time))
						: Math.min(1, Math.max(0, time)) * animation.duration;
				// A strip reports what its playhead crossed since the last apply; a playhead that moved
				// back (the state re-entered, or a loop wrapped) starts a new pass from before 0, so a
				// key at 0 fires again. A key in the last frame of a wrapping loop can be skipped.
				const strip = unit === 'seconds';
				const last = strip ? stripTimes[name] : undefined;
				const from = last !== undefined && last <= at ? last : -1;
				animation.apply(
					skeleton,
					strip ? from : at,
					at,
					false,
					droppedEvents,
					1,
					RIG.MixBlend.replace,
					RIG.MixDirection.mixIn,
				);
				if (strip) {
					stripTimes[name] = at;
					for (const event of droppedEvents) emitRigPoseEvent(rig, name, event);
				}
				droppedEvents.length = 0;
			}
			for (const { bone: name, offset } of props.bones ?? []) {
				if (isIdentityBoneOffset(offset)) continue;
				const bone = skeleton.findBone(name);
				if (bone) restores.push(applyRigBoneOffset(bone, offset));
				else warnOnce(`b:${name}`, `no bone "${name}" on this skeleton — the offset does nothing.`);
			}
		});
	const unpose = (): void => {
		for (let i = restores.length - 1; i >= 0; i--) restores[i]();
		restores = [];
	};

	const before = rig.beforeUpdateWorldTransforms;
	const after = rig.afterUpdateWorldTransforms;
	let active = true;
	const onBefore = (object: RIG.RigView): void => {
		before(object);
		if (active) pose();
	};
	const onAfter = (object: RIG.RigView): void => {
		unpose();
		after(object);
	};
	rig.beforeUpdateWorldTransforms = onBefore;
	rig.afterUpdateWorldTransforms = onAfter;

	onDestroy(() => {
		active = false;
		unpose();
		if (rig.beforeUpdateWorldTransforms === onBefore) rig.beforeUpdateWorldTransforms = before;
		if (rig.afterUpdateWorldTransforms === onAfter) rig.afterUpdateWorldTransforms = after;
	});
</script>
