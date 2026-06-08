<script lang="ts">
	import { Container, Text } from 'pixi-svelte';
	import { Button, type ButtonProps } from 'components-pixi';

	import UiSprite from './UiSprite.svelte';
	import type { ButtonIcon } from '../types';
	import type { Snippet } from 'svelte';
	import { i18nDerived } from '../i18n/i18nDerived';
	import { UI_BASE_FONT_SIZE } from '../constants';

	type Props = Omit<ButtonProps, 'children'> & {
		icon: ButtonIcon;
		sizes: { width: number; height: number };
		active?: boolean;
		children?: Snippet;
		variant?: 'dark' | 'light';
		/** Editor-authored recolour tint, applied as a PIXI `tint` (multiply) over the
		 * button visuals — preserves the disabled/active logic. Absent = white = parity. */
		tint?: number;
	};

	const {
		icon,
		active,
		variant = 'dark',
		tint,
		children: childrenFromParent,
		...buttonProps
	}: Props = $props();
</script>

<Button {...buttonProps}>
	{#snippet children({ center, hovered, pressed })}
		<Container tint={tint ?? 0xffffff}>
			<UiSprite
				{...center}
				anchor={0.5}
				width={buttonProps.sizes.width}
				height={buttonProps.sizes.height}
				backgroundColor={variant === 'dark' ? 0x000000 : 0xffffff}
				{...buttonProps.disabled
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

			<Text
				{...center}
				anchor={0.5}
				text={i18nDerived[icon]()}
				style={{
					align: 'center',
					wordWrap: true,
					wordWrapWidth: 200,
					fontFamily: 'proxima-nova',
					fontWeight: '600',
					fontSize: UI_BASE_FONT_SIZE * 0.9,
					fill: variant === 'dark' ? 0xffffff : 0x000000,
				}}
			/>

			{@render childrenFromParent?.()}
		</Container>
	{/snippet}
</Button>
