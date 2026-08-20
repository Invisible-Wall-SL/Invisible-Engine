<script lang="ts">
	import { stateBet, stateBetDerived } from 'state-shared';
	import { isCelebrationLocked } from 'utils-shared/spinStop';

	import UiButton from './UiButton.svelte';
	import { UI_BASE_SIZE } from '../constants';
	import { getContext } from '../context';
	import type { UiButtonArgs } from '../types';

	const props: UiButtonArgs = $props();
	const context = getContext();
	const sizes = { width: UI_BASE_SIZE, height: UI_BASE_SIZE };
	const active = $derived(stateBet.isTurbo);
	// Greyed while a non-skippable celebration owns the screen, on the SAME read as the spin
	// button (`utils-shared/spinStop`). The press is already dead there — and a disabled button
	// stops hit-testing entirely (`components-pixi/Button.svelte`), so a tap over it reaches the
	// celebration's own surface and skips the cinematic instead of silently toggling turbo — so
	// the button must LOOK dead too.
	const disabled = $derived(stateBet.isSpaceHold || isCelebrationLocked());

	const onpress = () => {
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateBetDerived.updateIsTurbo(!stateBet.isTurbo, { persistent: true });
	};

	context.eventEmitter.subscribeOnMount({
		stopButtonClick: () => stateBetDerived.updateIsTurbo(true, { persistent: false }),
		stopButtonEnable: () => stateBetDerived.updateIsTurbo(false, { persistent: false }),
	});
</script>

<UiButton {...props} {sizes} {active} {onpress} {disabled} icon="turbo" />
