import { resolveBoundValue } from './componentParams';
import type { LayoutNode } from './types';

/**
 * RIG-SLOT RIDERS (Rive plan Phase 8b, `BaseNode.rigSlot`): the pure half of hosting a node inside
 * a sibling rig's slot. A container's children are split once per render into the nodes drawn in
 * place and the riders its first rig child hosts; the rig renders each group of riders inside one
 * `<RigSlot>` per slot name, so the rig drives their transform and alpha every frame as it drives
 * any slot object. No rig among the siblings ⇒ no riders, every child draws where it is authored
 * (parity).
 */

export interface SlotRiderSplit {
	/** The first `spine` child — the host; `undefined` when the container has none. */
	host: LayoutNode | undefined;
	/** The children drawn in place, in order (the host among them). */
	inPlace: LayoutNode[];
	/** The children the host renders in its slots. */
	riders: LayoutNode[];
}

export function splitSlotRiders(children: readonly LayoutNode[]): SlotRiderSplit {
	const host = children.find((child) => child.kind === 'spine');
	if (!host) return { host: undefined, inPlace: [...children], riders: [] };
	const riders = children.filter((child) => child !== host && !!child.rigSlot);
	if (!riders.length) return { host, inPlace: [...children], riders: [] };
	return { host, inPlace: children.filter((child) => !riders.includes(child)), riders };
}

/** The slot a rider rides: its `rigSlot`, or the param it binds the field to when that is set. */
export function riderSlotName(rider: LayoutNode, params: Record<string, unknown>): string {
	const bound = resolveBoundValue(rider.paramBindings, 'rigSlot', params);
	return typeof bound === 'string' && bound ? bound : (rider.rigSlot ?? '');
}

/** Riders grouped by the slot they ride, in first-seen order — one `<RigSlot>` each. */
export function groupSlotRiders(
	riders: readonly LayoutNode[],
	params: Record<string, unknown>,
): { slot: string; riders: LayoutNode[] }[] {
	const groups: { slot: string; riders: LayoutNode[] }[] = [];
	for (const rider of riders) {
		const slot = riderSlotName(rider, params);
		if (!slot) continue;
		const group = groups.find((g) => g.slot === slot);
		if (group) group.riders.push(rider);
		else groups.push({ slot, riders: [rider] });
	}
	return groups;
}
