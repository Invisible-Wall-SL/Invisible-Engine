<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	import type { OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<Omit<SPINE_PIXI.SpineOptions, 'children'>> & {
		spineData: SPINE_PIXI.SkeletonData;
		children: Snippet;
	};
</script>

<script lang="ts">
	import { propsSyncEffect, spineSizeScale } from '../utils.svelte';
	import { setContextSpine, getContextParent } from '../context.svelte';

	const props: Props = $props();
	const parentContext = getContextParent();
	const spine = new SPINE_PIXI.Spine(props.spineData);

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
	propsSyncEffect({ props, target: spine, ignore: ['children', 'width', 'height', 'scale'] });

	$effect(() => {
		const sizeScale = spineSizeScale({
			spine,
			width: props.width,
			height: props.height,
		});
		const propScale = props.scale;
		const baseX = typeof propScale === 'number' ? propScale : (propScale?.x ?? 1);
		const baseY = typeof propScale === 'number' ? propScale : (propScale?.y ?? 1);
		spine.scale.set(baseX * sizeScale.x, baseY * sizeScale.y);
	});

	parentContext.addToParent(spine);
	setContextSpine(spine);
</script>

{@render props.children()}
