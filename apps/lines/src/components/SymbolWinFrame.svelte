<script lang="ts">
	import { RigProvider, RigTrack } from 'pixi-svelte';

	import { SYMBOL_SIZE, hexToTintNumber } from 'engine-game';
	import { bakedHighlight } from '../editor-scenes';
	import { getContext } from '../game/context';

	/**
	 * The GLOBAL win-highlight frame authored in the Invisible Symbols State Machine, drawn over a
	 * winning cell.
	 *
	 * It belongs to the SYMBOL, not to one renderer. It used to live inside `SymbolRig`, so a
	 * symbol whose Win cell is bound to a flipbook (or a sprite) paid with no frame at all while its
	 * rig-bound neighbour on the same payline got one — the highlight looked half-broken rather
	 * than un-authored. `Symbol.svelte` now owns the decision and draws this over whichever renderer
	 * the cell resolved to.
	 */
	type Props = {
		x?: number;
		y?: number;
		/** The paying line's authored colour for THIS win (`#rrggbb`), used only when the highlight's
		 *  `tintMode` is `winLine`. Absent ⇒ that mode falls through to no tint. */
		winLineColor?: string;
		/** A frame a reel view keeps between wins (`Symbol.svelte`): put away while true, started again
		 *  at each new `restart` (`<RigProvider parked restart>`). Absent ⇒ mounted per win. */
		parked?: boolean;
		restart?: number;
	};

	const props: Props = $props();
	const context = getContext();

	// Falls back to the coded `anticipation`/`payframe` frame when no highlight is authored
	// (un-baked = identical). That bundle is a coded asset of this app — the shared `_runtime/lines`
	// bundle every online game runs — so the fallback key always resolves.
	const highlight = bakedHighlight();
	const frameKey = highlight?.assetKey ?? 'anticipation';
	const frameAnimation = highlight?.animationName ?? 'payframe';

	// MULTIPLY tint the frame carries: `fixed` uses the authored colour; `winLine` uses the paying
	// line's colour threaded in on `winLineColor`; anything else ⇒ no tint.
	const frameTint = $derived.by(() => {
		if (highlight?.tintMode === 'fixed') return hexToTintNumber(highlight.tintColor);
		if (highlight?.tintMode === 'winLine') return hexToTintNumber(props.winLineColor);
		return undefined;
	});

	const geometry = $derived(context.stateGameDerived.boardGeometry());
</script>

<!--
	An authored frame fits its Rigger Bounds frame into the live cell, centred (`anchor={0.5}`,
	contain), so the box an author draws around the symbol in the Rigger is the box it covers here.
	`loadScaleBase={1}` divides out the symbol bundles' load scale (`SYMBOL_RIG_LOAD_SCALE`), which no
	width fit cancels. The coded payframe keeps its hand-tuned width on its skeleton origin.
-->
{#if highlight}
	<RigProvider
		x={props.x}
		y={props.y}
		key={frameKey}
		anchor={0.5}
		width={geometry.cellWidthLocal}
		height={geometry.cellHeightLocal}
		fit="contain"
		loadScaleBase={1}
		tint={frameTint}
		parked={props.parked}
		restart={props.restart}
	>
		<RigTrack trackIndex={0} animationName={frameAnimation} loop />
	</RigProvider>
{:else}
	<RigProvider
		x={props.x}
		y={props.y}
		key={frameKey}
		width={SYMBOL_SIZE * 0.19}
		tint={frameTint}
		parked={props.parked}
		restart={props.restart}
	>
		<RigTrack trackIndex={0} animationName={frameAnimation} loop />
	</RigProvider>
{/if}
