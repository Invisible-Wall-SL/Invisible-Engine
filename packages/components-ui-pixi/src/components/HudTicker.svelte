<script lang="ts">
	import { Sprite } from 'pixi-svelte';
	import { parseScopedFrameRef, type ResolvedTransform } from 'engine-layout';
	import { getComponentParams } from 'engine-layout/svelte';

	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_FONT_SIZE } from '../constants';

	/**
	 * Background tile slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces the `base_ticker` `UiSprite` from `UiLabel`'s stacked+tiled block,
	 * rendered at its OWN local origin — the `hudReadout` def positions this node
	 * (`y:-20`, `anchor {0.5,0}`), so this component draws the tile at (0,0).
	 *
	 * TWO authoring surfaces, deliberately:
	 *
	 * - DEF-level (`bind.props`, the `HudTicker` entry in `BOUND_COMPONENT_PARAMS`): the
	 *   editor writes `texture`/`tint`/`borderRadius`/`border*` to the node's `bind.props`,
	 *   spread in here. `texture` is the `UiSprite` key (a textured game `UiSprite` swaps
	 *   art; the reference `UiSprite` is a rounded `Rectangle` and ignores it). Recolour is
	 *   forwarded BOTH ways so either renderer responds: `backgroundColor` (the `Rectangle`
	 *   fill) and `tint` (a textured `Sprite`). These live on the DEF, so they restyle every
	 *   instance of it.
	 * - PER-INSTANCE (the `background*` component params, read off the param context
	 *   `<ComponentInstance>` provides — the same channel the Caption/Value parts read their
	 *   style from): `backgroundImage` REPLACES the tile with a picked atlas frame, sized by
	 *   `backgroundWidth`/`backgroundHeight` and multiplied by `backgroundTint`. This is what
	 *   lets balance / win / bet each carry their own background art without forking the def.
	 *
	 * All optional → unset keeps the coded defaults (byte-identical to `UiLabel`). The
	 * `fill`/value styling lives on the caption/value parts, not this tile.
	 */
	interface Props {
		tint?: number;
		borderRadius?: number;
		borderColor?: number;
		borderWidth?: number;
		texture?: string;
		/** The bind node's resolved transform — only `anchor` is read here (the
		 * editor's alignment knob); defaults to the tile's coded `{0.5,0}` origin. */
		transform?: ResolvedTransform;
	}
	const {
		tint,
		borderRadius = 35,
		borderColor,
		borderWidth,
		texture = 'base_ticker',
		transform,
	}: Props = $props();

	/** The coded tile box — mirrored by `engine-layout`'s `HUD_TILE_WIDTH`/`HUD_TILE_HEIGHT`,
	 * which the def's editor preview + the size params fall back to. */
	const TILE_WIDTH = UI_BASE_FONT_SIZE * 3 * (326 / 73);
	const TILE_HEIGHT = UI_BASE_FONT_SIZE * 3;

	// Resolved ONCE at init: `getComponentParams()` is `getContext`, which throws
	// `lifecycle_outside_component` when read after initialisation. The instance provides a
	// stable object whose engine-provided keys are live getters, so the reference stays live.
	const params = getComponentParams();
	// Empty string normalizes to undefined: a cleared editor field must fall back like an
	// absent param, else `''` would suppress the coded tile while rendering nothing.
	const stringParam = (key: string): string | undefined => {
		const value = typeof params[key] === 'string' ? (params[key] as string) : undefined;
		return value === '' ? undefined : value;
	};
	const numberParam = (key: string): number | undefined =>
		typeof params[key] === 'number' ? (params[key] as number) : undefined;

	const image = $derived(stringParam('backgroundImage'));
	// A picked frame stores `<assetKey>::<region>` (atlas-scoped, so a name two atlases pack
	// resolves to the picked one). Pass it through as the lookup key and fall back to the bare
	// region, exactly as `LayoutNodeView` does — a game whose sheet registration predates the
	// namespacing still resolves.
	const imageFallback = $derived(
		image ? parseScopedFrameRef(image).region || undefined : undefined,
	);
	const width = $derived(numberParam('backgroundWidth') ?? TILE_WIDTH);
	const height = $derived(numberParam('backgroundHeight') ?? TILE_HEIGHT);
	const anchor = $derived(transform?.anchor ?? { x: 0.5, y: 0 });
	// The instance's `backgroundTint` wins over the def-level `bind.props` tint; unset ⇒ the
	// prop, unset ⇒ undefined (which both renderers treat as untinted — parity).
	const tintValue = $derived(numberParam('backgroundTint') ?? tint);
</script>

{#if image}
	<Sprite key={image} fallbackKey={imageFallback} {anchor} {width} {height} tint={tintValue} />
{:else}
	<UiSprite
		{anchor}
		key={texture}
		{width}
		{height}
		{borderRadius}
		{borderColor}
		{borderWidth}
		backgroundColor={tintValue}
		tint={tintValue}
	/>
{/if}
