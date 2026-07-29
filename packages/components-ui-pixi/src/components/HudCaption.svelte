<script lang="ts">
	import { WHITE } from 'constants-shared/colors';
	import { stateBetDerived, stateI18nDerived } from 'state-shared';
	import { CatalogText, getComponentParams } from 'engine-layout/svelte';
	import type { ResolvedTransform } from 'engine-layout';

	import { UI_BASE_FONT_SIZE } from '../constants';
	import { i18nDerived } from '../i18n/i18nDerived';

	/**
	 * Caption slice of the split HUD readout (§14.3 "separate coded parts").
	 * Reproduces `HudReadout`'s caption EXACTLY: the localized text per `source`
	 * (`i18nDerived.*`, `bet` → the active bet mode's label) with a `label` override,
	 * styled by the same `fill`/`fontSize`/`fontFamily` merge over `UiLabel`'s base.
	 *
	 * Honors the bind node's `transform.anchor` (the editor's vertical/horizontal
	 * alignment knob) so a re-anchored Caption node lands the SAME in-game as it
	 * previews; defaults to `{0.5,0}` — `UiLabel`'s stacked caption origin — so the
	 * built-in `hudReadout` def (caption `y:0`) is byte-identical. Reads the engine
	 * param context the `<ComponentInstance>` provides.
	 */
	const { transform }: { transform?: ResolvedTransform } = $props();
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
			case 'bet': {
				// Authored bet-mode label (Invisible Game Config) is a source string — translate it.
				const betLabel = stateBetDerived.activeBetMode()?.text.betAmountLabel;
				return betLabel ? stateI18nDerived.translate(betLabel) : i18nDerived.bet();
			}
			case 'balance':
			default:
				return i18nDerived.balance();
		}
	});
	const caption = $derived(labelOverride ?? codedCaption);

	// Same base + override merge as `UiLabel` (font/size/fill); absent overrides leave
	// the coded base untouched → parity. Per-text `caption*` keys (v2) win over the
	// SHARED key, which wins over the coded base — so a readout can style its caption
	// independently of its value, while older instances (shared keys only) are unchanged.
	const style = $derived({
		fontFamily: stringParam('captionFontFamily') ?? stringParam('fontFamily') ?? 'proxima-nova',
		fontSize: numberParam('captionFontSize') ?? numberParam('fontSize') ?? UI_BASE_FONT_SIZE,
		fill: numberParam('captionFill') ?? numberParam('fill') ?? WHITE,
	});

	// Per-instance horizontal ALIGN (v3): `captionAlign` left/centre/right drives the
	// text anchor AND its offset within `alignWidth` (the readout's background box), so a
	// dropdown left/right-aligns the caption to the background with NO manual positioning.
	// Unset ⇒ inherit the node's manual transform anchor (back-compat). `anchor.y` (the
	// vertical knob) is always honoured.
	const align = $derived(stringParam('captionAlign'));
	const halfW = $derived((numberParam('alignWidth') ?? 0) / 2);
	const anchorX = $derived(
		align === 'left'
			? 0
			: align === 'right'
				? 1
				: align === 'center'
					? 0.5
					: (transform?.anchor?.x ?? 0.5),
	);
	const offsetX = $derived(align === 'left' ? -halfW : align === 'right' ? halfW : 0);
</script>

<CatalogText
	x={offsetX}
	anchor={{ x: anchorX, y: transform?.anchor?.y ?? 0 }}
	text={caption}
	{style}
/>
