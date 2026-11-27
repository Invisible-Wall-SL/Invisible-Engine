<script lang="ts">
	/**
	 * THE PAYLINE PREVIEW (Invisible Symbols → Win lines → Payline style): a sample board of the
	 * project's grid with one of its paylines, drawn as the game draws a win. The strokes are
	 * `engine-layout`'s `paintWinLine` — the very function `WinLine.svelte` strokes with — onto a
	 * Canvas 2D adapter; the head is `winLineHeadAt` and the draw time `winLineDrawMs`, both the
	 * game's. The timeline (`paylinePreview.ts` `previewFrame`) is the game's: the trail emits until
	 * the line lands, then the tip stays, fades or bursts.
	 *
	 * One board unit is one CSS pixel before the stage is scaled to fit (a cell is 120 units, as in
	 * the game). The trail plays on a see-through `FxStage` through its `ownerPos` hook — the
	 * container stays still and the owner follows the head, the game's `FlightView` mechanism, so
	 * particles stay where they were born. An effect tip and the burst play on their own stages.
	 */
	import type { EffectDoc } from 'engine-fx';
	import { pathLength, paintWinLine, winLineHeadAt, type WinLineGraphics } from 'engine-layout';
	import { onMount, type Snippet } from 'svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import FxStage from '../fx/FxStage.svelte';
	import { createFxArtResolver, fetchEffectDoc } from './fxPreview.client';
	import {
		boardSize,
		cellCentre,
		freeLayers,
		PREVIEW_CELL,
		PREVIEW_REPLAY_DEBOUNCE_MS,
		previewCues,
		previewFrame,
		previewPlan,
		previewReplayKey,
		sampleLineId,
		samplePoints,
		sampleRows,
		type PreviewBoard,
		type PreviewLine,
	} from './paylinePreview';

	interface Props {
		line: PreviewLine;
		board: PreviewBoard;
		/** Draws a sprite or flipbook tip's art at `size` CSS px (the page's thumbnail). */
		tipArt?: Snippet<[number]>;
		/** The uploads the line's sounds can play: name → stored file and level. */
		auditions: Record<string, { file: string; volume?: number }>;
		projectKey: string;
	}
	let { line, board, tipArt, auditions, projectKey }: Props = $props();

	/** Room around the board for a tip or an effect that reaches past its edge. */
	const MARGIN = PREVIEW_CELL * 0.75;
	/** The widest the stage is drawn, CSS px. */
	const MAX_WIDTH = 560;

	let lineId = $state<string | undefined>(undefined);
	let ofAKind = $state(0);
	let muted = $state(true);
	$effect.pre(() => {
		if (lineId === undefined || !board.paylines.some((l) => l.id === lineId)) {
			lineId = sampleLineId(board);
		}
		if (ofAKind < 2 || ofAKind > board.reels) ofAKind = board.reels;
	});

	const size = $derived(boardSize(board));
	const W = $derived(size.width + MARGIN * 2);
	const H = $derived(size.height + MARGIN * 2);
	const fit = $derived(Math.min(1, MAX_WIDTH / W));
	const rows = $derived(sampleRows(board, lineId));
	const sample = $derived(samplePoints(board, rows, ofAKind));
	const lineColor = $derived(board.paylines.find((l) => l.id === lineId)?.color);
	const length = $derived(pathLength(sample.points));

	const tip = $derived(line.tip);
	const tipEffectId = $derived(tip?.kind === 'effect' ? tip.effectId : undefined);
	const burstEffectId = $derived(tip?.atEnd === 'burst' ? tip.endEffectId : undefined);

	/** Effect docs by id, read once each per preview. */
	let docs = $state<Record<string, EffectDoc | null>>({});
	$effect(() => {
		const wanted = [...line.trailFx, tipEffectId, burstEffectId].filter(
			(id): id is string => !!id && !(id in docs),
		);
		for (const id of wanted) {
			docs[id] = null;
			void fetchEffectDoc(id).then((doc) => {
				docs[id] = doc;
			});
		}
	});
	const trailDocs = $derived(line.trailFx.flatMap((id) => docs[id] ?? []));
	const trailSet = $derived(freeLayers(trailDocs));
	const tipDoc = $derived(tipEffectId ? (docs[tipEffectId] ?? null) : null);
	const burstDoc = $derived(burstEffectId ? (docs[burstEffectId] ?? null) : null);
	const loading = $derived(
		[...line.trailFx, tipEffectId, burstEffectId].some((id) => !!id && !docs[id]),
	);

	const plan = $derived(previewPlan(line, length, burstDoc));
	const resolveArt = createFxArtResolver();

	/** Bumped by every replay: the effect stages remount, clearing the last play's particles, as
	 *  everything clears with the game's line. */
	let run = $state(0);
	let runStart = 0;
	let lastT = -1;
	function replay(): void {
		run += 1;
		runStart = performance.now();
		lastT = -1;
	}
	const replayKey = $derived(previewReplayKey(line, { lineId, ofAKind }));
	let keyed = '';
	$effect(() => {
		const key = replayKey;
		if (!keyed) {
			keyed = key;
			return;
		}
		if (key === keyed) return;
		const timer = setTimeout(() => {
			keyed = key;
			replay();
		}, PREVIEW_REPLAY_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	let canvas: HTMLCanvasElement | null = $state(null);
	let artEl: HTMLDivElement | null = $state(null);
	let trailing = $state(false);
	let tipShown = $state(false);
	let tipAlpha = $state(1);
	let bursting = $state(false);
	/** The head this frame, in board units from the board's top-left. */
	const head = { x: 0, y: 0, angle: 0 };
	const centred = (x: number, y: number) => ({ x: x + MARGIN - W / 2, y: y + MARGIN - H / 2 });
	const trailOwner = () => centred(head.x, head.y);
	const tipScale = $derived(tip?.scale ?? 1);
	const tipOwner = () => {
		const at = centred(head.x, head.y);
		return { x: at.x / tipScale, y: at.y / tipScale };
	};
	const tipRotation = $derived(tip?.rotateWithLine ? () => head.angle : undefined);
	const endPoint = $derived(winLineHeadAt(sample.points, 1));
	const burstOwner = () => centred(endPoint.x, endPoint.y);

	/** A Canvas 2D context as the few `Graphics` calls `paintWinLine` makes: a stroke or a fill ends
	 *  the path, as Pixi's do. */
	function canvasGraphics(ctx: CanvasRenderingContext2D): WinLineGraphics {
		let open = false;
		const begin = () => {
			if (!open) ctx.beginPath();
			open = true;
		};
		return {
			moveTo: (x, y) => {
				begin();
				ctx.moveTo(x, y);
			},
			lineTo: (x, y) => {
				begin();
				ctx.lineTo(x, y);
			},
			arc: (x, y, radius, start, end) => {
				begin();
				ctx.arc(x, y, radius, start, end);
			},
			closePath: () => ctx.closePath(),
			stroke: (style) => {
				ctx.strokeStyle = style.color;
				ctx.globalAlpha = style.alpha;
				ctx.lineWidth = style.width;
				ctx.lineCap = style.cap;
				ctx.lineJoin = style.join;
				ctx.stroke();
				open = false;
			},
			fill: (style) => {
				ctx.fillStyle = style.color;
				ctx.globalAlpha = style.alpha;
				ctx.fill();
				open = false;
			},
		};
	}

	function draw(progress: number, shown: boolean): void {
		const ctx = canvas?.getContext('2d');
		if (!ctx || !canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const scale = dpr * fit;
		if (canvas.width !== Math.round(W * scale)) {
			canvas.width = Math.round(W * scale);
			canvas.height = Math.round(H * scale);
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = '#0b0e13';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(scale, 0, 0, scale, MARGIN * scale, MARGIN * scale);
		const paying = new Set(
			rows.slice(0, sample.points.length).map((row, reel) => `${reel}:${row}`),
		);
		for (let reel = 0; reel < board.reels; reel++) {
			for (let row = 0; row < board.rows[reel]; row++) {
				const centre = cellCentre(board, reel, row);
				const c = { x: centre.x - PREVIEW_CELL / 2, y: centre.y - PREVIEW_CELL / 2 };
				const win = paying.has(`${reel}:${row}`);
				ctx.fillStyle = win ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.035)';
				ctx.fillRect(c.x + 4, c.y + 4, PREVIEW_CELL - 8, PREVIEW_CELL - 8);
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
				ctx.lineWidth = 1;
				ctx.strokeRect(c.x + 4.5, c.y + 4.5, PREVIEW_CELL - 9, PREVIEW_CELL - 9);
			}
		}
		if (!shown || !line.enabled) return;
		const input = {
			points: sample.points,
			fullPoints: line.fullPayline ? sample.fullPoints : [],
			progress,
			shape: 'path' as const,
			cellHalf: PREVIEW_CELL / 2,
			symbolSize: PREVIEW_CELL,
			color: lineColor,
		};
		const graphics = canvasGraphics(ctx);
		if (line.glow && line.blend === 'add') {
			ctx.globalCompositeOperation = 'lighter';
			paintWinLine(graphics, line, input, 'glow');
			ctx.globalCompositeOperation = 'source-over';
			paintWinLine(graphics, line, input, 'line');
		} else paintWinLine(graphics, line, input, 'both');
		ctx.globalAlpha = 1;
	}

	let player: HTMLAudioElement | null = null;
	function playSound(name: string | undefined): void {
		const entry = name ? auditions[name] : undefined;
		if (muted || !entry) return;
		player ??= new Audio();
		player.pause();
		player.src = `/api/sounds/file?project=${encodeURIComponent(projectKey)}&file=${encodeURIComponent(entry.file)}`;
		player.volume = Math.min(Math.max(entry.volume ?? 1, 0), 1);
		void player.play().catch(() => {});
	}

	onMount(() => {
		runStart = performance.now();
		let frame = 0;
		const loop = (now: number) => {
			const t = now - runStart;
			const f = previewFrame(plan, t);
			for (const cue of previewCues(plan, lastT, t)) {
				playSound(cue === 'draw' ? line.drawSound : line.endSound);
			}
			lastT = t;
			const pose = winLineHeadAt(sample.points, f.progress);
			head.x = pose.x;
			head.y = pose.y;
			head.angle = pose.angle;
			const live = f.shown && line.enabled;
			if (trailing !== (live && f.trailing)) trailing = live && f.trailing;
			if (tipShown !== (live && f.tipShown)) tipShown = live && f.tipShown;
			if (tipAlpha !== f.tipAlpha) tipAlpha = f.tipAlpha;
			if (bursting !== (live && f.bursting)) bursting = live && f.bursting;
			if (artEl) {
				const box = PREVIEW_CELL * tipScale;
				artEl.style.transform =
					`translate(${MARGIN + pose.x - box / 2}px, ${MARGIN + pose.y - box / 2}px)` +
					(tip?.rotateWithLine ? ` rotate(${pose.angle}rad)` : '');
			}
			draw(f.progress, f.shown);
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(frame);
			player?.pause();
		};
	});

	const unplayable = $derived(
		[line.drawSound, line.endSound].filter((name): name is string => !!name && !auditions[name]),
	);
</script>

<div class="payline-preview">
	<div class="controls">
		{#if board.paylines.length}
			<label>
				<span>Payline</span>
				<select bind:value={lineId}>
					{#each board.paylines as payline (payline.id)}
						<option value={payline.id}>{payline.id} · {payline.rows.join('-')}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label>
			<span>Pays</span>
			<select bind:value={ofAKind}>
				{#each Array.from({ length: Math.max(0, board.reels - 1) }, (_, i) => i + 2) as n (n)}
					<option value={n}>{n} of a kind</option>
				{/each}
			</select>
		</label>
		<label class="mute">
			<input
				type="checkbox"
				checked={!muted}
				onchange={(e) => (muted = !e.currentTarget.checked)}
			/>
			<span>Sound</span>
		</label>
		<IconButton icon="replay" label="Replay the line" onclick={replay} />
	</div>
	<div class="frame" style:width="{W * fit}px" style:height="{H * fit}px">
		<div class="stage" style:width="{W}px" style:height="{H}px" style:transform="scale({fit})">
			<canvas bind:this={canvas} style:width="{W}px" style:height="{H}px"></canvas>
			{#key run}
				{#if trailSet.length && plan.trails && line.enabled}
					<div class="fx-layer">
						<FxStage
							layers={trailSet}
							playing
							transparent
							{resolveArt}
							ownerPos={trailOwner}
							emitting={trailing}
							showReference={false}
						/>
					</div>
				{/if}
				{#if tipDoc?.layers.length && tipShown}
					<div class="fx-layer" class:add={tip?.blend === 'add'} style:opacity={tipAlpha}>
						<FxStage
							layers={freeLayers([tipDoc])}
							playing
							transparent
							worldScale={tipScale}
							{resolveArt}
							ownerPos={tipOwner}
							ownerRotation={tipRotation}
							showReference={false}
						/>
					</div>
				{/if}
				{#if burstDoc?.layers.length && plan.bursts}
					<div class="fx-layer">
						<FxStage
							layers={freeLayers([burstDoc])}
							playing
							transparent
							{resolveArt}
							ownerPos={burstOwner}
							emitting={bursting}
							showReference={false}
						/>
					</div>
				{/if}
			{/key}
			{#if tipArt && (tip?.kind === 'sprite' || tip?.kind === 'flipbook')}
				<div
					class="art-tip"
					class:add={tip.blend === 'add'}
					bind:this={artEl}
					style:width="{PREVIEW_CELL * tipScale}px"
					style:height="{PREVIEW_CELL * tipScale}px"
					style:opacity={tipShown ? tipAlpha : 0}
				>
					{@render tipArt(PREVIEW_CELL * tipScale)}
				</div>
			{/if}
		</div>
	</div>
	<p class="legend">
		{#if !line.enabled}
			The traced line is off — turn it on above to see it.
		{:else}
			{#if line.animated}{Math.round(plan.drawMs)} ms to draw{:else}Drawn whole at once, with no
				trail (Animated draw is off){/if}{#if !board.paylines.length}
				· a sample zig-zag (this project has no paylines){/if}{#if loading}
				· loading effects…{/if}{#if !muted && unplayable.length}
				· {unplayable.join(', ')} plays in the game only{/if}
		{/if}
	</p>
</div>

<style>
	.payline-preview {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 100%;
		overflow-x: auto;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: #9a9aa8;
	}
	.controls label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.frame {
		position: relative;
		flex: none;
		border-radius: 8px;
		overflow: hidden;
		background: #0b0e13;
	}
	.stage {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	canvas,
	.fx-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.add {
		mix-blend-mode: plus-lighter;
	}
	.art-tip {
		position: absolute;
		left: 0;
		top: 0;
		pointer-events: none;
		display: grid;
		place-items: center;
	}
	.legend {
		margin: 0;
		font-size: 12px;
		color: #9a9aa8;
	}
</style>
