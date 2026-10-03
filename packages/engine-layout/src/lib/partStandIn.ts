import type { ComponentDef, LayoutNode } from './types';

/**
 * The coded part an instance of `def` mounts as a STAND-IN (Phase 12c, `docs/design/hold-and-win.md`
 * §8): the part the def {@link ComponentDef.standsFor | stands for}, once its tree no longer binds
 * it — an author who deleted the Pot Meter's `Pot` part to draw the pot entirely with their own
 * nodes. `undefined` while the tree still binds the part (the part registers itself there) and for
 * a def that stands for nothing.
 */
export function partStandIn(def: ComponentDef): string | undefined {
	const part = def.standsFor;
	if (!part) return undefined;
	const binds = (node: LayoutNode): boolean =>
		node.bind?.component === part || (node.kind === 'container' && node.children.some(binds));
	return binds(def.root) ? undefined : part;
}
