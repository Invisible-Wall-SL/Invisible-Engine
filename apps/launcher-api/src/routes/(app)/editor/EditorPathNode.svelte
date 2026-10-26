<script lang="ts">
	import { PATH_MIN_POINTS, pathPoints, pathSmoothing, type PathNode } from 'engine-layout';
	import {
		appendPathPoint,
		removePathPoint,
		setPathClosed,
		setPathPoint,
		setPathSmoothing,
	} from '$lib/editor/pathNodeEdit';

	/**
	 * Properties of a `path` (game-families §4.3): a line an arcade character's brain patrols or
	 * follows, named by this node's id. The game draws nothing for it.
	 */
	type Props = { node: PathNode; onChange: () => void };
	const { node, onChange }: Props = $props();

	const points = $derived(pathPoints(node));
	const smoothing = $derived(pathSmoothing(node));

	function setCoord(i: number, axis: 'x' | 'y', v: number): void {
		const p = points[i];
		if (p && setPathPoint(node, i, { ...p, [axis]: v })) onChange();
	}
</script>

<section>
	<h3>Path</h3>
	<p class="muted small">
		A line a character walks: a brain's <strong>patrol</strong> or <strong>follow path</strong>
		names it by its id, <code>{node.id}</code>. The game draws nothing for it. On the stage, drag a
		point, click a segment to add one, Alt+click a point to delete it.
	</p>

	<div class="row">
		<label
			class="field check"
			title="Join the last point back to the first: a patrol goes round and round instead of back and forth."
		>
			<input
				type="checkbox"
				checked={node.closed === true}
				onchange={(e) => {
					setPathClosed(node, e.currentTarget.checked);
					onChange();
				}}
			/>
			<span>Loop (closed)</span>
		</label>
	</div>

	<div class="row" title="0 = straight lines between the points; 1 = a smooth curve through them.">
		<label class="field">
			<span>smoothing</span>
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={smoothing}
				oninput={(e) => {
					if (setPathSmoothing(node, e.currentTarget.valueAsNumber)) onChange();
				}}
			/>
		</label>
		<label class="field narrow">
			<span>&nbsp;</span>
			<input
				type="number"
				min="0"
				max="1"
				step="0.05"
				value={smoothing}
				oninput={(e) => {
					if (setPathSmoothing(node, e.currentTarget.valueAsNumber)) onChange();
				}}
			/>
		</label>
	</div>

	<span class="sub-label">points (from the node's origin)</span>
	<ul class="points">
		{#each points as p, i (i)}
			<li>
				<span class="idx">{i === 0 ? 'start' : i + 1}</span>
				<input
					type="number"
					step="1"
					aria-label="x"
					value={p.x}
					oninput={(e) => setCoord(i, 'x', e.currentTarget.valueAsNumber)}
				/>
				<input
					type="number"
					step="1"
					aria-label="y"
					value={p.y}
					oninput={(e) => setCoord(i, 'y', e.currentTarget.valueAsNumber)}
				/>
				<button
					type="button"
					class="ghost-sm"
					title={points.length <= PATH_MIN_POINTS
						? 'A path needs at least two points'
						: 'Delete this point'}
					disabled={points.length <= PATH_MIN_POINTS}
					onclick={() => {
						if (removePathPoint(node, i)) onChange();
					}}>×</button
				>
			</li>
		{/each}
	</ul>
	<button
		type="button"
		class="ghost-sm"
		onclick={() => {
			appendPathPoint(node);
			onChange();
		}}>+ add point</button
	>
</section>

<style>
	section {
		margin-bottom: 14px;
	}
	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 8px;
	}
	.sub-label {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a9aa6;
		margin: 10px 0 6px;
	}
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.field.narrow {
		flex: 0 0 64px;
	}
	.field.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.field.check span {
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: #ccc;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	input[type='number'] {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
		min-width: 0;
	}
	input[type='number']:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.points {
		list-style: none;
		padding: 0;
		margin: 0 0 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.points li {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
	}
	.idx {
		flex: 0 0 34px;
		color: #9a9aa6;
		font-size: 11px;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.ghost-sm {
		background: transparent;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		color: #aaa;
		font-size: 11px;
		padding: 2px 6px;
		cursor: pointer;
	}
	.ghost-sm:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
