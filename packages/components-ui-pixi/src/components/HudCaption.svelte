<script lang="ts">
	import { Text } from 'pixi-svelte';
	import { WHITE } from 'constants-shared/colors';
	import { stateBetDerived } from 'state-shared';
	import { getComponentParams } from 'engine-layout/svelte';

	import { UI_BASE_FONT_SIZE } from '../constants';
	import { i18nDerived } from '../i18n/i18nDerived';

	/**
	 * Caption slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces `HudReadout`'s caption EXACTLY: the localized text per `source`
	 * (`i18nDerived.*`, `bet` → the active bet mode's label) with a `label` override,
	 * styled by the same `fill`/`fontSize`/`fontFamily` merge over `UiLabel`'s base.
	 *
	 * Rendered at its OWN local origin (anchor `{0.5,0}`) — the `hudReadout` def
	 * positions this node (`y:0`), matching `UiLabel`'s stacked caption `Text`. Reads
	 * the engine param context the `<ComponentInstance>` provides.
	 */
	const numberParam = (key: string): number | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'number' ? (params[key] as number) : undefined;
	};
	const stringParam = (key: string): string | undefined => {
		const params = getComponentParams();
		return typeof params[key] === 'string' ? (params[key] as string) : undefined;
	};

	const source = $derived(stringParam('source'));
	const labelOverride = $derived(stringParam('label'));

	// Localized caption per source — the EXACT selector `HudReadout` uses
	// (`win`: `i18nDerived.win()`; `bet`: the active bet mode label, falling back to
	// `i18nDerived.bet()`; `balance`/default: `i18nDerived.balance()`). `label`
	// overrides when set.
	const codedCaption = $derived.by(() => {
		switch (source) {
			case 'win':
				return i18nDerived.win();
			case 'bet':
				return stateBetDerived.activeBetMode()?.text.betAmountLabel || i18nDerived.bet();
			case 'balance':
			default:
				return i18nDerived.balance();
		}
	});
	const caption = $derived(labelOverride ?? codedCaption);

	// Same base + override merge as `UiLabel` (font/size/fill); absent overrides leave
	// the coded base untouched → parity.
	const style = $derived({
		fontFamily: stringParam('fontFamily') ?? 'proxima-nova',
		fontSize: numberParam('fontSize') ?? UI_BASE_FONT_SIZE,
		fill: numberParam('fill') ?? WHITE,
	});
</script>

<Text anchor={{ x: 0.5, y: 0 }} text={caption} {style} />
