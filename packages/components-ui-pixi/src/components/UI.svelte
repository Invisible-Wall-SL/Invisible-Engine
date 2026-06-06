<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HudTextOverride } from 'engine-layout';

	import { stateUi } from 'state-shared';

	import UIDefault from './UIDefault.svelte';
	import UIReplay from './UIReplay.svelte';
	import type { UiHud } from '../types';

	type Props = {
		gameName: Snippet<[HudTextOverride?]>;
		logo: Snippet<[HudTextOverride?]>;
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
	{#snippet gameName(override?: HudTextOverride)}
		{@render props.gameName(override)}
	{/snippet}

	{#snippet logo(override?: HudTextOverride)}
		{@render props.logo(override)}
	{/snippet}
</UIComponent>
