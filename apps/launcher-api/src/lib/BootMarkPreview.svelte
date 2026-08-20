<script lang="ts">
	import { Application, Container } from 'pixi.js';
	import { BOOT_SPLASH_DEFAULT_SIZE } from 'constants-shared/bootSplash';
	import {
		loadFxSpine,
		type FxSkeletonEntry,
		type LoadedFxSpine,
	} from '../routes/(app)/fx/fxSpine.client';

	/**
	 * Live preview of a boot mark, so `size` / `animation` / `background` can be judged without a
	 * publish–reload round trip.
	 *
	 * It reuses the FX tool's `loadFxSpine` rather than PIXI's atlas loader, for the reason that
	 * module documents: the atlas loader resolves page images relative to `dirname(atlasURL)`, and
	 * these arrive from `/spine/file?dir=…&name=…`, which has no real path — the pages would 404.
	 * (That helper living under a tool route and being imported from `$lib` is a wart; it wants
	 * hoisting to `$lib` once something else needs it too.)
	 *
	 * FIDELITY IS THE POINT. Two things are matched to `LoaderSpine` deliberately, and must move
	 * together with it or the preview quietly starts lying:
	 *   - the fit formula (`0.6` of width, `0.45` of height, smaller axis wins, then × `size`);
	 *   - `shared: true`, so the bundle resolves in `_shared/spines/` exactly as the export does.
	 *     Previewing a same-named PROJECT bundle would show art the engine mark will never use.
	 * The canvas is held at 16:9 for the same reason — a preview at the panel's own odd aspect
	 * would misreport how much of the screen the mark fills.
	 */
	interface Props {
		/** The shared skeleton-index entry, or `null` when no bundle is selected. */
		entry: FxSkeletonEntry | null;
		animation: string;
		size: number;
		background: string;
		/** Animation names read off the loaded skeleton — lets the caller offer a real list
		 * instead of a free-text box nobody can verify. */
		animations?: string[];
	}

	let { entry, animation, size, background, animations = $bindable([]) }: Props = $props();

	let host: HTMLDivElement | undefined = $state();
	let status = $state('');
	let loaded: LoadedFxSpine | null = $state(null);

	let app: Application | undefined;
	let holder: Container | undefined;
	/** Reactive because the renderer comes up ASYNCHRONOUSLY: `app` is a plain binding, so a load
	 * effect that merely read it would run once, bail while the renderer was still initialising,
	 * and never retry — leaving a blank preview whenever a bundle was already selected on mount. */
	let ready = $state(false);

	/** Same box as `LoaderSpine`. Kept as a named constant pair so the two are visibly one rule. */
	const FIT_W = 0.6;
	const FIT_H = 0.45;

	/**
	 * Match the renderer to the host box, skipping a ZERO measurement.
	 *
	 * This panel lives inside an admin tab marked `hidden`, i.e. `display: none` until Settings is
	 * selected — so the renderer is stood up against a 0×0 element. `resizeTo` alone cannot cope
	 * with that: it feeds the 0 straight to `TextureSource.resize`, whose `width ||= this.width`
	 * treats 0 as "keep what you have", so the stage silently KEPT Pixi's 800×600 default forever.
	 * With `autoDensity` writing that default back as an inline `width: 800px` (which beats the
	 * stylesheet's `width: 100%`), the mark was drawn at the centre of an 800×600 stage inside a
	 * ~360×200 window with `overflow: hidden` — off-screen, and the panel read as a dead black box.
	 * A ResizeObserver fires on the display:none→visible transition, which is exactly the moment
	 * the real size first exists.
	 */
	function applySize(el: HTMLDivElement): void {
		if (!app) return;
		const w = el.clientWidth;
		const h = el.clientHeight;
		if (w <= 0 || h <= 0) return;
		if (app.screen.width !== w || app.screen.height !== h) app.renderer.resize(w, h);
		layout();
	}

	function layout(): void {
		if (!app || !holder || !loaded) return;
		const data = loaded.skeletonData;
		const w = data.width || 1;
		const h = data.height || 1;
		const fitted = Math.min((app.screen.width * FIT_W) / w, (app.screen.height * FIT_H) / h);
		const scale = fitted * (size || BOOT_SPLASH_DEFAULT_SIZE);
		holder.scale.set(scale > 0 && Number.isFinite(scale) ? scale : 1);
		holder.position.set(app.screen.width / 2, app.screen.height / 2);
	}

	// Stand up the renderer once, then keep it for the panel's lifetime — a WebGL context per
	// keystroke would burn through the browser's cap in seconds.
	$effect(() => {
		const el = host;
		if (!el) return;
		let disposed = false;
		let observer: ResizeObserver | undefined;

		void (async () => {
			try {
				const created = new Application();
				await created.init({
					preference: 'webgl',
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
				});
				if (disposed) {
					created.destroy({ removeView: true });
					return;
				}
				el.appendChild(created.canvas);
				app = created;
				created.renderer.on('resize', layout);
				observer = new ResizeObserver(() => applySize(el));
				observer.observe(el);
				applySize(el);
				ready = true;
			} catch {
				status = 'Preview needs WebGL, which this browser did not provide.';
			}
		})();

		return () => {
			disposed = true;
			ready = false;
			observer?.disconnect();
			app?.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
			app = undefined;
			holder = undefined;
		};
	});

	// Load whenever the SELECTED BUNDLE changes — not on every size/animation tweak, which are
	// applied to the already-loaded skeleton below.
	$effect(() => {
		const target = entry;
		if (!ready || !app) return;
		if (!target) {
			holder?.destroy({ children: true });
			holder = undefined;
			loaded = null;
			animations = [];
			status = '';
			return;
		}

		let cancelled = false;
		status = 'Loading…';
		void (async () => {
			try {
				const result = await loadFxSpine(target, { shared: true });
				if (cancelled || !app) return;
				holder?.destroy({ children: true });
				holder = new Container();
				holder.addChild(result.spine);
				app.stage.addChild(holder);
				result.spine.autoUpdate = true;
				loaded = result;
				animations = result.animations;
				status = result.animations.length === 0 ? 'This skeleton has no animations.' : '';
				layout();
			} catch (err) {
				if (cancelled) return;
				loaded = null;
				animations = [];
				status = `Could not load '${target.folder}'.`;
				console.warn('[bootMarkPreview] load failed:', err);
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	// Cheap knobs: re-pose / re-scale the skeleton already on the stage.
	$effect(() => {
		if (!loaded) return;
		// An unknown name would THROW out of `setAnimation` and kill the preview, so resolve it the
		// same way the runtime does: named clip, else the first, else leave the setup pose.
		const clip =
			(animation ? loaded.skeletonData.findAnimation(animation) : null) ??
			loaded.skeletonData.animations[0] ??
			null;
		if (clip) loaded.spine.state.setAnimation(0, clip.name, true);
	});

	$effect(() => {
		void size;
		layout();
	});
</script>

<div class="preview" style="--preview-bg: {background};">
	<div class="preview-stage" bind:this={host}></div>
	{#if status}
		<p class="preview-status">{status}</p>
	{/if}
</div>

<style>
	.preview {
		position: relative;
		width: 100%;
		max-width: 360px;
		aspect-ratio: 16 / 9;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		overflow: hidden;
		background-color: var(--preview-bg);
	}

	.preview-stage {
		position: absolute;
		inset: 0;
	}

	.preview-stage :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.preview-status {
		position: absolute;
		inset: auto 0 0 0;
		margin: 0;
		padding: 4px 8px;
		font-size: 11px;
		color: #cfcdc4;
		background: rgba(0, 0, 0, 0.55);
	}
</style>
