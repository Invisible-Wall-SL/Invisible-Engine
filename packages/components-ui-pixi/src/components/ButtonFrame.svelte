<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_SIZE } from '../constants';

	/**
	 * Frame slice of the split `button` component (§16.2 "separate coded parts" —
	 * the button analogue of B5's `HudTicker`). Reproduces `UiButton`'s `UiSprite`
	 * tile EXACTLY: the variant dark/light background, the disabled grey override,
	 * the active border, all under the editor-authored `tint` (multiply) — byte-
	 * identical to the coded button when the params carry their defaults.
	 *
	 * This part ALSO owns the hit area (the `HudValue`-owns-the-bet-tap analogue):
	 * a `static` `Container` whose `onpointerup` calls the action `onpress` exposed
	 * on the param context. That `onpress` is NOT wired until B6.2 (the
	 * `registerComponentActions` feed), so this phase a missing/undefined `onpress`
	 * is a safe no-op — exactly how `getComponentParams()` exposes any param that
	 * has no value yet.
	 *
	 * Rendered at its OWN local origin (anchor `{0.5,0.5}`) — the `button` def
	 * positions this node (`x:0,y:0`), matching `UiButton`'s centred frame. Reads
	 * the engine param context the `<ComponentInstance>` provides.
	 */
	const stringParam = (key: string): string | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'string' ? (params[key] as string) : undefined;
	};
	const boolParam = (key: string): boolean => getComponentParams()[key] === true;

	const variant = $derived(stringParam('variant') ?? 'dark');
	const tint = $derived.by(() => {
		const params = getComponentParams();
		return typeof params['tint'] === 'number' ? (params['tint'] as number) : 0xffffff;
	});
	const disabled = $derived(boolParam('disabled'));
	const active = $derived(boolParam('active'));

	// The action handler arrives on the param context (same reactive-getter trick
	// as `HudValue`'s `value`) once B6.2 registers the action feed. Until then it is
	// undefined — `onpointerup` becomes a no-op, preserving parity.
	const onpress = () => {
		const handler = getComponentParams()['onpress'];
		if (typeof handler === 'function') (handler as () => void)();
	};
</script>

<Container eventMode="static" cursor={disabled ? 'not-allowed' : 'pointer'} onpointerup={onpress}>
	<Container tint={tint}>
		<UiSprite
			anchor={0.5}
			width={UI_BASE_SIZE}
			height={UI_BASE_SIZE}
			backgroundColor={variant === 'dark' ? 0x000000 : 0xffffff}
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
				: {}}
		/>
	</Container>
</Container>
