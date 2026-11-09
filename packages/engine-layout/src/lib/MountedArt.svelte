<script lang="ts">
	import { onMount } from 'svelte';
	import { getContextApp, getContextParent } from 'pixi-svelte';
	import { Container } from 'pixi.js';

	import type { ArtMount } from './arcadeArt.svelte';

	/** A container of its own in the parent, drawn into by `mount` once the app is up. */
	type Props = { mount: ArtMount; zIndex?: number };
	const { mount, zIndex = 0 }: Props = $props();

	const app = getContextApp();
	const parent = getContextParent();
	const into = new Container();
	$effect(() => {
		into.zIndex = zIndex;
	});
	parent.addToParent(into);
	onMount(() => {
		const pixi = app.stateApp.pixiApplication;
		return pixi ? mount(into, pixi) : undefined;
	});
</script>
