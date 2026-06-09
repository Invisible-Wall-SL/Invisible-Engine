<script lang="ts">
	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_FONT_SIZE } from '../constants';

	/**
	 * Background tile slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces the `base_ticker` `UiSprite` from `UiLabel`'s stacked+tiled block,
	 * rendered at its OWN local origin — the `hudReadout` def positions this node
	 * (`y:-20`, `anchor {0.5,0}`), so this component draws the tile at (0,0) with the
	 * coded default fill (byte-identical to `UiLabel`). Kept fixed/dead-simple: the
	 * `fill` param styles the caption/value TEXT, not this tile.
	 */
</script>

<UiSprite
	anchor={{ x: 0.5, y: 0 }}
	key="base_ticker"
	width={UI_BASE_FONT_SIZE * 3 * (326 / 73)}
	height={UI_BASE_FONT_SIZE * 3}
	borderRadius={35}
/>
