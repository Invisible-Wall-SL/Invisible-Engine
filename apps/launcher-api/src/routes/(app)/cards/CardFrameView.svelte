<script lang="ts">
	import {
		evaluateBinding,
		foldBoundTransform,
		resolveComponentParams,
		resolveTransform,
		type ComponentDef,
		type LayoutNode,
	} from 'engine-layout';
	import CardArt from './CardArt.svelte';

	/**
	 * A card drawn in its card-frame component (`docs/design/card-games.md` §6, §8.2): the frame's
	 * own node tree, with the values the game feeds it (`frameValues`) as its params, its param
	 * bindings and its `param` value bindings folded the way the game folds them
	 * (`resolveTransform` → `evaluateBinding` → `foldBoundTransform`). So the looks a 0 / 1 param
	 * switches show and hide as in game.
	 *
	 * A light DOM drawing, not the Scene Editor's canvas: the list draws every card, and one WebGL
	 * stage per card would run out of contexts. It draws containers, rects, text, sprites (the art)
	 * and nested component instances; any other node kind (a rig, an effect) is left out and named
	 * under the card.
	 */
	interface Props {
		frame: ComponentDef | undefined;
		values: Record<string, unknown>;
		/** Other components by id, for a frame that nests an instance. */
		components?: ReadonlyMap<string, ComponentDef>;
		/** The frame's size, drawn centred on its origin (the placeholder's 140 × 196). */
		width?: number;
		height?: number;
		/** The width drawn on the page; the height follows. */
		size?: number;
	}
	let {
		frame,
		values,
		components = new Map(),
		width = 140,
		height = 196,
		size = 140,
	}: Props = $props();

	const params = $derived(frame ? resolveComponentParams(frame, values) : values);
	const scale = $derived(size / width);
	const DRAWN = new Set(['container', 'rect', 'text', 'sprite', 'componentInstance']);
	const MAX_DEPTH = 6;

	const hex = (color: number | undefined, fallback: string): string =>
		typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : fallback;

	const asNumber = (v: unknown): number | undefined =>
		typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : undefined;

	function transformOf(node: LayoutNode, p: Record<string, unknown>) {
		const base = resolveTransform(node, 'desktop');
		const bindings = node.valueBindings;
		if (!bindings?.length) return base;
		const outputs = bindings.map((b) => {
			const input = b.param ? asNumber(p[b.param]) : undefined;
			return input === undefined ? undefined : evaluateBinding(b, input);
		});
		return foldBoundTransform(base, bindings, outputs);
	}

	const bound = (node: LayoutNode, key: string, p: Record<string, unknown>): unknown => {
		const param = node.paramBindings?.[key];
		return param ? p[param] : undefined;
	};

	/** The node kinds the frame uses that this drawing leaves out. */
	function skipped(root: LayoutNode | undefined): string[] {
		const out: string[] = [];
		const walk = (n: LayoutNode): void => {
			if (!DRAWN.has(n.kind) && !out.includes(n.kind)) out.push(n.kind);
			if (n.kind === 'container') n.children.forEach(walk);
		};
		if (root) walk(root);
		return out;
	}
	const left = $derived(skipped(frame?.root));
</script>

{#snippet node(n: LayoutNode, p: Record, depth: number)}
	{@const t = transformOf(n, p)}
	{#if t.visible && depth < MAX_DEPTH}
		{@const sx = t.scale?.x ?? 1}
		{@const sy = t.scale?.y ?? 1}
		{@const place = `left:${t.x}px;top:${t.y}px;opacity:${t.alpha ?? 1};transform:rotate(${t.rotation ?? 0}rad) scale(${sx},${sy});`}
		{#if n.kind === 'container'}
			<div class="n" style={place}>
				{#each n.children as child (child.id)}{@render node(child, p, depth)}{/each}
			</div>
		{:else if n.kind === 'rect'}
			{@const ax = t.anchor?.x ?? 0.5}
			{@const ay = t.anchor?.y ?? 0.5}
			{@const w = t.width ?? n.width}
			{@const h = t.height ?? n.height}
			<div
				class="n"
				style="{place}margin-left:{-ax * w}px;margin-top:{-ay *
					h}px;width:{w}px;height:{h}px;background:{hex(
					n.color,
					'#888',
				)};border-radius:{n.borderRadius ?? 0}px;{n.borderWidth
					? `outline:${n.borderWidth}px solid ${hex(n.borderColor, '#fff')};outline-offset:-${n.borderWidth}px;`
					: ''}transform-origin:{ax * 100}% {ay * 100}%"
			></div>
		{:else if n.kind === 'text'}
			{@const text = bound(n, 'text', p) ?? n.text}
			{@const s = n.style ?? {}}
			{@const ax = t.anchor?.x ?? 0}
			{@const ay = t.anchor?.y ?? 0}
			{@const w = t.width ?? n.width}
			{@const h = t.height ?? n.height}
			<div
				class="n text"
				style="{place}transform:translate({-ax * 100}%, {-ay * 100}%) scale({sx},{sy});{w
					? `width:${w}px;`
					: 'white-space:nowrap;'}{h ? `height:${h}px;` : ''}font-size:{s.fontSize ??
					16}px;color:{hex(
					typeof s.fill === 'number' ? s.fill : undefined,
					typeof s.fill === 'string' ? s.fill : '#fff',
				)};font-weight:{s.fontWeight ?? 'normal'};text-align:{s.align ??
					'left'};justify-content:{s.verticalAlign === 'middle' ? 'center' : 'flex-start'}"
			>
				{String(text ?? '')}
			</div>
		{:else if n.kind === 'sprite'}
			{@const art = bound(n, 'region', p) ?? n.region}
			{@const w = t.width ?? n.width ?? 64}
			{@const h = t.height ?? n.height ?? 64}
			{@const ax = t.anchor?.x ?? 0.5}
			{@const ay = t.anchor?.y ?? 0.5}
			<div
				class="n sprite"
				style="{place}margin-left:{-ax * w}px;margin-top:{-ay * h}px;width:{w}px;height:{h}px"
			>
				{#if typeof art === 'string' && art}<CardArt value={art} size={Math.min(w, h)} />{/if}
			</div>
		{:else if n.kind === 'componentInstance'}
			{@const def = components.get(n.componentId)}
			{#if def}
				<div class="n" style={place}>
					{@render node(def.root, resolveComponentParams(def, n.params), depth + 1)}
				</div>
			{/if}
		{/if}
	{/if}
{/snippet}

<div class="card" style="width:{size}px;height:{height * scale}px">
	{#if frame}
		<div
			class="stage"
			style="transform:scale({scale});left:{size / 2}px;top:{(height * scale) / 2}px"
		>
			{@render node(frame.root, params, 0)}
		</div>
	{:else}
		<div class="missing">No frame</div>
	{/if}
</div>
{#if left.length}<p class="skipped">Not drawn here: {left.join(', ')}</p>{/if}

<style>
	.card {
		position: relative;
		overflow: hidden;
		flex: none;
	}
	.stage {
		position: absolute;
		transform-origin: 0 0;
		width: 0;
		height: 0;
	}
	.n {
		position: absolute;
		transform-origin: 0 0;
		box-sizing: border-box;
	}
	.text {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		overflow: hidden;
		font-family: system-ui, sans-serif;
		pointer-events: none;
	}
	.sprite {
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.missing {
		display: grid;
		place-items: center;
		height: 100%;
		border: 1px dashed #556;
		border-radius: 8px;
		color: #8a8a93;
		font-size: 12px;
	}
	.skipped {
		margin: 2px 0 0;
		color: #8a8a93;
		font-size: 10px;
	}
</style>
