<script lang="ts">
	/**
	 * Drives ONE cinematic actor's skeleton from the shared evaluator.
	 *
	 * Mounts inside a `<SpineProvider>` and takes over that rig's posing. The contract below is
	 * not a guess — it is what Phase 0's gate 3 (`tools/rigger-spike/cinematic-pixi.mjs`) measured
	 * against `spine-pixi-v8`:
	 *
	 *   1. `autoUpdate = false` — otherwise the runtime advances its own AnimationState and fights us.
	 *   2. `state.clearTracks()` — mandatory for EVENT reasons, not pose reasons. A leftover track
	 *      cannot corrupt the pose (our `setToSetupPose()` discards it) but DOES keep firing that
	 *      clip's spine events every frame.
	 *   3. Pose in `beforeUpdateWorldTransforms`. Posing in the `after` hook renders the PREVIOUS
	 *      frame's pose — proved, not assumed.
	 *   4. `spine.update(dt)` each frame so the hook runs.
	 */
	import { onDestroy } from 'svelte';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import { evaluateActor, resolvePlace, type CinematicTrack } from 'engine-cinematic';
	import { getContextSpine } from 'pixi-svelte';

	type Props = {
		/** The cast entry this actor renders (its static placement + visibility). */
		cast: { actorId: string; place?: Record<string, number | boolean>; visible?: boolean };
		/** Every track belonging to this actor — animation layers AND property channels. */
		tracks: CinematicTrack[];
		/** Cinematic time, in seconds. Owned by `<Cinematic>`, so every actor stays in lockstep. */
		time: number;
	};
	const props: Props = $props();

	const spine = getContextSpine();

	// The spine runtime namespace the evaluator needs (enums only — it constructs nothing).
	const spineNs = {
		MixBlend: SPINE_PIXI.MixBlend,
		MixDirection: SPINE_PIXI.MixDirection,
		Physics: SPINE_PIXI.Physics,
	};

	/**
	 * A strip's clip, resolved against THIS actor's skeleton.
	 * `src: 'library'` / `'local'` return null (the evaluator skips them) — those are authored-side
	 * clip sources that the ship chain resolves into the rig before a doc ever reaches a game.
	 */
	function resolveClip(strip: { clip?: { src?: string; name?: string } | null }) {
		const c = strip.clip;
		if (!c || c.src !== 'rig' || !c.name) return null;
		return spine.skeleton.data.findAnimation(c.name) ?? null;
	}

	// The evaluator's target: it hands this object back to `resolveClip`, so it must carry the
	// skeleton (not just be one). `tracks` is re-pointed reactively as the doc changes.
	const target = {
		actorId: props.cast.actorId,
		skeleton: spine.skeleton,
		skeletonData: spine.skeleton.data,
		tracks: props.tracks,
	};

	const animationTracks = $derived(props.tracks.filter((t) => t.kind === 'animation'));
	const propertyTracks = $derived(props.tracks.filter((t) => t.kind === 'property'));

	function pose() {
		target.tracks = animationTracks;
		evaluateActor(spineNs, target, props.time, resolveClip);
		const place = resolvePlace(props.cast.place ?? {}, propertyTracks, props.time);
		const sk = spine.skeleton;
		sk.x = Number(place.x) || 0;
		sk.y = Number(place.y) || 0;
		const s = place.scale == null ? 1 : Number(place.scale);
		sk.scaleX = (place.flipX ? -1 : 1) * s;
		sk.scaleY = s;
		// `setToSetupPose` does not reset skeleton.color, so alpha must be written EVERY frame or a
		// once-faded actor stays faded forever.
		sk.color.a = place.alpha == null ? 1 : Number(place.alpha);
		if (place.rotation) {
			const root = sk.getRootBone();
			if (root) root.rotation += Number(place.rotation);
		}
	}

	spine.autoUpdate = false;
	spine.state.clearTracks();
	spine.beforeUpdateWorldTransforms = pose;
	onDestroy(() => {
		// Hand the rig back exactly as we found it, so a spine reused elsewhere is not left frozen
		// with our hook attached.
		spine.beforeUpdateWorldTransforms = () => {};
		spine.autoUpdate = true;
	});

	// Re-pose on every time change even when the ticker is not running (a scrubbed//seeked
	// cinematic, or a paused frame) — `spine.update(0)` runs the hook without advancing physics.
	$effect(() => {
		void props.time;
		void props.tracks;
		spine.update(0);
	});
</script>
