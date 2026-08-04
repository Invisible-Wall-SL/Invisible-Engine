import type { LayoutNode } from './types';

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
