<script lang="ts">
	import { Container } from 'pixi-svelte';

	import Symbol from './Symbol.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import type { SymbolName } from '../game/types';

	/**
	 * A slot symbol rendered inline in a MESSAGE (the Invisible Win Text "show symbol as image"
	 * toast), at an arbitrary target `size` rather than the board cell size. Registered as the
	 * `messageSymbol` bound component and mounted by `engine-layout`'s `InlineImageText` per image
	 * segment — the engine layer can't reach `<Symbol>` (game-specific), so the game provides this.
	 *
	 * Renders through the SAME `<Symbol>` state-machine path the board uses, so it handles sprite,
	 * spine AND flipbook symbols identically (the whole point — the high symbols are spines, which a
	 * plain `<Sprite>` can't draw). `<Symbol>` draws at ~`SYMBOL_SIZE` (a sprite fills the cell; a
	 * spine contain-fits `cell × SYMBOL_SPINE_FILL`, the board's sprite↔spine visual match), so a
	 * uniform `size / SYMBOL_SIZE` scale on the whole output preserves that match and lands both
	 * types at ~`size` tall. The `static` (resting) state = a clean icon, no win frame.
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

	const scale = $derived(props.size / SYMBOL_SIZE);
</script>

<Container x={props.x ?? 0} y={props.y ?? 0} scale={{ x: scale, y: scale }}>
	<Symbol state="static" rawSymbol={{ name: props.symbol as SymbolName }} x={0} y={0} />
</Container>
