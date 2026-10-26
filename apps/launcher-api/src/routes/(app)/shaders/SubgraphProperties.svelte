<script lang="ts">
	import {
		SUBGRAPH_CALL,
		SUBGRAPH_IN,
		SUBGRAPH_PORTS_MAX,
		calledSubgraph,
		subgraphName,
		subgraphOf,
		type GraphNode,
		type ShaderGraphDoc,
	} from 'engine-shadergraph';
	import PortListEditor from './PortListEditor.svelte';
	import {
		addSubgraphPort,
		removeSubgraphPort,
		renameSubgraph,
		setSubgraphPort,
		subgraphCalls,
		type GraphScope,
		type PortSide,
	} from './shaderEditor';

	// Below the selected node's settings when it is a subgraph's: a call (its subgraph's name, Open,
	// Ungroup) or a body's Input or Output, where the subgraph's inputs or outputs are edited: added,
	// removed, renamed, retyped and given a default. A port keeps its id, so wires keep it.
	interface Props {
		doc: ShaderGraphDoc;
		scope: GraphScope;
		node: GraphNode;
		disabled?: boolean;
		onChange: (next: ShaderGraphDoc) => void;
		onOpen: (id: string) => void;
		onUngroup: (node: string) => void;
	}
	let { doc, scope, node, disabled = false, onChange, onOpen, onUngroup }: Props = $props();

	const isCall = $derived(node.type === SUBGRAPH_CALL);
	const sub = $derived(subgraphOf(doc, isCall ? calledSubgraph(node) : scope));
	const side = $derived<PortSide>(node.type === SUBGRAPH_IN ? 'inputs' : 'outputs');
	const calls = $derived(sub ? subgraphCalls(doc, sub.id).length : 0);
</script>

<section class="subgraph-props">
	{#if !sub}
		<p class="warn">
			{isCall
				? `This call names a subgraph the effect does not have ("${calledSubgraph(node) ?? ''}").`
				: 'This subgraph is gone.'}
		</p>
	{:else if isCall}
		<h4>Subgraph</h4>
		<label class="field">
			<span>Name</span>
			<input
				type="text"
				value={sub.name}
				{disabled}
				onchange={(e) => onChange(renameSubgraph(doc, sub.id, e.currentTarget.value))}
			/>
		</label>
		<p class="hint">
			Called {calls} time{calls === 1 ? '' : 's'}: editing it changes every call. Its inputs and
			outputs are edited on its Input and Output nodes inside.
		</p>
		<div class="row">
			<button type="button" onclick={() => onOpen(sub.id)}>Open {subgraphName(sub)}</button>
			<button type="button" {disabled} onclick={() => onUngroup(node.id)}>Ungroup</button>
		</div>
	{:else}
		<h4>{side === 'inputs' ? 'Inputs' : 'Outputs'} of {subgraphName(sub)}</h4>
		<p class="hint">
			{side === 'inputs'
				? 'Each is a port on every call. A call left unwired there reads the value set on it, else the default here, else 0.'
				: 'Each is a port on every call. One left unwired here gives its default, else 0.'}
		</p>
		<PortListEditor
			ports={sub[side]}
			noun={side === 'inputs' ? 'input' : 'output'}
			max={SUBGRAPH_PORTS_MAX}
			{disabled}
			onAdd={() => onChange(addSubgraphPort(doc, sub.id, side))}
			onPatch={(port, patch) => onChange(setSubgraphPort(doc, sub.id, side, port, patch))}
			onRemove={(port) => onChange(removeSubgraphPort(doc, sub.id, side, port))}
		/>
	{/if}
</section>

<style>
	.subgraph-props {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	h4 {
		margin: 8px 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #5eead4;
	}
	.field {
		display: grid;
		grid-template-columns: 110px 1fr;
		align-items: center;
		gap: 8px;
	}
	input {
		min-width: 0;
		width: 100%;
		font-size: 12px;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 4px;
	}
	.row {
		display: flex;
		gap: 6px;
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
	.hint {
		margin: 0;
		color: #94a3b8;
	}
	.warn {
		margin: 0;
		color: #fca5a5;
	}
</style>
