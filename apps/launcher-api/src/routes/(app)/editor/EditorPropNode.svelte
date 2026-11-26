<script lang="ts">
	/**
	 * A selected node's DEPTH in a prop (`docs/design/arcade-prop-components.md` §5): the band it
	 * draws in against the characters (its own, else its parent's), the z offset a `behind` or
	 * `sorted` band reads, and, for a component instance at the prop's root, the cell it stands at.
	 */
	import { PROP_DEPTHS, type ComponentDef, type LayoutNode, type PropDepth } from 'engine-layout';

	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import {
		propBandOf,
		propCellApplies,
		setNodePropCell,
		setNodePropDepth,
		setNodePropZOffset,
	} from '$lib/editor/propEdit';
	import { PROP_DEPTH_LABELS } from './propDepthLabels';

	interface Props {
		def: ComponentDef;
		node: LayoutNode;
		version: number;
		readOnly?: boolean;
		onChanged: () => void;
	}
	let { def, node, version, readOnly = false, onChanged }: Props = $props();

	let local = $state(0);
	const view = $derived.by(() => {
		void version;
		void local;
		return {
			own: node.propDepth,
			band: propBandOf(def.root, node.id) ?? 'sorted',
			z: node.propZOffset,
			cell: node.propCell,
		};
	});
	function edit(fn: () => boolean): void {
		if (readOnly || !fn()) return;
		local += 1;
		onChanged();
	}
	const cellText = (cell: LayoutNode['propCell']): string =>
		cell === undefined
			? ''
			: typeof cell === 'number'
				? String(cell)
				: `${cell.param}${cell.plus ? (cell.plus > 0 ? `+${cell.plus}` : cell.plus) : ''}`;
	/** `-2`, `length+1`, `length-1`: a number of cells, or a param plus cells. */
	function parseCell(text: string): LayoutNode['propCell'] | null {
		const t = text.replace(/\s+/g, '');
		if (!t) return undefined;
		if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
		const m = /^([A-Za-z_]\w*)([+-]\d+(\.\d+)?)?$/.exec(t);
		if (!m) return null;
		return m[2] ? { param: m[1], plus: Number(m[2]) } : { param: m[1] };
	}
	let cellError = $state(false);
</script>

<SectionCard scope="editor" id="prop-depth" title="Depth">
	{#snippet info()}
		Where this node draws against the characters in the game: on the water, behind every one, among
		them by ground depth, or over every one (those on the prop included). A child takes its parent’s
		band.
	{/snippet}
	<div class="row">
		<label class="field">
			<span>Band</span>
			<select
				value={view.own ?? ''}
				disabled={readOnly}
				onchange={(e) =>
					edit(() =>
						setNodePropDepth(node, (e.currentTarget.value || undefined) as PropDepth | undefined),
					)}
			>
				<option value="">as its parent ({PROP_DEPTH_LABELS[view.band]})</option>
				{#each PROP_DEPTHS as band (band)}
					<option value={band}>{PROP_DEPTH_LABELS[band]}</option>
				{/each}
			</select>
		</label>
		{#if view.band === 'sorted' || view.band === 'behind'}
			<label class="field">
				<span
					>Z offset <InfoTip
						>The original’s old px over its screen y; empty is the band’s own (1100 among the
						characters, the deck’s; 0 behind).</InfoTip
					></span
				>
				<input
					type="number"
					step="50"
					value={view.z ?? ''}
					placeholder={view.band === 'sorted' ? '1100' : '0'}
					disabled={readOnly}
					onchange={(e) => {
						const v = e.currentTarget.value;
						edit(() => setNodePropZOffset(node, v === '' ? undefined : Number(v)));
					}}
				/>
			</label>
		{/if}
		{#if propCellApplies(def, node)}
			<label class="field">
				<span
					>Cell <InfoTip
						>The cell along the zone this piece stands at: a number (−2: two before the first), or a
						param plus cells (length+1: one past the last).</InfoTip
					></span
				>
				<input
					type="text"
					class:bad={cellError}
					value={cellText(view.cell)}
					placeholder="0"
					disabled={readOnly}
					onchange={(e) => {
						const cell = parseCell(e.currentTarget.value);
						cellError = cell === null;
						if (cell !== null) edit(() => setNodePropCell(node, cell));
					}}
				/>
			</label>
		{/if}
	</div>
</SectionCard>

<style>
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		flex: 1 1 100px;
		min-width: 0;
	}
	.bad {
		outline: 1px solid #c55;
	}
</style>
