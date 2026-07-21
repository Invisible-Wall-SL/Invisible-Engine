<script lang="ts">
	import { Container } from 'pixi-svelte';

	import Symbol from './Symbol.svelte';
	import { stateGame } from '../game/stateGame.svelte';
	import type { SymbolName, SymbolState } from '../game/types';

	// The chosen book/reveal symbol (`stateGame.specialSymbol`) rendered to RIDE a bone of a
	// placed spine node — mounted by `<LayoutNodeView>` inside the rig's `<SpineBoneAttach>` when
	// that node sets `revealSymbolBone` (the `revealSymbolRider` bound component). Unlike the
	// rig-spawning `FreeSpinIntroSymbolReveal` this brings NO rig of its own: the author places
	// their own spine (e.g. `R_Cage_Freespin`) as a normal node and the special symbol appears on
	// its named bone. Like `ExpandingSymbol` it simply shows the correct art via the shared
	// `<Symbol>` state-machine render path; position/scale/rotation come from the host bone.
	const {
		state = 'bookIdle',
		scale = 1,
	}: {
		state?: SymbolState;
		scale?: number;
	} = $props();

	const displayName = $derived(stateGame.specialSymbol as SymbolName | null);
</script>

{#if displayName}
	<Container {scale}>
		<Symbol rawSymbol={{ name: displayName }} {state} loop={state === 'bookIdle'} />
	</Container>
{/if}
