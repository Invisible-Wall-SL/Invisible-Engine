<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import {
		derivePins,
		type Node as FlowNode,
		type Pin,
		type PinContext,
		type PinScope,
	} from 'engine-flow-v2';
	import { typeColor, typeLabel } from './palette';

	// A v2 graph node. Its pins are DERIVED (§2 anti-drift rule) — never hand-stored — by
	// calling `derivePins(node, ctx)` with the template vocabulary + function library, so a
	// node can never render pins that disagree with the effect it calls. Exec pins are white
	// control triangles; data pins are colored dots typed by their `TypeRef`. The header is
	// colored by node kind.
	type Data = {
		node: FlowNode;
		ctx: PinContext;
		/** The node's graph-resolved scope (`deriveGraphPins`) — the enclosing loop's element type +
		 *  the types of its edge-fed data-ins, neither of which is readable from the node alone. */
		scope?: PinScope;
		title: string;
		/** Group nodes only — commit an inline header rename (double-click the title). */
		onRename?: (label: string) => void;
	};
	let { data, selected }: NodeProps = $props();
	// REACTIVE: `data` is a prop that xyflow replaces when the canvas re-seeds after an edit, so `d`
	// MUST track it (a plain `const d = data` snapshots the first value → the header/pins go stale
	// until a remount, i.e. "you have to refresh to see a rename").
	const d = $derived(data as Data);

	// Inline rename (group nodes): double-click the title → edit in place → Enter/blur commits.
	let editing = $state(false);
	let draft = $state('');
	const startRename = (e: MouseEvent) => {
		if (!d.onRename) return;
		e.stopPropagation();
		draft = d.title;
		editing = true;
	};
	const commitRename = () => {
		if (editing) d.onRename?.(draft);
		editing = false;
	};
	const focusSelect = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};

	// Header hue per node kind — exec-carrying nodes read in kind-distinct colors so the
	// graph's control shape is legible; pure `compute` and `event` stand apart.
	const KIND_COLOR: Record<string, string> = {
		event: '#22c55e', // entry point — green.
		gameSignals: '#2dd4bf', // mechanic-signal source — teal.
		action: '#f59e0b', // template effect/command — amber.
		fireCue: '#a855f7', // broadcast a cue — violet.
		delay: '#0ea5e9', // latent wait — sky.
		branch: '#ec4899', // if/else — pink.
		forEach: '#10b981', // loop — teal.
		showContainer: '#6366f1',
		hideContainer: '#6366f1',
		textMessage: '#38bdf8', // presentation leaf (own text) — sky, matching the palette accent.
		playCinematic: '#38bdf8', // presentation leaf (plays a /rigger cinematic) — sky, its kin.
		functionCall: '#eab308', // reusable sub-graph — gold.
		sequence: '#64748b',
		parallel: '#64748b',
		compute: '#94a3b8', // pure value op — slate.
		group: '#fb923c', // inline container fold — warm orange.
		functionEntry: '#22d3ee', // function body start — cyan.
		functionResult: '#22d3ee', // function body end — cyan.
	};

	const headerColor = $derived(KIND_COLOR[d.node.kind] ?? '#64748b');

	// Derive the node's pins from its stored reference + the vocabulary/library + its graph scope.
	const pins = $derived<Pin[]>(derivePins(d.node, d.ctx, d.scope));

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
			case 'textMessage': {
				// A leaf that carries its own content (no ref) — preview the authored line, quoted, plus
				// the state-gate when one is set (`none` ⇒ flow-driven only, so nothing to show). Mirrors
				// how show/hideContainer surface their `ref` under the header. The derived Show/Hide/exec
				// pins render below via the generic pin loop.
				const preview = n.text.trim() || '(empty)';
				const gate = n.visibleWhile && n.visibleWhile !== 'none' ? ` · while ${n.visibleWhile}` : '';
				return `“${preview}”${gate}`;
			}
			case 'playCinematic': {
				// Names the cinematic it plays plus the two things that change how the flow BEHAVES
				// around it: whether it loops, and whether the chain waits. Both matter at a glance —
				// `await` is a hold, and `loop` + await is the deadlock the validator errors on.
				const mods = [n.loop ? 'loop' : null, n.awaitComplete && !n.loop ? 'await' : null]
					.filter(Boolean)
					.join(' · ');
				return `${n.ref || '(none)'}${mods ? ` · ${mods}` : ''}`;
			}
			case 'gameSignals':
				// Ref-less source node — summarise by the count of surfaced mechanic signals (the
				// derived exec-out pins), so the header reads without a `ref`.
				return `${outputs.filter((p) => p.kind === 'exec').length} mechanic signals`;
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
			case 'group':
				return `${inputs.length} in · ${outputs.length} out`;
			case 'functionEntry':
				return 'inputs →';
			case 'functionResult':
				return '→ outputs';
			default:
				return '';
		}
	});
