<script lang="ts">
	import type { Snippet } from 'svelte';

	import { SpineProvider, SpineTrack, SpineSlot } from 'pixi-svelte';
	import { EDITOR_SPINE_LOAD_SCALE } from 'engine-layout';

	type AnimationState = 'intro' | 'idle' | 'outro';

	type Props = {
		// Resolved intro/idle/outro animation names for the active tier — the coded `winLevelMap`
		// convention by default, or author-picked per-tier/shared overrides (see `WIN_DEF`), so any
		// string the `winSpine` bundle exposes is valid (no longer the fixed convention literals).
		animationMap: {
			intro: string;
			idle: string;
			outro: string;
		};
		/** The big-win spine bundle + the slot the count number is injected into. Configurable so a
		 * game can point the shared `win` component at its own art; the coded defaults reproduce the
		 * original hardcodes (`bigwin` / `slot_win_count`), so an un-authored game renders identically. */
		key?: string;
		slotName?: string;
		/**
		 * Explicit display WIDTH for the rig (the spine is fitted to it). The coded/OFF composer
		 * passes the board width — the historical hardcode. The AUTHORED `win` componentInstance
		 * passes nothing, so the rig renders at its NATURAL size: the same base the Scene Editor
		 * previews it at, leaving the instance node's own scale as the single size knob (WYSIWYG).
		 */
		width?: number;
		children: Snippet;
	};

	const {
		animationMap,
		key = 'bigwin',
		slotName = 'slot_win_count',
		width,
		children,
	}: Props = $props();

	let oncomplete = $state(() => {});
	let animationState = $state<AnimationState>('intro');
</script>

<!--
	`loadScaleBase` on the natural-size (authored) path only: the editor previews EVERY rig at
	`EDITOR_SPINE_LOAD_SCALE`, while the game reads each bundle at whatever `parser.scale` its
	asset index declares (the engine-bundled `bigwin` is 2, an exported editor-art bundle is 1)
	— and Spine leaves `skeleton.data.width/height` un-scaled, so nothing downstream cancels
	that. Dividing it out is what makes "natural size" mean the same thing on both surfaces. The
	width-fitted OFF path is deliberately left alone: `parser.scale × width` is its shipped size.
-->
<SpineProvider
	{width}
	{key}
	loadScaleBase={width === undefined ? EDITOR_SPINE_LOAD_SCALE : undefined}
>
	<SpineTrack
		trackIndex={0}
		animationName={animationMap[animationState]}
		loop={animationState === 'idle'}
		listener={{
			complete: () => {
				if (animationState === 'intro') animationState = 'idle';
				if (animationState === 'outro') oncomplete();
			},
		}}
	/>
	<SpineSlot {slotName}>
		{@render children()}
	</SpineSlot>
</SpineProvider>
