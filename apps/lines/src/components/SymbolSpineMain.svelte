<script lang="ts">
	import { SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SPINE_FILL } from 'engine-game';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: SpineTrackProps['listener'];
		loop?: boolean;
		/** Hold the animation's FIRST pose instead of playing it — the spine answer to a frozen
		 * flipbook frame. `SpineTrack` already calls `spine.update(0)` right after `setAnimation` to
		 * pose the skeleton before the first render (so a landing symbol can't flash its setup pose),
		 * so a zero `timeScale` simply never advances off that pose — no setup-pose fallback, which
		 * would be a DIFFERENT picture from the one the animation opens on. */
		frozen?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	// Contain-fit the rig into the reel's LIVE cell (the SAME source of truth as the
	// mask + sprite art), then apply SYMBOL_SPINE_FILL as the spine-only shrink knob —
	// so a spine symbol tracks the authored cell yet still reads smaller than sprites.
	// No override (and a uniform-scaled board) collapses the cell to SYMBOL_SIZE ⇒ the
	// box is exactly `SYMBOL_SIZE × SYMBOL_SPINE_FILL`, byte-identical to before.
	const geometry = $derived(context.stateGameDerived.boardGeometry());
</script>

<!--
	Spine symbols read visually bigger than sprite icons (a character + badge fills its bounds),
	so we contain-fit the rig's bounds to `cell × SYMBOL_SPINE_FILL` (< 1) to bring them down to
	match the sprites. Spine-only knob — sprites are full contain. Tune SYMBOL_SPINE_FILL.

	`centreBox`: the rect being fitted is the rig's authored box (the Rigger's Bounds frame), so
	its CENTRE — not the skeleton origin — sits at the cell centre. Same rule the Scene Editor's
	reel cells and the /symbols grid draw by, so the frame an author sizes in the Rigger is the
	frame that fills the cell here.
-->
<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={geometry.cellWidthLocal * SYMBOL_SPINE_FILL}
	height={geometry.cellHeightLocal * SYMBOL_SPINE_FILL}
	fit="contain"
	centreBox
	rebroadcastEvents
>
	<SpineTrack
		loop={props.loop}
		trackIndex={0}
		animationName={props.symbolInfo.animationName}
		timeScale={props.frozen ? 0 : stateBetDerived.timeScale()}
		listener={props.listener}
	/>
</SpineProvider>
