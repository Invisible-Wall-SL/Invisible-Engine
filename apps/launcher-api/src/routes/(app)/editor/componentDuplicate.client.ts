import type { CinematicDoc, ComponentDef, LayoutNode } from 'engine-layout';

import { componentTimelineId, componentTimelinesOf } from '$lib/timeline/screenTimeline';

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
	const own = componentTimelinesOf([...project], componentId);
	const ids = new Set(own.map((d) => d.id));
	return [...componentTimelinesOf([...builtin], componentId).filter((d) => !ids.has(d.id)), ...own];
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
 * Node actors keep their targets: a component timeline finds its node by name, and the copy keeps
 * every name. The built-in-only behaviour flags (`buttonStates`, `settles`, …) stay, so a copy of
 * a presentation def plays as it does.
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

	const reid = (node: LayoutNode, id: string): void => {
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
		return copy;
	});

	for (const layer of def.stateMachine?.layers ?? []) {
		for (const state of layer.states)
			state.timeline = timelineIds.get(state.timeline) ?? state.timeline;
	}
	return { def, timelines };
}

/** How the copy's def save ended: stored, refused (nothing stored, and why), or not known. */
export type DuplicateDefSave = 'saved' | 'unknown' | { refused: string };

export interface DuplicateWrites {
	/** Create one timeline, create-only; the refusal's reason, or `null` when created. */
	createTimeline: (doc: CinematicDoc) => Promise<string | null>;
	saveDef: (def: ComponentDef) => Promise<DuplicateDefSave>;
	/** Delete a timeline this duplicate created; false when it could not. */
	deleteTimeline: (id: string) => Promise<boolean>;
}

/**
 * Write `copy`: its timelines first, so the stored def never plays one that is missing, then the
 * def. A refusal takes back the timelines this call created; a def save that got no answer may
 * have landed, so its timelines stay. `null` when the copy is stored, else what to tell the author.
 */
export async function writeComponentDuplicate(
	copy: ComponentDuplicate,
	writes: DuplicateWrites,
): Promise<string | null> {
	const created: string[] = [];
	const rollBack = async (reason: string): Promise<string> => {
		const deleted = await Promise.allSettled(created.map((id) => writes.deleteTimeline(id)));
		const left = created.filter((_, i) => {
			const r = deleted[i];
			return r.status === 'rejected' || !r.value;
		});
		return left.length
			? `${reason} Its timelines ${left.join(', ')} could not be removed; delete them in Animate.`
			: reason;
	};
	for (const doc of copy.timelines) {
		let refused: string | null;
		try {
			refused = await writes.createTimeline(doc);
		} catch (e) {
			refused = e instanceof Error ? e.message : String(e);
		}
		if (refused !== null) {
			return rollBack(`Could not copy timeline "${doc.name || doc.id}": ${refused}`);
		}
		created.push(doc.id);
	}
	const saved = await writes.saveDef(copy.def).catch((): DuplicateDefSave => 'unknown');
	if (saved === 'saved') return null;
	if (saved !== 'unknown') return rollBack(`Could not save the copy: ${saved.refused}`);
	return (
		`The copy "${copy.def.name}" may have been saved — the save got no answer. Reload to check; ` +
		`if it is not there, delete its timelines (${created.join(', ') || 'none'}) in Animate.`
	);
}
