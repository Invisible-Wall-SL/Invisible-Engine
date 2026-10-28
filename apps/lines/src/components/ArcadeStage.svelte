<script lang="ts" module>
	import type { Scene } from 'engine-layout';

	export type Props = {
		/** The layout's screens: the one with a world or a camera gives the play field its camera, and
		 *  their `path` nodes are the paths the characters walk. */
		scenes: readonly Scene[];
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { getContextApp } from 'pixi-svelte';

	import {
		startArcade,
		tickArcade,
		useArcadeInput,
		useArcadePaths,
		useWorldCamera,
	} from '../game/arcade';
	import { getContext } from '../game/context';
	import { registerDeterminismArcade } from '../game/determinism';
	import { gameMechanic } from '../game/mechanic';
	import { listenOnline, onlineProbe, tickOnline, useOnlineCamera } from '../game/online';

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
	// An online game's bodies are the room's (`game/online.ts`): the server moves them, so the
	// local loop (its characters) never starts; its world camera follows the own player instead.
	const online = gameMechanic().room;
	const loop = online ? undefined : startArcade(() => context.stateLayoutDerived.mainLayout());
	$effect(() =>
		online
			? useOnlineCamera(scenes, () => {
					const { width, height } = context.stateLayoutDerived.mainLayout();
					return { w: width, h: height };
				})
			: useWorldCamera(scenes),
	);
	$effect(() =>
		online ? undefined : useArcadePaths(scenes, context.stateLayoutDerived.layoutType()),
	);

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		if (online || !pixi) return;
		return useArcadeInput(pixi.canvas, (x, y) => {
			const at = { x: 0, y: 0 };
			pixi.renderer.events.mapPositionToPoint(at, x, y);
			return at;
		});
	});

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
