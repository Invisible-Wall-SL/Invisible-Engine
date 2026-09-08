<script lang="ts">
	import { Container } from 'pixi-svelte';

	import Symbol from './Symbol.svelte';
	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from 'engine-game';
	import type { SymbolName } from '../game/types';

	/**
	 * A slot symbol rendered inline in a MESSAGE (the Invisible Win Text "show symbol as image"
	 * toast), at an arbitrary target `size` rather than the board cell size. Registered as the
	 * `messageSymbol` bound component and mounted by `engine-layout`'s `InlineImageText` per image
	 * segment — the engine layer can't reach `<Symbol>` (game-specific), so the game provides this.
	 *
	 * Renders through the SAME `<Symbol>` state-machine path the board uses, so it handles sprite,
	 * spine AND flipbook symbols identically (the whole point — the high symbols are spines, which a
	 * plain `<Sprite>` can't draw). `<Symbol>` draws into the board's LIVE cell (a sprite fills it; a
	 * spine contain-fits `cell × SYMBOL_SPINE_FILL`, the board's sprite↔spine visual match), so a
	 * uniform `size / cell` scale on the whole output preserves that match and lands both types at
	 * ~`size` tall — and `size` is the surrounding line of text's height, so an inline symbol that
	 * ignores the cell is a symbol that doesn't match the words. Dividing by `SYMBOL_SIZE` did just
	 * that: the two are equal only on a UNIFORM board (`boardGeometry`), so a non-square authored
	 * cell drew the symbol at `size × cell / 120`. The `static` (resting) state = a clean icon, no
	 * win frame.
	 *
	 * FROZEN, whatever the symbol is bound to: a flipbook holds frame 0 of its walk, a spine holds
	 * the pose its animation opens on, a sprite was already still. The toggle asks for a picture of
	 * the symbol in place of its NAME, and a name does not move: anything animating inside a line of
	 * text pulls the eye off the sentence it was meant to illustrate, and the toast is on screen for
	 * a couple of seconds anyway, so the animation would only ever be seen part-played.
	 *
	 * Centred on (x, y): `<Symbol>` centres its art at its own (0,0), so the wrapping scaled
	 * `<Container>` at (x, y) puts the symbol centre there — the same convention `InlineImageText`
	 * positions a text run's baseline with.
	 */
	const props: {
		symbol: string;
		/** Target height in local px (the surrounding text's cap-ish height). */
		size: number;
		x?: number;
		y?: number;
	} = $props();

	const context = getContext();
	// The contain-fit box `<Symbol>` actually draws into. Equal to `SYMBOL_SIZE` exactly when the
	// board's cell is uniform — which is when this collapses to the old `size / SYMBOL_SIZE` (parity).
	const cellHeight = $derived(
		context.stateGameDerived.boardGeometry().cellHeightLocal || SYMBOL_SIZE,
	);
	const scale = $derived(props.size / cellHeight);
</script>

<Container x={props.x ?? 0} y={props.y ?? 0} scale={{ x: scale, y: scale }}>
	<Symbol state="static" frozen rawSymbol={{ name: props.symbol as SymbolName }} x={0} y={0} />
</Container>
