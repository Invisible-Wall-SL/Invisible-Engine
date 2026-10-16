<script lang="ts">
	/**
	 * THE FLIGHT PREVIEW (Invisible Symbols → Flights): a mock 5×3 board, a few cells marked as
	 * showing a win, and a start and an end the author drags. The route is planned by the game's own
	 * code — `engine-layout`'s `planFlight` with `flightPlanOptions(style)`, the mapping `flyTo` calls
	 * — and timed by `flightDuration` + `flightEaseOf`, so what this draws is what the game flies.
	 *
	 * One board unit is one CSS pixel (a cell is `SYMBOL_SIZE` = 120 units, as in the game), and the
	 * origin is the stage centre, which is also `FxStage`'s world origin. An authored trail plays on
	 * that `FxStage` through its `ownerPos` hook: the emitter's container stays still and its OWNER
	 * follows the head, the mechanism the game's `<EffectPlayer ownerPos>` uses, so particles stay
	 * where they were born. The coded trail is drawn on the canvas as an approximation of the gold
	 * glow; the head is the coded glow (re-tinted) or the authored art — or, for a pots token, the
	 * token itself, which replaces any head in the game too — at the kind's `size`, moved along the
	 * route with the "+N" label it carries. The head's pose is the game's (`flightHeadPose`): the art
	 * turns to the heading when the kind follows the curve, and everything at the head — the token
	 * too, which never turns — takes the perspective of its `depth`. The arrival effect plays at B as
	 * the head lands, on a second `FxStage` that stays mounted and is re-armed each loop.
	 */
	import { emitterSecondsToWallMs, type EffectDoc } from 'engine-fx';
	import {
		flightDuration,
		flightEaseOf,
		flightHeadPose,
		flightPlanOptions,
		headingOnCurve,
		planFlight,
		pointOnCurve,
		type FlightPoint,
		type FlightRect,
		type ResolvedFlightStyle,
	} from 'engine-layout';
	import { onMount, type Snippet } from 'svelte';
	import FxStage from '../fx/FxStage.svelte';
	import { createFxArtResolver, fetchEffectDoc } from './fxPreview.client';

	interface Props {
		style: ResolvedFlightStyle;
		/** Draws the art head at `size` CSS px — the authored art, or the {@link token}. */
		headArt?: Snippet<[number]>;
		/** The head is a pots overlay token (drawn by `headArt` at a cell), not the style's head. */
		token?: boolean;
		/** Text riding on the head — an add-respins "+N". */
		label?: string;
	}
	let { style, headArt, token = false, label }: Props = $props();

	const W = 640;
	const H = 480;
	const CELL = 120;
	const REELS = 5;
	const ROWS = 3;
	const BOARD_LEFT = -(REELS * CELL) / 2;
	const BOARD_TOP = -210;
	const HANDLE_R = 14;
	const WAIT_MS = 250;
	const SETTLE_MS = 900;
	/** An arrival layer that would emit forever (no lifetime, no duration) bursts this long. */
	const ARRIVAL_BURST_MS = 200;
	/** The game's head label (`FlightLayer`'s `LABEL_STYLE`): 0.3 of a cell, black outline. */
	const LABEL_CELLS = 0.3;
	const LABEL_STROKE = 6;
	/** The coded trail's particles live ~0.5 emitter-seconds; drawn as a fading streak. */
	const CODED_TRAIL_MS = 220;
	const CODED_HEAD_TINT = '#ffd45a';
	/** The coded glow head is 0.45 of a cell across (`FlightView`'s `HEAD_CELLS`). */
	const GLOW_CELLS = 0.45;

	const cellCentre = (reel: number, row: number): FlightPoint => ({
		x: BOARD_LEFT + CELL * (reel + 0.5),
		y: BOARD_TOP + CELL * (row + 0.5),
	});
	const cellRect = (reel: number, row: number): FlightRect => ({
		x: BOARD_LEFT + CELL * reel,
		y: BOARD_TOP + CELL * row,
		width: CELL,
		height: CELL,
	});

	let start = $state<FlightPoint>(cellCentre(0, 2));
	let end = $state<FlightPoint>({ x: 240, y: 205 });
	let wins = $state<string[]>(['1:2', '2:2', '3:1']);

	const winRects = $derived(
		wins.map((key) => {
			const [reel, row] = key.split(':').map(Number);
			return cellRect(reel, row);
		}),
	);
	const route = $derived(planFlight(start, end, flightPlanOptions(style, CELL, winRects)));
	const durationMs = $derived(flightDuration(route.length, style));
	const ease = $derived(flightEaseOf(style));

	const trailEffectId = $derived(
		style.trail && 'effectId' in style.trail ? style.trail.effectId : undefined,
	);
	let trailDoc = $state<EffectDoc | null>(null);
	$effect(() => {
		const id = trailEffectId;
		trailDoc = null;
		if (!id) return;
		let live = true;
		void fetchEffectDoc(id).then((doc) => {
			if (live) trailDoc = doc;
		});
		return () => {
			live = false;
		};
	});
	const arrivalEffectId = $derived(style.arrival?.effectId);
	let arrivalDoc = $state<EffectDoc | null>(null);
	$effect(() => {
		const id = arrivalEffectId;
		arrivalDoc = null;
		if (!id) return;
		let live = true;
		void fetchEffectDoc(id).then((doc) => {
			if (live) arrivalDoc = doc;
		});
		return () => {
			live = false;
		};
	});
	/** How long the arrival emits once the head lands: a layer's `duration`, else its lifetime. */
	const arrivalEmitMs = $derived(
		Math.max(
			0,
			...(arrivalDoc?.layers ?? []).map((layer) => {
				if (layer.trigger?.duration) return layer.trigger.duration;
				const lifetime = layer.config.emitterLifetime ?? -1;
				return lifetime > 0 ? emitterSecondsToWallMs(lifetime) : ARRIVAL_BURST_MS;
			}),
		),
	);
	/** Its last particle, after emission stops — what the loop waits out before it restarts. */
	const arrivalSettleMs = $derived(
		arrivalEmitMs +
			Math.max(
				0,
				...(arrivalDoc?.layers ?? []).map((layer) =>
					emitterSecondsToWallMs(layer.config.lifetime?.max ?? 0),
				),
			),
	);
	const arrivalPos = () => end;
	const resolveArt = createFxArtResolver();

	let canvas: HTMLCanvasElement | null = $state(null);
	let artEl: HTMLDivElement | null = $state(null);
	/** Spawning — drives the authored trail's `emitting`. */
	let flying = $state(false);
	/** The arrival is emitting — true from the landing for {@link arrivalEmitMs}. */
	let arriving = $state(false);
	/** The head this frame; `scale` is its perspective (`flightHeadPose`). */
	const head = { x: 0, y: 0, heading: 0, scale: 1 };
	const ownerPos = () => head;
	/** The game's trail rotation (`FlightLayer`): the heading when aligned, plus the offset. */
	const trailRotation = $derived(
		style.trailAlign || style.trailRotation
			? () => (style.trailAlign ? head.heading : 0) + (style.trailRotation * Math.PI) / 180
			: undefined,
	);
	let streak: { x: number; y: number; at: number }[] = [];

	const headSize = $derived(CELL * (token ? 1 : (style.head?.scale ?? 1)) * style.size);
	const glowHead = $derived(!token && (!style.head || style.head.kind === 'glow'));
	const artHead = $derived(
		token ||
			style.head?.kind === 'sprite' ||
			style.head?.kind === 'spine' ||
			style.head?.kind === 'flipbook',
	);

	function draw(now: number, inFlight: boolean): void {
		const showHead = inFlight && (token || style.head?.kind !== 'none');
		const ctx = canvas?.getContext('2d');
		if (!ctx || !canvas) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== W * dpr) {
			canvas.width = W * dpr;
			canvas.height = H * dpr;
		}
		ctx.setTransform(dpr, 0, 0, dpr, (W / 2) * dpr, (H / 2) * dpr);
		ctx.clearRect(-W / 2, -H / 2, W, H);

		for (let reel = 0; reel < REELS; reel++) {
			for (let row = 0; row < ROWS; row++) {
				const r = cellRect(reel, row);
				const win = wins.includes(`${reel}:${row}`);
				ctx.fillStyle = win ? 'rgba(220, 70, 70, 0.28)' : 'rgba(255, 255, 255, 0.03)';
				ctx.fillRect(r.x + 3, r.y + 3, r.width - 6, r.height - 6);
				ctx.strokeStyle = win ? 'rgba(240, 90, 90, 0.9)' : 'rgba(255, 255, 255, 0.14)';
				ctx.lineWidth = 1;
				ctx.strokeRect(r.x + 3.5, r.y + 3.5, r.width - 7, r.height - 7);
			}
		}
		if (style.avoid && style.padding > 0) {
			const pad = style.padding * CELL;
			ctx.setLineDash([4, 4]);
			ctx.strokeStyle = 'rgba(240, 90, 90, 0.45)';
			for (const r of winRects) {
				ctx.strokeRect(r.x - pad, r.y - pad, r.width + pad * 2, r.height + pad * 2);
			}
			ctx.setLineDash([]);
		}

		ctx.beginPath();
		for (let i = 0; i <= 64; i++) {
			const p = pointOnCurve(route.curve, i / 64);
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.setLineDash([6, 6]);
		ctx.strokeStyle = route.hits ? 'rgba(255, 150, 90, 0.8)' : 'rgba(140, 200, 255, 0.7)';
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.globalCompositeOperation = 'lighter';
		if (!style.trail) {
			streak = streak.filter((dot) => now - dot.at < CODED_TRAIL_MS);
			for (const dot of streak) {
				const life = 1 - (now - dot.at) / CODED_TRAIL_MS;
				ctx.fillStyle = `rgba(255, ${Math.round(138 + 95 * life)}, ${Math.round(160 * life)}, ${0.5 * life})`;
				ctx.beginPath();
				ctx.arc(dot.x, dot.y, 3 + 9 * life, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		if (showHead && glowHead) {
			const radius = (GLOW_CELLS * headSize * head.scale) / 2;
			const gradient = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, radius);
			const tint = style.head?.tint ?? CODED_HEAD_TINT;
			gradient.addColorStop(0, '#ffffff');
			gradient.addColorStop(0.3, tint);
			gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.arc(head.x, head.y, radius, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalCompositeOperation = 'source-over';
		if (inFlight && label) {
			const labelScale = style.size * head.scale;
			ctx.font = `bold ${LABEL_CELLS * CELL * labelScale}px Arial, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.lineJoin = 'round';
			ctx.lineWidth = LABEL_STROKE * labelScale;
			ctx.strokeStyle = '#000000';
			ctx.strokeText(label, head.x, head.y);
			ctx.fillStyle = '#ffffff';
			ctx.fillText(label, head.x, head.y);
		}

		for (const [point, handle, colour] of [
			[start, 'A', '#4ade80'],
			[end, 'B', '#60a5fa'],
		] as const) {
			ctx.fillStyle = colour;
			ctx.beginPath();
			ctx.arc(point.x, point.y, HANDLE_R, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#0b0e13';
			ctx.font = 'bold 13px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(handle, point.x, point.y + 1);
		}
	}

	onMount(() => {
		let frame = 0;
		let cycleStart = performance.now();
		const loop = (now: number) => {
			const elapsed = now - cycleStart;
			const flyMs = elapsed - WAIT_MS;
			const inFlight = flyMs >= 0 && flyMs < durationMs;
			if (flyMs >= durationMs + Math.max(SETTLE_MS, arrivalSettleMs)) cycleStart = now;
			const landedMs = flyMs - durationMs;
			const emitArrival = !!arrivalDoc && landedMs >= 0 && landedMs < arrivalEmitMs;
			if (arriving !== emitArrival) arriving = emitArrival;
			const eased = ease(Math.min(1, Math.max(0, flyMs / durationMs)));
			const p = pointOnCurve(route.curve, eased);
			head.x = p.x;
			head.y = p.y;
			head.heading = headingOnCurve(route.curve, eased);
			const pose = flightHeadPose(style, head.heading, eased);
			head.scale = pose.scale;
			if (inFlight && !style.trail) streak.push({ x: p.x, y: p.y, at: now });
			if (flying !== inFlight) flying = inFlight;
			if (artEl) {
				artEl.style.opacity = inFlight ? '1' : '0';
				const at = `translate(${W / 2 + p.x - headSize / 2}px, ${H / 2 + p.y - headSize / 2}px)`;
				artEl.style.transform = token
					? `${at} scale(${pose.scale})`
					: `${at} rotate(${pose.rotation}rad) ` +
						`scale(${pose.scale * pose.stretch}, ${pose.scale * pose.flip}) ` +
						`rotate(${pose.artRotation}rad)`;
			}
			draw(now, inFlight);
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	const headLabel = $derived(
		token
			? 'the pots token'
			: !style.head
				? 'built-in glow'
				: style.head.kind === 'spine'
					? 'rig'
					: style.head.kind,
	);

	let dragging: 'start' | 'end' | null = null;
	let moved = false;

	const local = (e: PointerEvent): FlightPoint => {
		const box = canvas!.getBoundingClientRect();
		return {
			x: ((e.clientX - box.left) / box.width) * W - W / 2,
			y: ((e.clientY - box.top) / box.height) * H - H / 2,
		};
	};
	const clampToStage = (p: FlightPoint): FlightPoint => ({
		x: Math.min(W / 2 - HANDLE_R, Math.max(-W / 2 + HANDLE_R, p.x)),
		y: Math.min(H / 2 - HANDLE_R, Math.max(-H / 2 + HANDLE_R, p.y)),
	});

	function onPointerDown(e: PointerEvent): void {
		const p = local(e);
		moved = false;
		if (Math.hypot(p.x - end.x, p.y - end.y) <= HANDLE_R + 4) dragging = 'end';
		else if (Math.hypot(p.x - start.x, p.y - start.y) <= HANDLE_R + 4) dragging = 'start';
		else dragging = null;
		if (dragging) canvas?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent): void {
		if (!dragging) return;
		moved = true;
		const p = clampToStage(local(e));
		if (dragging === 'start') start = p;
		else end = p;
	}

	function onPointerUp(e: PointerEvent): void {
		if (dragging) {
			dragging = null;
			return;
		}
		if (moved) return;
		const p = local(e);
		const reel = Math.floor((p.x - BOARD_LEFT) / CELL);
		const row = Math.floor((p.y - BOARD_TOP) / CELL);
		if (reel < 0 || reel >= REELS || row < 0 || row >= ROWS) return;
		const key = `${reel}:${row}`;
		wins = wins.includes(key) ? wins.filter((k) => k !== key) : [...wins, key];
	}
</script>

<div class="flight-preview">
	<div class="stage" style="width:{W}px;height:{H}px">
		{#if trailDoc?.layers.length}
			<div class="fx-layer">
				{#key trailDoc.id}
					<FxStage
						layers={trailDoc.layers}
						playing
						{resolveArt}
						{ownerPos}
						ownerRotation={trailRotation}
						emitting={flying}
						showReference={false}
					/>
				{/key}
			</div>
		{/if}
		{#if arrivalDoc?.layers.length}
			<div class="fx-layer">
				{#key arrivalDoc.id}
					<FxStage
						layers={arrivalDoc.layers}
						playing
						{resolveArt}
						ownerPos={arrivalPos}
						emitting={arriving}
						showReference={false}
					/>
				{/key}
			</div>
		{/if}
		{#if artHead && headArt}
			<div class="art-head" bind:this={artEl} style="width:{headSize}px;height:{headSize}px">
				{@render headArt(headSize)}
			</div>
		{/if}
		<canvas
			bind:this={canvas}
			style="width:{W}px;height:{H}px"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
		></canvas>
	</div>
	<p class="legend">
		Drag <strong>A</strong> (the coin's cell) and <strong>B</strong> (the target). Click a cell to
		mark or unmark it as showing a win. Route:
		<strong>{route.kind}</strong>{#if route.strength}&nbsp;({route.strength.toFixed(
				2,
			)}){/if}{#if route.hits}, {route.hits} blocked samples{/if} · {Math.round(durationMs)} ms{#if style.trail && 'off' in style.trail}
			· no trail{:else if !style.trail}
			· coded trail (approximation){:else if !trailDoc}
			· loading the trail effect…{/if} · head: {headLabel}{#if style.size !== 1}
			× {style.size}{/if}{#if artHead && !token && style.headAlign !== 'off'}
			· follows the curve{/if}{#if style.depth}
			· 3D depth {style.depth}{/if}{#if arrivalEffectId && !arrivalDoc}
			· loading the arrival effect…{/if}
	</p>
</div>

<style>
	.flight-preview {
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 100%;
		overflow-x: auto;
	}
	.stage {
		position: relative;
		flex: none;
		border-radius: 8px;
		overflow: hidden;
		background: #0b0e13;
	}
	.fx-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.art-head {
		position: absolute;
		left: 0;
		top: 0;
		opacity: 0;
		pointer-events: none;
		display: grid;
		place-items: center;
	}
	canvas {
		position: absolute;
		inset: 0;
		cursor: crosshair;
		touch-action: none;
	}
	.legend {
		margin: 0;
		font-size: 12px;
		color: #9a9aa8;
	}
</style>
