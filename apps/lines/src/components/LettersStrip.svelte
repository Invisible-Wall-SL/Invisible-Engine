<script lang="ts">
	import { untrack } from 'svelte';
	import { Container } from 'pixi-svelte';
	import { LETTERS_STRIP_MOUNT, resolveComponent, type ComponentInstanceNode } from 'engine-layout';
	import { ComponentInstance, getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import HoldAndWinLetter from './HoldAndWinLetter.svelte';
	import { configuredLetters } from '../game/holdAndWinLetters.svelte';

	/**
	 * The `lettersStrip` component's coded part — Grand's column letters (design §1.3, board end
	 * `columnLetters`) at `spacing` px, centred on the instance. With the default spacing (the cell
	 * pitch) and the instance centred on the board each letter sits over its reel. It counts itself in
	 * as the letters row, so the coded row (`HoldAndWinLetters`) steps aside for any copy of the strip,
	 * whatever its id. A project whose board end is not column letters draws nothing.
	 *
	 * Each letter draws as the component `tile` names (Phase 12c — a project's Letter Tile copy), fed
	 * its `reel` and `letter`; blank, or a component that is not registered, draws the coded letter
	 * (`HoldAndWinLetter`: dim until its column completes, then lit with a pulse).
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` for a strip whose def no longer binds
	 * this part) draws nothing: the def's own nodes are the letters. It still counts in.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const { standIn = false, ...props }: Record<string, unknown> & { standIn?: boolean } = $props();
	const instanceParams = getComponentParams();
	const spacing = $derived.by(() => {
		const value = instanceParams.spacing ?? props.spacing;
		return typeof value === 'number' && Number.isFinite(value) ? value : 120;
	});
	const tile = $derived.by(() => {
		const value = instanceParams.tile ?? props.tile;
		return typeof value === 'string' && value && resolveComponent(value).def ? value : undefined;
	});
	const letters = $derived(standIn ? [] : configuredLetters());

	// Untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => untrack(() => trackComponentMount(LETTERS_STRIP_MOUNT)));

	const tileNode = (componentId: string, reel: number, letter: string): ComponentInstanceNode => ({
		kind: 'componentInstance',
		id: `lettersStrip-letter-${reel}`,
		componentId,
		x: 0,
		y: 0,
		params: { reel, letter },
	});
</script>

<Container>
	{#each letters as letter, reel (`${tile ?? ''}:${reel}`)}
		{@const x = (reel - (letters.length - 1) / 2) * spacing}
		{#if tile}
			<Container {x}>
				<ComponentInstance node={tileNode(tile, reel, letter)} />
			</Container>
		{:else}
			<HoldAndWinLetter {reel} {letter} {x} y={0} />
		{/if}
	{/each}
</Container>
