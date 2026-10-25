<script lang="ts">
	import { effectiveSpawnCap, SPAWN_DEFAULT_CAP, SPAWN_HARD_CAP } from 'constants-shared/spawn';
	import { spawnLayerGrid, spawnableComponentIds, type SpawnLayerNode } from 'engine-layout';

	/**
	 * Properties of a `spawnLayer` (game-families §3.3): which components Flow may spawn into it
	 * (declared here so the ship chain collects them), free or grid placement, the grid's lattice and
	 * the most live instances at once. The editor runs no flow, so nothing here previews a spawn.
	 */
	type Props = {
		node: SpawnLayerNode;
		componentDefs: { id: string; name: string }[];
		onChange: () => void;
	};
	const { node, componentDefs, onChange }: Props = $props();

	/** A lattice to start from when a free layer turns grid without one. */
	const DEFAULT_GRID = { cols: 6, rows: 4, pitch: 120 } as const;

	const spawnable = $derived(spawnableComponentIds(node));
	const addable = $derived(componentDefs.filter((c) => !spawnable.includes(c.id)));
	const grid = $derived(spawnLayerGrid(node));
	const nameOf = (id: string): string => componentDefs.find((c) => c.id === id)?.name ?? id;

	function setSpawnable(next: string[]): void {
		node.spawnable = next;
		onChange();
	}

	function move(i: number, by: -1 | 1): void {
		const next = [...spawnable];
		const j = i + by;
		if (j < 0 || j >= next.length) return;
		[next[i], next[j]] = [next[j], next[i]];
		setSpawnable(next);
	}

	function setPlacement(value: string): void {
		node.placement = value === 'grid' ? 'grid' : 'free';
		if (node.placement === 'grid' && !grid) node.grid = { ...DEFAULT_GRID, ...node.grid };
		onChange();
	}

	function setGrid(key: 'cols' | 'rows' | 'pitch', v: number): void {
		const ok = key === 'pitch' ? v > 0 : Number.isInteger(v) && v >= 1;
		if (!Number.isFinite(v) || !ok) return;
		node.grid = { ...DEFAULT_GRID, ...node.grid, [key]: v };
		onChange();
	}

	function setCap(raw: string, v: number): void {
		if (raw === '') node.cap = undefined;
		else if (Number.isInteger(v) && v >= 1 && v <= SPAWN_HARD_CAP) node.cap = v;
		else return;
		onChange();
	}
</script>

<section>
	<h3>Spawn layer</h3>
	<p class="muted small">
		A field Flow fills while the game runs — a <strong>Spawn</strong> node adds an instance of one
		of the components below, <strong>Despawn</strong> removes it. The editor runs no flow, so it draws
		the field, not the instances. Position it with the Transform section above.
	</p>

	<span class="sub-label">spawnable</span>
	{#if spawnable.length === 0}
		<p class="muted small warn">
			Nothing can spawn here yet — add a component. Only listed components ship with the game.
		</p>
	{:else}
		<ul class="spawnable">
			{#each spawnable as id, i (id)}
				<li>
					<span class="name" class:missing={!componentDefs.some((c) => c.id === id)}>
						{nameOf(id)}{componentDefs.some((c) => c.id === id) ? '' : ' (missing)'}
					</span>
					<button
						type="button"
						class="ghost-sm"
						title="Move up"
						disabled={i === 0}
						onclick={() => move(i, -1)}>↑</button
					>
					<button
						type="button"
						class="ghost-sm"
						title="Move down"
						disabled={i === spawnable.length - 1}
						onclick={() => move(i, 1)}>↓</button
					>
					<button
						type="button"
						class="ghost-sm"
						title="Remove from the spawnable list"
						onclick={() => setSpawnable(spawnable.filter((s) => s !== id))}>×</button
					>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="row">
		<label class="field wide">
			<span>add component</span>
			<select
				value=""
				disabled={addable.length === 0}
				onchange={(e) => {
					const id = e.currentTarget.value;
					e.currentTarget.value = '';
					if (id) setSpawnable([...spawnable, id]);
				}}
			>
				<option value="">{addable.length ? '— pick —' : '— every component is listed —'}</option>
				{#each addable as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="row">
		<label class="field">
			<span>placement</span>
			<select value={node.placement} onchange={(e) => setPlacement(e.currentTarget.value)}>
				<option value="free">free</option>
				<option value="grid">grid</option>
			</select>
		</label>
		<label class="field">
			<span>cap</span>
			<input
				type="number"
				step="1"
				min="1"
				max={SPAWN_HARD_CAP}
				value={node.cap ?? ''}
				placeholder={String(SPAWN_DEFAULT_CAP)}
				oninput={(e) => setCap(e.currentTarget.value, e.currentTarget.valueAsNumber)}
			/>
		</label>
	</div>
	<p class="muted small">
		{node.placement === 'grid'
			? 'A spawn names a cell (col, row), or a point.'
			: 'A spawn names a point (x, y) in this layer’s space.'}
		At most {effectiveSpawnCap(node.cap)} live at once (1 … {SPAWN_HARD_CAP}); a spawn past the cap
		is dropped.
	</p>

	{#if node.placement === 'grid'}
		<div class="row">
			<label class="field">
				<span>cols</span>
				<input
					type="number"
					step="1"
					min="1"
					value={node.grid?.cols ?? ''}
					oninput={(e) => setGrid('cols', e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label class="field">
				<span>rows</span>
				<input
					type="number"
					step="1"
					min="1"
					value={node.grid?.rows ?? ''}
					oninput={(e) => setGrid('rows', e.currentTarget.valueAsNumber)}
				/>
			</label>
			<label class="field">
				<span>pitch</span>
				<input
					type="number"
					step="1"
					min="1"
					value={node.grid?.pitch ?? ''}
					oninput={(e) => setGrid('pitch', e.currentTarget.valueAsNumber)}
				/>
			</label>
		</div>
		{#if !grid}
			<p class="muted small warn">
				The grid needs whole cols and rows and a pitch above 0 — until then the layer places freely.
			</p>
		{:else}
			<p class="muted small">Cell (0, 0) is at this layer's origin; cells are pitch px apart.</p>
		{/if}
	{/if}
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
	.field.wide {
		flex: 1 1 100%;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.field input[type='number'],
	.field select {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.field input:focus,
	.field select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.spawnable {
		list-style: none;
		padding: 0;
		margin: 0 0 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.spawnable li {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		font-size: 12px;
	}
	.spawnable .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spawnable .name.missing {
		color: #d9a441;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.warn {
		color: #d9a441;
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
