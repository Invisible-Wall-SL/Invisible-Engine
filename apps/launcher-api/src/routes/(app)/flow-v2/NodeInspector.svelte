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
		type PinScope,
		type TextMessageNode,
		type TypeRef,
	} from 'engine-flow-v2';
	import {
		setBranchGuard,
		setComputeOp,
		setCount,
		setForEachMode,
		setGroupLabel,
		setNodeInput,
		setNodeRef,
		setFireCueAwait,
		setShowContainerAwaitComplete,
		setTextMessageFields,
	} from './graphOps';
	import { typeLabel } from './palette';
	import type { FlowDoc } from 'engine-flow-v2';

	let {
		doc,
		node,
		ctx,
		scope,
		onchange,
	}: {
		doc: FlowDoc;
		node: V2Node;
		ctx: PinContext;
		/** The node's graph-resolved scope (`deriveGraphPins`) — so a `forEach.item` fed by wire reads
		 *  its real element type here too, not an untyped pin. */
		scope?: PinScope;
		onchange: (next: FlowDoc) => void;
	} = $props();

	const vocab = $derived(ctx.vocab);

	// The function-boundary nodes (§5). Their pins ARE the function's FIXED signature, so the
	// inspector renders them READ-ONLY here: no ref/field/data-source editing (that would alter the
	// signature). Wiring TO/FROM their pins on the canvas is still allowed. (Adding/removing a
	// function's inputs/outputs — which would change these — is a LATER feature.)
	const isSignatureNode = $derived(node.kind === 'functionEntry' || node.kind === 'functionResult');

	// The node's derived pins — the summary + the DATA-IN editor list both read from these.
	const pins = $derived<Pin[]>(derivePins(node, ctx, scope));
	// Entry/result data-ins are the function's declared outputs (fed by the body via wires), never
	// literal/accessor-authored here — so the editable Inputs list is empty for signature nodes.
	const dataIns = $derived(
		isSignatureNode ? [] : pins.filter((p) => p.dir === 'in' && p.kind === 'data'),
	);

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

	// A literal/accessor stored on a pin that is ALSO wired. The edge wins at runtime, so it is dead
	// (the `data-in-shadowed` warning) — and since the wired row below renders no source editor, it
	// was otherwise UNCLEARABLE: the panel reported a problem the UI gave no way to fix. New wires
	// re-stamp the pin `wire` on connect (`addDataEdgeIn`); this clears the ones already in a doc.
	const shadowedSource = (pinId: string): DataSource | undefined => {
		const stored = node.inputs?.[pinId];
		return stored && stored.kind !== 'wire' ? stored : undefined;
	};

	// Whether that DataSource is the PHANTOM default rather than something the doc actually stores.
	// The editor renders the default so a fresh pin isn't blank, but only `onchange` commits it — so
	// accepting the default stores NOTHING and the pin stays unfilled. That bites hardest where the
	// default IS the wanted value (an enum's first member, `false`): re-picking the value already
	// shown fires no change event, so there is no interaction that would save it. The editors below
	// render an unset pin honestly instead of showing a value the doc doesn't have.
	const isUnset = (pin: Pin): boolean => {
		const stored = node.inputs?.[pin.id];
		return !stored || stored.kind === 'wire';
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

	// --- showContainer round-block hold ----------------------------------------
	function onAwaitCompleteChange(value: boolean): void {
		onchange(setShowContainerAwaitComplete(doc, node.id, value));
	}

	// --- fireCue await ---------------------------------------------------------
	function onFireCueAwaitChange(value: boolean): void {
		onchange(setFireCueAwait(doc, node.id, value));
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

	// --- group (§5.2) ----------------------------------------------------------
	function onGroupLabelChange(label: string): void {
		onchange(setGroupLabel(doc, node.id, label));
	}

	// --- textMessage (§6.3) ----------------------------------------------------
	// The node CARRIES its content (text/place/visibleWhile/autoHideMs/style), not a vocab ref, so it
	// is edited directly here through one field-patch setter (`setTextMessageFields`). Each handler
	// guards on the kind — Svelte narrows `node` inside the `{#if}` template block, but the setters
	// close over `node` where that narrowing doesn't hold. A blank/undefined value clears an optional
	// field (autoHideMs/style) so an unused field is never stored (see the setter's doc).
	const VISIBLE_WHILE_OPTIONS: {
		value: NonNullable<TextMessageNode['visibleWhile']>;
		label: string;
	}[] = [
		{ value: 'none', label: 'None (only via a Show wire)' },
		{ value: 'idle', label: 'Idle (before a spin)' },
		{ value: 'spinning', label: 'Spinning' },
		{ value: 'freeSpins', label: 'Free spins' },
		{ value: 'always', label: 'Always (while this flow is active)' },
	];
	const PLACEMENT_OPTIONS: { value: NonNullable<TextMessageNode['placement']>; label: string }[] = [
		{ value: 'infoBar', label: 'Info bar (the game’s message line)' },
		{ value: 'anchor', label: 'Fixed position (custom anchor)' },
	];
	// Default matches the engine (`TEXT_MESSAGE_DEFAULTS.placement`): a message with no explicit
	// placement uses the shared info-bar channel, like every other in-game message.
	const placementOf = (n: TextMessageNode): NonNullable<TextMessageNode['placement']> =>
		n.placement ?? 'infoBar';

	function onTextChange(text: string): void {
		if (node.kind !== 'textMessage') return;
		onchange(setTextMessageFields(doc, node.id, { text }));
	}
	// Normalized 0..1 anchor — clamp so a stray value can't push the message off-canvas.
	function onPlaceChange(axis: 'x' | 'y', raw: number): void {
		if (node.kind !== 'textMessage') return;
		if (!Number.isFinite(raw)) return;
		const v = Math.min(1, Math.max(0, raw));
		onchange(setTextMessageFields(doc, node.id, { place: { ...node.place, [axis]: v } }));
	}
	function onVisibleWhileChange(value: NonNullable<TextMessageNode['visibleWhile']>): void {
		if (node.kind !== 'textMessage') return;
		onchange(setTextMessageFields(doc, node.id, { visibleWhile: value }));
	}
	function onPlacementChange(value: NonNullable<TextMessageNode['placement']>): void {
		if (node.kind !== 'textMessage') return;
		onchange(setTextMessageFields(doc, node.id, { placement: value }));
	}
	// 0/empty ⇒ clear the field (stay shown until a Hide wire or the gate flips).
	function onAutoHideChange(raw: number): void {
		if (node.kind !== 'textMessage') return;
		const ms = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : undefined;
		onchange(setTextMessageFields(doc, node.id, { autoHideMs: ms }));
	}
	// Merge one style key, pruning empties — an all-empty style object is dropped so the node falls
	// back entirely to the engine's default message style.
	function onStyleChange(part: { size?: number; color?: string }): void {
		if (node.kind !== 'textMessage') return;
		const merged = { ...(node.style ?? {}), ...part };
		const style: NonNullable<TextMessageNode['style']> = {};
		if (typeof merged.size === 'number' && Number.isFinite(merged.size) && merged.size > 0)
			style.size = merged.size;
		if (typeof merged.color === 'string' && merged.color.trim()) style.color = merged.color.trim();
		onchange(
			setTextMessageFields(doc, node.id, {
				style: Object.keys(style).length > 0 ? style : undefined,
			}),
		);
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
			case 'list':
				// A list of a SCALAR element (float/int/ms/bool/string/enum) is authorable as a
				// literal (comma-separated in the editor below), seeded EMPTY. A list of structs
				// (or nested lists) still has no literal form → wire.
				if (t.of.t === 'struct' || t.of.t === 'list') return { kind: 'wire' };
				return { kind: 'literal', type: t, value: [] };
			case 'struct':
				// Structs cannot be literals — they must be wired.
				return { kind: 'wire' };
			default:
				return { kind: 'literal', type: t, value: 0 };
		}
	}

	// A scalar-list literal is authored as a comma/space-separated string. `[]` (empty) is a valid
	// value — the consuming effect treats it as "no per-item override" (falls back to its defaults).
	function formatListLiteral(value: unknown): string {
		return Array.isArray(value) ? value.join(', ') : '';
	}
	function parseListLiteral(text: string, elem: TypeRef): unknown[] {
		const tokens = text
			.split(/[\s,]+/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (elem.t === 'float') return tokens.map(Number).filter(Number.isFinite);
		if (elem.t === 'int' || elem.t === 'ms')
			return tokens.map((s) => Math.trunc(Number(s))).filter(Number.isFinite);
		if (elem.t === 'bool') return tokens.map((s) => s === 'true');
		return tokens; // string / enum — keep as-is
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
		{#if isSignatureNode}
			<p class="ro-note">
				This is the function's {node.kind === 'functionEntry' ? 'Entry' : 'Result'} node — it carries
				the function's fixed signature. Wire to/from its pins to author the body; the signature itself
				isn't editable here.
			</p>
		{/if}

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

		{#if node.kind === 'showContainer'}
			<label class="field check">
				<input
					type="checkbox"
					checked={node.awaitComplete === true}
					onchange={(e) => onAwaitCompleteChange(e.currentTarget.checked)}
				/>
				<span class="flabel">Hold until this screen completes (tap)</span>
			</label>
			<p class="hint">
				Pauses the round after mounting until the overlay's <strong>Tap to continue</strong> fires
				its
				<code>complete</code> — the generic free-spin/intro/outro hold.
			</p>
		{/if}

		{#if node.kind === 'fireCue'}
			<label class="field check">
				<input
					type="checkbox"
					checked={node.await === true}
					onchange={(e) => onFireCueAwaitChange(e.currentTarget.checked)}
				/>
				<span class="flabel">Wait for this cue to finish</span>
			</label>
			<p class="hint">
				Pauses the chain until the cue's listeners finish, instead of firing it and running straight
				on. Turn this ON when a LATER node undoes what the cue starts — e.g.
				<code>boardWithAnimateSymbols</code> must be awaited or the
				<code>hideWinLine</code> after it erases the win line before the symbols finish animating.
			</p>
		{/if}

		{#if node.kind === 'group'}
			<label class="field">
				<span class="flabel">Name</span>
				<input
					type="text"
					value={node.label}
					placeholder="Group name"
					onchange={(e) => onGroupLabelChange(e.currentTarget.value)}
				/>
			</label>
		{/if}

		{#if node.kind === 'textMessage'}
			<label class="field">
				<span class="flabel">Message text</span>
				<textarea
					class="msg-text"
					rows="2"
					value={node.text}
					placeholder="e.g. Click spin button to start"
					onchange={(e) => onTextChange(e.currentTarget.value)}
				></textarea>
			</label>
			<p class="hint">
				This exact text is the <strong>localization key</strong> — it's the default line shown, and what
				the translator resolves per language.
			</p>

			<label class="field">
				<span class="flabel">Placement</span>
				<select
					value={placementOf(node)}
					onchange={(e) =>
						onPlacementChange(e.currentTarget.value as NonNullable<TextMessageNode['placement']>)}
				>
					{#each PLACEMENT_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
			<p class="hint">
				<strong>Info bar</strong> shows it in the game's shared message line, exactly like win
				messages (single slot — the latest message wins). <strong>Fixed position</strong> draws it as
				its own overlay at the anchor below.
			</p>

			<label class="field">
				<span class="flabel">Visible while (state gate)</span>
				<select
					value={node.visibleWhile ?? 'none'}
					onchange={(e) =>
						onVisibleWhileChange(
							e.currentTarget.value as NonNullable<TextMessageNode['visibleWhile']>,
						)}
				>
					{#each VISIBLE_WHILE_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
			<p class="hint">
				A sustained game state that shows the message continuously — e.g. <strong>Idle</strong> for
				a standing "Click spin button to start". Leave on <strong>None</strong> for a transient
				message driven only by a <code>Show</code> wire.
			</p>

			{#if placementOf(node) === 'anchor'}
				<div class="place-row">
					<label class="field">
						<span class="flabel">Anchor X (0–1)</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.01"
							value={node.place.x}
							onchange={(e) => onPlaceChange('x', Number(e.currentTarget.value))}
						/>
					</label>
					<label class="field">
						<span class="flabel">Anchor Y (0–1)</span>
						<input
							type="number"
							min="0"
							max="1"
							step="0.01"
							value={node.place.y}
							onchange={(e) => onPlaceChange('y', Number(e.currentTarget.value))}
						/>
					</label>
				</div>
				<p class="hint">
					Normalized position on the game canvas — 0,0 is top-left, 1,1 bottom-right.
				</p>
			{/if}

			<label class="field">
				<span class="flabel">Auto-hide after (ms)</span>
				<input
					type="number"
					min="0"
					step="100"
					value={node.autoHideMs ?? ''}
					placeholder="0 = stay until Hide / gate flips"
					onchange={(e) => onAutoHideChange(Number(e.currentTarget.value))}
				/>
			</label>
			<p class="hint">
				For a transient message shown via a <code>Show</code> wire (e.g. a "Good luck" fired from
				the spin button, ~1200 ms). <strong>0 / empty</strong> keeps it up until a
				<code>Hide</code> wire or the state gate turns off.
			</p>

			{#if placementOf(node) === 'anchor'}
				<div class="place-row">
					<label class="field">
						<span class="flabel">Text size (optional)</span>
						<input
							type="number"
							min="0"
							step="1"
							value={node.style?.size ?? ''}
							placeholder="engine default"
							onchange={(e) => onStyleChange({ size: Number(e.currentTarget.value) })}
						/>
					</label>
					<label class="field">
						<span class="flabel">Color (optional)</span>
						<input
							type="text"
							value={node.style?.color ?? ''}
							placeholder="#ffffff"
							onchange={(e) => onStyleChange({ color: e.currentTarget.value })}
						/>
					</label>
				</div>
				<p class="hint">Blank style fields fall back to the engine's default message style.</p>
			{/if}
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
						{@const shadowed = shadowedSource(pin.id)}
						<div class="field wired">
							<span class="pinname">{pin.label ?? pin.id}</span>
							<span class="wiredtag">wired</span>
							{#if shadowed}
								<button
									class="mini"
									type="button"
									title="The incoming wire wins at runtime, so this stored {shadowed.kind} is dead. Clearing it changes nothing the game does — it only clears the warning."
									onclick={() => onInputChange(pin.id, { kind: 'wire' })}
								>
									Clear dead {shadowed.kind}
								</button>
							{/if}
						</div>
					{:else}
						<div class="field">
							<span class="pinname" title={pin.doc ?? ''}
								>{pin.label ?? pin.id}{#if pin.dataType}<span class="ptype"
										>{typeLabel(pin.dataType)}</span
									>{/if}{#if pin.optional}<span class="popt">optional</span>{/if}</span
							>
							{@render dataSourceEditor(
								sourceFor(pin),
								pin.dataType,
								(s) => onInputChange(pin.id, s),
								true,
								isUnset(pin),
								pin.optional === true,
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
	/** `src` is the phantom default, not a stored value — render "nothing chosen", not a value the
	 *  doc doesn't have. Only the node data-in list passes this; operand editors always store. */
	unset = false,
	/** The pin may legitimately stay unset (the effect defaults it) — say so instead of demanding. */
	optional = false,
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
				<select
					value={unset ? '' : src.value === true ? 'true' : 'false'}
					onchange={(e) =>
						commit({ kind: 'literal', type: lt, value: e.currentTarget.value === 'true' })}
				>
					{#if unset}
						<!-- A bare checkbox draws the phantom default (`false`) as an unchecked box, so an
						     untouched pin LOOKS off. For an optional pin whose effect default is `true`
						     (`zoom`, `greyOut`) that is the OPPOSITE of what the game does — the board still
						     zoomed. Render the unset state honestly (like the enum/number editors) so picking
						     on/off is the only way to display a value, and it always commits. -->
						<option value="" disabled>{optional ? '— default —' : '— choose —'}</option>
					{/if}
					<option value="true">on</option>
					<option value="false">off</option>
				</select>
			{:else if lt.t === 'string'}
				<input
					type="text"
					value={String(src.value ?? '')}
					onchange={(e) => commit({ kind: 'literal', type: lt, value: e.currentTarget.value })}
				/>
			{:else if lt.t === 'enum'}
				<select
					value={unset ? '' : String(src.value ?? '')}
					onchange={(e) => commit({ kind: 'literal', type: lt, value: e.currentTarget.value })}
				>
					{#if unset}
						<!-- Without this, the select shows the first member as though it were chosen, and
						     picking that member fires no change event — so it can never be stored. -->
						<option value="" disabled>{optional ? '— default —' : '— choose —'}</option>
					{/if}
					{#each vocab.enums.find((en) => en.name === lt.name)?.values ?? [] as v (v)}
						<option value={v}>{v}</option>
					{/each}
				</select>
			{:else if lt.t === 'list' && lt.of.t === 'enum'}
				<!-- A list of an ENUM (e.g. `symbols: SymbolName[]`) is PICKED, not typed: one toggle chip
				     per member. Clicking adds/removes it from the stored array. Empty = the effect default. -->
				{@const enumName = lt.of.t === 'enum' ? lt.of.name : ''}
				{@const enumValues = vocab.enums.find((en) => en.name === enumName)?.values ?? []}
				{@const selected = Array.isArray(src.value) ? src.value.map(String) : []}
				<div class="chips">
					{#each enumValues as v (v)}
						<button
							type="button"
							class="chip"
							class:on={selected.includes(v)}
							onclick={() =>
								commit({
									kind: 'literal',
									type: lt,
									value: selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v],
								})}>{v}</button
						>
					{/each}
					{#if enumValues.length === 0}<span class="note">no options</span>{/if}
				</div>
			{:else if lt.t === 'list' && lt.of.t !== 'struct' && lt.of.t !== 'list'}
				<input
					type="text"
					class="listlit"
					placeholder="comma-separated (one per reel)"
					value={formatListLiteral(src.value)}
					onchange={(e) =>
						commit({
							kind: 'literal',
							type: lt,
							value: parseListLiteral(e.currentTarget.value, lt.of),
						})}
				/>
			{:else if lt.t === 'struct' || lt.t === 'list'}
				<span class="note">{typeLabel(lt)} must be wired</span>
			{:else}
				<input
					type="number"
					value={unset ? '' : Number(src.value ?? 0)}
					placeholder={unset ? (optional ? 'default' : 'required') : ''}
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
				else if (on === 'trigger') commit({ on: 'trigger' });
				else if (on === 'context') commit({ on: 'context' });
				else commit({ on: 'input', name: '' });
			}}
		>
			<option value="trigger">$trigger</option>
			<option value="item">$item</option>
			<option value="index">$index</option>
			<option value="engine">$engine</option>
			<option value="context">$context</option>
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
		{:else if acc.on === 'trigger'}
			<!-- The field of the payload of whichever event's chain this node is on. Empty = the WHOLE
					 payload (what an opaque mechanic effect like `revealBoard` consumes). A field that the
					 owning event doesn't declare is caught by the validator's `accessor-unresolved`. -->
			<input
				class="acc-detail"
				type="text"
				placeholder="payload field (empty = whole event)"
				value={acc.member ?? ''}
				onchange={(e) => {
					const m = e.currentTarget.value.trim();
					commit(m ? { on: 'trigger', member: m } : { on: 'trigger' });
				}}
			/>
		{:else if acc.on === 'context'}
			<input
				class="acc-detail"
				type="text"
				placeholder="context field (e.g. bookEvents)"
				value={acc.member ?? ''}
				onchange={(e) => {
					const m = e.currentTarget.value.trim();
					commit(m ? { on: 'context', member: m } : { on: 'context' });
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
	.popt {
		font-size: 9px;
		color: #64748b;
		margin-left: 4px;
		font-style: italic;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ro-note {
		margin: 0;
		font-size: 11px;
		line-height: 1.5;
		color: #94a3b8;
		border: 1px solid #1f2937;
		border-radius: 6px;
		background: #11161d;
		padding: 8px 10px;
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
	.field.check {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	.field.check .flabel {
		text-transform: none;
		font-size: 11px;
		color: #cbd5e1;
		letter-spacing: 0;
	}
	.field.check input[type='checkbox'] {
		flex: none;
	}
	.hint {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: #94a3b8;
	}
	.hint code {
		color: #93c5fd;
	}
	.pinname {
		font-size: 11px;
		color: #cbd5e1;
	}
	select,
	input[type='text'],
	input[type='number'],
	textarea {
		box-sizing: border-box;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 12px;
		padding: 4px 7px;
		width: 100%;
	}
	textarea.msg-text {
		resize: vertical;
		min-height: 40px;
		font-family: inherit;
		line-height: 1.4;
	}
	textarea:focus {
		outline: none;
		border-color: #2563eb;
	}
	/* Two normalized-anchor / style inputs side by side. */
	.place-row {
		display: flex;
		gap: 8px;
	}
	.place-row .field {
		flex: 1;
		min-width: 0;
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
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		padding: 2px 9px;
		font-size: 12px;
		line-height: 1.5;
		border: 1px solid #2a323d;
		border-radius: 999px;
		background: #14181f;
		color: #cbd5e1;
		cursor: pointer;
	}
	.chip:hover {
		border-color: #3b475a;
	}
	.chip.on {
		background: #2563eb;
		border-color: #2563eb;
		color: #fff;
	}
</style>
