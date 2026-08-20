<script lang="ts">
	import { onDestroy } from 'svelte';

	import { MainContainer, OnPressFullScreen } from 'components-layout';
	import { OnHotkey } from 'components-shared';
	import { registerContinuePress, stateUi, stateUrlDerived } from 'state-shared';
	import { Sprite } from 'pixi-svelte';

	import { getGameContext } from '../game/context';

	type Props = {
		onpress: () => void;
		// Hide the visible prompt sprite (the author draws their own continue graphic in the
		// screen) WITHOUT disabling the full-screen tap / Space hotkey — the round-blocking
		// hold still resolves on a tap anywhere. Default false ⇒ identical to today.
		hidePrompt?: boolean;
	};

	const props: Props = $props();
	const context = getGameContext();

	// Claim the press for as long as this overlay is up. The full-screen rect below already owns
	// the POINTER (it covers the canvas), and this makes the KEYBOARD follow the same owner: the
	// spin button's Space hotkey reads `hasContinuePress()` and stands down, so one keypress runs
	// the continue-press only — not the continue-press AND a slam (with `soundPressBet` over the
	// outro music). Counted, because two gates can overlap across a fade-out/fade-in.
	stateUi.continuePressCount += 1;
	// ...and publish the press BODY, so the canvas-top `<ContinuePressMask>` can run it. The rect
	// below only covers what paints beneath the overlay: chrome above it (the HUD) hit-tests first
	// and swallows the tap, which is why a pointer resting on the spin button used to make a
	// celebration unskippable. The mask sits above every band and routes the tap back here.
	const unregisterPress = registerContinuePress(() => props.onpress());
	onDestroy(() => {
		stateUi.continuePressCount -= 1;
		unregisterPress();
	});
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
