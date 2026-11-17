<script lang="ts">
	import { getContextApp } from 'pixi-svelte';
	import type { World3d } from 'engine-3d';

	import ArcadeStage, { type Props } from './ArcadeStage.svelte';

	/**
	 * THE 3D PLAY FIELD (`docs/design/3d-games.md`), compiled only into the `arcade3d` runtime
	 * (`families/arcade3d.ts`). The stock `<ArcadeStage>` keeps the loop, the input, the camera and
	 * the online room; beside it, three.js draws the world in its own canvas under the Pixi canvas,
	 * which is made transparent while this is mounted so the HUD draws over the world and takes every
	 * click. `engine-3d` is imported dynamically: three.js is its own lazy chunk, fetched when the
	 * play field mounts.
	 */

	const props: Props = $props();
	const app = getContextApp();

	$effect(() => {
		const pixi = app.stateApp.pixiApplication;
		const host = pixi?.canvas.parentElement;
		if (!pixi || !host) return;
		const background = pixi.renderer.background;
		const alpha = background.alpha;
		const position = pixi.canvas.style.position;
		background.alpha = 0;
		// A positioned later sibling paints over the world's fixed canvas.
		pixi.canvas.style.position = 'relative';

		let world: World3d | undefined;
		let gone = false;
		const tick = () => world?.sync({ deltaMs: pixi.ticker.deltaMS });
		const fit = () => world?.resize(window.innerWidth, window.innerHeight);
		import('engine-3d').then(({ mountWorld3d }) => {
			if (gone) return;
			world = mountWorld3d(host);
			fit();
			pixi.ticker.add(tick);
			window.addEventListener('resize', fit);
		});
		return () => {
			gone = true;
			pixi.ticker.remove(tick);
			window.removeEventListener('resize', fit);
			world?.destroy();
			background.alpha = alpha;
			pixi.canvas.style.position = position;
		};
	});
</script>

<ArcadeStage {...props} />
