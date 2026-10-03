import type { ComponentDef, LayoutNode } from './types';

/**
 * Collect every `componentInstance` `componentId` referenced in a node tree
 * (recursing into container children). Pure + Svelte-free so both the launcher's
 * bake endpoint and any build tool can use it to decide which {@link
 * import('./types').ComponentDef}s a doc needs.
 *
 * Pass a scene's `nodes`, the whole doc's nodes (`scenes.flatMap(s => s.nodes)`),
 * or a single def's `root` wrapped in an array (`[def.root]`) to find the defs a
 * component itself nests — the caller resolves the transitive closure by feeding
 * each loaded def's root back in.
 */
export function collectComponentIds(nodes: LayoutNode[]): string[] {
	const ids = new Set<string>();
	const walk = (node: LayoutNode): void => {
		if (node.kind === 'componentInstance') ids.add(node.componentId);
		// A `repeater` instantiates its `componentId` once per live item, so that def must ride
		// the bake/pull chain exactly like a direct `componentInstance`.
		//
		// GAP (Phase B): a repeater ITEM may override this with its own `RepeaterItem.componentId`
		// (distinct, authorable cards), but that id is assigned from CONFIG at runtime — it does
		// NOT appear on any doc node, so this static walk cannot see it. Those config-assigned card
		// components must be collected onto the bake chain SEPARATELY (like editor-art keys), by the
		// config side that owns them. This walk still ships the repeater's shared `componentId`.
		if (node.kind === 'repeater') ids.add(node.componentId);
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) children.forEach(walk);
	};
	for (const node of nodes) walk(node);
	return [...ids];
}

/** The keys of a def's `component`-kind params. */
const componentParamKeys = (def: ComponentDef): string[] =>
	(def.params ?? []).filter((p) => p.kind === 'component').map((p) => p.key);

/**
 * The component ids that `component`-kind params name (the Letters Strip's `tile`): components a
 * placed instance mounts at RUNTIME, which no node in the tree names, so the bake must follow them
 * like a nested instance or they never ship. Read from each def's own default, the project's
 * defaults for it (`defaults`, keyed by def id), and every instance of it in `nodes`, base params
 * and per-layoutType overrides.
 */
export function collectParamComponentIds(
	nodes: LayoutNode[],
	defs: Record<string, ComponentDef>,
	defaults: Record<string, Record<string, unknown>> = {},
): string[] {
	const ids = new Set<string>();
	const add = (value: unknown): void => {
		if (typeof value === 'string' && value) ids.add(value);
	};
	for (const [id, def] of Object.entries(defs)) {
		for (const param of def.params ?? []) {
			if (param.kind !== 'component') continue;
			add(param.default);
			add(defaults[id]?.[param.key]);
		}
	}
	const walk = (node: LayoutNode): void => {
		if (node.kind === 'componentInstance') {
			const def = defs[node.componentId];
			for (const key of def ? componentParamKeys(def) : []) {
				add(node.params?.[key]);
				for (const override of Object.values(node.overrides ?? {})) add(override?.params?.[key]);
			}
		}
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) children.forEach(walk);
	};
	for (const node of nodes) walk(node);
	return [...ids];
}

/**
 * Every def `nodes` need, loaded through `load`: the instances they place, the defs those nest, and
 * the components their `component`-kind params name ({@link collectParamComponentIds}), until
 * nothing new turns up. `extraSeedIds` are ids named from outside the nodes (a bet mode's card). A
 * seed with no def is skipped. `defaultsFor` reads the project's defaults for a def, and is asked
 * only for a def that has a `component`-kind param. Defs come out in load order, so a doc that names
 * no component through a param resolves exactly as the plain instance walk did.
 *
 * The one closure the doc bake, the runtime bundle and the art export share, so a def one of them
 * ships the others ship too.
 */
export async function resolveComponentClosure(
	nodes: LayoutNode[],
	load: (id: string) => Promise<ComponentDef | null | undefined>,
	{
		extraSeedIds = [],
		defaultsFor,
	}: {
		extraSeedIds?: string[];
		defaultsFor?: (
			id: string,
		) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
	} = {},
): Promise<Record<string, ComponentDef>> {
	const defs: Record<string, ComponentDef> = {};
	const defaults: Record<string, Record<string, unknown>> = {};
	const seen = new Set<string>();
	let queue = [...collectComponentIds(nodes), ...extraSeedIds];
	while (queue.length) {
		while (queue.length) {
			const id = queue.shift()!;
			if (seen.has(id)) continue;
			seen.add(id);
			const def = await load(id);
			if (!def) continue;
			defs[id] = def;
			if (defaultsFor && componentParamKeys(def).length) {
				const own = await defaultsFor(id);
				if (own) defaults[id] = own;
			}
			for (const nested of collectComponentIds([def.root])) {
				if (!seen.has(nested)) queue.push(nested);
			}
		}
		const scanned = [...nodes, ...Object.values(defs).map((def) => def.root)];
		queue = collectParamComponentIds(scanned, defs, defaults).filter((id) => !seen.has(id));
	}
	return defs;
}

/**
 * The effect ids PLACED as `effect` nodes in `nodes` (a doc's scenes, flattened) and in every def's
 * tree (`defs`, the closure of the placed instances), recursing into container children — a bind
 * part's skin included. An instance is not expanded: its def is walked once, in `defs`. The game
 * skips these when it auto-mounts free effects at the stage origin (an FX inside a Pot mounts on the
 * pot), and the launcher keeps them when it prunes the effects a bundle ships.
 */
export function collectPlacedEffectIds(
	nodes: readonly LayoutNode[],
	defs: Iterable<ComponentDef> = [],
): Set<string> {
	const ids = new Set<string>();
	const walk = (list: readonly LayoutNode[] | undefined): void => {
		for (const node of list ?? []) {
			if (node.kind === 'effect' && typeof node.effectId === 'string' && node.effectId) {
				ids.add(node.effectId);
			} else if (node.kind === 'container') walk(node.children);
		}
	};
	walk(nodes);
	for (const def of defs) if (def.root) walk([def.root]);
	return ids;
}

/** A `componentInstance`'s explicit version pin (`componentVersion` set). */
export interface ComponentPin {
	id: string;
	version: number;
}

/**
 * Collect every EXPLICIT `(componentId, componentVersion)` pin in a node tree
 * (§8.9 v2). Only instances that pin a version are returned — an instance with no
 * `componentVersion` follows latest and needs no historical def shipped. Deduped by
 * `id@version`. The bake uses this to ship the EXACT pinned defs (not just latest)
 * so a shipped game renders the version each instance was authored against; without
 * a pin nothing here changes and the bundle stays byte-identical (parity).
 */
export function collectComponentPins(nodes: LayoutNode[]): ComponentPin[] {
	const seen = new Set<string>();
	const out: ComponentPin[] = [];
	const walk = (node: LayoutNode): void => {
		if (node.kind === 'componentInstance' && typeof node.componentVersion === 'number') {
			const tag = `${node.componentId}@${node.componentVersion}`;
			if (!seen.has(tag)) {
				seen.add(tag);
				out.push({ id: node.componentId, version: node.componentVersion });
			}
		}
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) children.forEach(walk);
	};
	for (const node of nodes) walk(node);
	return out;
}
