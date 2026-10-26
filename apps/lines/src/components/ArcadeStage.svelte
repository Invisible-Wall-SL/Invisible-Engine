<script lang="ts">
	import { onDestroy } from 'svelte';

	import { getContextApp } from 'pixi-svelte';

	import { startArcade, tickArcade } from '../game/arcade';
	import { getContext } from '../game/context';
	import { registerDeterminismArcade } from '../game/determinism';

	/**
	 * THE ARCADE PLAY FIELD'S LOOP (`docs/design/game-families.md` §4.2, §6.4): mounted in the reel
	 * stack's place for a mechanic that is a play field. It draws nothing of its own — the bodies are
	 * spawned instances, drawn by the play field's spawn layer where the loop puts them — and ticks the
	 * arcade loop once a frame while the play field is on screen, so the field stops when the game
	 * leaves it.
	 */

	const context = getContext();
	const app = getContextApp();
	const loop = startArcade(() => context.stateLayoutDerived.mainLayout());

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
