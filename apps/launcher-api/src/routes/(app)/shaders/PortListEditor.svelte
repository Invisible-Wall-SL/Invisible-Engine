<script lang="ts">
	import { DIMS, SUBGRAPH_PORT_TYPES, type PortType, type SubgraphPort } from 'engine-shadergraph';
	import type { PortPatch } from './shaderEditor';

	// One side of a node's declared ports (a subgraph's inputs or outputs, a Custom GLSL node's):
	// each named, typed and given a default, added and removed. A port keeps its id, so wires keep
	// it; where code reads a port by its id (`onRename`), the id is edited too.
	interface Props {
		ports: readonly SubgraphPort[];
		/** What one port is called on the add button and in titles. */
		noun: 'input' | 'output';
		max: number;
		/** The fewest it may keep: the last ones do not remove. */
		min?: number;
		disabled?: boolean;
		onAdd: () => void;
		onPatch: (id: string, patch: PortPatch) => void;
		onRemove: (id: string) => void;
		/** The port's id is a name code reads: it is edited, and a new one is asked of this, which
		 *  answers why it refuses one (the field then shows the old name again). */
		onRename?: (id: string, next: string) => string | undefined;
	}
	let {
		ports,
		noun,
		max,
		min = 0,
		disabled = false,
		onAdd,
		onPatch,
		onRemove,
		onRename,
	}: Props = $props();

	const AXES = ['x', 'y', 'z', 'w'];
	/** Why the last name typed was refused. */
	let refused = $state('');

	const components = (port: SubgraphPort): (number | undefined)[] => {
		const width = DIMS[port.type];
		const value = port.default;
		if (Array.isArray(value)) return Array.from({ length: width }, (_, i) => value[i]);
		return Array.from({ length: width }, () => value);
	};

	/** Set component `i` of a port's default; all empty clears it, so it reads 0. */
	function setDefault(port: SubgraphPort, i: number, raw: string): void {
		const current = components(port);
		const parsed = raw.trim() === '' ? undefined : Number(raw);
		if (parsed !== undefined && !Number.isFinite(parsed)) return;
		current[i] = parsed;
		const value = current.every((v) => v === undefined)
			? null
			: current.length === 1
				? (current[0] ?? 0)
				: current.map((v) => v ?? 0);
		onPatch(port.id, { default: value });
	}
</script>

<div class="port-list">
	{#each ports as port (port.id)}
		<div class="port" class:named={!!onRename}>
			{#if onRename}
				<input
					type="text"
					class="code"
					aria-label="Name of {port.id} in the code"
					title="The name the code reads it by"
					value={port.id}
					spellcheck="false"
					autocomplete="off"
					{disabled}
					onchange={(e) => {
						const next = e.currentTarget.value.trim();
						refused = next && next !== port.id ? (onRename(port.id, next) ?? '') : '';
						if (refused || !next) e.currentTarget.value = port.id;
					}}
				/>
			{/if}
			<input
				type="text"
				aria-label="Label of {port.id}"
				title="Its label on the node"
				value={port.label}
				placeholder={port.id}
				{disabled}
				onchange={(e) => onPatch(port.id, { label: e.currentTarget.value })}
			/>
			<select
				aria-label="Type of {port.label || port.id}"
				value={port.type}
				{disabled}
				onchange={(e) => onPatch(port.id, { type: e.currentTarget.value as PortType })}
			>
				{#each SUBGRAPH_PORT_TYPES as type (type)}
					<option value={type}>{type}</option>
				{/each}
			</select>
			<button
				type="button"
				class="x"
				title={ports.length <= min
					? `It keeps at least ${min} ${noun}${min === 1 ? '' : 's'}`
					: `Remove ${port.label || port.id}, and every wire to it`}
				disabled={disabled || ports.length <= min}
				onclick={() => onRemove(port.id)}>✕</button
			>
			<span class="vec" title="Default">
				{#each components(port) as value, i (i)}
					<input
						type="number"
						step="any"
						aria-label="{port.label || port.id} default {AXES[i]}"
						value={value ?? ''}
						placeholder="0"
						{disabled}
						onchange={(e) => setDefault(port, i, e.currentTarget.value)}
					/>
				{/each}
			</span>
		</div>
	{/each}
	{#if refused}
		<p class="refused" role="alert">{refused}</p>
	{/if}
	<button
		type="button"
		disabled={disabled || ports.length >= max}
		title={ports.length >= max ? `At most ${max} ${noun}s` : undefined}
		onclick={onAdd}>+ Add {noun}</button
	>
</div>

<style>
	.port-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.port {
		display: grid;
		grid-template-columns: 1fr 64px auto;
		gap: 4px;
		padding: 4px 0;
		border-bottom: 1px solid #1f2937;
	}
	.port.named {
		grid-template-columns: 1fr 1fr 64px auto;
	}
	.vec {
		grid-column: 1 / -1;
		display: flex;
		gap: 4px;
	}
	input,
	select {
		min-width: 0;
		width: 100%;
		font-size: 12px;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 4px;
	}
	.code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11px;
	}
	button {
		font-size: 11px;
		background: #1f2937;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.x {
		padding: 1px 6px;
	}
	.refused {
		margin: 0;
		font-size: 11px;
		color: #fca5a5;
	}
</style>
