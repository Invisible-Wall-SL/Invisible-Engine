<script lang="ts">
	/**
	 * THE PROP VIEW (`docs/design/arcade-prop-components.md` §7 P7): the open prop drawn as the game
	 * draws it on its preview zone (`propStage.ts`: its pieces in their bands, projected as Salmons'
	 * screen is), with, toggled from the editor bar:
	 * - the COLLIDER over it: the deck, the ramps, the snap band, the hole and the solids, with
	 *   handles for each ramp's length (whole cells) and the snap, and solids moved and resized by
	 *   their corners or drawn with ＋ Solid;
	 * - a STAND-IN fisherman dragged under, onto and over the prop, lifted by the `bridges` rule's
	 *   own math (`standInOn`); what it does to `occupied` / `stepOn` / `stepOff` goes to the page,
	 *   which hands it to the State machine preview.
	 * Every handle edits the draft (`propEdit.ts`); the page saves it with the component.
	 */
	import type { ComponentDef } from 'engine-layout';

	import { drawShapes2d, PROP_VIEW_PROJECTOR } from '$lib/editor/propCanvas';
	import {
		addPropSolid,
		dragColliderHandle,
		propColliderOverlay,
		propPreviewZone,
		setPropSolidBox,
		solidBoxOf,
		standInOn,
		standInSteps,
		type GroundBox,
	} from '$lib/editor/propEdit';
	import { liftPx, propStageItems } from '$lib/editor/propStage';
	import { segmentTimelines, segmentTimelinesVersion } from './segmentTimelines.client.svelte';

	interface Props {
		def: ComponentDef;
		version: number;
		componentMap: ReadonlyMap<string, ComponentDef>;
		showCollider: boolean;
		showStandIn: boolean;
		readOnly?: boolean;
		onChanged: () => void;
		/** The stand-in moved: the prop's `occupied` now, and the triggers the move fired. */
		onStandIn?: (occupied: number, fired: string[]) => void;
	}
	let {
		def,
		version,
		componentMap,
		showCollider,
		showStandIn,
		readOnly = false,
		onChanged,
		onStandIn,
	}: Props = $props();

	let host = $state<HTMLDivElement | undefined>();
	let canvas = $state<HTMLCanvasElement | undefined>();
	let size = $state({ w: 800, h: 500 });
	let local = $state(0);
	let drawingSolid = $state(false);
	let selectedSolid = $state<number | null>(null);

	const zone = $derived.by(() => {
		void version;
		void local;
		return propPreviewZone(def);
	});
	/** World px on the ground under the stand-in's feet; it starts a cell before the near ramp. */
	let standIn = $state({ x: -3 * 48, y: 24, character: 'fisherman' });
	let occupied = $state(0);
	const stood = $derived.by(() => {
		void version;
		void local;
		return standInOn(def, standIn);
	});

	const project = (x: number, y: number) => PROP_VIEW_PROJECTOR.project(x, y);
	/** The view: the preview zone with two cells round it, fitted to the stage. */
	const view = $derived.by(() => {
		const pad = 4 * 48;
		const corners = [
			project(zone.x - pad, zone.y - pad),
			project(zone.x + zone.w + pad, zone.y - pad),
			project(zone.x - pad, zone.y + zone.h + pad),
			project(zone.x + zone.w + pad, zone.y + zone.h + pad),
		];
		const lift = liftPx((zone.height ?? 6) * 48);
		const xs = corners.map((c) => c.x);
		const ys = corners.map((c) => c.y);
		const x0 = Math.min(...xs);
		const y0 = Math.min(...ys) - lift - 48;
		const w = Math.max(...xs) - x0;
		const h = Math.max(...ys) - y0;
		const scale = Math.min(size.w / w, size.h / h);
		return {
			scale,
			ox: (size.w - w * scale) / 2 - x0 * scale,
			oy: (size.h - h * scale) / 2 - y0 * scale,
		};
	});
	const toStage = (p: { x: number; y: number }) => ({
		x: view.ox + p.x * view.scale,
		y: view.oy + p.y * view.scale,
	});
	const groundAt = (e: PointerEvent) => {
		const r = host!.getBoundingClientRect();
		const sx = (e.clientX - r.left - view.ox) / view.scale;
		const sy = (e.clientY - r.top - view.oy) / view.scale;
		return PROP_VIEW_PROJECTOR.unproject(sx, sy);
	};
	const boxPoints = (b: GroundBox, dy = 0) =>
		[
			[b.x, b.y],
			[b.x + b.w, b.y],
			[b.x + b.w, b.y + b.h],
			[b.x, b.y + b.h],
		]
			.map(([x, y]) => toStage({ x: project(x, y).x, y: project(x, y).y + dy }))
			.map((p) => `${p.x},${p.y}`)
			.join(' ');

	$effect(() => {
		if (!host) return;
		const ro = new ResizeObserver(([entry]) => {
			size = { w: entry.contentRect.width, h: entry.contentRect.height };
		});
		ro.observe(host);
		return () => ro.disconnect();
	});

	$effect(() => {
		void version;
		void local;
		void segmentTimelinesVersion();
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(size.w * ratio);
		canvas.height = Math.round(size.h * ratio);
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, size.w, size.h);
		drawGround(ctx);
		ctx.save();
		ctx.translate(view.ox, view.oy);
		ctx.scale(view.scale, view.scale);
		const items = propStageItems(
			def,
			(id) => (id === def.id ? def : componentMap.get(id)),
			(id) => segmentTimelines(id),
			showStandIn ? { ...standIn, y: stood.y, z: stood.z } : undefined,
		);
		for (const item of items) {
			if ('kind' in item) drawStandIn(ctx, item.x, item.y - item.lift);
			else drawShapes2d(ctx, item.shapes, item.x, item.y);
		}
		ctx.restore();
	});

	/** The ground the prop stands over: the water under the zone's row and the banks round it. */
	function drawGround(ctx: CanvasRenderingContext2D): void {
		const band = (b: GroundBox, color: string) => {
			ctx.beginPath();
			const pts = [
				[b.x, b.y],
				[b.x + b.w, b.y],
				[b.x + b.w, b.y + b.h],
				[b.x, b.y + b.h],
			].map(([x, y]) => toStage(project(x, y)));
			ctx.moveTo(pts[0].x, pts[0].y);
			for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
			ctx.closePath();
			ctx.fillStyle = color;
			ctx.fill();
		};
		band({ x: zone.x - 4 * 48, y: zone.y - 3 * 48, w: zone.w + 8 * 48, h: 7 * 48 }, '#2f4a2a');
		band({ x: zone.x, y: zone.y - 3 * 48, w: zone.w, h: 7 * 48 }, '#1d4a6a');
	}
	/** The stand-in: a fisherman's 56 × 88 box (`salmons.js` `BODIES`) with a head, feet at `y`. */
	function drawStandIn(ctx: CanvasRenderingContext2D, x: number, y: number): void {
		ctx.fillStyle = 'rgba(0,0,0,0.3)';
		ctx.beginPath();
		ctx.ellipse(x, y, 20, 7, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#d8c070';
		ctx.fillRect(x - 14, y - 70, 28, 62);
		ctx.beginPath();
		ctx.arc(x, y - 80, 11, 0, Math.PI * 2);
		ctx.fill();
	}

	const overlay = $derived.by(() => {
		void version;
		void local;
		return propColliderOverlay(def);
	});

	type Drag =
		| { kind: 'handle'; handle: 'near' | 'far' | 'snap' }
		| {
				kind: 'solid';
				i: number;
				corner: number | null;
				from: { x: number; y: number };
				box: GroundBox;
		  }
		| { kind: 'draw'; from: { x: number; y: number } }
		| { kind: 'standIn' };
	let drag: Drag | null = null;

	function changed(): void {
		local += 1;
		onChanged();
	}
	function start(e: PointerEvent, next: Drag): void {
		if (next.kind !== 'standIn' && readOnly) return;
		e.stopPropagation();
		(e.currentTarget as Element).setPointerCapture?.(e.pointerId);
		drag = next;
	}
	function move(e: PointerEvent): void {
		if (!drag) return;
		const at = groundAt(e);
		if (drag.kind === 'handle') {
			if (dragColliderHandle(def, drag.handle, at)) changed();
		} else if (drag.kind === 'solid') {
			const d = { x: at.x - drag.from.x, y: at.y - drag.from.y };
			const b = drag.box;
			const next =
				drag.corner === null
					? { ...b, x: b.x + d.x, y: b.y + d.y }
					: {
							x: drag.corner === 0 || drag.corner === 3 ? b.x + d.x : b.x,
							y: drag.corner < 2 ? b.y + d.y : b.y,
							w: drag.corner === 0 || drag.corner === 3 ? b.w - d.x : b.w + d.x,
							h: drag.corner < 2 ? b.h - d.y : b.h + d.y,
						};
			if (setPropSolidBox(def, drag.i, solidBoxOf(def, next))) changed();
		} else if (drag.kind === 'standIn') {
			standIn = { ...standIn, x: at.x, y: at.y };
			report();
		}
	}
	function end(e: PointerEvent): void {
		if (drag?.kind === 'draw') {
			const at = groundAt(e);
			const from = drag.from;
			const box = {
				x: Math.min(from.x, at.x),
				y: Math.min(from.y, at.y),
				w: Math.abs(at.x - from.x),
				h: Math.abs(at.y - from.y),
			};
			if (box.w > 4 && box.h > 4) {
				selectedSolid = addPropSolid(def, solidBoxOf(def, box));
				changed();
			}
			drawingSolid = false;
		}
		drag = null;
	}
	function report(): void {
		const next = standInOn(def, standIn).occupied;
		const fired = standInSteps(occupied, next);
		occupied = next;
		onStandIn?.(next, fired);
	}
	$effect(() => {
		void version;
		if (showStandIn) report();
	});
</script>

<div
	class="stage"
	bind:this={host}
	role="application"
	aria-label="Prop view"
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
>
	<canvas bind:this={canvas} style="width:{size.w}px;height:{size.h}px"></canvas>
	<svg
		class="overlay"
		class:drawing={drawingSolid}
		width={size.w}
		height={size.h}
		role="presentation"
		onpointerdown={(e) => {
			if (drawingSolid && !readOnly) start(e, { kind: 'draw', from: groundAt(e) });
			else selectedSolid = null;
		}}
	>
		{#if showCollider && overlay}
			{#if overlay.hole}
				<polygon class="hole" points={boxPoints(overlay.hole)}
					><title>Hole: the water opens here</title></polygon
				>
			{/if}
			<polygon class="ramp" points={boxPoints(overlay.ramps.near)}><title>Near ramp</title></polygon
			>
			<polygon class="ramp" points={boxPoints(overlay.ramps.far)}><title>Far ramp</title></polygon>
			<polygon class="deck" points={boxPoints(overlay.deck)}><title>Deck</title></polygon>
			<polygon class="snap" points={boxPoints(overlay.snap)}><title>Snap band</title></polygon>
			{#each overlay.solids as solid, i (i)}
				<polygon
					class="solid"
					class:on={selectedSolid === i}
					points={boxPoints(solid)}
					onpointerdown={(e) => {
						selectedSolid = i;
						start(e, { kind: 'solid', i, corner: null, from: groundAt(e), box: solid });
					}}><title>Solid {i + 1}: drag to move, drag a corner to resize</title></polygon
				>
				{#if selectedSolid === i}
					{#each [[solid.x, solid.y], [solid.x + solid.w, solid.y], [solid.x + solid.w, solid.y + solid.h], [solid.x, solid.y + solid.h]] as [x, y], corner (corner)}
						{@const p = toStage(project(x, y))}
						<circle
							class="handle corner"
							cx={p.x}
							cy={p.y}
							r="5"
							onpointerdown={(e) =>
								start(e, { kind: 'solid', i, corner, from: groundAt(e), box: solid })}
						/>
					{/each}
				{/if}
			{/each}
			{#each [['near', 'Near ramp: drag to its length, in whole cells'], ['far', 'Far ramp: drag to its length, in whole cells'], ['snap', 'Snap: drag across the row']] as const as [handle, tip] (handle)}
				{@const p = toStage(project(overlay.handles[handle].x, overlay.handles[handle].y))}
				<circle
					class="handle"
					class:snap-handle={handle === 'snap'}
					cx={p.x}
					cy={p.y}
					r="7"
					onpointerdown={(e) => start(e, { kind: 'handle', handle })}><title>{tip}</title></circle
				>
			{/each}
		{/if}
		{#if showStandIn}
			{@const at = toStage(project(standIn.x, stood.y))}
			<rect
				class="stand-in-grab"
				x={at.x - 16 * view.scale}
				y={at.y - (liftPx(stood.z) + 92) * view.scale}
				width={32 * view.scale}
				height={92 * view.scale}
				onpointerdown={(e) => start(e, { kind: 'standIn' })}
				><title>The stand-in fisherman: drag him under, onto and over the prop</title></rect
			>
		{/if}
	</svg>
	<div class="readout">
		{#if showCollider}
			<button
				type="button"
				class="tool"
				class:on={drawingSolid}
				disabled={readOnly}
				title="Draw a solid (a railing, a post): drag on the ground"
				onclick={() => (drawingSolid = !drawingSolid)}>＋ Solid</button
			>
		{/if}
		{#if showStandIn}
			<span title="How many of the characters it carries stand on it (the prop's occupied)"
				>occupied {occupied}{stood.z > 0 ? ` · ${(stood.z / 48).toFixed(2)} cells up` : ''}</span
			>
		{/if}
	</div>
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0c0f14;
		touch-action: none;
	}
	canvas,
	.overlay {
		position: absolute;
		inset: 0;
	}
	.overlay.drawing {
		cursor: crosshair;
	}
	.deck {
		fill: rgba(160, 220, 120, 0.12);
		stroke: #a0dc78;
		stroke-width: 1.5;
		pointer-events: none;
	}
	.ramp {
		fill: rgba(230, 180, 90, 0.15);
		stroke: #e6b45a;
		stroke-dasharray: 5 3;
		pointer-events: none;
	}
	.snap {
		fill: none;
		stroke: #7fd0ff;
		stroke-dasharray: 2 3;
		pointer-events: none;
	}
	.hole {
		fill: rgba(90, 160, 255, 0.12);
		stroke: rgba(90, 160, 255, 0.5);
		pointer-events: none;
	}
	.solid {
		fill: rgba(240, 90, 90, 0.25);
		stroke: #f05a5a;
		cursor: move;
	}
	.solid.on {
		stroke-width: 2;
	}
	.handle {
		fill: #fff;
		stroke: #222;
		cursor: ew-resize;
	}
	.snap-handle {
		cursor: ns-resize;
	}
	.handle.corner {
		cursor: nwse-resize;
	}
	.stand-in-grab {
		fill: transparent;
		cursor: grab;
	}
	.readout {
		position: absolute;
		left: 8px;
		bottom: 8px;
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		color: #cbd2dc;
	}
	.tool.on {
		outline: 1px solid #7fd0ff;
	}
</style>