</script>

<div class="v2-node" class:selected style="--kind:{headerColor}">
	<header style="background:{headerColor}22; border-bottom-color:{headerColor}55;">
		<span class="kind" style="color:{headerColor}">{d.node.kind}</span>
		{#if editing}
			<input
				class="title-edit nodrag"
				value={draft}
				oninput={(e) => (draft = e.currentTarget.value)}
				onblur={commitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') commitRename();
					else if (e.key === 'Escape') editing = false;
				}}
				use:focusSelect
			/>
		{:else}
			<span
				class="title"
				class:renamable={!!d.onRename}
				title={d.onRename ? 'Double-click to rename' : d.title}
				ondblclick={startRename}>{d.title}</span
			>
		{/if}
	</header>
	{#if refLine}<div class="ref" title={refLine}>{refLine}</div>{/if}

	<div class="pins">
		<ul class="col in">
			{#each inputs as pin (pin.id + ':in')}
				<li
					class:exec={pin.kind === 'exec'}
					class:has-tip={!!pin.doc}
					title={pin.doc ? undefined : pinLabel(pin)}
				>
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
					{@render pinTip(pin, 'in')}
				</li>
			{/each}
		</ul>
		<ul class="col out">
			{#each outputs as pin (pin.id + ':out')}
				<li
					class:exec={pin.kind === 'exec'}
					class:has-tip={!!pin.doc}
					title={pin.doc ? undefined : pinLabel(pin)}
				>
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
					{@render pinTip(pin, 'out')}
				</li>
			{/each}
		</ul>
	</div>
</div>

<!-- Per-pin help tooltip (a hover card, theme-styled) — only rendered for pins that carry a `doc`
	 (the game-signal / event pins whose vocabulary declares a description). `side` places it clear of
	 the node: input pins open leftward, output pins rightward. -->
{#snippet pinTip(pin: Pin, side: 'in' | 'out')}
	{#if pin.doc}
		<div class="tip tip-{side}" role="tooltip">
			<div class="tip-head">
				<span class="tip-name">{pinLabel(pin)}</span>
				{#if pin.kind === 'exec'}
					<span class="tip-kind">signal</span>
				{:else if pin.dataType}
					<span class="tip-type" style="color:{pinColor(pin)}">{typeLabel(pin.dataType)}</span>
				{/if}
			</div>
			<p class="tip-doc">{pin.doc}</p>
		</div>
	{/if}
{/snippet}

<style>
	.v2-node {
		min-width: 200px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 8px;
		color: #e2e8f0;
		font-size: 12px;
		/* `visible` so a pin's hover tooltip can extend past the node edge; the header keeps its own
		   rounded top corners so the tint doesn't poke out of the border. */
		overflow: visible;
	}
	/* Raise the hovered node above its neighbours so its tooltip is never covered by another node. */
	.v2-node:hover {
		z-index: 20;
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
		border-radius: 7px 7px 0 0;
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
	.title.renamable {
		cursor: text;
	}
	.title-edit {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		font-weight: 600;
		color: #e2e8f0;
		background: #0b0e13;
		border: 1px solid var(--kind, #2563eb);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.title-edit:focus {
		outline: none;
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

	/* --- Per-pin help tooltip (hover card) ------------------------------------------------ */
	.col li.has-tip {
		cursor: help;
	}
	.tip {
		position: absolute;
		top: 50%;
		z-index: 50;
		width: 232px;
		padding: 8px 10px;
		background: #0b0e13;
		border: 1px solid #2a323d;
		border-left: 2px solid var(--kind, #2dd4bf);
		border-radius: 6px;
		box-shadow: 0 8px 22px #000000aa;
		color: #cbd5e1;
		text-align: left;
		white-space: normal;
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transform: translateY(-50%) scale(0.97);
		transform-origin: center left;
		transition:
			opacity 0.1s ease,
			transform 0.1s ease;
	}
	.tip-in {
		right: 100%;
		margin-right: 14px;
		transform-origin: center right;
	}
	.tip-out {
		left: 100%;
		margin-left: 14px;
	}
	.col li.has-tip:hover .tip {
		opacity: 1;
		visibility: visible;
		transform: translateY(-50%) scale(1);
	}
	.tip-head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 4px;
	}
	.tip-name {
		font-weight: 700;
		font-size: 12px;
		color: #f1f5f9;
	}
	.tip-type {
		font-size: 10px;
		font-weight: 600;
	}
	.tip-kind {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #64748b;
	}
	.tip-doc {
		margin: 0;
		font-size: 11px;
		line-height: 1.45;
		color: #b8c2cf;
	}
</style>
