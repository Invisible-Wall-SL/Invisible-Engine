<script lang="ts">
	import * as PIXI from 'pixi.js';
	// Side-effect import: registers Pixi's KTX2 loader (`loadKTX2` + `detectCompressed` +
	// `resolveCompressedTextureUrl`) so a `.ktx2` (Basis Universal) page loads + transcodes
	// to the device-native GPU format (ASTC/ETC2/BC), staying compressed in VRAM. Inert for a
	// game that ships no `.ktx2` assets — the loader is simply never dispatched (parity).
	import 'pixi.js/ktx2';
	// Registers the ADVANCED blend modes (`overlay`, `lighten`) as filter extensions. Unregistered,
	// `blendMode = 'overlay'` is silently rendered as `normal` — no warning, no error — so the
	// authored mode would work in the editor preview (Canvas2D/CSS support it natively) and quietly
	// do nothing in game. We register OUR OWN corrected filters rather than importing
	// `pixi.js/advanced-blend-modes`, because Pixi's blend the PREMULTIPLIED sample as if it were
	// straight colour and so disagree with the editor everywhere the art is not fully opaque — see
	// `advancedBlendModes.ts` for the measurements. Registration only; the filters are constructed
	// on demand, so a game placing no advanced blend pays nothing beyond the bundle.
	import { registerAdvancedBlendModes } from '../advancedBlendModes';
	import { honourPremultipliedKtx2 } from '../ktx2AlphaMode';
	import { preferAstcForKtx2 } from '../ktx2TranscodeTarget';
	import { shareSheetPages } from '../sharedSheetPages';
	import { installKtx2Transcoder } from '../ktx2Transcoder';
	// Self-hosted KTX2 transcoder (Pixi's default is an external CDN — forbidden). `?url` emits
	// both files into every consuming build's own `_app/immutable/assets/` — standalone game builds
	// and the shared runtime alike, which a `static/` copy would not reach (a standalone build's
	// `static/` is the game repo's). `config-vite` keeps them out of asset inlining, and the bundle
	// is an ES module, so their url resolves against `import.meta.url`: beside the bundle, wherever
	// the build is served from.
	import ktxTranscoderJsUrl from '../transcoders/ktx/libktx.js?url';
	import ktxTranscoderWasmUrl from '../transcoders/ktx/libktx.wasm?url';
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';

	import { getContextApp } from '../context.svelte';
	import { disposeCameraEffects } from '../cameraEffects';
	import { disposeScreenTransitions } from '../screenFx/screenTransition';
	import { renderSettings } from '../renderTier';
	import { installRenderQuality } from '../renderQuality';
	import { trimBackBufferPasses } from '../backBufferPasses';
	import {
		AUTO_OPAQUE,
		measurePageBackdrop,
		noteAppliedRenderOptions,
		renderNeeds,
		renderSwitches,
		resolveRenderOptions,
	} from '../renderOptions';
	import { bindFrameClock, frameClockTick } from '../frameClock';
	import { preloadFont } from '../utils.svelte';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	let wrap: HTMLDivElement;
	let initialised = $state(false);
	let releaseFrameClock: (() => void) | undefined;
	let releaseBackBufferPasses: (() => void) | undefined;
	let releaseRenderQuality: (() => void) | undefined;

	const initialiseApplication = async () => {
		PIXI.Assets.reset();

		installKtx2Transcoder({ jsUrl: ktxTranscoderJsUrl, wasmUrl: ktxTranscoderWasmUrl });
		preferAstcForKtx2();
		honourPremultipliedKtx2();
		shareSheetPages();

		// Before the renderer exists: `BlendModePipe` caches one `FilterEffect` per mode name for
		// the life of a renderer, so a registration landing after a mode has drawn is ignored.
		registerAdvancedBlendModes();

		await preloadFont();
		const render = renderSettings();
		const switches = renderSwitches();
		const needs = renderNeeds();
		const canvas = document.createElement('canvas');
		// Only where an opaque canvas is possible: the check mounts the canvas for a moment.
		const opaquePossible = switches.opaque ?? (AUTO_OPAQUE && needs.backdropBlend === false);
		const options = resolveRenderOptions({
			tierAntialias: render.antialias,
			switches,
			needs,
			backdrop: opaquePossible ? measurePageBackdrop(wrap, canvas) : undefined,
		});
		noteAppliedRenderOptions(options);
		context.stateApp.pixiApplication = new PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>();
		await context.stateApp.pixiApplication.init({
			canvas,
			autoDensity: true,
			// Opaque only when the page behind is one solid colour, and cleared to it, so the pixels
			// are the ones the page compositor made of the transparent canvas (`renderOptions.ts`).
			backgroundAlpha: options.opaque ? 1 : 0,
			...(options.background ? { background: options.background } : {}),
			hello: true,
			multiView: false,
			antialias: options.antialias,
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
			// Costs a multisampled offscreen target, its resolve and a full-screen copy onto the
			// canvas every frame. `renderOptions.ts` decides it: on for every game until the owner
			// approves the edge pixels the canvas's own MSAA changes; `?backbuffer=0` shows that.
			useBackBuffer: options.useBackBuffer,
			powerPreference: 'high-performance',
			// Clamp the backing-store resolution to [1, 2]. Upper cap: on high-DPR phones
			// (iPhone 16 = 3) an uncapped DPR allocates every framebuffer + render-texture at
			// 9× the pixel area, which blows past iOS Safari's per-tab memory cap and crashes
			// the WebContent process ("A problem repeatedly occurred"); 2 is visually identical.
			// Lower floor: a DPR below 1 (a zoomed-out / fractional-scaled display) would render
			// the whole scene SUB-native, so thin antialiased text ghosts into a faint echo that
			// reads as "double text". Never render below 1:1. `?render=reduced` lowers the cap, and
			// `renderQuality.ts` lowers it later on a device that cannot keep up.
			resolution: Math.min(Math.max(devicePixelRatio.current ?? 1, 1), render.maxResolution),
			resizeTo: window,
		});

		wrap.appendChild(context.stateApp.pixiApplication.canvas);

		if (options.useBackBuffer)
			releaseBackBufferPasses = trimBackBufferPasses(context.stateApp.pixiApplication.renderer, {
				resolveOncePerFrame: switches.lazyResolve !== false,
				discardDepthStencil: switches.discardDepthStencil !== false,
			});

		// Keeps the frame clock's callback ahead of this ticker's, so reel motion sampled at a frame's
		// timestamp is the motion this ticker draws in that frame (`frameClock.ts`).
		context.stateApp.pixiApplication.ticker.add(frameClockTick);
		releaseFrameClock = bindFrameClock();
		// Only a game configures it: a tool's renderer stays at the level it was created at.
		releaseRenderQuality = installRenderQuality(context.stateApp.pixiApplication, {
			tier: render.tier,
			msaa: options.antialias,
		});

		// to prevent that you can't scroll the page with touch on the canvas. https://github.com/pixijs/pixijs/issues/4824
		context.stateApp.pixiApplication.renderer.events.autoPreventDefault = false;
		context.stateApp.pixiApplication.renderer.canvas.style.touchAction = 'auto';
		// A long press on the canvas is a game gesture (hold the spin button), never the browser's
		// callout or a text selection.
		const canvasStyle = context.stateApp.pixiApplication.renderer.canvas.style;
		canvasStyle.setProperty('-webkit-touch-callout', 'none');
		canvasStyle.setProperty('-webkit-user-select', 'none');
		canvasStyle.setProperty('user-select', 'none');
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
		releaseFrameClock?.();
		releaseRenderQuality?.();
		releaseBackBufferPasses?.();
		if (context.stateApp.pixiApplication) {
			context.stateApp.pixiApplication.ticker?.remove(frameClockTick);
			// Before `destroy()`: it kills the ticker first, so a camera effect or a screen transition
			// can never observe the teardown itself and would leave an awaiting flow chain hanging
			// forever.
			disposeCameraEffects(context.stateApp.pixiApplication);
			disposeScreenTransitions(context.stateApp.pixiApplication);
			context.stateApp.pixiApplication.destroy();
		}
	});
</script>

<div bind:this={wrap}>
	{#if initialised}
		{@render props.children()}
	{/if}
</div>
