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
		/**
		 * The child is authored in RIG units (a Rigger binding: a Flipbook clip or effect placed on this
		 * bone in the Rigger / `/symbols`, which load every rig at scale 1). With `followScale`, also
		 * multiply by the host bundle's LOAD scale: the reader scales bone positions and attachment
		 * geometry by it but never a bone's own scale, so a child following only the bone's scale drew
		 * at 1/loadScale of its authored size on a symbol bundle (read at 2). Off ⇒ unchanged.
		 */
		rigUnits?: boolean;
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
		getContextSpineLoadScale,
		createContextParent,
	} from '../context.svelte';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();
	const spine = getContextSpine();
	const loadScale = getContextSpineLoadScale();

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

	/**
	 * The scale of `from` expressed in `parent`'s frame — i.e. how much of `from`'s world scale this
	 * container does NOT already inherit through its own parent chain.
	 *
	 * Magnitudes (`hypot` of each basis vector), never signed components: a rig may carry a negative
	 * axis for a y-flip or a mirrored skin, and a signed ratio would silently mirror the attachment
	 * instead of sizing it. A zero/absent parent scale degrades to 1 rather than dividing by zero.
	 */
	function worldScaleRatio(
		from: PIXI.Matrix,
		parent: PIXI.Container | null,
	): { x: number; y: number } {
		const fx = Math.hypot(from.a, from.b);
		const fy = Math.hypot(from.c, from.d);
		if (!parent) return { x: fx, y: fy };
		const p = parent.worldTransform;
		const px = Math.hypot(p.a, p.b);
		const py = Math.hypot(p.c, p.d);
		return { x: px ? fx / px : 1, y: py ? fy / py : 1 };
	}

	function follow(): void {
		const offset = props.offset ?? { x: 0, y: 0 };
		// Resolve the bone BEFORE asking for its position. `getBonePosition` returns the `outPos` we
		// hand it UNCHANGED on a missing bone (it only logs), so probing `pos` for truthiness can
		// never detect one — it would read back last frame's leftover `bonePoint` and re-apply the
		// world transform to it every tick, compounding a drift instead of taking the fallback below.
		const b = resolveBone();
		const pos = b ? spine?.getBonePosition(props.boneName, bonePoint) : undefined;
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
			if (b) {
				if (props.followRotation) {
					container.rotation = -b.getWorldRotationX() * DEG_TO_RAD;
				}
				if (props.followScale) {
					// The bone's scale is SKELETON-space (~1), so it excludes whatever scale the rig
					// itself is drawn at — and this container is NOT reliably a child of the rig, so it
					// cannot inherit it either: `BaseSpineProvider` adds the spine to the parent but
					// never `createContextParent(spine)`, which leaves us a SIBLING of the spine in the
					// `<SpineProvider>` host. A rig fitted to `width`/`height` therefore drew its
					// attachment at ~1 while the rig drew at its fit scale, so the attached thing
					// rendered several times oversized and mostly off-frame.
					//
					// Fix it the way the position math above already works: take the bone's scale into
					// WORLD space via the rig's own transform, then map it back into this container's
					// parent frame. Where the container IS a rig descendant the two transforms cancel to
					// 1, so that host is unchanged.
					const rigToParent = worldScaleRatio(spine.worldTransform, container.parent);
					// `rigUnits`: the ratio above also divides out a load-scale factor a parent
					// (`RiggedFlipbook`'s local container) applied, so the factor is re-applied HERE for
					// the bone path — the child ends up at bone scale × load scale, in rig units.
					const units = props.rigUnits ? loadScale() : 1;
					container.scale.set(
						b.getWorldScaleX() * rigToParent.x * units,
						b.getWorldScaleY() * rigToParent.y * units,
					);
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
