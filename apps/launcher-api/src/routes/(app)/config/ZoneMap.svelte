<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { ArcadeZone } from 'game-config';
	import BoundsBox from '$lib/BoundsBox.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { clampZoom } from '$lib/panZoom';
	import {
		ZONE_ROLES,
		ZONE_ROLE_LABELS,
		drawnRect,
		fitScale,
		ruleText,
		rulesByZone,
		zoneRole,
		type Rect,
		type ZoneRuleLike,
	} from './zones';

	/**
	 * THE ZONE MAP: the play field with every zone drawn as what its rules make it (the goal, a
	 * wall, a one-way wall, a current, a kind the rules module acts on, or nothing). Click a zone
	 * for what it is. With `edit` the selected zone has the shared `BoundsBox` handles (move and
	 * resize, written back in whole px), a drag on the empty field draws a new zone, and the
	 * inspector under the map edits it. Without, it only shows: a generated game's level, or a
	 * project someone else holds.
	 *
	 * Zoom resizes the pane (`docs/ui-inventory.md` §16): the overlay is parented to the pane, the
	 * exactly-sized element the SVG fills (§15), so a drag needs no zoom term.
	 */
	let {
		area,
		field,
		zones,
		rules,
		edit,
		toolbar,
	}: {
		/** What the map shows, field px (`./zones` `zoneMapArea`). */
		area: Rect;
		/** The play field, outlined; absent ⇒ the screen. */
		field?: { w: number; h: number };
		zones: readonly ArcadeZone[];
		/** The rules on the zones: what colours them. */
		rules: readonly ZoneRuleLike[];
		edit?: {
			rect: (index: number, rect: Rect) => void;
			add: (rect: Rect) => number;
			remove: (index: number) => void;
			field: (index: number, field: keyof ArcadeZone, value: string) => void;
		};
		/** Controls beside the zoom (a generated level's seed). */
		toolbar?: Snippet;
	} = $props();

	const VIEW_H = 420;
	/** The width assumed before the view is measured (the server's render). */
	const VIEW_W = 640;
	/** A drag shorter than this, screen px, is a click. */
	const DRAW_MIN = 4;

	let scroller = $state<HTMLDivElement>();
	let pane = $state<HTMLDivElement>();
	let viewW = $state(0);
	let zoom = $state(1);
	/** The area as a pointer went down. A zone dragged or drawn past the field grows the area, and
	 *  with it the scale and the pane's origin: the same pointer would then be another field point
	 *  and the zone would run away from it. Held until the pointer lifts. */
	let held = $state<Rect>();
	const shown = $derived(held ?? area);
	const scale = $derived(fitScale(shown, viewW || VIEW_W, VIEW_H) * zoom);
	const paneW = $derived(Math.max(1, Math.round(shown.w * scale)));
	const paneH = $derived(Math.max(1, Math.round(shown.h * scale)));
	const fit = $derived({ scale, originX: -shown.x * scale, originY: -shown.y * scale });

	const byZone = $derived(rulesByZone(rules));
	const layers = $derived.by(() => {
		const drawn = new Map(ZONE_ROLES.map((role) => [role, [] as number[]]));
		zones.forEach((zone, index) => drawn.get(zoneRole(byZone.get(zone.id)))!.push(index));
		return ZONE_ROLES.map((role) => ({ role, indexes: drawn.get(role)! }));
	});

	let selected = $state.raw<ArcadeZone>();
	const at = $derived(selected ? zones.indexOf(selected) : -1);
	const zone = $derived(at >= 0 ? zones[at] : undefined);
	const onZone = $derived(zone ? (byZone.get(zone.id) ?? []) : []);

	type Point = { x: number; y: number };
	let drawing = $state<{ from: Point; to: Point; pointer: number }>();
	const drawn = $derived(drawing ? drawnRect(drawing.from, drawing.to) : undefined);

	function fieldAt(e: PointerEvent): Point {
		const box = pane!.getBoundingClientRect();
		return {
			x: shown.x + (e.clientX - box.left) / scale,
			y: shown.y + (e.clientY - box.top) / scale,
		};
	}

	function down(e: PointerEvent): void {
		if (e.button !== 0) return;
		const hit = (e.target as Element).closest('[data-i]');
		if (hit && !(edit && e.shiftKey)) {
			selected = zones[Number(hit.getAttribute('data-i'))];
			return;
		}
		selected = undefined;
		if (!edit) return;
		const from = fieldAt(e);
		drawing = { from, to: from, pointer: e.pointerId };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}

	function move(e: PointerEvent): void {
		if (drawing?.pointer === e.pointerId) drawing.to = fieldAt(e);
	}

	function up(e: PointerEvent): void {
		if (!drawing || drawing.pointer !== e.pointerId || !edit) return;
		const rect = drawnRect(drawing.from, drawing.to);
		drawing = undefined;
		if (rect.w * scale < DRAW_MIN || rect.h * scale < DRAW_MIN) return;
		selected = zones[edit.add(rect)];
	}

	/** Zoom to `next` (× the fit), keeping what is under `(cx, cy)` of the view under it. */
	async function zoomTo(next: number, cx: number, cy: number): Promise<void> {
		const z = clampZoom(next);
		if (!scroller || !pane || z === zoom) return;
		const view = scroller.getBoundingClientRect();
		const before = pane.getBoundingClientRect();
		const px = cx - (before.left - view.left);
		const py = cy - (before.top - view.top);
		const k = z / zoom;
		zoom = z;
		await tick();
		const after = pane.getBoundingClientRect();
		scroller.scrollLeft += after.left - view.left - (cx - px * k);
		scroller.scrollTop += after.top - view.top - (cy - py * k);
	}
	function zoomBy(k: number): void {
		if (scroller) void zoomTo(zoom * k, scroller.clientWidth / 2, scroller.clientHeight / 2);
	}

	$effect(() => {
		const view = scroller;
		if (!view) return;
		const wheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const box = view.getBoundingClientRect();
			void zoomTo(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - box.left, e.clientY - box.top);
		};
		view.addEventListener('wheel', wheel, { passive: false });
		return () => view.removeEventListener('wheel', wheel);
	});

	/** A field of the selected zone as typed; the box then shows what was stored. */
	function typeField(key: keyof ArcadeZone, input: HTMLInputElement): void {
		if (!edit || at < 0) return;
		const index = at;
		edit.field(index, key, input.value);
		input.value = String(zones[index][key]);
	}

	function removeSelected(): void {
		if (!edit || at < 0) return;
		edit.remove(at);
		selected = undefined;
	}
