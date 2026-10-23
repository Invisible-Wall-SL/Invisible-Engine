import type { CinematicDoc, ComponentDef, LayoutNode } from 'engine-layout';

import { componentTimelineId } from '$lib/timeline/screenTimeline';

/** "<name> copy", or " copy 2", " copy 3", … when another of `taken` already has it. */
export function duplicateComponentName(name: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base = `${name.trim() || 'Component'} copy`;
	let out = base;
	for (let i = 2; used.has(out); i++) out = `${base} ${i}`;
	return out;
}

/** The timelines a component plays: the built-in ones, overridden by id by the project's. */
export function componentOwnTimelines(
	componentId: string,
	builtin: readonly CinematicDoc[],
	project: readonly CinematicDoc[],
): CinematicDoc[] {
	const hosted = (d: CinematicDoc) =>
		d.host?.kind === 'component' && d.host.componentId === componentId;
	const own = project.filter(hosted);
	const ids = new Set(own.map((d) => d.id));
	return [...builtin.filter((d) => hosted(d) && !ids.has(d.id)), ...own];
}

export interface ComponentDuplicate {
	def: ComponentDef;
	/** The copy's own timelines, to be created before the def that plays them. */
	timelines: CinematicDoc[];
}

/**
 * A new project component copied from `source` (the Components list's ⧉ Duplicate): every node,
 * param, input, event, state machine and setting, under id `id`, the name `name`, version 1 and
 * fresh node ids (two copies never share one). Each of `timelines` (the source's own) is copied
 * onto the copy under a fresh id, and the state machine plays the copies, so editing one never
 * moves the original. A state playing a timeline the source only reuses keeps playing that one.
 *
 * `projectDefaults` (this game's defaults for the source) become the copy's own param defaults:
 * the copy is already this project's fork, so its look lives in one place, the def, and shows the
 * same in this game as the source did.
 */
export function duplicateComponent(
	source: ComponentDef,
	opts: {
		id: string;
		name: string;
		mintNodeId: () => string;
		timelines: readonly CinematicDoc[];
		takenTimelineIds: Iterable<string>;
		projectDefaults?: Record<string, unknown>;
	},
): ComponentDuplicate {
	const def = structuredClone(source);
	def.id = opts.id;
	def.name = opts.name;
	def.version = 1;
	def.scope = 'project';
	// An engine-placed built-in's copy is the author's to place.
	delete def.internal;

	const nodeIds = new Map<string, string>();
	const labels = new Set<string>();
	const reid = (node: LayoutNode, id: string): void => {
		nodeIds.set(node.id, id);
		if (node.label) labels.add(node.label);
		node.id = id;
		if (node.kind === 'container')
			for (const child of node.children) reid(child, opts.mintNodeId());
	};
	reid(def.root, `${opts.mintNodeId()}_root`);

	for (const [key, value] of Object.entries(opts.projectDefaults ?? {})) {
		if (value === undefined) continue;
		const param = def.params?.find((p) => p.key === key && !p.engineProvided);
		if (!param) continue;
		param.default = structuredClone(value) as typeof param.default;
		// Resolution layers these over the param defaults, so a baked value must win here too.
		if (def.defaultInstanceParams && key in def.defaultInstanceParams) {
			def.defaultInstanceParams[key] = structuredClone(value);
		}
	}

	// A node actor names its node, or an unnamed node by id: follow the id to the copy's node.
	const target = (t: string): string => (labels.has(t) ? t : (nodeIds.get(t) ?? t));
	const taken = new Set(opts.takenTimelineIds);
	const timelineIds = new Map<string, string>();
	const timelines = opts.timelines.map((doc) => {
		const copy = structuredClone(doc);
		copy.id = componentTimelineId(def.id, doc.name || doc.id, taken);
		taken.add(copy.id);
		timelineIds.set(doc.id, copy.id);
		copy.host = { kind: 'component', componentId: def.id };
		// The source's reuse on other components stays the source's.
		delete copy.playOnComponents;
		for (const cast of copy.stage.cast) {
			if (cast.kind !== 'node') continue;
			if (cast.target) cast.target = target(cast.target);
			if (cast.nodeId) cast.nodeId = nodeIds.get(cast.nodeId) ?? cast.nodeId;
		}
		const links = copy.shared?.targets;
		if (links) for (const [from, to] of Object.entries(links)) links[from] = target(to);
		return copy;
	});

	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states)
			state.timeline = timelineIds.get(state.timeline) ?? state.timeline;
	}
	return { def, timelines };
}
