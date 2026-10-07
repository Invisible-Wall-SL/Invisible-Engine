<script lang="ts" module>
	import type { RigBoneOffset } from '../rigBoneOffset';

	/** Hold `animation` at `time` (0 = its first frame, 1 = its last). */
	export type RigPoseScrub = { animation: string; time: number };
	/** Offset `bone` on top of whatever poses it — see `rigBoneOffset.ts`. */
	export type RigPoseBone = { bone: string; offset: RigBoneOffset };

	export type Props = { scrubs?: RigPoseScrub[]; bones?: RigPoseBone[] };
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import * as RIG from 'engine-rig/pixi';

	import { getContextRig } from '../context.svelte';
	import { applyRigBoneOffset, isIdentityBoneOffset } from '../rigBoneOffset';

	/**
	 * Pose a playing rig on top of its animation, every frame — the rig half of a layout value
	 * binding (`engine-layout` targets `animTime` and `bone`).
	 *
	 * It runs on the rig's world-transform hooks, after the animation state has applied:
	 * 1. Each SCRUB applies its animation at the held time, replacing the channels that animation keys.
	 *    It goes through `Animation.apply`, whose events are dropped, so a scrub fires none of the
	 *    animation's events. A track entry would replay every event up to the time on each new
	 *    entry, and those reach the game bus through `rebroadcastEvents`.
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

	/** Where a scrub's events land and are dropped — never dispatched, cleared after each apply. */
	const droppedEvents: RIG.Event[] = [];
	let restores: (() => void)[] = [];
	const pose = (): void =>
		untrack(() => {
			const skeleton = rig.skeleton;
			for (const { animation: name, time } of props.scrubs ?? []) {
				const animation = skeleton.data.findAnimation(name);
				if (!animation) {
					warnOnce(
						`a:${name}`,
						`no animation "${name}" on this skeleton — the scrub does nothing.`,
					);
					continue;
				}
				const at = Math.min(1, Math.max(0, time)) * animation.duration;
				animation.apply(
					skeleton,
					at,
					at,
					false,
					droppedEvents,
					1,
					RIG.MixBlend.replace,
					RIG.MixDirection.mixIn,
				);
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
