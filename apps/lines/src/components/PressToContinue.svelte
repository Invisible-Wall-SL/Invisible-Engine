<script lang="ts">
	import { MainContainer, OnPressFullScreen } from 'components-layout';
	import { OnHotkey } from 'components-shared';
	import { stateUrlDerived } from 'state-shared';
	import { Sprite } from 'pixi-svelte';

	import { getContext } from '../game/context';

	type Props = {
		onpress: () => void;
		// Hide the visible prompt sprite (the author draws their own continue graphic in the
		// screen) WITHOUT disabling the full-screen tap / Space hotkey — the round-blocking
		// hold still resolves on a tap anywhere. Default false ⇒ identical to today.
		hidePrompt?: boolean;
	};

	const props: Props = $props();
	const context = getContext();
</script>

{#if !props.hidePrompt}
	<MainContainer alignVertical="bottom">
		<Sprite
			key="pressToContinueText_{stateUrlDerived.lang()}.png"
			width={800}
			height={134}
			anchor={{ x: 0.5, y: 1 }}
			x={context.stateLayoutDerived.mainLayout().width * 0.5}
			y={context.stateLayoutDerived.mainLayout().height}
		/>
	</MainContainer>
{/if}
<OnHotkey hotkey="Space" onpress={() => props.onpress()} />
<OnPressFullScreen onpress={() => props.onpress()} />
