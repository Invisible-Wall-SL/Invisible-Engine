<script lang="ts">
	import type { LayoutNode, ResolvedPreviewArt } from 'engine-layout';

	interface OverlayInfo {
		node: LayoutNode;
		/** Resolved stand-in art (explicit override OR catalog default), so the
		 * overlay treats catalog-default anchors (no baked `preview.art`) like art. */
		resolvedArt?: ResolvedPreviewArt | null;
		left: number;
		top: number;
		right: number;
		bottom: number;
		width: number;
		height: number;
	}

	interface Props {
		info: OverlayInfo;
		onDelete: (node: LayoutNode) => void;
		onToggleLock: (node: LayoutNode) => void;
		onAnchor: (node: LayoutNode, ax: number, ay: number) => void;
		onScale: (node: LayoutNode, factor: number) => void;
		onForward: (node: LayoutNode) => void;
		onBack: (node: LayoutNode) => void;
		/** Whether the selected spine node's preview animation is playing. */
		spinePlaying?: boolean;
		/** Toggle the spine preview animation (only wired for `kind: 'spine'`). */
		onToggleSpinePlay?: (node: LayoutNode) => void;
	}
	let {
		info,
		onDelete,
		onToggleLock,
		onAnchor,
		onScale,
		onForward,
		onBack,
		spinePlaying = false,
		onToggleSpinePlay,
	}: Props = $props();

	const node = $derived(info.node);
	const locked = $derived(node.locked === true);
	// The selected anchor's resolved art — an explicit `preview.art` OR the catalog
	// default resolved by the canvas (catalog anchors carry no baked art).
	const art = $derived(info.resolvedArt ?? node.preview?.art ?? null);
	// Spine play toggle applies to real spine nodes AND spine stand-in anchors (e.g.
	// the animated Background), so both can preview their animation.
	const isSpine = $derived(node.kind === 'spine' || art?.kind === 'spine');

	const subtitle = $derived.by(() => {
		if (node.kind === 'sprite' && node.region)
			return `${node.region} · ${node.assetKey.split('/').pop()}`;
		if (node.kind === 'sprite') return node.assetKey.split('/').pop() ?? 'sprite';
		if (node.kind === 'spine') return `spine · ${node.assetKey.split('/').pop()}`;
		if (art) return `${art.kind} · ${(art.assetKey || art.region || '').split('/').pop()}`;
		return node.kind;
	});

	// 9-point anchor presets (col, row → ax, ay).
	const anchors: { ax: number; ay: number }[] = [
		{ ax: 0, ay: 0 },
		{ ax: 0.5, ay: 0 },
		{ ax: 1, ay: 0 },
		{ ax: 0, ay: 0.5 },
		{ ax: 0.5, ay: 0.5 },
		{ ax: 1, ay: 0.5 },
		{ ax: 0, ay: 1 },
		{ ax: 0.5, ay: 1 },
		{ ax: 1, ay: 1 },
	];
	function isActiveAnchor(ax: number, ay: number): boolean {
		const a = node.anchor ?? { x: 0.5, y: 0.5 };
		return Math.abs(a.x - ax) < 0.01 && Math.abs(a.y - ay) < 0.01;
	}

	// Bar sits above the box; flips below when too close to the top.
	const below = $derived(info.top < 96);
</script>

<div
	class="bar"
	class:below
	class:locked
	style:left="{info.left}px"
	style:top="{below ? info.bottom + 6 : info.top - 6}px"
	style:transform={below ? 'translateY(0)' : 'translateY(-100%)'}
	onmousedown={(e) => e.stopPropagation()}
	role="toolbar"
	aria-label="Item controls"
	tabindex="-1"
>
	<span class="bn" title={node.label ?? node.id}>{node.label ?? node.id}</span>
	<span class="sub" title={subtitle}>{subtitle}</span>
	<span class="size">{info.width} × {info.height} px</span>

	{#if isSpine && onToggleSpinePlay}
		<button
			type="button"
			class="ic play"
			class:active={spinePlaying}
			title={spinePlaying ? 'Pause animation' : 'Play animation'}
			onclick={() => onToggleSpinePlay(node)}
		>
			{spinePlaying ? '❚❚' : '▶'}
		</button>
	{/if}

	{#if !locked}
		<div class="anchorgrid" title="Anchor preset">
			{#each anchors as a (a.ax + '-' + a.ay)}
				<button
					type="button"
					class="ap"
					class:on={isActiveAnchor(a.ax, a.ay)}
					aria-label={`anchor ${a.ax},${a.ay}`}
					onclick={() => onAnchor(node, a.ax, a.ay)}
				></button>
			{/each}
		</div>
		<button type="button" class="ic" title="Scale down" onclick={() => onScale(node, 0.9)}>−</button
		>
		<button type="button" class="ic" title="Scale up" onclick={() => onScale(node, 1.1)}>+</button>
		<button type="button" class="ic" title="Send back" onclick={() => onBack(node)}>⤓</button>
		<button type="button" class="ic" title="Bring forward" onclick={() => onForward(node)}>⤒</button
		>
	{/if}
	<button
		type="button"
		class="ic lock"
		class:active={locked}
		title={locked ? 'Unlock' : 'Lock'}
		onclick={() => onToggleLock(node)}
	>
		{locked ? '🔒' : '🔓'}
	</button>
	{#if !locked}
		<button type="button" class="ic danger" title="Delete" onclick={() => onDelete(node)}>✕</button>
	{/if}
</div>

<style>
	.bar {
		position: absolute;
		display: flex;
		gap: 4px;
		align-items: center;
		background: #0c0c0fee;
		border: 1px solid #3a3a44;
		border-radius: 6px;
		padding: 4px 6px;
		font-size: 11px;
		color: #9ad;
		white-space: nowrap;
		z-index: 10;
		pointer-events: auto;
		box-shadow: 0 4px 16px #000a;
	}
	.bar.locked {
		border-color: #6a5520;
	}
	.bn {
		color: #9cf;
		max-width: 110px;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
	}
	.sub {
		color: #667;
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.size {
		color: #7ee0c0;
		font-variant-numeric: tabular-nums;
		padding: 0 4px;
		border-left: 1px solid #2a2a31;
		border-right: 1px solid #2a2a31;
	}
	.anchorgrid {
		display: grid;
		grid-template-columns: repeat(3, 7px);
		grid-template-rows: repeat(3, 7px);
		gap: 2px;
		padding: 2px;
		border: 1px solid #2a2a31;
		border-radius: 4px;
	}
	.ap {
		width: 7px;
		height: 7px;
		padding: 0;
		border: none;
		border-radius: 1px;
		background: #33333c;
		cursor: pointer;
	}
	.ap:hover {
		background: #4a4a55;
	}
	.ap.on {
		background: #5db0ff;
	}
	.ic {
		min-width: 22px;
		height: 22px;
		padding: 0 5px;
		border: 1px solid #2a2a31;
		border-radius: 4px;
		background: #1d1d22;
		color: #cdd;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
	}
	.ic:hover {
		background: #26262d;
		border-color: #3a3a44;
	}
	.ic.lock.active {
		background: #7a5a1d;
		border-color: #9a7a2d;
	}
	.ic.play.active {
		background: #234038;
		border-color: #2f6a58;
		color: #7ee0c0;
	}
	.ic.danger {
		color: #ff9a9a;
	}
	.ic.danger:hover {
		background: #5a2020;
		border-color: #8a3030;
	}
</style>
