<script lang="ts">
	// Invisible Flow v2 — the Variables panel (`docs/design/game-families.md` §3.1–§3.2). Declares
	// the open section's game variables (the Global tab: `game` and `round` ones; a mode's tab: that
	// mode's own, reset each time it is entered) and, on the Global tab, the key map `onInput` nodes
	// read. A component input binds a variable as the value source `var:<id>`. Every edit hands back a
	// whole doc; the page autosaves it like a node edit.
	import type { FlowDoc, FlowInputBinding, FlowVariable, FlowVariableType } from 'engine-flow-v2';
	import { renameVariable, setInputBindings, setVariables } from './graphOps';

	let {
		doc,
		modeId,
		modeLabel,
		onchange,
	}: {
		doc: FlowDoc;
		/** The open mode tab, or `null` for the Global tab. */
		modeId: string | null;
		modeLabel?: (modeId: string) => string;
		onchange: (next: FlowDoc) => void;
	} = $props();

	const TYPES: FlowVariableType[] = ['int', 'float', 'bool', 'string', 'enum'];

	const variables = $derived<FlowVariable[]>(
		(modeId === null ? doc.variables : doc.modes?.[modeId]?.variables) ?? [],
	);
	const inputs = $derived<FlowInputBinding[]>(doc.inputs ?? []);
	/** Every id the doc already declares, in any section — a new id avoids them all. */
	const takenIds = $derived(
		new Set([
			...(doc.variables ?? []).map((v) => v.id),
			...Object.values(doc.modes ?? {}).flatMap((m) => (m?.variables ?? []).map((v) => v.id)),
		]),
	);

	/** The initial a variable of `type` starts at when nothing else is set. */
	const initialFor = (type: FlowVariableType, values: string[] = []): number | boolean | string =>
		type === 'bool' ? false : type === 'string' ? '' : type === 'enum' ? (values[0] ?? '') : 0;

	function write(next: FlowVariable[]): void {
		renameError = null;
		onchange(setVariables(doc, modeId, next));
	}
	function patch(i: number, change: Partial<FlowVariable>): void {
		write(variables.map((v, j) => (j === i ? { ...v, ...change } : v)));
	}
	/** Rename variable `i` and every node that names or reads it. An empty id, or one the doc already
	 *  declares, is refused (the field goes back to the old id). */
	let renameError = $state<string | null>(null);
	function rename(i: number, raw: string, field: HTMLInputElement): void {
		const from = variables[i].id;
		const to = raw.trim();
		if (to === from) return;
		if (!from || !to || takenIds.has(to)) {
			renameError = to ? `"${to}" is already a variable.` : 'A variable needs an id.';
			field.value = from;
			return;
		}
		renameError = null;
		onchange(renameVariable(doc, from, to));
	}
	function add(): void {
		let n = variables.length + 1;
		while (takenIds.has(`var${n}`)) n += 1;
		write([
			...variables,
			{ id: `var${n}`, type: 'int', initial: 0, scope: modeId === null ? 'game' : 'mode' },
		]);
	}
	function setType(i: number, type: FlowVariableType): void {
		const v = variables[i];
		const values = type === 'enum' ? (v.values?.length ? v.values : ['a', 'b']) : undefined;
		const next: FlowVariable = {
			id: v.id,
			type,
			initial: initialFor(type, values),
			scope: v.scope,
		};
		if (values) next.values = values;
		write(variables.map((w, j) => (j === i ? next : w)));
	}
	function setValues(i: number, raw: string): void {
		const values = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const v = variables[i];
		patch(i, {
			values,
			initial: values.includes(String(v.initial)) ? v.initial : (values[0] ?? ''),
		});
	}
	function setInitial(i: number, raw: string | boolean): void {
		const v = variables[i];
		if (v.type === 'bool') patch(i, { initial: raw === true });
		else if (v.type === 'int' || v.type === 'float') {
			const n = Number(raw);
			patch(i, { initial: Number.isFinite(n) ? (v.type === 'int' ? Math.trunc(n) : n) : 0 });
		} else patch(i, { initial: String(raw) });
	}

	function writeInputs(next: FlowInputBinding[]): void {
		onchange(setInputBindings(doc, next));
	}
	function addInput(): void {
		let n = inputs.length + 1;
		while (inputs.some((b) => b.action === `action${n}`)) n += 1;
		writeInputs([...inputs, { action: `action${n}`, keys: [] }]);
	}
	/** The keys typed as a comma list (`KeyboardEvent.key` names; `Space` is the space bar). */
	const keysOf = (raw: string): string[] =>
		raw
			.split(',')
			.map((k) => k.trim())
			.filter(Boolean)
			.map((k) => (k === 'Space' ? ' ' : k));
	const keysText = (keys: string[]): string =>
		keys.map((k) => (k === ' ' ? 'Space' : k)).join(', ');
</script>

