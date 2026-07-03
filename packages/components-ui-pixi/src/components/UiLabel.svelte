<script lang="ts">
	import { WHITE } from 'constants-shared/colors';
	import { CatalogText } from 'engine-layout/svelte';
	import type { TextStyle } from 'engine-layout';

	import UiSprite from './UiSprite.svelte';
	import { UI_BASE_FONT_SIZE } from '../constants';

	type Props = {
		label: string;
		value: string;
		tiled?: boolean;
		stacked?: boolean;
		/** Editor-authored text-style override merged over the coded label + value
		 * styling (font/size/fill). Absent = coded default (parity). */
		style?: Partial<TextStyle>;
		/** Editor-authored caption override (the label text only; the live VALUE
		 * stays coded). Absent = coded label (parity). */
		text?: string;
	};

	const props: Props = $props();

	const baseStyle = {
		fontFamily: 'proxima-nova',
		fontSize: UI_BASE_FONT_SIZE,
		fill: WHITE,
	} as const;

	// The override styles both the caption and the live value; spreading an absent
	// override (`undefined`) leaves the coded base untouched → byte-identical parity.
	const labelStyle = $derived({ ...baseStyle, ...props.style });
	const valueStyle = $derived({ ...baseStyle, ...props.style });
	const caption = $derived(props.text ?? props.label);
</script>

{#if props.stacked}
	{#if props.tiled}
		<UiSprite
			y={-20}
			anchor={{ x: 0.5, y: 0 }}
			key="base_ticker"
			width={UI_BASE_FONT_SIZE * 3 * (326 / 73)}
			height={UI_BASE_FONT_SIZE * 3}
			borderRadius={35}
		/>
	{/if}
	<CatalogText anchor={{ x: 0.5, y: 0 }} text={caption} style={labelStyle} />
	<CatalogText
		anchor={{ x: 0.5, y: 0 }}
		text={props.value}
		style={valueStyle}
		y={UI_BASE_FONT_SIZE}
	/>
{:else}
	{#if props.tiled}
		<UiSprite
			x={-90}
			anchor={{ x: 0, y: 0.5 }}
			key="base_ticker"
			width={UI_BASE_FONT_SIZE * 3 * (326 / 73)}
			height={UI_BASE_FONT_SIZE * 3}
			borderRadius={35}
		/>
	{/if}
	<CatalogText anchor={{ x: 0, y: 0.5 }} text={caption} style={labelStyle} />
	<CatalogText
		anchor={{ x: 1, y: 0.5 }}
		text={props.value}
		style={valueStyle}
		x={UI_BASE_FONT_SIZE * 10}
	/>
{/if}
