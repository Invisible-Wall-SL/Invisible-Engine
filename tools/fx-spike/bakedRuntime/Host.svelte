<script lang="ts">
	/**
	 * The game's side of a placed effect, as `LayoutNodeView` mounts it: a positioned `<Container>`
	 * holding the real `<EffectPlayer>`, under an app context whose `loadedAssets` the entry fills.
	 */
	import type { Application } from 'pixi.js';
	import type { EffectDoc } from 'engine-fx';
	import {
		createContextParent,
		setContextApp,
	} from '@fxroot/packages/pixi-svelte/src/lib/context.svelte';
	import type { App } from '@fxroot/packages/pixi-svelte/src/lib/createApp.svelte';
	import Container from '@fxroot/packages/pixi-svelte/src/lib/components/Container.svelte';
	import EffectPlayer from '@fxroot/packages/pixi-svelte/src/lib/components/EffectPlayer.svelte';

	export interface Mount {
		doc: EffectDoc;
		x: number;
		y: number;
		instanceKey?: string;
		forceEmit?: boolean;
	}

	let {
		app,
		loadedAssets,
		mounts,
	}: { app: Application; loadedAssets: Record<string, unknown>; mounts: Mount[] } = $props();

	// svelte-ignore state_referenced_locally
	setContextApp({
		stateApp: { loaded: true, loadingProgress: 1, loadedAssets, pixiApplication: app },
	} as unknown as App);
	// svelte-ignore state_referenced_locally
	createContextParent(app.stage);
</script>

{#each mounts as m, i (i)}
	<Container x={m.x} y={m.y}>
		<EffectPlayer doc={m.doc} instanceKey={m.instanceKey} forceEmit={m.forceEmit} />
	</Container>
{/each}