</script>

<div class="zone-map">
	<div class="bar">
		{#if toolbar}{@render toolbar()}{/if}
		<span class="zoom">
			<button type="button" class="small" title="Zoom out" onclick={() => zoomBy(0.8)}>−</button>
			<button type="button" class="small" title="The whole field" onclick={() => (zoom = 1)}
				>Fit</button
			>
			<button type="button" class="small" title="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
			<InfoTip label="Using the map" alignEnd
				>{edit
					? 'Click a zone to select it, then drag it or its handles. Drag on the empty field to draw a new zone (hold Shift to draw over zones). '
					: 'Click a zone for what it is. '}Ctrl (or ⌘) and the wheel zoom about the pointer; scroll
				to move around.</InfoTip
			>
		</span>
	</div>
	<div class="view" bind:this={scroller} bind:clientWidth={viewW} style:height="{VIEW_H}px">
		<div
			class="pane"
			role="presentation"
			bind:this={pane}
			style:width="{paneW}px"
			style:height="{paneH}px"
			onpointerdowncapture={() => (held = { ...area })}
			onpointerup={() => (held = undefined)}
			onpointercancel={() => (held = undefined)}
		>
			<svg
				role="presentation"
				width={paneW}
				height={paneH}
				viewBox="{shown.x} {shown.y} {shown.w} {shown.h}"
				preserveAspectRatio="none"
				class:drawable={!!edit}
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={() => (drawing = undefined)}
			>
				{#if field}<rect class="field" x="0" y="0" width={field.w} height={field.h} />{/if}
				{#each layers as layer (layer.role)}
					<g class="layer {layer.role}">
						{#each layer.indexes as i (i)}
							{@const z = zones[i]}
							<rect x={z.x} y={z.y} width={z.w} height={z.h} data-i={i}
								><title>{z.id}: {ZONE_ROLE_LABELS[layer.role]}</title></rect
							>
						{/each}
					</g>
				{/each}
				{#if zone && !edit}
					<rect class="picked" x={zone.x} y={zone.y} width={zone.w} height={zone.h} />
				{/if}
				{#if drawn}
					<rect class="drawing" x={drawn.x} y={drawn.y} width={drawn.w} height={drawn.h} />
				{/if}
			</svg>
			{#if edit && zone}
				<BoundsBox bounds={zone} {fit} stage={pane ?? null} onchange={(b) => edit.rect(at, b)} />
			{/if}
		</div>
	</div>
	<div class="legend-row">
		{#each layers as layer (layer.role)}
			{#if layer.indexes.length}
				<span class="key"
					><i class="swatch {layer.role}"></i>{ZONE_ROLE_LABELS[layer.role]}
					<em>{layer.indexes.length}</em></span
				>
			{/if}
		{/each}
	</div>
	{#if zone}
		{#if edit}
			<div class="inspector">
				<label
					>Zone<input value={zone.id} onchange={(e) => typeField('id', e.currentTarget)} /></label
				>
				{#each ['x', 'y', 'w', 'h'] as const as key (key)}
					<label
						>{key}<input
							type="number"
							value={zone[key]}
							onchange={(e) => typeField(key, e.currentTarget)}
						/></label
					>
				{/each}
				<IconButton icon="trash" danger label="Delete this zone" onclick={removeSelected} />
			</div>
		{:else}
			<p class="readonly">
				<code>{zone.id}</code>
				{zone.x}, {zone.y} · {zone.w} × {zone.h}
			</p>
		{/if}
		<p class="readonly">{onZone.length ? onZone.map(ruleText).join('; ') : 'No rule on it.'}</p>
	{/if}
</div>

<style>
	.zone-map {
		max-width: 900px;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.zoom {
		display: inline-flex;
		gap: 6px;
		align-items: center;
		margin-left: auto;
	}
	.view {
		display: flex;
		overflow: auto;
		scrollbar-gutter: stable;
		background: #0a0a0f;
		border: 1px solid #1c1c24;
		border-radius: 8px;
	}
	.pane {
		position: relative;
		flex: none;
		margin: auto;
	}
	svg {
		display: block;
		touch-action: none;
	}
	svg.drawable {
		cursor: crosshair;
	}
	svg :global(rect) {
		vector-effect: non-scaling-stroke;
		stroke-width: 1;
	}
	.field {
		fill: #12121a;
		stroke: #3a3a48;
	}
	/* Global: a scoping class on each of a thousand rects is a kilobyte per forty zones. */
	.layer :global(rect) {
		fill: var(--fill);
		stroke: var(--edge);
		fill-opacity: 0.45;
		cursor: pointer;
	}
	.layer :global(rect:hover) {
		fill-opacity: 0.8;
	}
	.none {
		--fill: #3a3a48;
		--edge: #6f6f7d;
	}
	.solid {
		--fill: #8a93a6;
		--edge: #b9c0cf;
	}
	.push {
		--fill: #4f9fd8;
		--edge: #7fbfea;
	}
	.oneWay {
		--fill: #a77fd6;
		--edge: #c6a6ee;
	}
	.kind {
		--fill: #d88c4f;
		--edge: #eeb27f;
	}
	.goal {
		--fill: #e0c46c;
		--edge: #f2dc94;
	}
	.picked {
		fill: none;
		stroke: #7ee0c0;
		stroke-width: 2;
	}
	.drawing {
		fill: #7ee0c0;
		fill-opacity: 0.25;
		stroke: #7ee0c0;
	}
	.legend-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 6px 0;
		font-size: 11px;
		color: #b9b9c4;
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.key em {
		font-style: normal;
		color: #6f6f7d;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		border: 1px solid var(--edge);
		background: var(--fill);
	}
	.inspector {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: flex-end;
		margin: 6px 0 4px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #8b8b98;
	}
	input {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 6px 8px;
		font-size: 13px;
		font-family: inherit;
		box-sizing: border-box;
	}
	input:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	input[type='number'] {
		width: 90px;
	}
	.readonly {
		margin: 0 0 4px;
		font-size: 12px;
		color: #8b8b98;
	}
	button.small {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
</style>
