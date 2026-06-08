<script lang="ts">
	import { stateUi } from 'state-shared';

	import UiButton from './UiButton.svelte';
	import { UI_BASE_SIZE } from '../constants';
	import { getContext } from '../context';
	import type { UiButtonArgs } from '../types';

	const props: UiButtonArgs = $props();
	const context = getContext();
	const sizes = { width: UI_BASE_SIZE, height: UI_BASE_SIZE };

	const onpress = () => {
		context.eventEmitter.broadcast({ type: 'soundPressGeneral' });
		stateUi.menuOpen = true;
	};
</script>

<UiButton {...props} {sizes} {onpress} icon="menu" />
