<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import Symbol from './Symbol.svelte';
	import { stateGame } from '../game/stateGame.svelte';
	import type { SymbolName, SymbolState } from '../game/types';

	// The landed book expanding symbol as a PLACEABLE, editor-positioned component (the
	// `expandingSymbol` builtin def binds this). Unlike the coded `SpecialBook` it does NOT
	// shuffle — it simply renders the CHOSEN symbol (`stateGame.specialSymbol`) via the same
	// `<Symbol>` state-machine render path. The author wraps their own reveal animation +
	// timing around it (their spine cued by the `specialBookReveal` signal + Flow choreography);
	// this only shows the correct art. Position/scale come from the instance node.
	const {
		state: stateProp = 'bookIdle',
		scale: scaleProp = 1,
	}: {
		state?: SymbolState;
		scale?: number;
	} = $props();

	const stringParam = (key: string): string | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	};
	const numberParam = (key: string): number | undefined => {
		const value = getComponentParams()[key];
		return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
	};

	const state = $derived((stringParam('state') as SymbolState | undefined) ?? stateProp);
	const scale = $derived(numberParam('scale') ?? scaleProp);
	const displayName = $derived(stateGame.specialSymbol as SymbolName | null);
</script>

{#if displayName}
	<Container {scale}>
		<Symbol rawSymbol={{ name: displayName }} {state} loop={state === 'bookIdle'} />
	</Container>
{/if}
