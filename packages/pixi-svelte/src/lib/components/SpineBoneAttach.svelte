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
	 * live transform and position our container there. Because this container is parented under
	 * the Spine (via the parent context), the bone resolves into the SAME local frame our
	 * position lives in: `getBonePosition` (skeleton space) → `skeletonToPixiWorldCoordinates`
	 * maps it into the Spine's child space. No pan/zoom inverse is needed here (unlike the `/fx`
	 * authoring stage, whose emitter container also carries the stage camera transform).
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
			// Mutates `pos` (== bonePoint) from skeleton space into the Spine's local space —
			// the frame this container's position lives in.
			spine.skeletonToPixiWorldCoordinates(pos);
			container.position.set(pos.x + offset.x, pos.y + offset.y);
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
