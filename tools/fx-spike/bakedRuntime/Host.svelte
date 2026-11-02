<script lang="ts">
	/**
	 * The game's side of a placed effect, as `LayoutNodeView` mounts it: a positioned `<Container>`
	 * holding the real `<EffectPlayer>`, under an app context whose `loadedAssets` the entry fills.
	 * A `beat` mount is mounted the way `<RiggedEffect>` mounts a rig-fired effect — `forceEmit`,
	 * `emitSpeed`, `emitFor={released ? 0 : duration}`, re-keyed on every beat — and the entry drives
	 * its beats and its release through `fire` / `release`.
	 */
	import type { Application } from 'pixi.js';
	import type { EffectDoc, EffectParamValues } from 'engine-fx';
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
		beat?: { duration?: number; speed?: number };
		ownerPos?: () => { x: number; y: number };
		params?: () => EffectParamValues | undefined;
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

	// svelte-ignore state_referenced_locally
	const runs = $state(mounts.map(() => 1));
	// svelte-ignore state_referenced_locally
	const released = $state(mounts.map(() => false));

	/** A new beat on mount `i`: emitting again, re-mounted from t=0 (`<RiggedEffect>`'s `fire`). */
	export const fire = (i: number): void => {
		released[i] = false;
		runs[i] += 1;
	};
	/** Mount `i`'s clip is no longer played: emission ends (`<RiggedEffect>`'s `released`). */
	export const release = (i: number): void => {
		released[i] = true;
	};
</script>

{#each mounts as m, i (i)}
	<Container x={m.x} y={m.y}>
		{#if m.beat}
			{#key runs[i]}
				<EffectPlayer
					doc={m.doc}
					instanceKey={m.instanceKey}
					forceEmit
					emitSpeed={m.beat.speed}
					emitFor={released[i] ? 0 : m.beat.duration}
					ownerPos={m.ownerPos}
				/>
			{/key}
		{:else}
			<EffectPlayer
				doc={m.doc}
				instanceKey={m.instanceKey}
				forceEmit={m.forceEmit}
				ownerPos={m.ownerPos}
				params={m.params}
			/>
		{/if}
	</Container>
{/each}
