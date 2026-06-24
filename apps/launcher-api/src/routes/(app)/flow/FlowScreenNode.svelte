<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { FlowPin } from 'engine-flow';

	// A screen node: its name + a thumbnail-less list of derived pins (design doc §12 —
	// a name + handle list suffices, no live Pixi inside the node). The four dynamic-pin
	// classes plus the fixed structural pins each render as a typed Svelte Flow handle.
	type Data = {
		label: string;
		pins: FlowPin[];
		orphanCount: number;
		initial: boolean;
	};
	let { data }: NodeProps = $props();
	const d = data as Data;

	// Inputs on the LEFT, outputs on the RIGHT, state pins shown inline (no handle —
	// `active` is a status, not a wire endpoint).
	const inputs = $derived(d.pins.filter((p) => p.direction === 'in'));
	const outputs = $derived(d.pins.filter((p) => p.direction === 'out'));
	const stateP = $derived(d.pins.filter((p) => p.direction === 'state'));

	const roleColor: Record<string, string> = {
		value: '#3b82f6',
		signal: '#a855f7',
		action: '#f59e0b',
		gate: '#10b981',
		enter: '#64748b',
		complete: '#64748b',
		active: '#64748b',
	};
</script>

<div class="screen-node" class:initial={d.initial}>
	<header>
		<span class="title">{d.label}</span>
		{#if d.initial}<span class="badge">start</span>{/if}
		{#if d.orphanCount > 0}<span class="badge warn" title="{d.orphanCount} orphaned pin(s)"
				>⚠ {d.orphanCount}</span
			>{/if}
	</header>

	<div class="pins">
		<ul class="col in">
			{#each inputs as pin (pin.id)}
				<li class:orphaned={pin.orphaned}>
					<Handle
						type="target"
						position={Position.Left}
						id={pin.id}
						style="background:{roleColor[pin.role]}"
					/>
					<span class="dot" style="background:{roleColor[pin.role]}"></span>
					<span class="label">{pin.label}</span>
				</li>
			{/each}
		</ul>
		<ul class="col out">
			{#each outputs as pin (pin.id)}
				<li class:orphaned={pin.orphaned}>
					<span class="label">{pin.label}</span>
					<span class="dot" style="background:{roleColor[pin.role]}"></span>
					<Handle
						type="source"
						position={Position.Right}
						id={pin.id}
						style="background:{roleColor[pin.role]}"
					/>
				</li>
			{/each}
		</ul>
	</div>

	{#if stateP.length}
		<footer>
			{#each stateP as pin (pin.id)}
				<span class="state-pin">{pin.label}</span>
			{/each}
		</footer>
	{/if}
</div>

<style>
	.screen-node {
		min-width: 220px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 8px;
		color: #e2e8f0;
		font-size: 12px;
		overflow: hidden;
	}
	.screen-node.initial {
		border-color: #3b82f6;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		background: #1b212b;
		border-bottom: 1px solid #2a323d;
		font-weight: 600;
	}
	.title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 999px;
		background: #1d3a6b;
		color: #bfdbfe;
	}
	.badge.warn {
		background: #5b2a18;
		color: #fed7aa;
	}
	.pins {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
	}
	.col {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.col li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 2px 10px;
	}
	.col.out li {
		justify-content: flex-end;
	}
	.col li.orphaned .label {
		color: #fca5a5;
		text-decoration: line-through;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
	}
	.label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}
	footer {
		padding: 5px 10px;
		border-top: 1px solid #2a323d;
		background: #11161d;
		display: flex;
		gap: 6px;
	}
	.state-pin {
		font-size: 10px;
		color: #94a3b8;
		padding: 1px 6px;
		border-radius: 4px;
		background: #1b212b;
	}
</style>
