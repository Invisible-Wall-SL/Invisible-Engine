<script lang="ts">
	// Invisible Flow v2 — the node inspector (Phase 2b.2). Given the SELECTED node, its
	// `PinContext` (template vocabulary + function library), and the doc's containers, it
	// renders a kind-specific editor so every node becomes fully authorable — clearing the
	// `unfilled-data-in` warnings a freshly-added node validates with. It NEVER touches pins
	// (those stay derived by `derivePins`) or edges (that's the wiring loop) — only a node's
	// stored REFERENCE / per-kind fields / data-source `inputs`, via the pure `graphOps`
	// setters. Each edit calls `onchange(nextDoc)`; the page re-seeds + revalidates + autosaves.
	import {
		derivePins,
		type Accessor,
		type CompareOp,
		type ComputeOp,
		type ContainerRef,
		type DataSource,
		type Guard,
		type Node as V2Node,
		type Pin,
		type PinContext,
		type TypeRef,
	} from 'engine-flow-v2';
	import {
		setBranchGuard,
		setComputeOp,
		setCount,
		setForEachMode,
		setNodeInput,
		setNodeRef,
	} from './graphOps';
	import { typeLabel } from './palette';
	import type { FlowDoc } from 'engine-flow-v2';

	let {
		doc,
		node,
		ctx,
		onchange,
	}: {
		doc: FlowDoc;
		node: V2Node;
		ctx: PinContext;
		onchange: (next: FlowDoc) => void;
	} = $props();

	const vocab = $derived(ctx.vocab);

	// The node's derived pins — the summary + the DATA-IN editor list both read from these.
	const pins = $derived<Pin[]>(derivePins(node, ctx));
	const dataIns = $derived(pins.filter((p) => p.dir === 'in' && p.kind === 'data'));

	// A data-in that is FED BY A WIRE (an incoming data edge) is set by that wire, so it is
	// skipped by the source editor; only free data-ins expose a literal/accessor editor.
	const wiredIn = (pinId: string): boolean =>
		doc.graph.data.some((e) => e.to.node === node.id && e.to.pin === pinId);

	// The current DataSource for a node data-in: its stored `inputs[pinId]`, else a default
	// literal typed by the pin (so a fresh pin starts editable, not blank).
	const sourceFor = (pin: Pin): DataSource => {
		const stored = node.inputs?.[pin.id];
		if (stored && stored.kind !== 'wire') return stored;
		return defaultLiteral(pin.dataType);
	};

	// --- ref-carrying editors --------------------------------------------------
	const isRefKind = $derived(
		node.kind === 'event' ||
			node.kind === 'action' ||
			node.kind === 'fireCue' ||
			node.kind === 'functionCall' ||
			node.kind === 'showContainer' ||
			node.kind === 'hideContainer',
	);

	// The valid refs for a ref-carrying kind, projected from the vocab / library / containers.
	const refOptions = $derived.by((): { value: string; label: string }[] => {
		switch (node.kind) {
			case 'event':
				return vocab.events.map((e) => ({ value: e.name, label: e.name }));
			case 'action':
				return vocab.actions.map((a) => ({ value: a.name, label: `${a.name} · ${a.category}` }));
			case 'fireCue':
				return vocab.cues.map((c) => ({ value: c.name, label: c.name }));
			case 'functionCall':
				return ctx.library.functions.map((f) => ({ value: f.id, label: f.name }));
			case 'showContainer':
			case 'hideContainer':
				return doc.containers.map((c: ContainerRef) => ({
					value: c.id,
					label: `${c.id} (${c.sceneId})`,
				}));
			default:
				return [];
		}
	});

	const currentRef = $derived(isRefKind ? ((node as { ref?: string }).ref ?? '') : '');

	function onRefChange(value: string): void {
		onchange(setNodeRef(doc, node.id, value));
	}

	// --- forEach ---------------------------------------------------------------
	function onModeChange(mode: 'sequence' | 'parallel'): void {
		onchange(setForEachMode(doc, node.id, mode));
	}

	// --- sequence / parallel ---------------------------------------------------
	function onCountChange(value: number): void {
		if (!Number.isFinite(value)) return;
		onchange(setCount(doc, node.id, value));
	}

	// --- data-in source editing ------------------------------------------------
	function onInputChange(pinId: string, src: DataSource | undefined): void {
		onchange(setNodeInput(doc, node.id, pinId, src));
	}

	// --- compute ---------------------------------------------------------------
	const COMPUTE_OPS = ['add', 'sub', 'mul', 'div', 'member'] as const;
	const isArith = (op: ComputeOp['op']): boolean => op !== 'member';

	function onComputeOpChange(op: ComputeOp['op']): void {
		if (node.kind !== 'compute') return;
		const cur = node.compute;
		let next: ComputeOp;
		if (op === 'member') {
			const on = cur.op === 'member' ? cur.on : 'a' in cur ? cur.a : defaultLiteral({ t: 'int' });
			const member = cur.op === 'member' ? cur.member : '';
			next = { op: 'member', on, member };
		} else {
			const a = cur.op === 'member' ? cur.on : cur.a;
			const b = cur.op === 'member' ? defaultLiteral({ t: 'int' }) : cur.b;
			next = { op, a, b };
		}
		onchange(setComputeOp(doc, node.id, next));
	}

	function onComputeOperand(which: 'a' | 'b' | 'on', src: DataSource): void {
		if (node.kind !== 'compute') return;
		const cur = node.compute;
		let next: ComputeOp;
		if (cur.op === 'member') {
			next = which === 'on' ? { ...cur, on: src } : cur;
		} else {
			next = which === 'a' ? { ...cur, a: src } : which === 'b' ? { ...cur, b: src } : cur;
		}
		onchange(setComputeOp(doc, node.id, next));
	}

	function onComputeMember(member: string): void {
		if (node.kind !== 'compute' || node.compute.op !== 'member') return;
		onchange(setComputeOp(doc, node.id, { ...node.compute, member }));
	}

	// --- branch guard ----------------------------------------------------------
	const COMPARE_OPS: CompareOp[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
	const guardRows = $derived(node.kind === 'branch' ? (node.guard.all ?? []) : []);

	function writeGuard(all: Guard['all']): void {
		if (node.kind !== 'branch') return;
		const guard: Guard = { ...node.guard, all };
		onchange(setBranchGuard(doc, node.id, guard));
	}
	function addGuardRow(): void {
		if (node.kind !== 'branch') return;
		const rows = [...(node.guard.all ?? [])];
		rows.push({
			left: defaultLiteral({ t: 'int' }),
			op: 'eq',
			right: defaultLiteral({ t: 'int' }),
		});
		writeGuard(rows);
	}
	function removeGuardRow(i: number): void {
		if (node.kind !== 'branch') return;
		const rows = (node.guard.all ?? []).filter((_, k) => k !== i);
		writeGuard(rows);
	}
	function setGuardOp(i: number, op: CompareOp): void {
		if (node.kind !== 'branch') return;
		const rows = (node.guard.all ?? []).map((r, k) => (k === i ? { ...r, op } : r));
		writeGuard(rows);
	}
	function setGuardSide(i: number, side: 'left' | 'right', src: DataSource): void {
		if (node.kind !== 'branch') return;
		const rows = (node.guard.all ?? []).map((r, k) => (k === i ? { ...r, [side]: src } : r));
		writeGuard(rows);
	}

	// --- DataSource helpers ----------------------------------------------------
	// A sensible default literal for a `TypeRef` (or an untyped fallback), used to seed a fresh
	// operand / data-in so the editor is never blank.
	function defaultLiteral(type: TypeRef | undefined): DataSource {
		const t = type ?? { t: 'int' };
		switch (t.t) {
			case 'bool':
				return { kind: 'literal', type: t, value: false };
			case 'string':
				return { kind: 'literal', type: t, value: '' };
			case 'enum': {
				const decl = vocab.enums.find((e) => e.name === t.name);
				return { kind: 'literal', type: t, value: decl?.values[0] ?? '' };
			}
			case 'struct':
			case 'list':
				// Structs/lists cannot be literals — they must be wired. Default to a wire.
				return { kind: 'wire' };
			default:
				return { kind: 'literal', type: t, value: 0 };
		}
	}
</script>

<div class="inspector">
	<div class="summary">
		<div class="head">
			<span class="kind">{node.kind}</span>
			<span class="id" title={node.id}>{node.id}</span>
		</div>
		<ul class="pinlist">
			{#each pins as p (p.dir + ':' + p.kind + ':' + p.id)}
				<li>
					<span class="pdir">{p.dir}</span>
					<span class="pkind {p.kind}">{p.kind}</span>
					<span class="pid">{p.label ?? p.id}</span>
					{#if p.dataType}<span class="ptype">{typeLabel(p.dataType)}</span>{/if}
				</li>
			{/each}
		</ul>
	</div>

	<div class="fields">
		{#if isRefKind}
			<label class="field">
				<span class="flabel">Reference</span>
				<select value={currentRef} onchange={(e) => onRefChange(e.currentTarget.value)}>
					<option value="" disabled>— choose —</option>
					{#each refOptions as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if node.kind === 'forEach'}
			<label class="field">
				<span class="flabel">Mode</span>
				<select
					value={node.mode}
					onchange={(e) =>
						onModeChange(e.currentTarget.value === 'parallel' ? 'parallel' : 'sequence')}
				>
					<option value="sequence">sequence</option>
					<option value="parallel">parallel</option>
				</select>
			</label>
		{/if}

		{#if node.kind === 'sequence' || node.kind === 'parallel'}
			<label class="field">
				<span class="flabel">Count</span>
				<input
					type="number"
					min="1"
					step="1"
					value={node.count}
					onchange={(e) => onCountChange(Number(e.currentTarget.value))}
				/>
			</label>
		{/if}

		{#if node.kind === 'compute'}
			<label class="field">
				<span class="flabel">Op</span>
				<select
					value={node.compute.op}
					onchange={(e) => onComputeOpChange(e.currentTarget.value as ComputeOp['op'])}
				>
					{#each COMPUTE_OPS as op (op)}
						<option value={op}>{op}</option>
					{/each}
				</select>
			</label>
			{#if isArith(node.compute.op) && node.compute.op !== 'member'}
				<div class="field">
					<span class="flabel">a</span>
					{@render dataSourceEditor(
						node.compute.a,
						undefined,
						(s) => onComputeOperand('a', s),
						false,
					)}
				</div>
				<div class="field">
					<span class="flabel">b</span>
					{@render dataSourceEditor(
						node.compute.b,
						undefined,
						(s) => onComputeOperand('b', s),
						false,
					)}
				</div>
			{:else if node.compute.op === 'member'}
				<div class="field">
					<span class="flabel">on</span>
					{@render dataSourceEditor(
						node.compute.on,
						undefined,
						(s) => onComputeOperand('on', s),
						false,
					)}
				</div>
				<label class="field">
					<span class="flabel">member</span>
					<input
						type="text"
						value={node.compute.member}
						placeholder="field name"
						onchange={(e) => onComputeMember(e.currentTarget.value)}
					/>
				</label>
			{/if}
		{/if}

		{#if node.kind === 'branch'}
			<div class="guard">
				<div class="ghead">
					<span class="flabel">Guard · all of</span>
					<button class="mini" type="button" onclick={addGuardRow}>+ add</button>
				</div>
				{#if guardRows.length === 0}
					<p class="empty">No comparisons — the branch always takes <code>then</code>.</p>
				{/if}
				{#each guardRows as row, i (i)}
					<div class="grow">
						<div class="side">
							{@render dataSourceEditor(
								row.left,
								undefined,
								(s) => setGuardSide(i, 'left', s),
								false,
							)}
						</div>
						<select
							class="op"
							value={row.op}
							onchange={(e) => setGuardOp(i, e.currentTarget.value as CompareOp)}
						>
							{#each COMPARE_OPS as op (op)}
								<option value={op}>{op}</option>
							{/each}
						</select>
						<div class="side">
							{@render dataSourceEditor(
								row.right,
								undefined,
								(s) => setGuardSide(i, 'right', s),
								false,
							)}
						</div>
						<button class="mini rm" type="button" onclick={() => removeGuardRow(i)} title="remove"
							>✕</button
						>
					</div>
				{/each}
			</div>
		{/if}

		{#if dataIns.length > 0}
			<div class="datains">
				<span class="flabel">Inputs</span>
				{#each dataIns as pin (pin.id)}
					{#if wiredIn(pin.id)}
						<div class="field wired">
							<span class="pinname">{pin.label ?? pin.id}</span>
							<span class="wiredtag">wired</span>
						</div>
					{:else}
						<div class="field">
							<span class="pinname"
								>{pin.label ?? pin.id}{#if pin.dataType}<span class="ptype"
										>{typeLabel(pin.dataType)}</span
									>{/if}</span
							>
							{@render dataSourceEditor(
								sourceFor(pin),
								pin.dataType,
								(s) => onInputChange(pin.id, s),
								true,
							)}
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>

{#snippet dataSourceEditor(
	src: DataSource,
	type: TypeRef | undefined,
	commit: (s: DataSource) => void,
	allowWire: boolean,
)}
	{@const mode = src.kind}
	<div class="dse">
		<select
			class="dse-mode"
			value={mode === 'wire' ? 'wire' : mode}
			onchange={(e) => {
				const v = e.currentTarget.value;
				if (v === 'literal') commit(defaultLiteral(type));
				else if (v === 'accessor') commit({ kind: 'accessor', path: { on: 'index' } });
				else commit({ kind: 'wire' });
			}}
		>
			{#if allowWire}<option value="wire">wire</option>{/if}
			<option value="literal">literal</option>
			<option value="accessor">accessor</option>
		</select>

		{#if src.kind === 'literal'}
			{@const lt = src.type}
			{#if lt.t === 'bool'}
				<input
					type="checkbox"
					checked={src.value === true}
					onchange={(e) => commit({ kind: 'literal', type: lt, value: e.currentTarget.checked })}
				/>
			{:else if lt.t === 'string'}
				<input
					type="text"
					value={String(src.value ?? '')}
					onchange={(e) => commit({ kind: 'literal', type: lt, value: e.currentTarget.value })}
				/>
			{:else if lt.t === 'enum'}
				<select
					value={String(src.value ?? '')}
					onchange={(e) => commit({ kind: 'literal', type: lt, value: e.currentTarget.value })}
				>
					{#each vocab.enums.find((en) => en.name === lt.name)?.values ?? [] as v (v)}
						<option value={v}>{v}</option>
					{/each}
				</select>
			{:else if lt.t === 'struct' || lt.t === 'list'}
				<span class="note">{typeLabel(lt)} must be wired</span>
			{:else}
				<input
					type="number"
					value={Number(src.value ?? 0)}
					step={lt.t === 'float' ? 'any' : '1'}
					onchange={(e) =>
						commit({ kind: 'literal', type: lt, value: Number(e.currentTarget.value) })}
				/>
			{/if}
		{:else if src.kind === 'accessor'}
			{@render accessorEditor(src.path, (path) => commit({ kind: 'accessor', path }))}
		{/if}
	</div>
{/snippet}

{#snippet accessorEditor(acc: Accessor, commit: (a: Accessor) => void)}
	{@const collections = vocab.collections}
	<div class="acc">
		<select
			class="acc-on"
			value={acc.on}
			onchange={(e) => {
				const on = e.currentTarget.value;
				if (on === 'item') commit({ on: 'item' });
				else if (on === 'index') commit({ on: 'index' });
				else if (on === 'engine') commit({ on: 'engine', key: collections[0]?.name ?? '' });
				else commit({ on: 'input', name: '' });
			}}
		>
			<option value="item">$item</option>
			<option value="index">$index</option>
			<option value="engine">$engine</option>
			<option value="input">$input</option>
		</select>

		{#if acc.on === 'item'}
			<input
				class="acc-detail"
				type="text"
				placeholder="member (optional)"
				value={acc.member ?? ''}
				onchange={(e) => {
					const m = e.currentTarget.value.trim();
					commit(m ? { on: 'item', member: m } : { on: 'item' });
				}}
			/>
		{:else if acc.on === 'engine'}
			<select
				class="acc-detail"
				value={acc.key}
				onchange={(e) => commit({ on: 'engine', key: e.currentTarget.value })}
			>
				{#each collections as c (c.name)}
					<option value={c.name}>{c.name}</option>
				{/each}
			</select>
		{:else if acc.on === 'input'}
			<input
				class="acc-detail"
				type="text"
				placeholder="input name"
				value={acc.name}
				onchange={(e) => commit({ on: 'input', name: e.currentTarget.value.trim() })}
			/>
		{/if}
	</div>
{/snippet}

<style>
	.inspector {
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 12px;
		color: #cbd5e1;
	}
	.summary {
		border: 1px solid #1f2937;
		border-radius: 8px;
		background: #11161d;
		padding: 8px 10px;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 6px;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: #93c5fd;
	}
	.id {
		font-size: 11px;
		color: #94a3b8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pinlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pinlist li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
	}
	.pdir {
		color: #64748b;
		width: 22px;
		flex: none;
	}
	.pkind {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0 4px;
		border-radius: 3px;
		border: 1px solid #2a323d;
		flex: none;
	}
	.pkind.exec {
		color: #e2e8f0;
	}
	.pkind.data {
		color: #38bdf8;
	}
	.pid {
		color: #cbd5e1;
	}
	.ptype {
		font-size: 9px;
		color: #fbbf24;
		margin-left: 4px;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.flabel {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
	}
	.pinname {
		font-size: 11px;
		color: #cbd5e1;
	}
	select,
	input[type='text'],
	input[type='number'] {
		box-sizing: border-box;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 12px;
		padding: 4px 7px;
		width: 100%;
	}
	input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: #2563eb;
	}
	select:focus,
	input:focus {
		outline: none;
		border-color: #2563eb;
	}
	.datains {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid #1f2937;
		padding-top: 10px;
	}
	.field.wired {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.wiredtag {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7ee0c0;
		border: 1px solid #234038;
		border-radius: 999px;
		padding: 1px 7px;
	}
	.dse {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.dse-mode {
		width: auto;
		flex: none;
		min-width: 78px;
	}
	.note {
		font-size: 10px;
		color: #94a3b8;
		font-style: italic;
	}
	.acc {
		display: flex;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}
	.acc-on {
		width: auto;
		flex: none;
		min-width: 72px;
	}
	.acc-detail {
		flex: 1;
		min-width: 0;
	}
	.guard {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid #1f2937;
		padding-top: 10px;
	}
	.ghead {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.empty {
		margin: 0;
		font-size: 11px;
		color: #64748b;
	}
	.empty code {
		color: #93c5fd;
	}
	.grow {
		display: flex;
		flex-direction: column;
		gap: 5px;
		border: 1px solid #1f2937;
		border-radius: 6px;
		padding: 7px;
		position: relative;
	}
	.grow .op {
		width: auto;
		align-self: flex-start;
		min-width: 64px;
	}
	.grow .side {
		width: 100%;
	}
	.mini {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #cbd5e1;
		cursor: pointer;
	}
	.mini:hover {
		border-color: #3a4655;
	}
	.mini.rm {
		position: absolute;
		top: 5px;
		right: 5px;
		padding: 1px 6px;
		color: #fca5a5;
	}
</style>
