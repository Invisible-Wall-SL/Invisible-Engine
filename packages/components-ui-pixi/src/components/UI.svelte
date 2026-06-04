<script lang="ts">
	import type { Snippet } from 'svelte';

	import { stateUi } from 'state-shared';

	import UIDefault from './UIDefault.svelte';
	import UIReplay from './UIReplay.svelte';
	import type { UiHud } from '../types';

	type Props = {
		gameName: Snippet;
		logo: Snippet;
		/** Editor-authored HUD scenes — when provided the default UI renders its
		 * HUD from them (positionable in the editor). Omit for the coded layout. */
		hud?: UiHud;
	};

	const props: Props = $props();

	const UI_COMPONENT_MAP = {
		default: UIDefault,
		replay: UIReplay,
	};

	const UIComponent = $derived(UI_COMPONENT_MAP[stateUi.config.mode]);
</script>

<UIComponent hud={props.hud}>
	{#snippet gameName()}
		{@render props.gameName()}
	{/snippet}

	{#snippet logo()}
		{@render props.logo()}
	{/snippet}
</UIComponent>
