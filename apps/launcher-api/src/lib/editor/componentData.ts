/**
 * The read-only **Data** tab (Rive plan Phase 9d, `docs/design/rive-reference.md` §3.2 Data row):
 * a component's whole interface in one place — its inputs (and the signals that fire as triggers),
 * its events, its params, and every value a node is bound to. Rive calls this the view model; ours
 * is the component interface (§6) plus Flow, so this only SHOWS it. Edits stay where they are
 * (Properties' Inputs / Events / params, a node's bindings). Pure, so the gate pins it.
 */
import type { ComponentDef, LayoutNode } from 'engine-layout';

export interface DataRow {
	/** What the row names: an input id, an event id, a param key, or `node.field`. */
	name: string;
	/** Its kind (`bool`, `trigger`, `number` …) or, for a bound value, the binding's target. */
	kind: string;
	/** A plain-words detail: a default, a source, a payload, what it reads from. */
	detail: string;
	/** For a bound value: the node to select. */
	nodeId?: string;
}

export interface ComponentData {
	inputs: DataRow[];
	events: DataRow[];
	params: DataRow[];
	bound: DataRow[];
}

const shown = (value: unknown): string =>
	value === undefined ? '' : typeof value === 'string' ? `"${value}"` : JSON.stringify(value);

function walk(node: LayoutNode, visit: (node: LayoutNode) => void): void {
	visit(node);
	if (node.kind === 'container') for (const child of node.children) walk(child, visit);
}

/** Everything the Data tab lists for `def`, in the def's own order. */
export function componentData(def: ComponentDef): ComponentData {
	const inputs: DataRow[] = (def.inputs ?? []).map((input) => ({
		name: input.id,
		kind: input.kind,
		detail: [
			input.source ? `from engine value "${input.source}"` : '',
			input.kind !== 'trigger' && input.default !== undefined
				? `default ${shown(input.default)}`
				: '',
			input.note ?? '',
		]
			.filter(Boolean)
			.join(' · '),
	}));
	for (const signal of def.signals ?? []) {
		if (inputs.some((row) => row.name === signal.key)) continue;
		inputs.push({ name: signal.key, kind: 'trigger', detail: signal.note ?? 'declared signal' });
	}

	const events: DataRow[] = (def.events ?? []).map((event) => ({
		name: event.id,
		kind: 'event',
		detail: [
			event.payload?.length
				? `payload: ${event.payload.map((p) => `${p.name}:${p.type.t}`).join(', ')}`
				: '',
			event.note ?? '',
		]
			.filter(Boolean)
			.join(' · '),
	}));

	const params: DataRow[] = (def.params ?? []).map((param) => ({
		name: param.key,
		kind: param.kind,
		detail: [
			param.engineProvided ? 'fed by the engine' : '',
			param.default !== undefined ? `default ${shown(param.default)}` : '',
		]
			.filter(Boolean)
			.join(' · '),
	}));

	const bound: DataRow[] = [];
	walk(def.root, (node) => {
		const label = node.label ?? node.id;
		for (const [field, param] of Object.entries(node.paramBindings ?? {})) {
			bound.push({
				name: `${label}.${field}`,
				kind: 'param',
				detail: `← param "${param}"`,
				nodeId: node.id,
			});
		}
		for (const binding of node.valueBindings ?? []) {
			const from = binding.source
				? `engine value "${binding.source}"`
				: binding.param
					? `param "${binding.param}"`
					: 'nothing (unbound)';
			const target = binding.target === 'fxParam' ? `fx:${binding.fxParam ?? '?'}` : binding.target;
			bound.push({
				name: `${label}.${target}`,
				kind: 'value',
				detail: `← ${from}`,
				nodeId: node.id,
			});
		}
	});
	return { inputs, events, params, bound };
}
