<script lang="ts">
	import * as PIXI from 'pixi.js';
	// Side-effect import: registers Pixi's KTX2 loader (`loadKTX2` + `detectCompressed` +
	// `resolveCompressedTextureUrl`) so a `.ktx2` (Basis Universal) page loads + transcodes
	// to the device-native GPU format (ASTC/ETC2/BC), staying compressed in VRAM. Inert for a
	// game that ships no `.ktx2` assets — the loader is simply never dispatched (parity).
	import 'pixi.js/ktx2';
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

		// Self-host the KTX2 transcoder (libktx.js + libktx.wasm). Pixi's default points at
		// `files.pixijs.download` — an external CDN we must NOT depend on at runtime (offline-
		// hostile, blockable, against the no-external-host rule). The two files are vendored
		// into each game's static root (`static/transcoders/ktx/`); resolve them against the
		// document base so the URL is correct whether the game serves at '/' (dev) or under a
		// sub-path online (e.g. '/bookofborutremakebuild/'). Inert unless a `.ktx2` is loaded.
		if (typeof document !== 'undefined') {
			const ktxBase = new URL('transcoders/ktx/', document.baseURI).href;
			PIXI.setKTXTranscoderPath({ jsUrl: `${ktxBase}libktx.js`, wasmUrl: `${ktxBase}libktx.wasm` });
		}

		await preloadFont();
		context.stateApp.pixiApplication = new PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>();
		await context.stateApp.pixiApplication.init({
			autoDensity: true,
			backgroundAlpha: 0,
			hello: true,
			multiView: false,
			antialias: true,
			clearBeforeRender: true,
			// Force WebGL, do NOT let Pixi pick WebGPU. Mobile WebGPU (Safari iOS 18+,
			// Chrome on Pixel/Adreno) initialises "successfully" but paints nothing — the
			// game runs (buttons, sound, flow) yet the canvas is blank. Samsung Internet
			// has no WebGPU so it fell back to WebGL and always worked, which is why the
			// bug looked GPU-vendor specific. WebGL is rock-solid across all these devices
			// and visually identical for a 2D game. Revisit only when mobile WebGPU matures.
			preference: 'webgl',
			powerPreference: 'high-performance',
			// Clamp the backing-store resolution to [1, 2]. Upper cap: on high-DPR phones
			// (iPhone 16 = 3) an uncapped DPR allocates every framebuffer + render-texture at
			// 9× the pixel area, which blows past iOS Safari's per-tab memory cap and crashes
			// the WebContent process ("A problem repeatedly occurred"); 2 is visually identical.
			// Lower floor: a DPR below 1 (a zoomed-out / fractional-scaled display) would render
			// the whole scene SUB-native, so thin antialiased text ghosts into a faint echo that
			// reads as "double text". Never render below 1:1.
			resolution: Math.min(Math.max(devicePixelRatio.current ?? 1, 1), 2),
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
