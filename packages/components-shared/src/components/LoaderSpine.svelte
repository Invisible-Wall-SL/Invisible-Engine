<script lang="ts">
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import { Application, Assets, Container } from 'pixi.js';
	import { BOOT_SPLASH_HOLD_MS, type BootSplashEntry } from 'constants-shared/bootSplash';

	/**
	 * ONE boot-splash tier: a spine logo on a solid background, as a full-screen overlay.
	 * The spine replaces the gif that `LoaderStakeEngine` / `LoaderExample` showed, so the
	 * mark is produced by our own pipeline instead of being a baked image.
	 *
	 * It stands up its OWN tiny `Application` rather than borrowing the game's, because the
	 * game's Pixi app does not exist yet — covering that gap is the splash's entire job.
	 * Two consequences the implementation is built around:
	 *
	 *  - **The context MUST be released.** A `WebGLRenderingContext` is a capped resource
	 *    (~16 live contexts before the browser starts dropping the oldest), and this app is
	 *    created moments before the GAME's renderer wants one. `destroy()` in the effect
	 *    teardown is load-bearing, not tidiness. Same cap that bit the always-mounted spine
	 *    previews in `/symbols`.
	 *  - **Nothing here may block boot.** Every failure path — no WebGL, a 404 atlas, a
	 *    skeleton the runtime rejects, an animation name that no longer exists — calls
	 *    `oncomplete()` and gets out of the way. A broken logo must cost the player a blank
	 *    2 seconds at worst, never a game that won't start.
	 *
	 * The background paints from CSS immediately, before the spine loads, so the splash never
	 * flashes white while its art is in flight.
	 */
	type Props = {
		entry: BootSplashEntry;
		/** Deploy-tree URL prefix, ending in `/` (`assets/` baked, the launcher's
		 * `/api/deploy/f/…/` in runtime mode — both preserve file extensions, which
		 * `Assets.load` needs to pick a parser). */
		assetBase: string;
		oncomplete: () => void;
	};

	const { entry, assetBase, oncomplete }: Props = $props();

	/** Hard ceiling on one tier, however long its animation is — a looping or mis-authored
	 * clip must not strand the player on the splash. */
	const MAX_TIER_MS = 6000;

	let host: HTMLDivElement | undefined = $state();
	let fading = $state(false);
	/** Guards against the fade-out running twice (animation end AND the timer). */
	let finished = false;

	function finish() {
		if (finished) return;
		finished = true;
		fading = true;
		// Let the CSS opacity transition play before the parent unmounts us.
		setTimeout(oncomplete, 400);
	}

	$effect(() => {
		const el = host;
		if (!el) return;

		let app: Application | undefined;
		let disposed = false;
		const urls = [`${assetBase}${entry.atlas}`, `${assetBase}${entry.skeleton}`];
		const timers: ReturnType<typeof setTimeout>[] = [];

		void (async () => {
			try {
				app = new Application();
				await app.init({
					// WebGPU inits on mobile but paints nothing (blank canvas on iOS/Pixel), and a
					// splash that renders nothing is worse than no splash — pin WebGL.
					preference: 'webgl',
					backgroundAlpha: 0,
					antialias: true,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
					resizeTo: el,
				});
				if (disposed) return;
				el.appendChild(app.canvas);

				const [atlas, skeletonRaw] = (await Assets.load(urls)) as [
					SPINE_PIXI.TextureAtlas,
					Uint8Array | unknown,
				];
				if (disposed) return;

				const attachmentLoader = new SPINE_PIXI.AtlasAttachmentLoader(atlas);
				const parser =
					skeletonRaw instanceof Uint8Array
						? new SPINE_PIXI.SkeletonBinary(attachmentLoader)
						: new SPINE_PIXI.SkeletonJson(attachmentLoader);
				parser.scale = entry.scale || 1;
				const skeletonData = parser.readSkeletonData(skeletonRaw as never);

				const spine = new SPINE_PIXI.Spine(skeletonData);
				const holder = new Container();
				holder.addChild(spine);
				app.stage.addChild(holder);

				// A named animation that no longer exists must not leave the skeleton on its setup
				// pose — that renders EMPTY and reads as a broken splash. Fall back to the first
				// clip, and only then to the static pose.
				const named = entry.animation ? skeletonData.findAnimation(entry.animation) : null;
				const clip = named ?? skeletonData.animations[0] ?? null;
				if (clip) spine.state.setAnimation(0, clip.name, false);

				const fit = () => {
					const w = skeletonData.width || spine.width || 1;
					const h = skeletonData.height || spine.height || 1;
					// Fit inside a conservative box so a wide mark can't touch the screen edges on
					// mobile; the smaller of the two axes wins so nothing is ever cropped.
					const scale = Math.min((app!.screen.width * 0.6) / w, (app!.screen.height * 0.45) / h);
					holder.scale.set(scale > 0 && Number.isFinite(scale) ? scale : 1);
					holder.position.set(app!.screen.width / 2, app!.screen.height / 2);
				};
				fit();
				app.renderer.on('resize', fit);

				// Hold for the same beat the gif loaders used, extended to cover a longer clip.
				const clipMs = clip ? clip.duration * 1000 : 0;
				timers.push(
					setTimeout(finish, Math.min(Math.max(clipMs, BOOT_SPLASH_HOLD_MS), MAX_TIER_MS)),
				);
			} catch (err) {
				console.warn('[bootSplash] tier failed to render — skipping it:', err);
				finish();
			}
		})();

		return () => {
			disposed = true;
			for (const t of timers) clearTimeout(t);
			// Release the GL context + textures before the game's renderer asks for its own.
			app?.destroy({ removeView: true }, { children: true, texture: true, textureSource: true });
			void Assets.unload(urls).catch(() => {});
		};
	});
</script>

<div
	class="boot-splash"
	class:fading
	style="--boot-splash-background: {entry.background};"
	bind:this={host}
></div>

<style>
	.boot-splash {
		position: absolute;
		inset: 0;
		z-index: 999;
		overflow: hidden;
		background-color: var(--boot-splash-background);
		transition: opacity 0.4s ease;
	}

	.boot-splash.fading {
		opacity: 0;
	}

	.boot-splash :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
