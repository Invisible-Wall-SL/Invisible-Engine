<script lang="ts">
	import * as PIXI from 'pixi.js';
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';

	import { getContextApp } from '../context.svelte';
	import { disposeCameraEffects } from '../cameraEffects';
	import { preloadFont } from '../utils.svelte';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	let wrap: HTMLDivElement;
	let initialised = $state(false);

	const initialiseApplication = async () => {
		PIXI.Assets.reset();

		await preloadFont();
		context.stateApp.pixiApplication = new PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>();
		await context.stateApp.pixiApplication.init({
			autoDensity: true,
			backgroundAlpha: 0,
			hello: true,
			multiView: false,
			antialias: true,
			clearBeforeRender: true,
			// WebGL, not WebGPU. On some Android GPUs (notably the Pixel 9 Pro's Mali/
			// Immortalis) PixiJS 8's WebGPU path creates a context successfully — so Pixi's
			// built-in "WebGPU unavailable → WebGL" fallback never fires — yet composites a
			// solid black frame (game boots, audio + input work, screen stays black). WebGL is
			// universally reliable across mobile GPUs and costs nothing visible for a 2D slot.
			preference: 'webgl',
			powerPreference: 'high-performance',
			// Cap the backing-store resolution at 2. On high-DPR phones (iPhone 16 = 3)
			// an uncapped DPR allocates every framebuffer + render-texture at 9× the pixel
			// area, which blows past iOS Safari's per-tab memory cap and crashes the
			// WebContent process ("A problem repeatedly occurred"). 2 is visually identical.
			resolution: Math.min(devicePixelRatio.current ?? 1, 2),
			resizeTo: window,
		});

		wrap.appendChild(context.stateApp.pixiApplication.canvas);

		// to prevent that you can't scroll the page with touch on the canvas. https://github.com/pixijs/pixijs/issues/4824
		context.stateApp.pixiApplication.renderer.events.autoPreventDefault = false;
		context.stateApp.pixiApplication.renderer.canvas.style.touchAction = 'auto';
	};

	onMount(async () => {
		try {
			if (!initialised) await initialiseApplication();
			initialised = true;
		} catch (error) {
			console.error(error);
		}
	});

	onDestroy(() => {
		if (context.stateApp.pixiApplication) {
			// Before `destroy()`: it kills the ticker first, so a camera effect can never observe the
			// teardown itself and would leave an awaiting flow chain hanging forever.
			disposeCameraEffects(context.stateApp.pixiApplication);
			context.stateApp.pixiApplication.destroy();
		}
	});
</script>

<div bind:this={wrap}>
	{#if initialised}
		{@render props.children()}
	{/if}
</div>
