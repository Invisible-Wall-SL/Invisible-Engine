<script lang="ts">
	import type { Snippet } from 'svelte';

	import {
		anchorToPivot,
		Container,
		SpineProvider,
		SpineSlot,
		SpineTrack,
		type Sizes,
	} from 'pixi-svelte';
	import { MainContainer } from 'components-layout';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE, BOARD_DIMENSIONS } from '../game/constants';

	type Props = {
		children: Snippet<[{ sizes: Sizes }]>;
		/**
		 * §17 Phase 3 — when true, this block is the bound child of a free-spin VISUAL
		 * `componentInstance`: render at LOCAL origin so the instance node's transform
		 * places it. Drops its OWN `<MainContainer>` (the scene's game-space MainContainer
		 * provides the main-scale) and the `boardLayout()` offset (the node provides it),
		 * keeping only the centring pivot. Default false ⇒ the standalone overlay
		 * self-centres on the board exactly as before (parity).
		 */
		boundToInstance?: boolean;
	};

	const { children, boundToInstance = false }: Props = $props();

	type AnimationName = 'intro' | 'idle';

	const context = getContext();
	const BACKGROUND_RATIO = 920 / 720;
	const BACKGROUND_WIDTH = SYMBOL_SIZE * BOARD_DIMENSIONS.x;
	const BACKGROUND_SIZES = {
		width: BACKGROUND_WIDTH,
		height: BACKGROUND_WIDTH / BACKGROUND_RATIO,
	};
	const PANEL_SIZES = {
		width: SYMBOL_SIZE * BOARD_DIMENSIONS.x,
		height: SYMBOL_SIZE * BOARD_DIMENSIONS.x,
	};

	let animationName = $state<AnimationName>('intro');
</script>

{#snippet block()}
	<SpineProvider
		key="fsIntro"
		width={PANEL_SIZES.width}
		x={PANEL_SIZES.width * 0.5}
		y={PANEL_SIZES.height * 0.4}
	>
		<SpineTrack
			trackIndex={0}
			{animationName}
			loop={animationName === 'idle'}
			listener={{
				complete: () => (animationName = 'idle'),
			}}
		/>
		<SpineSlot slotName="slot_text_placeholder">
			{@render children({ sizes: BACKGROUND_SIZES })}
		</SpineSlot>
	</SpineProvider>
{/snippet}

{#if boundToInstance}
	<!-- Bound to a VISUAL componentInstance: no own MainContainer / boardLayout offset.
		The instance node (default = board-centre) + the scene's game-space MainContainer
		place + scale this; the pivot still centres the block on that origin. -->
	<Container pivot={anchorToPivot({ anchor: 0.5, sizes: BACKGROUND_SIZES })}>
		{@render block()}
	</Container>
{:else}
	<MainContainer>
		<Container
			x={context.stateGameDerived.boardLayout().x}
			y={context.stateGameDerived.boardLayout().y}
			pivot={anchorToPivot({ anchor: 0.5, sizes: BACKGROUND_SIZES })}
		>
			{@render block()}
		</Container>
	</MainContainer>
{/if}
