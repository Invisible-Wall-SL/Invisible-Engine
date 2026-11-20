<script lang="ts">
	/**
	 * A character drawn as a rig, in every facing of its sheet's view at once, as the game draws
	 * it: each facing is the game's own look (`engine-layout/sheet-rig` `createSheetRigLook`) fed
	 * the frame the game's resolver answers (`sheetRigTiles`), so the rig, the animation, the
	 * mirror, the skin and the placement in the draw box are the game's code. One Pixi application
	 * on one canvas draws every facing, laid over a compass of tiles in the order and areas of
	 * Flipbook's Directions preview (`compassAreas`).
	 *
	 * The host owns the rigs: `rigs` are the facts it has read (the resolver asks them) and `load`
	 * hands a rig's loaded data (`rigLoad.client.ts` `createRigLoader`), which the host disposes.
	 */
	import { onMount } from 'svelte';
	import { sheetDraw, type ClipFacing } from 'engine-layout';
	import type { SheetRigLook } from 'engine-layout/sheet-rig';
	import type { CharacterSheet } from 'game-config';
	import { Application, Container, Graphics, RendererType } from 'pixi.js';

	import { compassAreas } from '$lib/flipbook/characterSet';
	import type { RigFacts, RigFactsByName } from './rigFacts';
	import type { LoadedRig } from './rigLoad.client';
	import {
		RIG_HOLD_REST_MS,
		sheetRigCaption,
		sheetRigFrameAt,
		sheetRigHolds,
		sheetRigLoops,
		sheetRigStartFailed,
		sheetRigTileBox,
		sheetRigTiles,
		type SheetRigTile,
	} from './sheetRigTiles';

	interface Props {
		sheet: CharacterSheet;
		/** The rigs read so far, by bundle name: a rig not in it has no animation yet. */
		rigs: RigFactsByName;
		load: (rig: string) => Promise<LoadedRig>;
		/** The action shown. */
		action: string;
		/** The statuses that hold (a variant's skin is worn while its status does). */
		statuses?: string[];
		/** The facing the host has selected. */
		selected?: string;
		/** Every facing is a button and this is told which was pressed, one that draws nothing too. */
		onCell?: (facing: ClipFacing) => void;
	}
	let { sheet, rigs, load, action, statuses = [], selected, onCell }: Props = $props();

	let zoom = $state(1);
	let showBox = $state(false);
	let playing = $state(true);

	const tiles = $derived(sheetRigTiles(sheet, action, statuses, rigs));
	const loops = $derived(sheetRigLoops(sheet, action));
	const holds = $derived(sheetRigHolds(sheet, action));
	const areas = $derived(compassAreas(tiles.map((t) => t.facing)));
	const drawnWidth = $derived(sheetDraw(sheet).width);

	/** Each rig a tile needs: loaded, or why it could not be. */
	let loads = $state.raw<Record<string, LoadedRig | { error: string }>>({});
	/** The facts each rig was asked for under: a rig the host has read again (new facts) is loaded
	 *  again, and one whose load failed is forgotten, so the next read of it tries again. */
	const asked: Record<string, RigFacts | undefined> = {};
	$effect(() => {
		for (const { found } of tiles) {
			if (!found) continue;
			const { rig } = found;
			const facts = Object.hasOwn(rigs, rig) ? rigs[rig] : undefined;
			const askedUnder = (): boolean => Object.hasOwn(asked, rig) && asked[rig] === facts;
			if (askedUnder()) continue;
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
		}
	});

	/** Why the preview draws nothing at all (the game's look or the renderer did not start). */
	let startFailed = $state('');

	const loadedOf = (rig: string): LoadedRig | undefined => {
		const entry = Object.hasOwn(loads, rig) ? loads[rig] : undefined;
		return entry && 'data' in entry ? entry : undefined;
	};

	function stateOf(tile: SheetRigTile): {
		kind: 'none' | 'loading' | 'failed' | 'drawn';
		why: string;
	} {
		if (!tile.found) return { kind: 'none', why: '' };
		if (startFailed) return { kind: 'failed', why: startFailed };
		const entry = Object.hasOwn(loads, tile.found.rig) ? loads[tile.found.rig] : undefined;
		if (!entry) return { kind: 'loading', why: 'loading…' };
		return 'error' in entry ? { kind: 'failed', why: entry.error } : { kind: 'drawn', why: '' };
	}

	/** The rig box's height over its width, read off the looks once they are drawn. */
	let aspect = $state(1);
	const tileBox = $derived(sheetRigTileBox(sheet, zoom, aspect));

	let compass = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();

	type Cell = {
		root: Container;
		holder: Container;
		clip: Graphics;
		overlay: Graphics;
		look: SheetRigLook | undefined;
		unmount: (() => void) | undefined;
		drawnBy: CharacterSheet | undefined;
		drawnFrom: LoadedRig | undefined;
		size: string;
	};

	onMount(() => {
		const app = new Application();
		const cells: Partial<Record<ClipFacing, Cell>> = {};
		let ready = false;
		let gone = false;
		let clock = 0;

		const drop = (cell: Cell): void => {
			cell.unmount?.();
			cell.look?.destroy();
			cell.look = undefined;
			cell.unmount = undefined;
		};

		const cellOf = (facing: ClipFacing): Cell => {
			const made = cells[facing];
			if (made) return made;
			const root = new Container();
			const clip = new Graphics();
			const holder = new Container();
			const overlay = new Graphics();
			root.addChild(clip, holder, overlay);
			root.mask = clip;
			app.stage.addChild(root);
			const cell: Cell = {
				root,
				holder,
				clip,
				overlay,
				look: undefined,
				unmount: undefined,
				drawnBy: undefined,
				drawnFrom: undefined,
				size: '',
			};
			cells[facing] = cell;
			return cell;
		};

		function drawOverlay(cell: Cell, box: typeof tileBox, scale: number): void {
			const g = cell.overlay.clear();
			if (!showBox) return;
			g.moveTo(0, box.placeY)
				.lineTo(box.width, box.placeY)
				.stroke({ color: 0xfacc15, alpha: 0.55 });
			if (cell.look) {
				const { width, height } = cell.look.drawn();
				const { hand } = cell.look.points();
				const { anchorY } = sheetDraw(sheet);
				g.rect(
					box.placeX - (width * scale) / 2,
					box.placeY - anchorY * height * scale,
					width * scale,
					height * scale,
				).stroke({ color: 0x7ee0c0, width: 1 });
				g.circle(box.placeX + hand.dx * scale, box.placeY - hand.lift * scale, 3).fill(0x60a5fa);
			}
			g.circle(box.placeX, box.placeY, 3.5).fill(0xfacc15);
		}

		function frame(): void {
			if (!compass) return;
			const width = compass.clientWidth;
			const height = compass.clientHeight;
			if (app.renderer.width !== width || app.renderer.height !== height)
				app.renderer.resize(Math.max(1, width), Math.max(1, height));
			if (playing) clock += app.ticker.deltaMS;

			const box = tileBox;
			const frame0 = compass.getBoundingClientRect();
			const live: ClipFacing[] = [];
			let tallest = 0;
			for (const tile of tiles) {
				const stage = compass.querySelector<HTMLElement>(`[data-rig-stage="${tile.facing}"]`);
				if (!stage) continue;
				live.push(tile.facing);
				const cell = cellOf(tile.facing);
				const at = stage.getBoundingClientRect();
				cell.root.position.set(at.left - frame0.left, at.top - frame0.top);
				const size = `${box.width}x${box.height}`;
				if (cell.size !== size) {
					cell.size = size;
					cell.clip.clear().rect(0, 0, box.width, box.height).fill(0xffffff);
				}
				cell.holder.position.set(box.placeX, box.placeY);
				cell.holder.scale.set(zoom);

				const loaded = tile.found && loadedOf(tile.found.rig);
				if (!tile.found || !loaded) drop(cell);
				else {
					if (!cell.look || cell.drawnFrom !== loaded || cell.drawnBy !== sheet) {
						drop(cell);
						cell.look = createSheetRigLook(loaded.name, loaded.data, sheet);
						cell.unmount = cell.look.mount(cell.holder, app);
						cell.drawnBy = sheet;
						cell.drawnFrom = loaded;
					}
					cell.look.frame(
						sheetRigFrameAt(tile, loops, clock, holds ? RIG_HOLD_REST_MS : undefined),
						clock,
					);
					const drawn = cell.look.drawn();
					if (drawn.width > 0) tallest = Math.max(tallest, drawn.height / drawn.width);
				}
				drawOverlay(cell, box, zoom);
			}
			for (const [facing, cell] of Object.entries(cells) as [ClipFacing, Cell][]) {
				if (live.includes(facing)) continue;
				drop(cell);
				cell.root.destroy({ children: true });
				delete cells[facing];
			}
			if (tallest > 0 && Math.abs(tallest - aspect) > 0.01) aspect = tallest;
		}

		// The game's look is fetched when the preview is, as a room fetches it: only for a rig.
		let createSheetRigLook: typeof import('engine-layout/sheet-rig').createSheetRigLook;
		void import('engine-layout/sheet-rig')
			.then((module) => {
				createSheetRigLook = module.createSheetRigLook;
				return app.init({
					canvas,
					backgroundAlpha: 0,
					antialias: true,
					autoDensity: true,
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
				else app.ticker.add(frame);
			})
			.catch((e: unknown) => {
				console.error('[characters] the rig preview did not start', e);
				if (ready) app.destroy(false, { children: true });
				ready = false;
				startFailed = sheetRigStartFailed;
			});

		return () => {
			gone = true;
			for (const cell of Object.values(cells)) drop(cell);
			if (ready) app.destroy(false, { children: true });
		};
	});
</script>

<div class="bar">
	<button class="play" onclick={() => (playing = !playing)}>
		{playing ? '❚❚ Pause' : '▶ Play'}
	</button>
	<label class="field">
		<span>size</span>
		<select value={zoom} onchange={(e) => (zoom = Number(e.currentTarget.value))}>
			<option value={1}>game size</option>
			<option value={2}>×2</option>
			<option value={3}>×3</option>
		</select>
	</label>
	<label class="check">
		<input type="checkbox" bind:checked={showBox} />
		<span>Box, feet and hand</span>
	</label>
</div>

<div class="scroll">
	<div class="compass" style:grid-template-areas={areas} bind:this={compass}>
		{#each tiles as tile (tile.facing)}
			{@const state = stateOf(tile)}
			<figure
				class="tile {state.kind}"
				class:mirrored={tile.found?.flipX === true}
				class:selected={selected === tile.facing}
				style:grid-area="f-{tile.facing}"
				style:width="{tileBox.width}px"
				data-rig-tile={tile.facing}
				data-rig={tile.found?.rig ?? ''}
				data-animation={tile.found?.animation ?? ''}
				data-flip={tile.found ? String(tile.found.flipX) : ''}
				data-skin={tile.found?.skin ?? ''}
				data-state={state.kind}
			>
				<div
					class="stage"
					data-rig-stage={tile.facing}
					style:width="{tileBox.width}px"
					style:height="{tileBox.height}px"
				>
					{#if state.kind === 'none'}<span class="empty">—</span>{/if}
					{#if state.why}<span class="why" class:failed={state.kind === 'failed'}>{state.why}</span
						>{/if}
				</div>
				<figcaption>
					<b>{tile.facing}</b>
					<span>{sheetRigCaption(tile, action)}</span>
				</figcaption>
				{#if onCell}
					<button
						class="hit"
						aria-label="{action}, facing {tile.facing}"
						aria-pressed={selected === tile.facing}
						onclick={() => onCell(tile.facing)}
					></button>
				{/if}
			</figure>
		{/each}
		{#if areas.includes('mid')}
			<div class="mid">
				<b>{action}</b>
				<span>{holds ? 'plays once, then holds' : loops ? 'loops' : 'plays once'}</span>
				<span>{drawnWidth} px wide</span>
			</div>
		{/if}
		<canvas bind:this={canvas}></canvas>
	</div>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}
	.play {
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		font-size: 12px;
		padding: 5px 10px;
		cursor: pointer;
	}
	.field,
	.check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #94a3b8;
	}
	select {
		padding: 4px 6px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.scroll {
		overflow-x: auto;
	}
	.compass {
		position: relative;
		display: grid;
		gap: 8px;
		justify-content: start;
		width: max-content;
	}
	canvas {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.tile {
		position: relative;
		box-sizing: content-box;
		margin: 0;
		border: 1px solid #1f2937;
		border-radius: 8px;
		background: #0b0e13;
		overflow: hidden;
	}
	.tile.drawn {
		border-color: #2f6b5b;
	}
	.tile.mirrored {
		border-color: #2f5273;
		border-style: dashed;
	}
	.tile.failed {
		border-color: #7f1d1d;
	}
	.tile.selected {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
	}
	.hit {
		position: absolute;
		inset: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.stage {
		position: relative;
		overflow: hidden;
		background: repeating-conic-gradient(#10151c 0% 25%, #0c1016 0% 50%) 50% / 16px 16px;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 18px;
		color: #475569;
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
	figcaption {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 4px 8px 5px;
		border-top: 1px solid #1f2937;
		font-size: 11px;
		line-height: 1.3;
		color: #94a3b8;
	}
	figcaption b {
		color: #e2e8f0;
		text-transform: uppercase;
		font-size: 11px;
	}
	figcaption span {
		overflow-wrap: anywhere;
		font-family: ui-monospace, monospace;
		font-size: 10px;
	}
	.tile.none figcaption span {
		color: #64748b;
	}
	.mid {
		grid-area: mid;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		font-size: 11px;
		color: #64748b;
	}
	.mid b {
		font-size: 13px;
		color: #cbd5e1;
	}
</style>
