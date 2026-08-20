<script lang="ts">
	import { Tween } from 'svelte/motion';

	import { Container } from 'pixi-svelte';
	import { WHITE } from 'constants-shared/colors';
	import { stateModal } from 'state-shared';
	import { CatalogText, getComponentParams } from 'engine-layout/svelte';
	import type { ResolvedTransform } from 'engine-layout';
	import { numberToCurrencyString, bookEventAmountToCurrencyString } from 'utils-shared/amount';

	import { getContext } from '../context';
	import { UI_BASE_FONT_SIZE } from '../constants';

	/**
	 * Value slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces `HudReadout`'s value EXACTLY: the engine-fed live number, the
	 * per-source currency formatter (`win` → `bookEventAmountToCurrencyString`,
	 * balance/bet → `numberToCurrencyString`), the `svelte/motion` count-up `Tween`,
	 * and the `bet`-only tap-to-open-bet-menu interactivity (disabled mid-spin).
	 *
	 * Honors the bind node's `transform.anchor` (the editor's alignment knob) so a
	 * re-anchored Value node lands the SAME in-game as it previews; defaults to
	 * `{0.5,0}` — mirroring `UiLabel`'s `y: UI_BASE_FONT_SIZE` value `Text` origin —
	 * so the built-in `hudReadout` def (value `y:45`) is byte-identical. Reads the
	 * engine param context the `<ComponentInstance>` provides.
	 */
	const { transform }: { transform?: ResolvedTransform } = $props();

	const context = getContext();

	const numberParam = (key: string): number | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'number' ? (params[key] as number) : undefined;
	};
	const stringParam = (key: string): string | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'string' ? (params[key] as string) : undefined;
	};
	const boolParam = (key: string): boolean => getComponentParams()[key] === true;

	const source = $derived(stringParam('source'));
	const countUp = $derived(boolParam('countUp'));
	// The RAW live number from the engine value feed (undefined before the first
	// emit → render an empty value).
	const liveValue = $derived(numberParam('value'));

	// Per-source currency formatting — `win` is a BOOK-EVENT amount (bet-multiplier
	// normalised); balance/bet are plain currency amounts.
	const formatValue = (value: number): string =>
		source === 'win' ? bookEventAmountToCurrencyString(value) : numberToCurrencyString(value);

	// Count-up via the SAME `svelte/motion` Tween `HudReadout` uses. Init to a literal
	// 0 (not the `$derived` `liveValue`, which trips `state_referenced_locally`); the
	// effect immediately sets it to the live value.
	const valueTween = new Tween(0, { duration: 0 });
	$effect(() => {
		valueTween.set(liveValue ?? 0, { duration: countUp ? 500 : 0 });
	});
	const value = $derived(liveValue === undefined ? '' : formatValue(valueTween.current));

	// Per-text `value*` keys (v2) win over the SHARED key, which wins over the coded
	// base — so the value can be styled independently of the caption, while older
	// instances (shared keys only) render unchanged.
	const style = $derived({
		fontFamily: stringParam('valueFontFamily') ?? stringParam('fontFamily') ?? 'proxima-nova',
		fontSize: numberParam('valueFontSize') ?? numberParam('fontSize') ?? UI_BASE_FONT_SIZE,
		fill: numberParam('valueFill') ?? numberParam('fill') ?? WHITE,
	});

	// Per-instance horizontal ALIGN (v3): `valueAlign` left/centre/right drives the text
	// anchor AND its offset within `alignWidth` (the readout's background box), so a
	// dropdown left/right-aligns the value to the background with NO manual positioning.
	// Unset ⇒ inherit the node's manual transform anchor (back-compat); `anchor.y` honoured.
	const align = $derived(stringParam('valueAlign'));
	const halfW = $derived((numberParam('alignWidth') ?? 0) / 2);
	const anchorX = $derived(
		align === 'left' ? 0 : align === 'right' ? 1 : align === 'center' ? 0.5 : (transform?.anchor?.x ?? 0.5),
	);
	const offsetX = $derived(align === 'left' ? -halfW : align === 'right' ? halfW : 0);
	const anchor = $derived({ x: anchorX, y: transform?.anchor?.y ?? 0 });

	// `bet` reproduces tap-to-open-bet-menu (disabled mid-spin); other sources are
	// non-interactive.
	const isBet = $derived(source === 'bet');
	const disabled = $derived(!context.stateXstateDerived.isIdle());
	const onpress = () => {
		if (disabled) return;
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateModal.modal = { name: 'betAmountMenu' };
	};
</script>

{#if isBet}
	<!-- `none` while DISABLED so an inert surface does not SWALLOW the pointer — see the note in
		 `components-pixi/Button.svelte`. -->
	<Container
		eventMode={disabled ? 'none' : 'static'}
		cursor={disabled ? 'not-allowed' : 'pointer'}
		onpointerup={onpress}
	>
		<CatalogText x={offsetX} {anchor} text={value} {style} />
	</Container>
{:else}
	<CatalogText x={offsetX} {anchor} text={value} {style} />
{/if}
