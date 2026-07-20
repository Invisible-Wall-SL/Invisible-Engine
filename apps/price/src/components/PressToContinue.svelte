<script lang="ts">
	import { onDestroy } from 'svelte';

	import { MainContainer, OnPressFullScreen } from 'components-layout';
	import { OnHotkey } from 'components-shared';
	import { stateUi, stateUrlDerived } from 'state-shared';
	import { Sprite } from 'pixi-svelte';

	import { getContext } from '../game/context';

	type Props = {
		onpress: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	// Claim the press while this overlay is up, so the spin button's Space hotkey stands down and
	// one keypress runs the continue-press only (see `stateUi.continuePressCount`).
	stateUi.continuePressCount += 1;
	onDestroy(() => (stateUi.continuePressCount -= 1));
</script>

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
<OnHotkey hotkey="Space" onpress={() => props.onpress()} />
<OnPressFullScreen onpress={() => props.onpress()} />
