<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { derivePins, type Node as FlowNode, type Pin, type PinContext } from 'engine-flow-v2';
	import { typeColor, typeLabel } from './palette';

	// A v2 graph node. Its pins are DERIVED (§2 anti-drift rule) — never hand-stored — by
	// calling `derivePins(node, ctx)` with the template vocabulary + function library, so a
	// node can never render pins that disagree with the effect it calls. Exec pins are white
	// control triangles; data pins are colored dots typed by their `TypeRef`. The header is
	// colored by node kind.
	type Data = {
		node: FlowNode;
		ctx: PinContext;
		title: string;
	};
	let { data, selected }: NodeProps = $props();
	const d = data as Data;

	// Header hue per node kind — exec-carrying nodes read in kind-distinct colors so the
	// graph's control shape is legible; pure `compute` and `event` stand apart.
	const KIND_COLOR: Record<string, string> = {
		event: '#22c55e', // entry point — green.
		action: '#f59e0b', // template effect/command — amber.
		fireCue: '#a855f7', // broadcast a cue — violet.
		delay: '#0ea5e9', // latent wait — sky.
		branch: '#ec4899', // if/else — pink.
		forEach: '#10b981', // loop — teal.
		showContainer: '#6366f1',
		hideContainer: '#6366f1',
		functionCall: '#eab308', // reusable sub-graph — gold.
		sequence: '#64748b',
		parallel: '#64748b',
		compute: '#94a3b8', // pure value op — slate.
	};

	const headerColor = $derived(KIND_COLOR[d.node.kind] ?? '#64748b');

	// Derive the node's pins from its stored reference + the vocabulary/library.
	const pins = $derived<Pin[]>(derivePins(d.node, d.ctx));

	const inputs = $derived(pins.filter((p) => p.dir === 'in'));
	const outputs = $derived(pins.filter((p) => p.dir === 'out'));

	// A short human label for a pin — its own `label`, else its id.
	const pinLabel = (p: Pin): string => p.label ?? p.id;

	// The dot/handle color for a data pin follows its `TypeRef`; exec pins are white.
	const pinColor = (p: Pin): string =>
		p.kind === 'exec' ? '#e2e8f0' : p.dataType ? typeColor(p.dataType) : '#94a3b8';

	// A one-line ref/summary shown under the header (the event/action/cue/function name).
	const refLine = $derived.by((): string => {
		const n = d.node;
		switch (n.kind) {
			case 'event':
			case 'action':
			case 'fireCue':
			case 'functionCall':
				return n.ref;
			case 'showContainer':
			case 'hideContainer':
				return n.ref;
			case 'forEach':
				return `forEach · ${n.mode}`;
			case 'compute':
				return `compute · ${n.compute.op}`;
			case 'delay':
				return 'delay';
			case 'branch':
				return 'branch';
			case 'sequence':
			case 'parallel':
				return `${n.kind} · ${n.count}`;
			default:
				return '';
		}
	});
</script>

<div class="v2-node" class:selected style="--kind:{headerColor}">
	<header style="background:{headerColor}22; border-bottom-color:{headerColor}55;">
		<span class="kind" style="color:{headerColor}">{d.node.kind}</span>
		<span class="title" title={d.title}>{d.title}</span>
	</header>
	{#if refLine}<div class="ref" title={refLine}>{refLine}</div>{/if}

	<div class="pins">
		<ul class="col in">
			{#each inputs as pin (pin.id + ':in')}
				<li class:exec={pin.kind === 'exec'} title={pinLabel(pin)}>
					<Handle
						type="target"
						position={Position.Left}
						id={pin.id}
						class={pin.kind === 'exec' ? 'v2-h exec' : 'v2-h data'}
						style="background:{pinColor(pin)}"
					/>
					{#if pin.kind === 'exec'}
						<span class="glyph" style="color:{pinColor(pin)}">▷</span>
						<span class="plabel">{pinLabel(pin)}</span>
					{:else}
						<span class="dot" style="background:{pinColor(pin)}"></span>
						<span class="plabel">{pinLabel(pin)}</span>
						{#if pin.dataType}<span class="ptype" style="color:{pinColor(pin)}"
								>{typeLabel(pin.dataType)}</span
							>{/if}
					{/if}
				</li>
			{/each}
		</ul>
		<ul class="col out">
			{#each outputs as pin (pin.id + ':out')}
				<li class:exec={pin.kind === 'exec'} title={pinLabel(pin)}>
					{#if pin.kind === 'exec'}
						<span class="plabel">{pinLabel(pin)}</span>
						<span class="glyph" style="color:{pinColor(pin)}">▷</span>
					{:else}
						{#if pin.dataType}<span class="ptype" style="color:{pinColor(pin)}"
								>{typeLabel(pin.dataType)}</span
							>{/if}
						<span class="plabel">{pinLabel(pin)}</span>
						<span class="dot" style="background:{pinColor(pin)}"></span>
					{/if}
					<Handle
						type="source"
						position={Position.Right}
						id={pin.id}
						class={pin.kind === 'exec' ? 'v2-h exec' : 'v2-h data'}
						style="background:{pinColor(pin)}"
					/>
				</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.v2-node {
		min-width: 200px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 8px;
		color: #e2e8f0;
		font-size: 12px;
		overflow: hidden;
	}
	.v2-node.selected {
		border-color: #2563eb;
		box-shadow:
			0 0 0 2px #2563eb66,
			0 6px 18px #00000066;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-bottom: 1px solid #2a323d;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		flex: none;
	}
	.title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 600;
		color: #e2e8f0;
	}
	.ref {
		padding: 4px 10px;
		font-size: 10px;
		color: #94a3b8;
		border-bottom: 1px solid #1f2937;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pins {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		gap: 12px;
	}
	.col {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.col li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 11px;
	}
	.col.out li {
		justify-content: flex-end;
	}
	/* Exec rows read a touch stronger (control flow) than data rows. */
	.col li.exec .plabel {
		color: #e2e8f0;
		font-weight: 600;
	}
	.glyph {
		font-size: 10px;
		line-height: 1;
		flex: none;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.plabel {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 130px;
		color: #cbd5e1;
	}
	.ptype {
		font-size: 9px;
		opacity: 0.85;
		flex: none;
	}
	/* Exec handles render as a square (control), data handles as the default round dot. The
	   v2 CSS class is applied on the Handle so the shape reads without touching xyflow internals. */
	.v2-node :global(.svelte-flow__handle.v2-h.exec) {
		border-radius: 2px;
		width: 9px;
		height: 9px;
	}
	.v2-node :global(.svelte-flow__handle.v2-h.data) {
		border-radius: 50%;
		width: 8px;
		height: 8px;
	}
</style>
