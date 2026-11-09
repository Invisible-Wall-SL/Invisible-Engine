<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { getContextApp, getContextParent } from 'pixi-svelte';
	import { Container } from 'pixi.js';

	import type { ArtMount } from './arcadeArt.svelte';

	/**
	 * A container of its own in the parent, drawn into by `mount` once the app is up (until then,
	 * nothing). It owns the whole lifecycle, so the art's teardown runs while its pieces are still
	 * in the container, and only then is the container destroyed.
	 */
	type Props = { mount: ArtMount; zIndex?: number };
	const { mount, zIndex = 0 }: Props = $props();

	const app = getContextApp();
	const parent = getContextParent();
	const into = new Container();
	$effect(() => {
		into.zIndex = zIndex;
	});
	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		if (!pixi) return;
		parent.parent.addChild(into);
		parent.parent.sortChildren();
		const teardown = untrack(() => mount(into, pixi));
		return () => {
			teardown();
			into.removeFromParent();
		};
	});
	onDestroy(() => into.destroy());
</script>
