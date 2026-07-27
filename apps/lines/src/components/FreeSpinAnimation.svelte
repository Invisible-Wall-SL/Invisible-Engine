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
	import { EDITOR_SPINE_LOAD_SCALE } from 'engine-layout';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import { boardDimensions } from '../game/gameConfig';

	type Props = {
		children: Snippet<[{ sizes: Sizes }]>;
		/**
		 * §17 Phase 3 — when true, this block is the bound child of a free-spin VISUAL
		 * `componentInstance`: render at LOCAL origin so the instance node's transform
		 * places it. Drops its OWN `<MainContainer>` (the scene's game-space MainContainer
		 * provides the main-scale), the `boardLayout()` offset (the node provides it) AND the
		 * legacy authoring-box offset/pivot pair below. Default false ⇒ the standalone overlay
		 * self-centres on the board exactly as before (parity).
		 */
		boundToInstance?: boolean;
		/**
		 * Explicit display WIDTH for the frame rig (the spine is fitted to it). Unset, it falls
		 * back to the historical `PANEL_SIZES.width` fit on the coded/OFF composer path, and to
		 * NO width on the AUTHORED componentInstance path — so the frame renders at its NATURAL
		 * size, the same base the Scene Editor previews it at, leaving the instance node's own
		 * transform as the single size/position knob (WYSIWYG).
		 */
		width?: number;
	};

	const { children, boundToInstance = false, width }: Props = $props();

	type AnimationName = 'intro' | 'idle';

	const context = getContext();
	const BACKGROUND_RATIO = 920 / 720;
	const BACKGROUND_WIDTH = SYMBOL_SIZE * boardDimensions().x;
	const BACKGROUND_SIZES = {
		width: BACKGROUND_WIDTH,
		height: BACKGROUND_WIDTH / BACKGROUND_RATIO,
	};
	const PANEL_SIZES = {
		width: SYMBOL_SIZE * boardDimensions().x,
		height: SYMBOL_SIZE * boardDimensions().x,
	};

	let animationName = $state<AnimationName>('intro');

	// The frame rig's size base: the coded/OFF composer keeps the board-derived `PANEL_SIZES`
	// fit (its shipped size); the AUTHORED instance takes none, so the rig renders at the
	// natural size the Scene Editor previews. An explicit `width` always wins.
	const frameWidth = $derived(width ?? (boundToInstance ? undefined : PANEL_SIZES.width));
	// Legacy authoring box (OFF composer only): the frame spine is placed at (0.5w, 0.4h) inside
	// a 0..PANEL rect and the wrapper's centring pivot takes it straight back out — the pair
	// nearly annihilates (net (0, +5.2px)), so it compensates for nothing a sibling reads: the
	// count spine and the caption sprites live INSIDE the frame's `slot_text_placeholder` and
	// ride the RIG, not this container. The authored path drops both, putting the frame's
	// SKELETON ORIGIN on the local origin — exactly where the editor draws it.
	const frameX = $derived(boundToInstance ? undefined : PANEL_SIZES.width * 0.5);
	const frameY = $derived(boundToInstance ? undefined : PANEL_SIZES.height * 0.4);
</script>

{#snippet block()}
	<!--
		`loadScaleBase` on the natural-size (authored) path only: the editor previews EVERY rig at
		`EDITOR_SPINE_LOAD_SCALE`, while the game reads each bundle at whatever `parser.scale` its
		asset index declares (the engine-bundled `fsIntro` is 2, an exported editor-art bundle is
		1) — and Spine leaves `skeleton.data.width/height` un-scaled, so nothing downstream cancels
		that. Dividing it out is what makes "natural size" mean the same thing on both surfaces.
		The width-fitted OFF path is deliberately left alone: `parser.scale × width` is its size.
	-->
	<SpineProvider
		key="fsIntro"
		width={frameWidth}
		loadScaleBase={frameWidth === undefined ? EDITOR_SPINE_LOAD_SCALE : undefined}
		x={frameX}
		y={frameY}
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
	<!-- Bound to a VISUAL componentInstance: no own MainContainer / boardLayout offset, and no
		authoring-box offset/pivot pair either — the instance node (default = board-centre) + the
		scene's game-space MainContainer are the SOLE placement, so the rig lands where the Scene
		Editor draws it. -->
	{@render block()}
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
