<script lang="ts" module>
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import type { SpineBoneOffset } from '../spineBoneOffset';

	export type Props = Partial<SPINE_PIXI.Bone> & {
		boneName: Parameters<SPINE_PIXI.Spine['skeleton']['findBone']>[0];
		/**
		 * Offset the bone ON TOP of the pose its animation gives it, every frame (a layout `bone`
		 * value binding — `spineBoneOffset.ts`). The direct props above SET a bone field once, which
		 * an animation keying that channel overwrites on its next frame; an offset survives it.
		 * Read at mount: pass it (identity until the value arrives) to opt in. Absent ⇒ no per-frame
		 * hook, exactly as before.
		 */
		offset?: SpineBoneOffset;
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { propsSyncEffect } from '../utils.svelte';
	import { getContextSpine } from '../context.svelte';
	import { applySpineBoneOffset, isIdentityBoneOffset } from '../spineBoneOffset';

	const props: Props = $props();
	const spine = getContextSpine();
	const bone = spine.skeleton.findBone(props.boneName);

	propsSyncEffect({ props, target: bone, ignore: ['boneName', 'y', 'offset'] });
	$effect(() => {
		if (bone && props.y !== undefined) bone.y = -props.y;
	});

	// The offset rides the spine's world-transform hooks: applied after the animation state poses
	// the skeleton, undone once the world transform is computed (see `applySpineBoneOffset`).
	// Chained, not replaced, so two bound bones on one rig — or any earlier hook — all still run;
	// on unmount the hook is unlinked when it is still the head of the chain, else left inert.
	// svelte-ignore state_referenced_locally
	if (bone && props.offset !== undefined) {
		const before = spine.beforeUpdateWorldTransforms;
		const after = spine.afterUpdateWorldTransforms;
		let active = true;
		let restore: (() => void) | undefined;
		const onBefore = (object: SPINE_PIXI.Spine): void => {
			before(object);
			const offset = props.offset;
			if (active && offset && !isIdentityBoneOffset(offset)) {
				restore = applySpineBoneOffset(bone, offset);
			}
		};
		const onAfter = (object: SPINE_PIXI.Spine): void => {
			after(object);
			restore?.();
			restore = undefined;
		};
		spine.beforeUpdateWorldTransforms = onBefore;
		spine.afterUpdateWorldTransforms = onAfter;
		onDestroy(() => {
			active = false;
			if (spine.beforeUpdateWorldTransforms === onBefore)
				spine.beforeUpdateWorldTransforms = before;
			if (spine.afterUpdateWorldTransforms === onAfter) spine.afterUpdateWorldTransforms = after;
		});
	} else if (props.offset !== undefined) {
		console.warn(
			`[SpineBone] no bone "${props.boneName}" on this skeleton — the offset does nothing.`,
		);
	}
</script>
