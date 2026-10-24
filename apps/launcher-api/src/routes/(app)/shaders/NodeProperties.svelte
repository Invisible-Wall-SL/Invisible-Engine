<script lang="ts">
	import ColorField from '$lib/ColorField.svelte';
	import {
		DIMS,
		type GraphNode,
		type NodeDef,
		type PortType,
		type ShaderGraphDoc,
	} from 'engine-shadergraph';
	import { categoryColor } from './shaderEditor';

	// The selected node: what it does, the value each unwired input reads, and its settings. A field
	// left empty clears the value, so the input reads its default again.
	interface Props {
		doc: ShaderGraphDoc;
		node: GraphNode;
		def: NodeDef | undefined;
		/** Its inputs' resolved types (an input that follows the node's type takes its width). */
		inTypes: Record<string, PortType>;
		wired: readonly string[];
		errors: readonly string[];
		disabled?: boolean;
		onValue: (key: string, value: number | number[] | string | undefined) => void;
	}
	let { doc, node, def, inTypes, wired, errors, disabled = false, onValue }: Props = $props();

	const AXES = ['x', 'y', 'z', 'w'];

	/** An input's value as N numbers (its stored value, else its default, else zeros). */
	function numbers(id: string, width: number): (number | undefined)[] {
		const stored = node.values?.[id];
		if (Array.isArray(stored)) return Array.from({ length: width }, (_, i) => stored[i]);
		if (typeof stored === 'number') return Array.from({ length: width }, () => stored);
		return Array.from({ length: width }, () => undefined);
	}

	/** Component `i` of an input's default, if it has a number for one. */
	function defaultComponent(id: string, i: number): number | undefined {
		const port = def?.inputs.find((p) => p.id === id);
		if (port?.default === undefined) return undefined;
		return Array.isArray(port.default) ? port.default[i] : (port.default as number);
	}

	/** What an empty component reads: its default, or the expression the input falls back to. */
	function placeholder(id: string, i: number): string {
		const value = defaultComponent(id, i);
		if (value !== undefined) return String(value);
		return def?.inputs.find((p) => p.id === id)?.defaultExpr ?? '0';
	}

	/** Set component `i` of a width-`width` input; all empty clears it. */
	function setComponent(id: string, width: number, i: number, raw: string): void {
		const current = numbers(id, width);
		const parsed = raw.trim() === '' ? undefined : Number(raw);
		if (parsed !== undefined && !Number.isFinite(parsed)) return;
		current[i] = parsed;
		if (current.every((v) => v === undefined)) return onValue(id, undefined);
		const filled = current.map((v, k) => v ?? defaultComponent(id, k) ?? 0);
		onValue(id, width === 1 ? filled[0] : filled);
	}
</script>

<section class="node-props">
	<header style="--family:{def ? categoryColor(def.category) : '#f87171'}">
		<strong>{def?.label ?? node.type}</strong>
		<span class="muted">{node.id}</span>
	</header>
	{#if def}
		<p class="hint">{def.description}</p>
	{:else}
		<p class="hint warn">
			This build has no "{node.type}" node. Delete it, or open the graph in a newer build.
		</p>
	{/if}
	{#each errors as message, i (i)}
		<p class="hint warn">{message}</p>
	{/each}

	{#if def?.settings?.length}
		<h4>Settings</h4>
		{#each def.settings as setting (setting.id)}
			<label class="field">
				<span>{setting.label}</span>
				{#if setting.kind === 'choice'}
					<select
						value={String(node.values?.[setting.id] ?? setting.default)}
						{disabled}
						onchange={(e) => onValue(setting.id, e.currentTarget.value)}
					>
						{#each setting.options as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				{:else if setting.kind === 'param'}
					<select
						value={String(node.values?.[setting.id] ?? '')}
						{disabled}
						onchange={(e) => onValue(setting.id, e.currentTarget.value || undefined)}
					>
						<option value="">— pick a param —</option>
						{#each doc.params as param (param.id)}
							<option value={param.id}>{param.label} ({param.kind})</option>
						{/each}
					</select>
				{:else if setting.kind === 'number'}
					<input
						type="number"
						step="any"
						value={node.values?.[setting.id] ?? ''}
						placeholder={String(setting.default)}
						{disabled}
						onchange={(e) => {
							const raw = e.currentTarget.value.trim();
							onValue(setting.id, raw === '' ? undefined : Number(raw));
						}}
					/>
				{:else if setting.kind === 'color'}
					<ColorField
						value={String(node.values?.[setting.id] ?? setting.default)}
						{disabled}
						onchange={(hex: string) => onValue(setting.id, hex)}
					/>
				{/if}
			</label>
		{/each}
	{/if}

	{#if def?.inputs.length}
		<h4>Inputs</h4>
		{#each def.inputs as port (port.id)}
			{@const type = inTypes[port.id] ?? (port.type === 'any' ? 'float' : port.type)}
			{@const width = DIMS[type]}
			<div class="field">
				<span>{port.label} <em class="muted">{type}</em></span>
				{#if wired.includes(port.id)}
					<span class="muted">wired</span>
				{:else}
					<span class="vec">
						{#each numbers(port.id, width) as value, i (i)}
							<input
								type="number"
								step="any"
								aria-label="{port.label} {AXES[i]}"
								value={value ?? ''}
								placeholder={placeholder(port.id, i)}
								{disabled}
								onchange={(e) => setComponent(port.id, width, i, e.currentTarget.value)}
							/>
						{/each}
					</span>
				{/if}
			</div>
		{/each}
	{/if}
</section>

<style>
	.node-props {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding-left: 8px;
		border-left: 3px solid var(--family);
	}
	h4 {
		margin: 8px 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.field {
		display: grid;
		grid-template-columns: 110px 1fr;
		align-items: center;
		gap: 8px;
	}
	.vec {
		display: flex;
		gap: 4px;
	}
	.vec input,
	.field input,
	.field select {
		min-width: 0;
		width: 100%;
		font-size: 12px;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 4px;
	}
	.hint {
		margin: 0;
		color: #94a3b8;
	}
	.warn {
		color: #fca5a5;
	}
	.muted {
		color: #64748b;
		font-style: normal;
	}
</style>
