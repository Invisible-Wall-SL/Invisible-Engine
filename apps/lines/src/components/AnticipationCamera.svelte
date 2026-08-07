<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Container } from 'pixi-svelte';

	import { anticipationCameraTransform } from '../game/anticipationCamera.svelte';

	// DEDICATED camera container for the reel-anticipation zoom (`docs/design/reel-anticipation.md`,
	// Phase 3). It wraps the reel board INSIDE its `MainContainer` but never touches `MainContainer`
	// or the editor coordinate boxes: the zoom is a plain scale + pan on THIS container alone, so the
	// board's own layout/pivot is untouched (see the "editor scenes offset / MainContainer" gotchas).
	// The transform math now lives in the SHARED `anticipationCamera` module (single source of truth),
	// so this component just RENDERS it — the identical transform an opted-in screen applies via
	// `registerSceneCameraTransform` (one coherent camera move). It eases to identity (scale 1, offset
	// 0) whenever nothing is armed, so with the mode on but no reel anticipating the board renders
	// exactly as the un-wrapped path. The driver (`updateAnticipationCameraTarget`) runs from
	// `Game.svelte` so the transform is live regardless of whether this camera is mounted.

	type Props = {
		children: Snippet;
	};

	const props: Props = $props();

	const transform = $derived(anticipationCameraTransform());
</script>

<Container scale={transform.scale} x={transform.x} y={transform.y}>
	{@render props.children()}
</Container>
