import type { LayoutNode, ValueBinding } from './types';

/**
 * Does this node draw inside a HIDE SLOT — a container that stays mounted, at the node's `zIndex`,
 * while the node itself unmounts on hide? A hidden node unmounts (shown again, a rig restarts and a
 * component fires `enter`), and Pixi re-adds a remounted child LAST among its equal-`zIndex`
 * siblings, so without the slot a node shown again draws over the siblings authored after it.
 *
 * True only for a node something can hide while its view lives: a layout gate (`visibleFor`, an
 * override's `visible`), a `visible` binding (its own or a timeline's — `bindings` is the fold's
 * `allBindings`), or a `hiddenUntilSignal` an instance gates (`revealGated`). Never for an instance
 * that may hoist a tap-to-continue surface (`hoistsTap`): that surface sorts among the node's
 * siblings, not inside it. So a hideable overlay instance, tap or not, still re-adds last when
 * shown again; overlays draw on top as a rule. Every other node renders bare, as before (parity).
 */
export function needsHideSlot(
	node: LayoutNode,
	bindings: readonly ValueBinding[] | undefined,
	revealGated: boolean,
	hoistsTap: boolean,
): boolean {
	if (hoistsTap) return false;
	if (node.visibleFor) return true;
	if (Object.values(node.overrides ?? {}).some((o) => o?.visible !== undefined)) return true;
	if (bindings?.some((b) => b.target === 'visible')) return true;
	return revealGated && !!node.hiddenUntilSignal;
}
