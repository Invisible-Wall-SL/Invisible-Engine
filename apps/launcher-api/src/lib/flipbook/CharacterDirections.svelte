<script lang="ts">
	/**
	 * A character in all its facings at once, as the game draws it: each facing's clip at the
	 * width the game draws it (a block's `displayWidth`, a sheet's `draw.width`), its feet on the
	 * facing's place, mirrored where the game mirrors and stood in for where it stands in
	 * ({@link cellPlays}, the grid's own answer); a sheet's still image is drawn as the game draws
	 * it, a clip of one frame. The character plays a block (`look`) or a sheet
	 * (`sheet`), and `grid` is `characterGrid` of that same one.
	 *
	 * Drawn with the Clips preview's own parts: `RegionThumb` for the pixels, `applyClipBounds` to
	 * state a frame against a box, `boxFit` / `boxRect` for the overlay and `playbackIndices` for
	 * the walk. Mirroring is a CSS scale about the place, as the game mirrors about the anchor.
	 */
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import { boxFit, boxRect } from '$lib/boundsFit';
	import {
		cellKey,
		cellPlays,
		characterDraw,
		clipTail,
		clipsWithStills,
		compassAreas,
		type CharacterGrid,
		type GridCell,
	} from '$lib/flipbook/characterSet';
	import { clipStage, stageFeet } from '$lib/flipbook/characterStage';
	import {
		DEFAULT_FLIPBOOK_FPS,
		applyClipBounds,
		clipSheetKeys,
		parseFrameRef,
		playbackIndices,
		type FlipbookBounds,
		type FlipbookClip,
		type FlipbookFrameBox,
	} from 'engine-flipbook';
	import type { CharacterClips, ClipFacing } from 'engine-layout';
	import type { CharacterSheet } from 'game-config';
	import {
		fetchRegions,
		type EditorRegion,
		type RegionSet,
	} from '../../routes/(app)/editor/editorRegions.client';
	import RegionThumb from '../../routes/(app)/editor/RegionThumb.svelte';

	interface Props {
		/** The block the character plays. */
		look?: CharacterClips;
		/** The sheet it plays, read before `look` as the game reads it. */
		sheet?: CharacterSheet;
		/** `characterGrid` of the sheet (else the block), the project's clip ids and the variant. */
		grid: CharacterGrid;
		/** The project's clips under the character's prefixes, by id. */
		clips: Record<string, FlipbookClip>;
		/** A box drawn on every clip in place of its own: one the author is about to apply. */
		candidate?: FlipbookBounds;
		/** The state shown (a row of `grid`); bind it to follow or to set it. `''` ⇒ the first. */
		picked?: string;
		/** Every facing is a button and this is told which was pressed, one that plays nothing too. */
		onCell?: (cell: GridCell) => void;
		/** The `cellKey` of the cell the host has selected. */
		selected?: string;
	}
	let {
		look,
		sheet,
		grid,
		clips: projectClips,
		candidate,
		picked = $bindable(''),
		onCell,
		selected,
	}: Props = $props();

	const art = $derived(sheet ?? look);
	/** A sheet's still images are drawn too, each as the clip of one frame the game makes of it. */
	const clips = $derived<Record<string, FlipbookClip>>(
		art ? clipsWithStills(art, projectClips) : projectClips,
	);
	const row = $derived(grid.rows.find((r) => r.state === picked) ?? grid.rows[0]);
	let zoom = $state(1);
	let showBox = $state(false);
	let playing = $state(true);

	let regionSets = $state<Record<string, RegionSet>>({});
	function ensureRegions(key: string): void {
		if (!key || regionSets[key]) return;
		void fetchRegions(key).then((set) => {
			if (set) regionSets = { ...regionSets, [key]: set };
		});
	}

	/** One authored frame, ready to draw: its region, the box `RegionThumb` fits and where the
	 *  feet are on the drawn canvas. `null` for a frame whose region is not found. */
	type Draw = {
		set: RegionSet;
		record: EditorRegion;
		box: { origW: number; origH: number; offX: number; offY: number };
		feetX: number;
		feetY: number;
	};
	type Tile = {
		cell: GridCell;
		clip: FlipbookClip | undefined;
		/** The game mirrors it; the clip's own saved Mirror X turns that over, as in the game. */
		sx: number;
		sy: number;
		size: number;
		draws: (Draw | null)[];
		walk: number[];
		fps: number;
		/** The Bounds overlay on the drawn canvas, and whether it is the clip's own box. */
		overlay: { left: number; top: number; width: number; height: number } | undefined;
		boxed: boolean;
		/** How far the drawing reaches from the feet, px. */
		reach: { side: number; up: number; down: number };
		/** Why nothing is drawn though a clip plays. */
		problem: string;
	};

	const frameBox = (r: EditorRegion): FlipbookFrameBox => ({
		origW: r.origW ?? r.w,
		origH: r.origH ?? r.h,
		offX: r.offX ?? 0,
		offY: r.offY ?? 0,
		artW: r.w,
		artH: r.h,
	});

	function tileOf(cell: GridCell): Tile {
		const plays = cellPlays(cell);
		const clip = plays ? clips[plays.clipId] : undefined;
		const empty: Tile = {
			cell,
			clip,
			sx: 1,
			sy: 1,
			size: 0,
			draws: [],
			walk: [],
			fps: DEFAULT_FLIPBOOK_FPS,
			overlay: undefined,
			boxed: false,
			reach: { side: 0, up: 0, down: 0 },
			problem: plays && !clip ? 'Its clip could not be read.' : '',
		};
		if (!plays || !clip || !art) return empty;
		const found = clip.frames.map((entry) => {
			const ref = parseFrameRef(entry);
			const set = regionSets[ref.assetKey ?? clip.assetKey];
			const record = set?.regions.find((r) => r.name === ref.region);
			return set && record ? { set, record } : null;
		});
		const loaded = clipSheetKeys(clip).every((key) => !!regionSets[key]);
		if (!found[0])
			return { ...empty, problem: loaded ? 'Its first frame is not in its sheet.' : '' };
		const boxes = found.flatMap((f) => (f ? [frameBox(f.record)] : []));
		const stage = clipStage(art, clip, boxes, zoom, candidate ?? clip.bounds);
		if (!stage) return empty;
		const size = Math.max(1, Math.round(stage.scale * Math.max(stage.view.w, stage.view.h)));
		const fit = boxFit(size, stage.view);
		if (!fit) return empty;
		const reach = { side: 0, up: 0, down: 0 };
		const draws = found.map((f): Draw | null => {
			if (!f) return null;
			const frame = frameBox(f.record);
			const feet = stageFeet(art, stage, frame);
			const feetX = fit.originX + feet.x * fit.scale;
			const feetY = fit.originY + feet.y * fit.scale;
			const view = boxRect(fit, stage.view);
			reach.side = Math.max(reach.side, feetX - view.left, view.left + view.width - feetX);
			reach.up = Math.max(reach.up, feetY - view.top);
			reach.down = Math.max(reach.down, view.top + view.height - feetY);
			const { origW, origH, offX, offY } = applyClipBounds(frame, stage.view);
			return { ...f, box: { origW, origH, offX, offY }, feetX, feetY };
		});
		return {
			cell,
			clip,
			sx: (clip.flipX === true) !== plays.flipX ? -1 : 1,
			sy: clip.flipY === true ? -1 : 1,
			size,
			draws,
			walk: playbackIndices(clip.frames.length, clip.direction),
			fps: clip.fps ?? DEFAULT_FLIPBOOK_FPS,
			overlay: boxRect(fit, stage.box),
			boxed: stage.boxed,
			reach,
			problem: '',
		};
	}

	const tiles = $derived(row ? row.cells.map(tileOf) : []);

	$effect(() => {
		for (const tile of tiles)
			if (tile.clip) for (const key of clipSheetKeys(tile.clip)) ensureRegions(key);
	});

	const drawnWidth = $derived(art ? characterDraw(art).width : 0);

	/** One size for every tile, so the compass stays a grid: the widest reach of any facing,
	 *  never smaller than the character's own width and never past what a screen column holds. */
	const TILE_MAX = 420;
	const PAD = 10;
	const tileBox = $derived.by(() => {
		const least = (drawnWidth * zoom) / 2;
		const side = Math.max(least, ...tiles.map((t) => t.reach.side));
		const up = Math.max(least, ...tiles.map((t) => t.reach.up));
		const down = Math.max(0, ...tiles.map((t) => t.reach.down));
		const width = Math.min(TILE_MAX, Math.ceil(side * 2) + PAD * 2);
		const height = Math.min(TILE_MAX, Math.ceil(up + down) + PAD * 2);
		return { width, height, placeX: width / 2, placeY: Math.min(height - PAD, PAD + up) };
	});

	// One clock for every facing, so they stay in step as they do on one screen.
	let now = $state(0);
	$effect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		const tick = (at: number): void => {
			now += at - last;
			last = at;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	/** How long a one-shot rests on its last frame before the preview plays it again, and a held
	 *  one (the game keeps its last frame for as long as it is in force). */
	const REPLAY_REST_MS = 700;
	const HOLD_REST_MS = 2500;

	/** The frame of a tile at the clock: a loop wraps; a one-shot plays through, rests, replays. */
	function drawAt(tile: Tile, at: number): Draw | null {
		const count = tile.walk.length;
		if (!count) return null;
		const tick = Math.floor((at * tile.fps) / 1000);
		const restMs = row?.hold ? HOLD_REST_MS : row?.loop || !row?.once ? 0 : REPLAY_REST_MS;
		const rest = Math.ceil((restMs * tile.fps) / 1000);
		const step = Math.min(tick % (count + rest), count - 1);
		return tile.draws[tile.walk[step]] ?? null;
	}

	/** A clip id without its character's prefix: `walk_e`. */
	const tail = (clipId: string): string => (art ? clipTail(art, clipId) : clipId);

	function caption({ status, holds, name }: GridCell): string {
		if (holds?.kind === 'still') return `still image: ${tail(name)}`;
		if (status.kind === 'made') return 'as made';
		if (status.kind === 'mirrored') return `mirrors ${tail(status.clipId)}`;
		if (status.kind === 'none') return 'nothing plays';
		return `stand-in: ${tail(status.clipId)}${status.flipX ? ', mirrored' : ''}`;
	}

	const areaOf = (facing: ClipFacing): string => `f-${facing}`;
	const areas = $derived(compassAreas([...grid.drawn, ...grid.mirrored]));
</script>

<div class="bar">
	<CanvasModeBar
		inline
		options={grid.rows.map((r) => ({
			value: r.state,
			label: r.state,
			title: `${r.name ?? r.state}: ${r.hold ? 'played once, then held on its last frame' : r.loop ? 'a loop' : r.once ? 'played once' : 'only stands in for another action'}`,
		}))}
		value={row?.state ?? ''}
		onChange={(v) => (picked = v)}
		ariaLabel="State"
	/>
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
		<span>Box and feet</span>
	</label>
</div>

<div class="compass" style:grid-template-areas={areas}>
	{#each tiles as tile (tile.cell.facing)}
		{@const draw = drawAt(tile, now)}
		<figure
			class="tile {tile.cell.status.kind}"
			class:selected={selected === cellKey(tile.cell)}
			style:grid-area={areaOf(tile.cell.facing)}
			style:width="{tileBox.width}px"
			data-facing={tile.cell.facing}
			data-plays={cellPlays(tile.cell)?.clipId ?? ''}
		>
			<div class="stage" style:width="{tileBox.width}px" style:height="{tileBox.height}px">
				{#if showBox}
					<div class="ground" style:top="{tileBox.placeY}px"></div>
				{/if}
				<div
					class="place"
					style:left="{tileBox.placeX}px"
					style:top="{tileBox.placeY}px"
					style:transform="scale({tile.sx}, {tile.sy})"
				>
					{#if draw}
						<div class="art" style:left="{-draw.feetX}px" style:top="{-draw.feetY}px">
							<RegionThumb set={draw.set} region={draw.record} size={tile.size} box={draw.box} />
							{#if showBox && tile.overlay}
								<div
									class="bbox"
									class:own={tile.boxed}
									style:left="{tile.overlay.left}px"
									style:top="{tile.overlay.top}px"
									style:width="{tile.overlay.width}px"
									style:height="{tile.overlay.height}px"
								></div>
							{/if}
						</div>
					{/if}
				</div>
				{#if showBox}
					<div class="feet" style:left="{tileBox.placeX}px" style:top="{tileBox.placeY}px"></div>
				{/if}
				{#if tile.problem}<span class="why">{tile.problem}</span>{/if}
			</div>
			<figcaption title={cellPlays(tile.cell)?.clipId ?? tile.cell.name}>
				<b>{tile.cell.facing}</b>
				<span>{caption(tile.cell)}</span>
			</figcaption>
			{#if onCell}
				<button
					class="hit"
					aria-label="{tile.cell.state}, facing {tile.cell.facing}"
					aria-pressed={selected === cellKey(tile.cell)}
					onclick={() => onCell(tile.cell)}
				></button>
			{/if}
		</figure>
	{/each}
	{#if areas.includes('mid') && row}
		<div class="mid">
			<b>{row.state}</b>
			<span
				>{row.hold
					? 'plays once, then holds'
					: row.loop
						? 'loops'
						: row.once
							? 'plays once'
							: 'stands in'}</span
			>
			<span>{drawnWidth} px wide</span>
		</div>
	{/if}
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
	.compass {
		display: grid;
		gap: 8px;
		justify-content: start;
		overflow-x: auto;
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
	.tile.made {
		border-color: #2f6b5b;
	}
	.tile.mirrored {
		border-color: #2f5273;
		border-style: dashed;
	}
	.tile.standIn {
		border-color: #7a5a1e;
		border-style: dashed;
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
	.place {
		position: absolute;
		width: 0;
		height: 0;
		transform-origin: 0 0;
	}
	.art {
		position: absolute;
	}
	/* The thumbnail paints its own dark tile behind the art; here the stage shows through, so art
	   reaching outside the box reads against the same ground as the box. */
	.art :global(canvas) {
		background: transparent;
		border-radius: 0;
	}
	.bbox {
		position: absolute;
		box-sizing: border-box;
		border: 1px dashed #94a3b8;
		pointer-events: none;
	}
	.bbox.own {
		border: 1px solid #7ee0c0;
	}
	.ground {
		position: absolute;
		left: 0;
		right: 0;
		height: 0;
		border-top: 1px solid rgb(250 204 21 / 0.55);
		pointer-events: none;
	}
	.feet {
		position: absolute;
		width: 7px;
		height: 7px;
		margin: -4px 0 0 -4px;
		border-radius: 50%;
		background: #facc15;
		box-shadow: 0 0 0 1px #0b0e13;
		pointer-events: none;
	}
	.why {
		position: absolute;
		inset: auto 6px 6px;
		font-size: 10px;
		color: #fca5a5;
	}
	/* A tile is as narrow as the character at game size, so what plays is said on its own lines
	   under the facing rather than cut short beside it. */
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
