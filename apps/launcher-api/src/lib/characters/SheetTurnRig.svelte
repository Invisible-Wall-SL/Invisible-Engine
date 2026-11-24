<script lang="ts">
	/**
	 * The turn preview's character when its sheet draws a rig (`SheetTurnPreview.svelte`): the
	 * game's own look (`engine-layout/sheet-rig` `createSheetRigLook`) drawing the frame the host's
	 * animator answered, with its place on the stage's: the mirror, the lean about the sheet's
	 * pivot, and the blend of two animations while the frame mixes two (`frame.blend`). It has no
	 * clock: it draws when the host hands it a frame, so a paused preview costs nothing.
	 *
	 * Fetched, with the runtime and Pixi, only when a rig sheet's preview is shown.
	 */
	import { onMount } from 'svelte';
	import { sheetClipPoints, sheetDraw, type SheetRigFrame } from 'engine-layout';
	import type { SheetRigLook } from 'engine-layout/sheet-rig';
	import type { CharacterSheet } from 'game-config';
	import { Application, Container, RendererType } from 'pixi.js';

	import type { RigFacts, RigFactsByName } from './rigFacts';
	import type { LoadedRig } from './rigLoad.client';
	import { sheetRigStartFailed } from './sheetRigTiles';
	import { turnStageBox } from './sheetTurn';

	interface Props {
		sheet: CharacterSheet;
		/** The frame to draw, at `atMs` on the host's clock. */
		frame: SheetRigFrame | undefined;
		atMs: number;
		/** The rigs read so far: a rig read again (new facts) is loaded again. */
		rigs: RigFactsByName;
		load: (rig: string) => Promise<LoadedRig>;
	}
	let { sheet, frame, atMs, rigs, load }: Props = $props();

	let loads = $state.raw<Record<string, LoadedRig | { error: string }>>({});
	const asked: Record<string, RigFacts | undefined> = {};
	$effect(() => {
		const rig = frame?.rig;
		if (!rig) return;
		const facts = Object.hasOwn(rigs, rig) ? rigs[rig] : undefined;
		const askedUnder = (): boolean => Object.hasOwn(asked, rig) && asked[rig] === facts;
		if (askedUnder()) return;
		asked[rig] = facts;
		load(rig).then(
			(loaded) => {
				if (askedUnder()) loads = { ...loads, [rig]: loaded };
			},
			(e: unknown) => {
				if (!askedUnder()) return;
				delete asked[rig];
				loads = { ...loads, [rig]: { error: e instanceof Error ? e.message : String(e) } };
			},
		);
	});
	const entry = $derived(frame && Object.hasOwn(loads, frame.rig) ? loads[frame.rig] : undefined);
	const loaded = $derived(entry && 'data' in entry ? entry : undefined);

	let startFailed = $state('');
	const why = $derived(
		!frame ? '' : startFailed || (!entry ? 'loading…' : 'error' in entry ? entry.error : ''),
	);

	/** The rig box's height over its width, read off the look once it is drawn. */
	let aspect = $state(1);
	const box = $derived.by(() => {
		const { width, anchorY } = sheetDraw(sheet);
		const w = Math.max(24, width);
		const h = w * aspect;
		return turnStageBox(
			sheet,
			{ side: w / 2, up: anchorY * h, down: (1 - anchorY) * h },
			sheetClipPoints(sheet, { w, h }, false).middle,
		);
	});

	let canvas = $state<HTMLCanvasElement>();
	let draw = $state.raw<(() => void) | undefined>(undefined);
	$effect(() => draw?.());

	onMount(() => {
		const app = new Application();
		const holder = new Container();
		app.stage.addChild(holder);
		let ready = false;
		let gone = false;
		let look: SheetRigLook | undefined;
		let unmount: (() => void) | undefined;
		let drawnBy: CharacterSheet | undefined;
		let drawnFrom: LoadedRig | undefined;

		const drop = (): void => {
			unmount?.();
			look?.destroy();
			look = undefined;
			unmount = undefined;
		};

		let createSheetRigLook: typeof import('engine-layout/sheet-rig').createSheetRigLook;
		void import('engine-layout/sheet-rig')
			.then((module) => {
				createSheetRigLook = module.createSheetRigLook;
				return app.init({
					canvas,
					backgroundAlpha: 0,
					antialias: true,
					autoDensity: true,
					autoStart: false,
					resolution: window.devicePixelRatio || 1,
					width: 1,
					height: 1,
					preference: 'webgl',
				});
			})
			.then(() => {
				ready = true;
				if (gone) app.destroy(false, { children: true });
				// Pixi falls back to a 2D canvas, which cannot draw a rig: that is not a preview.
				else if (app.renderer.type !== RendererType.WEBGL) throw new Error('no WebGL renderer');
				else
					draw = () => {
						if (app.renderer.width !== box.width || app.renderer.height !== box.height)
							app.renderer.resize(box.width, box.height);
						holder.position.set(box.placeX, box.placeY);
						if (!frame || !loaded) drop();
						else {
							if (!look || drawnFrom !== loaded || drawnBy !== sheet) {
								drop();
								look = createSheetRigLook(loaded.name, loaded.data, sheet);
								unmount = look.mount(holder, app);
								drawnBy = sheet;
								drawnFrom = loaded;
							}
							look.frame(frame, atMs);
							const drawn = look.drawn();
							const tall = drawn.width > 0 ? drawn.height / drawn.width : 0;
							if (tall > 0 && Math.abs(tall - aspect) > 0.01) aspect = tall;
						}
						app.render();
					};
			})
			.catch((e: unknown) => {
				console.error('[characters] the turn preview did not start', e);
				if (ready) app.destroy(false, { children: true });
				ready = false;
				draw = undefined;
				startFailed = sheetRigStartFailed;
			});

		return () => {
			gone = true;
			draw = undefined;
			drop();
			if (ready) app.destroy(false, { children: true });
		};
	});
</script>

<div class="stage" style:width="{box.width}px" style:height="{box.height}px">
	<canvas bind:this={canvas}></canvas>
	{#if why}<span class="why" class:failed={why !== 'loading…'}>{why}</span>{/if}
</div>

<style>
	.stage {
		position: relative;
		overflow: hidden;
		border-radius: 8px;
		background: repeating-conic-gradient(#10151c 0% 25%, #0c1016 0% 50%) 50% / 16px 16px;
	}
	canvas {
		position: absolute;
		inset: 0;
	}
	.why {
		position: absolute;
		inset: auto 6px 6px;
		font-size: 10px;
		color: #94a3b8;
	}
	.why.failed {
		color: #fca5a5;
	}
</style>
