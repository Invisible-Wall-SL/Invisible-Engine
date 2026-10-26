<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The layout's screens: their `path` nodes are the paths the characters walk. */
		scenes: readonly Scene[];
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { getContextApp } from 'pixi-svelte';

	import { startArcade, tickArcade, useArcadePaths, useArcadeInput } from '../game/arcade';
	import { getContext } from '../game/context';
	import { registerDeterminismArcade } from '../game/determinism';

	/**
	 * THE ARCADE PLAY FIELD'S LOOP (`docs/design/game-families.md` §4.2, §6.4): mounted in the reel
	 * stack's place for a mechanic that is a play field. It draws nothing of its own — the bodies are
	 * spawned instances, drawn by the play field's spawn layer where the loop puts them — and ticks the
	 * arcade loop once a frame while the play field is on screen, so the field stops when the game
	 * leaves it. For a config with characters (P10.11) it also hands the loop the layout's paths and
	 * the keys and the pointer, while it is mounted; without, neither is read.
	 */

	const { scenes }: Props = $props();
	const context = getContext();
	const app = getContextApp();
	const loop = startArcade(() => context.stateLayoutDerived.mainLayout());
	$effect(() => useArcadePaths(scenes, context.stateLayoutDerived.layoutType()));

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		if (!pixi) return;
		return useArcadeInput(pixi.canvas, (x, y) => {
			const at = { x: 0, y: 0 };
			pixi.renderer.events.mapPositionToPoint(at, x, y);
			return at;
		});
	});

	$effect(() => {
		const ticker = app.stateApp.pixiApplication?.ticker;
		if (!ticker) return;
		const tick = () => tickArcade(ticker.deltaMS);
		ticker.add(tick);
		return () => {
			ticker.remove(tick);
		};
	});

	const unregisterProbe = registerDeterminismArcade({
		read: () => ({ steps: loop.steps, bodies: loop.bodies() }),
	});
	onDestroy(unregisterProbe);
</script>
