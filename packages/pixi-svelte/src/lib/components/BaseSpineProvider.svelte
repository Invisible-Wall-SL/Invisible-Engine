<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import type { OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<Omit<SPINE_PIXI.SpineOptions, 'children'>> & {
		spineData: SPINE_PIXI.SkeletonData;
		children: Snippet;
		/** Node anchor, used ONLY to pivot a spine exported without skeleton bounds (its
		 * pivot can't be computed statically). Ignored when the skeleton has authored bounds. */
		anchorFallback?: number | { x?: number; y?: number };
		// When set AND both `width`/`height` are given, the spine sizes by a UNIFORM
		// cover/contain scale instead of per-axis stretch (true cover, no distortion).
		// Absent = prior per-axis behaviour. See docs/design/invisible-editor.md §10.
		fit?: 'cover' | 'contain';
		// Skeleton skin name. When set + non-empty, applied via the spine-pixi-v8 API
		// after construction. Absent = the runtime's default-skin behaviour (untouched).
		skin?: string;
		/**
		 * Opt-in: rebroadcast this rig's fired Spine ANIMATION EVENTS onto the shared
		 * `utils-event-emitter` bus (`{ type: <event name>, int, float, string }`), so an FX layer
		 * (or anything) subscribed to that name fires exactly when the animation reaches the event
		 * key — the "time an effect on the timeline" seam (Rigger event keys → runtime). OFF by
		 * default so only the rigs that should drive presentation opt in (no bus spam); a no-op when
		 * off or when no event-emitter is in context.
		 */
		rebroadcastEvents?: boolean;
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getContextEventEmitter, type EmitterEventBase } from 'utils-event-emitter';

	import { propsSyncEffect, spineSizeScale } from '../utils.svelte';
	import { setContextSpine, getContextParent } from '../context.svelte';

	const props: Props = $props();
	const parentContext = getContextParent();
	const spine = new SPINE_PIXI.Spine(props.spineData);

	// Rebroadcast this rig's fired Spine animation EVENTS onto the shared event bus (opt-in), so an
	// effect subscribed to the event name fires exactly when the animation reaches its timeline event
	// key (the Rigger event-key → runtime seam). Read the opt-in + the bus once at mount (a static
	// per-rig config); a no-op when off or when no game set an event-emitter context.
	// svelte-ignore state_referenced_locally
	if (props.rebroadcastEvents) {
		const eventEmitter = getContextEventEmitter<
			EmitterEventBase & { int: number; float: number; string: string | null }
		>()?.eventEmitter;
		if (eventEmitter) {
			const listener: SPINE_PIXI.AnimationStateListener = {
				event: (_entry, event) => {
					const name = event?.data?.name;
					if (!name) return;
					eventEmitter.broadcast({
						type: name,
						int: event.intValue,
						float: event.floatValue,
						string: event.stringValue,
					});
				},
			};
			spine.state.addListener(listener);
			onDestroy(() => spine.state.removeListener(listener));
		}
	}

	// `width`/`height` are handled here, NOT through `propsSyncEffect`: spine-pixi-v8's
	// width/height setters scale the skeleton so its CURRENT-FRAME bounds match the
	// requested size, but animation/skin-driven art (e.g. a background spine) has no
	// attachments in the setup pose, so those bounds are degenerate (0) before any
	// animation advances — the setter then scales against zero and the size never takes
	// effect (the spine renders at its raw, oversized natural size). We instead convert
	// width/height to a scale ourselves, preferring the pose-independent authored size
	// `skeleton.data.width/height`, and fold it into any incoming `scale` prop. This
	// keeps normal spines (valid setup bounds) identical while fixing the degenerate
	// case at first paint.
	propsSyncEffect({
		props,
		target: spine,
		ignore: [
			'children',
			'width',
			'height',
			'scale',
			'fit',
			'skin',
			'anchorFallback',
			'rebroadcastEvents',
		],
	});

	// Apply an authored skeleton skin by name. Reactive (re-applies if `skin` changes),
	// a no-op when absent so the runtime keeps its default-skin behaviour. An unknown
	// skin name throws in spine-pixi-v8; we swallow it and leave the current skin.
	$effect(() => {
		const skin = props.skin;
		if (!skin) return;
		try {
			spine.skeleton.setSkinByName(skin);
			spine.skeleton.setSlotsToSetupPose();
		} catch {
			// Unknown skin name — keep the current skin.
		}
	});

	$effect(() => {
		const sizeScale = spineSizeScale({
			spine,
			width: props.width,
			height: props.height,
			fit: props.fit,
		});
		const propScale = props.scale;
		const baseX = typeof propScale === 'number' ? propScale : (propScale?.x ?? 1);
		const baseY = typeof propScale === 'number' ? propScale : (propScale?.y ?? 1);
		spine.scale.set(baseX * sizeScale.x, baseY * sizeScale.y);
	});

	parentContext.addToParent(spine);
	setContextSpine(spine);

	// Pivot fallback for a spine exported WITHOUT skeleton bounds: SpineProvider can't
	// compute a static pivot (no size) and defers here. Such a spine otherwise pins its
	// pivot to the origin → the art renders at (0,0) top-left instead of the node's anchor.
	// Once the animation reveals art, the LIVE `spine.bounds` are valid, so anchor the art
	// by them (offset-aware, so the anchor lands on the art's centre wherever the skeleton
	// origin sits). Authored-bounds spines never enter this (SpineProvider gives them a
	// real pivot). Applied ONCE the bounds are available; the proper fix is re-exporting
	// the spine with bounds — this just stops a bounds-less one rendering in the corner.
	$effect(() => {
		const data = spine.skeleton?.data;
		if (data && data.width > 0 && data.height > 0) return; // authored bounds → handled upstream
		const af = props.anchorFallback;
		const ax = typeof af === 'number' ? af : (af?.x ?? 0);
		const ay = typeof af === 'number' ? af : (af?.y ?? 0);
		if (!ax && !ay) return; // top-left anchor → origin pivot is already correct
		let applied = false;
		const apply = (): boolean => {
			const b = spine.bounds;
			if (!b || !(b.width > 0) || !(b.height > 0)) return false;
			spine.pivot.set(b.x + ax * b.width, b.y + ay * b.height);
			return true;
		};
		applied = apply();
		if (applied) return;
		// Poll until the first frame with art (the setup pose is empty for this spine).
		const id = setInterval(() => {
			if (apply()) clearInterval(id);
		}, 80);
		const stop = setTimeout(() => clearInterval(id), 4000);
		return () => {
			clearInterval(id);
			clearTimeout(stop);
		};
	});
</script>

{@render props.children()}
