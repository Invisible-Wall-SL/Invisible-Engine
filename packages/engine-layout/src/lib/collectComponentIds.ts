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
		const children = (node as { children?: LayoutNode[] }).children;
		if (Array.isArray(children)) children.forEach(walk);
	};
	for (const node of nodes) walk(node);
	return [...ids];
}
