<script lang="ts">
	import * as PIXI from 'pixi.js';
	// Side-effect import: registers Pixi's KTX2 loader (`loadKTX2` + `detectCompressed` +
	// `resolveCompressedTextureUrl`) so a `.ktx2` (Basis Universal) page loads + transcodes
	// to the device-native GPU format (ASTC/ETC2/BC), staying compressed in VRAM. Inert for a
	// game that ships no `.ktx2` assets — the loader is simply never dispatched (parity).
	import 'pixi.js/ktx2';
	// Side-effect import: registers Pixi's ADVANCED blend modes (`overlay` and its family) as
	// filter extensions. Without it `blendMode = 'overlay'` is silently rendered as `normal` —
	// no warning, no error, just a node that does not blend — so the authored mode would work in
	// the editor preview (Canvas2D/CSS support overlay natively) and quietly do nothing in game.
	// Registration only; the filters are constructed on demand, so a game placing no advanced
	// blend pays the bundle and nothing else.
	import 'pixi.js/advanced-blend-modes';
	// Self-hosted KTX2 transcoder, bundled INTO the engine via Vite `?url` so it is emitted
	// into every consuming build's own asset output (`_app/immutable/...`) with a correct,
	// base-aware URL — standalone game builds AND the shared runtime bundle alike. (An earlier
	// `static/` + `document.baseURI` approach 404'd on standalone builds, whose `static/` comes
	// from the game repo, not the engine.) Pixi's default transcoder is an external CDN — forbidden.
	import ktxTranscoderJsUrl from '../transcoders/ktx/libktx.js?url';
	import ktxTranscoderWasmUrl from '../transcoders/ktx/libktx.wasm?url';
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

		// Point Pixi's KTX2 loader at the engine-bundled transcoder (URLs emitted by Vite `?url`
		// above), replacing Pixi's external-CDN default. `config-vite` excludes libktx from
		// inlining so these resolve to real files; but defensively, if a build still inlines them
		// to `data:` URIs, convert to a same-origin `blob:` URL — a Web Worker's `importScripts()`
		// rejects `data:` but accepts `blob:`. Inert unless a `.ktx2` is actually loaded.
		const toWorkerUrl = async (u: string) =>
			u.startsWith('data:') ? URL.createObjectURL(await (await fetch(u)).blob()) : u;
		PIXI.setKTXTranscoderPath({
			jsUrl: await toWorkerUrl(ktxTranscoderJsUrl),
			wasmUrl: await toWorkerUrl(ktxTranscoderWasmUrl),
		});

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
			// Render the frame into an offscreen back buffer and blit it to the canvas at the
			// end. Required for Pixi's ADVANCED blend modes (`overlay`, `lighten`, …), which are
			// filters that READ THE BACKDROP: on WebGL the backdrop is only readable from a
			// non-root render target, so with the default `useBackBuffer: false` `FilterSystem`
			// sets `filterData.skip = true` and the node renders as `normal`. It warns once per
			// push ("Blend filter requires backBuffer on WebGL renderer to be enabled") and
			// draws something plausible, which is why an authored `lighten` looked right in the
			// editor (Canvas2D/CSS blend natively) and did nothing in game. Measured on
			// pixi 8.8.1, backdrop `808080` under `40c040`: `lighten` gave `40c040` (i.e. normal)
			// with the back buffer off and the correct `80c080` with it on.
			// Costs one full-screen texture plus one blit per frame; the blit is a 1:1 copy at
			// the same resolution and MSAA still applies (the back-buffer texture is created
			// with `antialias`), so an unblended game renders identically to before.
			useBackBuffer: true,
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
