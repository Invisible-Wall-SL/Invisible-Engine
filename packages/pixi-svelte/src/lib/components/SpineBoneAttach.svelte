<script lang="ts" module>
	import * as PIXI from 'pixi.js';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import type { Snippet } from 'svelte';

	export type Props = {
		/** The bone to follow (resolved on the host `SpineProvider`'s playing skeleton). */
		boneName: Parameters<SPINE_PIXI.Spine['skeleton']['findBone']>[0];
		/** Pixel offset added to the bone position, in the spine's local space. */
		offset?: { x: number; y: number };
		/** Also rotate the child subtree with the bone's world rotation (default: position only). */
		followRotation?: boolean;
		/** Also scale the child subtree with the bone's world scale (default: position only). */
		followScale?: boolean;
		children: Snippet;
	};
</script>

<script lang="ts">
	/**
	 * Attach a child subtree (e.g. a `<ParticleEmitter>`) to a Spine rig bone so it RIDES the
	 * animation. This is the runtime half of Invisible FX Tier B (`invisible-fx.md` §4.4): the
	 * `EffectPlayer` wraps a `bone`-placed layer in this against the HOST game's playing
	 * `SpineProvider` (NOT an authoring backdrop), so the effect follows the live bone.
	 *
	 * `<SpineBone>` only WRITES a bone's transform; following a bone is the inverse — read its
	 * live transform and position our container there. The load-bearing coordinate hop:
	 * `getBonePosition` is in SKELETON space; `skeletonToPixiWorldCoordinates` lifts it to Pixi
	 * WORLD coords (it literally does `spine.worldTransform.apply(point)`). But our `container.position`
	 * lives in our PARENT's frame, and that parent already carries the rig's world transform (the
	 * cell translate + contain-fit scale in a MainContainer-scaled game — whether the parent is
	 * `RiggedEffect`'s spine-child `fxParent` or the `SpineProvider`'s outer container). So we must
	 * map the world point back into the parent's local frame (`parent.worldTransform.applyInverse`)
	 * before assigning it — otherwise the rig transform is applied TWICE (once here, once again at
	 * render because we're a descendant of the rig) and the FX drifts off the bone by exactly that
	 * transform. This mirrors the `/fx` authoring stage, which inverts its own container's world
	 * matrix for the same reason (`emitterOwnerLocal`).
	 */
	import { onMount } from 'svelte';
	import {
		getContextApp,
		getContextParent,
		getContextSpine,
		createContextParent,
	} from '../context.svelte';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();
	const spine = getContextSpine();

	const container = new PIXI.Container();
	parentContext.addToParent(container);
	createContextParent(container);

	// Reusable scratch point so the per-frame follow allocates nothing.
	const bonePoint = new PIXI.Point();
	const DEG_TO_RAD = Math.PI / 180;

	// Cache the resolved bone (findBone is a linear scan). `resolvedFor` lets a boneName change
	// re-resolve, and leaves us retrying each frame until the skeleton is ready.
	let bone: SPINE_PIXI.Bone | null = null;
	let resolvedFor: string | null = null;
	function resolveBone(): SPINE_PIXI.Bone | null {
		if (resolvedFor !== props.boneName) {
			bone = spine?.skeleton?.findBone(props.boneName) ?? null;
			resolvedFor = bone ? props.boneName : null;
		}
		return bone;
	}

	function follow(): void {
		const offset = props.offset ?? { x: 0, y: 0 };
		const pos = spine?.getBonePosition(props.boneName, bonePoint);
		if (pos) {
			// `pos` (== bonePoint) is in skeleton space. Lift it to Pixi WORLD coords (offset applied
			// in the same world frame, matching the authoring stage), then map it back into THIS
			// container's parent frame — where `container.position` lives. Skipping the inverse would
			// double-apply the rig's world transform (this container is a descendant of the rig), which
			// is the offset the FX shows in a MainContainer-scaled game.
			spine.skeletonToPixiWorldCoordinates(pos);
			pos.x += offset.x;
			pos.y += offset.y;
			const parent = container.parent;
			if (parent) parent.worldTransform.applyInverse(pos, pos);
			container.position.set(pos.x, pos.y);
		} else {
			// Unresolved bone → spawn at the spine origin + offset (never silently vanish).
			container.position.set(offset.x, offset.y);
		}

		// Opt-in rotation/scale follow so an attached symbol banks/scales with the bone (a
		// flipping page, a rising glow). Skeleton space is CCW / y-up, Pixi is CW / y-down, so
		// world rotation is negated — same inversion `<SpineBone>` applies to y.
		if (props.followRotation || props.followScale) {
			const b = resolveBone();
			if (b) {
				if (props.followRotation) {
					container.rotation = -b.getWorldRotationX() * DEG_TO_RAD;
				}
				if (props.followScale) {
					container.scale.set(b.getWorldScaleX(), b.getWorldScaleY());
				}
			}
		}
	}

	onMount(() => {
		const ticker = context.stateApp.pixiApplication?.ticker;
		if (!ticker) {
			follow();
			return;
		}
		ticker.add(follow);
		return () => ticker.remove(follow);
	});
</script>

{@render props.children()}
