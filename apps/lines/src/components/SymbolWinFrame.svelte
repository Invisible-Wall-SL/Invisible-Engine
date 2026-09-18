<script lang="ts">
	import { SpineProvider, SpineTrack } from 'pixi-svelte';

	import { SYMBOL_SIZE, hexToTintNumber } from 'engine-game';
	import { bakedHighlight } from '../editor-scenes';

	/**
	 * The GLOBAL win-highlight frame authored in the Invisible Symbols State Machine, drawn over a
	 * winning cell.
	 *
	 * It belongs to the SYMBOL, not to one renderer. It used to live inside `SymbolSpine`, so a
	 * symbol whose Win cell is bound to a flipbook (or a sprite) paid with no frame at all while its
	 * spine-bound neighbour on the same payline got one — the highlight looked half-broken rather
	 * than un-authored. `Symbol.svelte` now owns the decision and draws this over whichever renderer
	 * the cell resolved to.
	 */
	type Props = {
		x?: number;
		y?: number;
		/** The paying line's authored colour for THIS win (`#rrggbb`), used only when the highlight's
		 *  `tintMode` is `winLine`. Absent ⇒ that mode falls through to no tint. */
		winLineColor?: string;
	};

	const props: Props = $props();

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
</script>

<SpineProvider x={props.x} y={props.y} key={frameKey} width={SYMBOL_SIZE * 0.19} tint={frameTint}>
	<SpineTrack trackIndex={0} animationName={frameAnimation} loop />
</SpineProvider>
