<script lang="ts">
	import { Container, Text } from 'pixi-svelte';
	import { Button } from 'components-pixi';
	import { OnHotkey } from 'components-shared';

	import UiSprite from './UiSprite.svelte';
	import ButtonBetProvider from './ButtonBetProvider.svelte';
	import { UI_BASE_FONT_SIZE, UI_BASE_SIZE } from '../constants';
	import { i18nDerived } from '../i18n/i18nDerived';
	import type { UiButtonArgs } from '../types';

	const { tint, ...props }: UiButtonArgs = $props();
	const sizes = { width: UI_BASE_SIZE, height: UI_BASE_SIZE };
</script>

<ButtonBetProvider>
	{#snippet children({ key, onpress, disabled, hotkeyDisabled })}
		<!-- A bet starts only from a press that began while this hotkey listened: a Space still held
			 when it stands back up (a press-to-continue closing, the loading tap) auto-repeats keyDown,
			 and that repeat used to place a bet no one pressed for. -->
		<OnHotkey hotkey="Space" disabled={hotkeyDisabled} ignorePressInProgress {onpress} />
		<Button {...props} {sizes} {onpress} {disabled}>
			{#snippet children({ center, hovered })}
				<Container {...center} tint={tint ?? 0xffffff}>
					<UiSprite
						key="bet"
						width={sizes.width}
						height={sizes.height}
						anchor={0.5}
						{...disabled ? { backgroundColor: 0xaaaaaa } : {}}
					/>
					<Text
						anchor={0.5}
						text={['spin_default', 'spin_disabled'].includes(key)
							? i18nDerived.bet()
							: i18nDerived.stop()}
						style={{
							align: 'center',
							wordWrap: true,
							wordWrapWidth: 200,
							fontFamily: 'proxima-nova',
							fontWeight: '600',
							fontSize: UI_BASE_FONT_SIZE * 0.9,
							fill: 0xffffff,
						}}
					/>
				</Container>
			{/snippet}
		</Button>
	{/snippet}
</ButtonBetProvider>
