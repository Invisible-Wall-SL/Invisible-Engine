/**
 * Find the baked switches in a ComfyUI API graph that nothing can reach.
 *
 * A published blueprint's `params[]` are the ONLY inputs the runner writes before
 * submitting a job (`video_runner.build_video_workflow`). Every other input keeps
 * whatever value the author's ComfyUI export happened to save — forever, with no
 * UI able to change it. That is fine for the hundred inputs a graph bakes on
 * purpose, and ruinous for the one that decides what the graph DOES.
 *
 * It cost a day of `executionTimeout` failures. An imported looping-Wan graph
 * gated both its passes on a single `PrimitiveBoolean` left at `false`, which
 * selected 50 steps at cfg 3.5 with no speed LoRA; the built-in blueprint has the
 * identical gate and differs only in DECLARING it as a param with `default: true`.
 * An unticked boolean looks exactly like one that does not matter, so the publish
 * modal has to be able to tell the author which is which.
 *
 * Dependency-free on purpose: the publish modal imports it, and
 * `blueprintGates.fixture.ts` runs it under bare `node` against the real graphs.
 */

/** A ComfyUI API node: a class name plus inputs that are each either a baked
 * widget value or a link `[nodeId, slot]`. */
export interface GraphNode {
	class_type?: string;
	inputs?: Record<string, unknown>;
	_meta?: { title?: string };
}
export type ApiGraph = Record<string, GraphNode>;

/** One baked boolean that gates the graph and is not exposed. */
export interface Gate {
	node: string;
	field: string;
	/** What the export baked in — what every render will use until it is exposed. */
	value: boolean;
	/** How many switch inputs it ultimately drives. Ranks the warning: the one
	 * that flips ten switches is the mode switch, the one that flips a single
	 * switch is usually an optional pass. */
	switches: number;
}

/** The input name a switch node takes its gate on. Matched by NAME, not by class:
 * `on_true` / `on_false` are inputs on that same node and are data, not the gate,
 * so a class test would count every switch three times. `switch` is what core's
 * `ComfySwitchNode` uses — which is what both the built-in blueprint and every
 * graph imported so far are built from — and `boolean` covers the common
 * third-party spelling. */
const GATE_INPUTS = ['switch', 'boolean'];

/** A ComfyUI API input is either a baked widget value or a link `[nodeId, slot]`. */
export function linkSource(v: unknown): string | null {
	return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

/** Which (node · input) each node FEEDS — the forward index. Every other walk in
 * the publish modal runs backwards, from a consumer to the widget behind it; this
 * one has to run forwards, because the question is what a knob CONTROLS. */
function feedIndex(graph: ApiGraph): Record<string, { node: string; field: string }[]> {
	const out: Record<string, { node: string; field: string }[]> = {};
	for (const [id, n] of Object.entries(graph)) {
		for (const [field, v] of Object.entries(n?.inputs ?? {})) {
			const src = linkSource(v);
			if (!src) continue;
			(out[src] ??= []).push({ node: id, field });
		}
	}
	return out;
}

/** How many switch gates a node's value ultimately reaches, following it forward
 * through `Primitive*` relays.
 *
 * The relay hop is what makes this worth writing: a ComfyUI SUBGRAPH republishes
 * an outer value as its own `Primitive*` node inside, so a top-level gate reaches
 * its switches two subgraphs and several hops away and drives NOTHING that looks
 * like a switch directly. Counting only direct consumers finds nothing at all on
 * exactly the graphs this exists for. */
function gateReach(
	graph: ApiGraph,
	feeds: Record<string, { node: string; field: string }[]>,
	id: string,
	seen: string[] = [],
): number {
	let n = 0;
	for (const t of feeds[id] ?? []) {
		if (GATE_INPUTS.includes(t.field)) {
			n += 1;
			continue;
		}
		const ct = String(graph[t.node]?.class_type ?? '');
		if (/^Primitive/i.test(ct) && !seen.includes(t.node)) {
			seen.push(t.node);
			n += gateReach(graph, feeds, t.node, seen);
		}
	}
	return n;
}

/**
 * Every baked boolean in `graph` that gates at least one switch, minus the ones
 * already reachable — `bound` holds the role bindings' `node::field`, `exposed`
 * the params'. Most switches first.
 *
 * A candidate is the same shape the modal's `resolveKnob` already calls a knob:
 * exactly one input, nothing wired into it. That is what a `Primitive*` node
 * pulled out of a widget looks like, and it keeps a switch's own `on_true` /
 * `on_false` — wired, and never alone on their node — out of the list.
 */
export function findUnexposedGates(
	graph: ApiGraph | null | undefined,
	bound: Iterable<string> = [],
	exposed: Iterable<string> = [],
): Gate[] {
	if (!graph) return [];
	const reachable = new Set<string>([...bound, ...exposed]);
	const feeds = feedIndex(graph);
	const out: Gate[] = [];
	for (const [id, n] of Object.entries(graph)) {
		const inputs = (n?.inputs ?? {}) as Record<string, unknown>;
		const fields = Object.keys(inputs);
		if (fields.length !== 1) continue;
		const field = fields[0];
		if (linkSource(inputs[field]) !== null) continue;
		const value = inputs[field];
		if (typeof value !== 'boolean') continue;
		if (reachable.has(`${id}::${field}`)) continue;
		const switches = gateReach(graph, feeds, id);
		if (switches) out.push({ node: id, field, value, switches });
	}
	return out.sort((a, b) => b.switches - a.switches || a.node.localeCompare(b.node));
}
