<script lang="ts">
	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_FONT_SIZE } from '../constants';

	/**
	 * Background tile slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces the `base_ticker` `UiSprite` from `UiLabel`'s stacked+tiled block,
	 * rendered at its OWN local origin — the `hudReadout` def positions this node
	 * (`y:-20`, `anchor {0.5,0}`), so this component draws the tile at (0,0).
	 *
	 * Editor-configurable (the `HudTicker` entry in `BOUND_COMPONENT_PARAMS`): the
	 * editor writes `texture`/`tint`/`borderRadius` to the node's `bind.props`, spread
	 * in here. `texture` is the `UiSprite` key (a textured game `UiSprite` swaps art;
	 * the reference `UiSprite` is a rounded `Rectangle` and ignores it). Recolour is
	 * forwarded BOTH ways so either renderer responds: `backgroundColor` (the
	 * `Rectangle` fill) and `tint` (a textured `Sprite`). All optional → unset keeps
	 * the coded defaults (byte-identical to `UiLabel`). The `fill`/value styling lives
	 * on the caption/value parts, not this tile.
	 */
	interface Props {
		tint?: number;
		borderRadius?: number;
		texture?: string;
	}
	const { tint, borderRadius = 35, texture = 'base_ticker' }: Props = $props();
</script>

<UiSprite
	anchor={{ x: 0.5, y: 0 }}
	key={texture}
	width={UI_BASE_FONT_SIZE * 3 * (326 / 73)}
	height={UI_BASE_FONT_SIZE * 3}
	{borderRadius}
	backgroundColor={tint}
	{tint}
/>