<section class="vars">
	<div class="head">
		<h3>Variables</h3>
		<button type="button" class="add" onclick={add}>+ Add</button>
	</div>
	<p class="hint">
		{#if modeId === null}
			Values the game keeps: score, lives, moves. <strong>round</strong> ones restart each spin.
		{:else}
			Values only <code>{modeLabel?.(modeId) ?? modeId}</code> uses, restarted each time it starts.
		{/if}
		A component input follows one as <code>var:&lt;id&gt;</code>; renaming one here does not change
		those.
	</p>
	{#if renameError}
		<p class="error">{renameError}</p>
	{/if}
	{#each variables as v, i (i)}
		<div class="var">
			<div class="line">
				<input
					class="id"
					type="text"
					value={v.id}
					aria-label="Variable id"
					onchange={(e) => rename(i, e.currentTarget.value, e.currentTarget)}
				/>
				<select
					value={v.type}
					aria-label="Type"
					onchange={(e) => setType(i, e.currentTarget.value as FlowVariableType)}
				>
					{#each TYPES as t (t)}
						<option value={t}>{t}</option>
					{/each}
				</select>
				{#if modeId === null}
					<select
						value={v.scope}
						aria-label="Scope"
						onchange={(e) => patch(i, { scope: e.currentTarget.value as 'game' | 'round' })}
					>
						<option value="game">game</option>
						<option value="round">round</option>
					</select>
				{/if}
				<button
					type="button"
					class="rm"
					title="Remove this variable"
					onclick={() => write(variables.filter((_, j) => j !== i))}>✕</button
				>
			</div>
			<div class="line">
				{#if v.type === 'enum'}
					<input
						class="grow"
						type="text"
						value={(v.values ?? []).join(', ')}
						placeholder="values, comma separated"
						aria-label="Values"
						onchange={(e) => setValues(i, e.currentTarget.value)}
					/>
					<select
						value={String(v.initial)}
						aria-label="Starts at"
						onchange={(e) => setInitial(i, e.currentTarget.value)}
					>
						{#each v.values ?? [] as value (value)}
							<option {value}>{value}</option>
						{/each}
					</select>
				{:else if v.type === 'bool'}
					<label class="start">
						<input
							type="checkbox"
							checked={v.initial === true}
							onchange={(e) => setInitial(i, e.currentTarget.checked)}
						/>
						starts on
					</label>
				{:else}
					<label class="start grow">
						starts at
						<input
							type={v.type === 'string' ? 'text' : 'number'}
							step={v.type === 'int' ? '1' : 'any'}
							value={String(v.initial)}
							onchange={(e) => setInitial(i, e.currentTarget.value)}
						/>
					</label>
				{/if}
			</div>
		</div>
	{:else}
		<p class="empty">No variables.</p>
	{/each}

	{#if modeId === null}
		<div class="head keys-head">
			<h4>Key map</h4>
			<button type="button" class="add" onclick={addInput}>+ Add</button>
		</div>
		<p class="hint">
			An <strong>On input</strong> node reads an action, never a key, so a rebind leaves the graph alone.
		</p>
		{#each inputs as b, i (i)}
			<div class="line">
				<input
					class="id"
					type="text"
					value={b.action}
					aria-label="Action"
					onchange={(e) =>
						writeInputs(
							inputs.map((w, j) => (j === i ? { ...w, action: e.currentTarget.value.trim() } : w)),
						)}
				/>
				<input
					class="grow"
					type="text"
					value={keysText(b.keys)}
					placeholder="keys: ArrowLeft, a, Space"
					aria-label="Keys"
					onchange={(e) =>
						writeInputs(
							inputs.map((w, j) => (j === i ? { ...w, keys: keysOf(e.currentTarget.value) } : w)),
						)}
				/>
				<button
					type="button"
					class="rm"
					title="Remove this action"
					onclick={() => writeInputs(inputs.filter((_, j) => j !== i))}>✕</button
				>
			</div>
		{/each}
	{/if}
</section>

<style>
	.vars {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 10px 0;
		font-size: 12px;
		color: #cbd5e1;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.head h3,
	.head h4 {
		margin: 0;
	}
	.keys-head {
		margin-top: 8px;
	}
	.error {
		margin: 0;
		font-size: 11px;
		color: #f87171;
	}
	.hint,
	.empty {
		margin: 0;
		font-size: 11px;
		color: #64748b;
	}
	.var {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border: 1px solid #1f2937;
		border-radius: 6px;
		background: #11161d;
	}
	.line {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.id {
		width: 7em;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.start {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #94a3b8;
	}
	.start input[type='number'],
	.start input[type='text'] {
		flex: 1;
		min-width: 0;
	}
	input[type='text'],
	input[type='number'],
	select {
		background: #0b0f14;
		border: 1px solid #2a323d;
		border-radius: 4px;
		color: #e2e8f0;
		font: inherit;
		font-size: 12px;
		padding: 3px 5px;
	}
	.add,
	.rm {
		background: #1f2937;
		border: 1px solid #2a323d;
		border-radius: 4px;
		color: #e2e8f0;
		font: inherit;
		font-size: 11px;
		padding: 2px 8px;
		cursor: pointer;
	}
	.rm {
		padding: 2px 6px;
	}
</style>
