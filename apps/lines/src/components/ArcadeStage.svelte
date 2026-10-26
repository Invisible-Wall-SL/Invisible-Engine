<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The layout's screens: the one with a world or a camera gives the play field its camera. */
		scenes: readonly Scene[];
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { getContextApp } from 'pixi-svelte';

	import { startArcade, tickArcade, useWorldCamera } from '../game/arcade';
	import { getContext } from '../game/context';
	import { registerDeterminismArcade } from '../game/determinism';
	import { gameMechanic } from '../game/mechanic';
	import { listenOnline, onlineProbe, tickOnline } from '../game/online';

	/**
	 * THE ARCADE PLAY FIELD'S LOOP (`docs/design/game-families.md` §4.2, §6.4): mounted in the reel
	 * stack's place for a mechanic that is a play field. It draws nothing of its own — the bodies are
	 * spawned instances, drawn by the play field's spawn layer where the loop puts them — and ticks the
	 * arcade loop once a frame while the play field is on screen, so the field stops when the game
	 * leaves it.
	 */

	const { scenes }: Props = $props();
	const context = getContext();
	const app = getContextApp();
	// An online game's bodies are the room's (`game/online.ts`): the server moves them, so the
	// local loop (and its camera) never starts.
	const online = gameMechanic().room;
	const loop = online ? undefined : startArcade(() => context.stateLayoutDerived.mainLayout());
	$effect(() => (online ? undefined : useWorldCamera(scenes)));

	$effect(() => {
		const ticker = app.stateApp.pixiApplication?.ticker;
		if (!ticker) return;
		const tick = online ? () => tickOnline(ticker.deltaMS) : () => tickArcade(ticker.deltaMS);
		ticker.add(tick);
		return () => {
			ticker.remove(tick);
		};
	});

	$effect(() => (online ? listenOnline() : undefined));

	const unregisterProbe = registerDeterminismArcade({
		read: () => {
			if (!loop) return onlineProbe();
			const camera = loop.camera();
			return { steps: loop.steps, bodies: loop.bodies(), ...(camera ? { camera } : {}) };
		},
	});
	onDestroy(unregisterProbe);
</script>
