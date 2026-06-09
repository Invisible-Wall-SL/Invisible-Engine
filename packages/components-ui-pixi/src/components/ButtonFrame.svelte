<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_SIZE } from '../constants';

	/**
	 * Frame slice of the split `button` component (§16.2 "separate coded parts" —
	 * the button analogue of B5's `HudTicker`). Reproduces `UiButton`'s `UiSprite`
	 * tile: the variant dark/light background, the disabled grey override, the active
	 * border, all under the `tint` multiply — byte-identical to the coded button when
	 * the params carry their defaults.
	 *
	 * This part ALSO owns the hit area: a `static` `Container` whose `onpointerup`
	 * calls the action `onpress` exposed on the param context (the action feed).
	 *
	 * Editor-configurable via the shared `TILE_PARAMS` (the `ButtonFrame` entry in
	 * `BOUND_COMPONENT_PARAMS`): `texture`/`tint`/`borderColor`/`borderWidth`/
	 * `borderRadius` arrive on the node's `bind.props` (spread in here) as the RESTING
	 * look. The engine STATES still win: `disabled` greys the fill and `active` draws
	 * its border OVER any authored border (the live flags come from the action feed via
	 * the param context). `tint` on `bind.props` overrides the instance `tint` param.
	 * Reads the engine param context the `<ComponentInstance>` provides.
	 */
	interface Props {
		texture?: string;
		tint?: number;
		borderColor?: number;
		borderWidth?: number;
		borderRadius?: number;
	}
	const { texture, tint: tintProp, borderColor, borderWidth, borderRadius }: Props = $props();

	const stringParam = (key: string): string | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'string' ? (params[key] as string) : undefined;
	};
	const numberParam = (key: string): number | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'number' ? (params[key] as number) : undefined;
	};
	const boolParam = (key: string): boolean => getComponentParams()[key] === true;

	const variant = $derived(stringParam('variant') ?? 'dark');
	// Per-part tint (bind.props) overrides the instance `tint` param; else white.
	const tint = $derived(tintProp ?? numberParam('tint') ?? 0xffffff);
	const disabled = $derived(boolParam('disabled'));
	const active = $derived(boolParam('active'));

	// The action handler arrives on the param context (same reactive trick as
	// `HudValue`'s `value`); undefined until the action feed registers it → no-op.
	const onpress = () => {
		const handler = getComponentParams()['onpress'];
		if (typeof handler === 'function') (handler as () => void)();
	};
</script>

<Container eventMode="static" cursor={disabled ? 'not-allowed' : 'pointer'} onpointerup={onpress}>
	<Container {tint}>
		<UiSprite
			anchor={0.5}
			width={UI_BASE_SIZE}
			height={UI_BASE_SIZE}
			backgroundColor={variant === 'dark' ? 0x000000 : 0xffffff}
			{...texture ? { key: texture } : {}}
			{...borderRadius !== undefined ? { borderRadius } : {}}
			{...disabled
				? {
						backgroundColor: 0xaaaaaa,
					}
				: {}}
			{...active
				? {
						borderWidth: 10,
						borderColor: variant === 'dark' ? 0xffffff : 0x000000,
					}
				: borderWidth
					? {
							borderWidth,
							borderColor: borderColor ?? 0x000000,
						}
					: {}}
		/>
	</Container>
</Container>
