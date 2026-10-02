<script lang="ts" module>
	import type { SpineBoneOffset } from '../spineBoneOffset';

	/** Hold `animation` at `time` (0 = its first frame, 1 = its last). */
	export type SpinePoseScrub = { animation: string; time: number };
	/** Offset `bone` on top of whatever poses it — see `spineBoneOffset.ts`. */
	export type SpinePoseBone = { bone: string; offset: SpineBoneOffset };

	export type Props = { scrubs?: SpinePoseScrub[]; bones?: SpinePoseBone[] };
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import { getContextSpine } from '../context.svelte';
	import { applySpineBoneOffset, isIdentityBoneOffset } from '../spineBoneOffset';

	/**
	 * Pose a playing spine on top of its animation, every frame — the spine half of a layout value
	 * binding (`engine-layout` targets `animTime` and `bone`).
	 *
	 * It runs on the spine's world-transform hooks, after the animation state has applied:
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
	 * hook can fire inside another component's effect (`SpineTrack` calls `spine.update(0)`). The
	 * hooks are chained, not replaced, and unlinked on unmount while still at the head of the chain
	 * (else left inert).
	 */
	const props: Props = $props();
	const spine = getContextSpine();

	const warned: Record<string, true> = {};
	const warnOnce = (key: string, message: string): void => {
		if (warned[key]) return;
		warned[key] = true;
		console.warn(`[SpinePose] ${message}`);
	};

	/** Where a scrub's events land and are dropped — never dispatched, cleared after each apply. */
	const droppedEvents: SPINE_PIXI.Event[] = [];
	let restores: (() => void)[] = [];
	const pose = (): void =>
		untrack(() => {
			const skeleton = spine.skeleton;
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
					SPINE_PIXI.MixBlend.replace,
					SPINE_PIXI.MixDirection.mixIn,
				);
				droppedEvents.length = 0;
			}
			for (const { bone: name, offset } of props.bones ?? []) {
				if (isIdentityBoneOffset(offset)) continue;
				const bone = skeleton.findBone(name);
				if (bone) restores.push(applySpineBoneOffset(bone, offset));
				else warnOnce(`b:${name}`, `no bone "${name}" on this skeleton — the offset does nothing.`);
			}
		});
	const unpose = (): void => {
		for (let i = restores.length - 1; i >= 0; i--) restores[i]();
		restores = [];
	};

	const before = spine.beforeUpdateWorldTransforms;
	const after = spine.afterUpdateWorldTransforms;
	let active = true;
	const onBefore = (object: SPINE_PIXI.Spine): void => {
		before(object);
		if (active) pose();
	};
	const onAfter = (object: SPINE_PIXI.Spine): void => {
		unpose();
		after(object);
	};
	spine.beforeUpdateWorldTransforms = onBefore;
	spine.afterUpdateWorldTransforms = onAfter;

	onDestroy(() => {
		active = false;
		unpose();
		if (spine.beforeUpdateWorldTransforms === onBefore) spine.beforeUpdateWorldTransforms = before;
		if (spine.afterUpdateWorldTransforms === onAfter) spine.afterUpdateWorldTransforms = after;
	});
</script>
