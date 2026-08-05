<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import {
		activeReelIndices,
		activeMaxTier,
		reelCenterX,
		resolveTierFx,
	} from '../game/anticipationPresentation';

	// DEDICATED camera container for the reel-anticipation zoom (`docs/design/reel-anticipation.md`,
	// Phase 3). It wraps the reel board INSIDE its `MainContainer` but never touches `MainContainer`
	// or the editor coordinate boxes: the zoom is a plain scale + pan on THIS container alone, so the
	// board's own layout/pivot is untouched (see the "editor scenes offset / MainContainer" gotchas).
	// It eases to identity (scale 1, offset 0) whenever nothing is armed, so with the mode on but no
	// reel anticipating the board renders exactly as the un-wrapped path.

	type Props = {
		children: Snippet;
	};

	const props: Props = $props();
	const context = getContext();

	const zoom = new Tween(1, { duration: 450, easing: cubicOut });

	// Last framed centre, held so the pan eases back to identity as the zoom releases (rather than
	// snapping when the active set empties). x/y fold `(1 - zoom)`: scaling about the child origin keeps
	// the point `target` fixed when `x = target·(1 - zoom)`, and at zoom 1 the offset is 0 for ANY held
	// target — so a fully-released camera is byte-identical to an un-zoomed board.
	let targetX = $state(0);
	let targetY = $state(0);

	$effect(() => {
		const active = activeReelIndices();
		const tier = activeMaxTier();
		if (active.length && tier) {
			targetX = active.reduce((sum, index) => sum + reelCenterX(index), 0) / active.length;
			targetY = context.stateGameDerived.boardLayout().y;
			void zoom.set(resolveTierFx(tier).zoom);
		} else {
			void zoom.set(1);
		}
	});
</script>

<Container scale={zoom.current} x={targetX * (1 - zoom.current)} y={targetY * (1 - zoom.current)}>
	{@render props.children()}
</Container>
