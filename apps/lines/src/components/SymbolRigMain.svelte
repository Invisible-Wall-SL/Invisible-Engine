<script lang="ts">
	import { RigProvider, RigTrack, type RigTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_RIG_FILL } from 'engine-game';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: RigTrackProps['listener'];
		loop?: boolean;
		/** Hold the animation's FIRST pose instead of playing it — the rig answer to a frozen
		 * flipbook frame. `RigTrack` already calls `rig.update(0)` right after `setAnimation` to
		 * pose the skeleton before the first render (so a landing symbol can't flash its setup pose),
		 * so a zero `timeScale` simply never advances off that pose — no setup-pose fallback, which
		 * would be a DIFFERENT picture from the one the animation opens on. */
		frozen?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	// Contain-fit the rig into the reel's LIVE cell (the SAME source of truth as the
	// mask + sprite art), then apply SYMBOL_RIG_FILL as the rig-only shrink knob —
	// so a rig symbol tracks the authored cell yet still reads smaller than sprites.
	// No override (and a uniform-scaled board) collapses the cell to SYMBOL_SIZE ⇒ the
	// box is exactly `SYMBOL_SIZE × SYMBOL_RIG_FILL`, byte-identical to before.
	const geometry = $derived(context.stateGameDerived.boardGeometry());
</script>

<!--
	Rig symbols read visually bigger than sprite icons (a character + badge fills its bounds),
	so we contain-fit the rig's bounds to `cell × SYMBOL_RIG_FILL` (< 1) to bring them down to
	match the sprites. Rig-only knob — sprites are full contain. Tune SYMBOL_RIG_FILL.

	`centreBox`: the rect being fitted is the rig's authored box (the Rigger's Bounds frame), so
	its CENTRE — not the skeleton origin — sits at the cell centre. Same rule the Scene Editor's
	reel cells and the /symbols grid draw by, so the frame an author sizes in the Rigger is the
	frame that fills the cell here.
-->
<RigProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={geometry.cellWidthLocal * SYMBOL_RIG_FILL}
	height={geometry.cellHeightLocal * SYMBOL_RIG_FILL}
	fit="contain"
	centreBox
	rebroadcastEvents
>
	<RigTrack
		loop={props.loop}
		trackIndex={0}
		animationName={props.symbolInfo.animationName}
		timeScale={props.frozen ? 0 : stateBetDerived.timeScale()}
		listener={props.listener}
	/>
</RigProvider>
