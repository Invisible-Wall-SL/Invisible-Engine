import { repeaterComponentIds } from './repeaterCount';
import { spawnableComponentIds } from './spawnLayerFields';
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
		// config side that owns them. This walk still ships the repeater's shared `componentId`, and a
		// count-mode repeater's first / middle / last segment variants.
		if (node.kind === 'repeater') for (const id of repeaterComponentIds(node)) ids.add(id);
		// A `spawnLayer` instantiates any of its `spawnable` components at runtime (game-families
		// §3.3), so each rides the chain like a placed instance: declared on the node for exactly this.
		if (node.kind === 'spawnLayer') for (const id of spawnableComponentIds(node)) ids.add(id);
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

/** What {@link resolveComponentClosure} takes beyond the nodes and the loader. */
export interface ComponentClosureOptions {
	extraSeedIds?: string[];
	onMissing?: (id: string) => void;
	defaultsFor?: (
		id: string,
	) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
}

/**
 * Every def `nodes` need, loaded through `load`: the instances they place, the defs those nest, and
 * the components their `component`-kind params name ({@link collectParamComponentIds}), until
 * nothing new turns up. `extraSeedIds` are ids named from outside the nodes (a bet mode's card). An
 * id with no def is skipped and handed to `onMissing`. `defaultsFor` reads the project's defaults
 * for a def, and is asked only for a def that has a `component`-kind param. Defs come out in load
 * order, so a doc that names no component through a param resolves exactly as the plain instance
 * walk did.
 *
 * The one closure the doc bake, the runtime bundle and the art export share, so a def one of them
 * ships the others ship too.
 */
export async function resolveComponentClosure(
	nodes: LayoutNode[],
	load: (id: string) => Promise<ComponentDef | null | undefined>,
	{ extraSeedIds = [], defaultsFor, onMissing }: ComponentClosureOptions = {},
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
			if (!def) {
				onMissing?.(id);
				continue;
			}
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

/**
 * {@link resolveComponentClosure} plus the exact older versions the placements in `nodes` pin
 * (§8.9), loaded through `loadVersion`; a pin the latest def already is needs no copy, and a store
 * that answers with another version (a built-in has only its coded def) ships nothing for it. A
 * pinned version can name a component its latest no longer does, through a node (a repeater variant
 * swapped since) or a `component`-kind param. The editor draws that one from the project's store,
 * so the closure follows the pinned versions too, or the game draws a fallback the author never
 * saw. A pin nested inside a def is not followed: the editor and the game both draw the latest.
 */
export async function resolveComponentClosureWithPins(
	nodes: LayoutNode[],
	load: (id: string) => Promise<ComponentDef | null | undefined>,
	loadVersion: (id: string, version: number) => Promise<ComponentDef | null | undefined>,
	options: ComponentClosureOptions = {},
): Promise<{ defs: Record<string, ComponentDef>; versions: ComponentDef[] }> {
	const missing = new Set<string>();
	const onMissing = (id: string): void => {
		if (missing.has(id)) return;
		missing.add(id);
		options.onMissing?.(id);
	};
	const defs = await resolveComponentClosure(nodes, load, { ...options, onMissing });
	const versions: ComponentDef[] = [];
	for (const pin of collectComponentPins(nodes)) {
		if (defs[pin.id]?.version === pin.version) continue;
		const pinned = await loadVersion(pin.id, pin.version);
		if (pinned?.version === pin.version) versions.push(pinned);
	}
	if (!versions.length) return { defs, versions };
	// The components a pinned version's params name, read against ITS params: its own defaults, the
	// project's defaults for it, and what the placements set.
	const paramIds: string[] = [];
	for (const def of versions) {
		if (!componentParamKeys(def).length) continue;
		const own = await options.defaultsFor?.(def.id);
		paramIds.push(
			...collectParamComponentIds(nodes, { [def.id]: def }, own ? { [def.id]: own } : {}),
		);
	}
	const reached = await resolveComponentClosure(
		versions.map((def) => def.root),
		async (id) => (Object.hasOwn(defs, id) ? defs[id] : missing.has(id) ? undefined : load(id)),
		{ ...options, extraSeedIds: paramIds, onMissing },
	);
	for (const [id, def] of Object.entries(reached)) if (!Object.hasOwn(defs, id)) defs[id] = def;
	return { defs, versions };
}
