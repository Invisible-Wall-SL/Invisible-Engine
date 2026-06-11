<script lang="ts">
	import { Text } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';
	import type { ResolvedTransform } from 'engine-layout';

	import { UI_BASE_FONT_SIZE } from '../constants';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { ButtonIcon } from '../types';

	/**
	 * Label slice of the split `button` component (§16.2 "separate coded parts" —
	 * the button analogue of B5's `HudCaption`). Reproduces `UiButton`'s localized
	 * `Text` label EXACTLY: the icon glyph text (`i18nDerived[icon]()`) when an
	 * `icon` param names a known glyph, else the raw `label` string, under the same
	 * style merge `UiButton` uses (align/wrap, `proxima-nova` 600, `UI_BASE_FONT_SIZE
	 * * 0.9`, variant fill) so the live render is unchanged.
	 *
	 * Honors the bind node's `transform.anchor` (the editor's alignment knob) so a
	 * re-anchored Label node lands the SAME in-game as it previews; defaults to
	 * `0.5` — `UiButton`'s centred label origin — so the built-in `button` def
	 * (label `x:0,y:0`) is byte-identical. Reads the engine param context the
	 * `<ComponentInstance>` provides.
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

	const icon = $derived(stringParam('icon'));
	const labelOverride = $derived(stringParam('label'));
	const variant = $derived(stringParam('variant') ?? 'dark');

	// Localized glyph per `icon` (the EXACT selector `UiButton` uses,
	// `i18nDerived[icon]()`) when `icon` names a known glyph; otherwise the raw
	// `label` string. Absent both ⇒ empty.
	const text = $derived.by(() => {
		if (icon && icon in i18nDerived) return i18nDerived[icon as ButtonIcon]();
		return labelOverride ?? '';
	});

	// Same base + override merge as `UiButton`'s label; absent overrides leave the
	// coded base untouched → parity.
	const style = $derived({
		align: 'center' as const,
		wordWrap: true,
		wordWrapWidth: 200,
		fontFamily: stringParam('fontFamily') ?? 'proxima-nova',
		fontWeight: '600' as const,
		fontSize: numberParam('fontSize') ?? UI_BASE_FONT_SIZE * 0.9,
		fill: numberParam('fill') ?? (variant === 'dark' ? 0xffffff : 0x000000),
	});
</script>

<Text anchor={transform?.anchor ?? 0.5} {text} {style} />
