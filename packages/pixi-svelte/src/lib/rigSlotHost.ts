/**
 * ONE slot object per slot, shared by every rig binding that draws at that slot's depth.
 *
 * RigView allows exactly one Pixi container per slot: `addSlotObject(slot, c)` first calls
 * `removeSlotObject(slot)`, which pulls whatever was registered there OUT of the rig's children.
 * Since a rig binding is one keyframe, a rig that binds the same clip on `slot1` in two animations
 * mounts two `<RiggedFlipbook>`s — and the second `addSlotObject` silently evicted the first, whose
 * clip then played into a container the rig no longer contained. Seen live on the H1 tentacle: the
 * effect on `slot2` (one binding) showed, the clip on `slot1` (two bindings) did not.
 *
 * So the slot object is a HOST the bindings share: the first binding on a slot creates it and
 * registers it, later ones add themselves under it, and the last one out removes it. Rig drives
 * the host (position, rotation, scale, alpha from the slot's bone and colour, every frame), and the
 * bindings underneath inherit that exactly as the single container did.
 *
 * Generic over the container so the ref-counting is testable without pixi
 * (`fixtures/rigSlotHost.fixture.ts`); the components pass `() => new PIXI.Container()`.
 */

export interface SlotHostChild {
	parent: unknown;
	destroyed: boolean;
}

export interface SlotHostContainer<C extends SlotHostChild> extends SlotHostChild {
	addChild(child: C): unknown;
	removeChild(child: C): unknown;
	destroy(): void;
}

export interface SlotHostRig<C extends SlotHostChild, H extends SlotHostContainer<C>> {
	destroyed: boolean;
	addSlotObject(slot: string, container: H): void;
	removeSlotObject(container: H): void;
}

type Host<H> = { container: H; refs: number };

const hosts = new WeakMap<object, Map<string, Host<unknown>>>();

/**
 * Put `child` under the shared slot object for `slot` on `spine`, creating and registering the
 * host if this is the first binding there. Returns the detach function — call it from `onDestroy`;
 * the host is unregistered and destroyed when the last child detaches.
 */
export function attachToSlot<C extends SlotHostChild, H extends SlotHostContainer<C>>(
	rig: SlotHostRig<C, H>,
	slot: string,
	child: C,
	createHost: () => H,
): () => void {
	let bySlot = hosts.get(rig);
	if (!bySlot) {
		bySlot = new Map();
		hosts.set(rig, bySlot);
	}
	let host = bySlot.get(slot) as Host<H> | undefined;
	if (!host) {
		const container = createHost();
		rig.addSlotObject(slot, container);
		host = { container, refs: 0 };
		bySlot.set(slot, host);
	}
	host.refs += 1;
	host.container.addChild(child);
	const slots = bySlot;
	const mine = host;
	let detached = false;
	return () => {
		if (detached) return;
		detached = true;
		if (!child.destroyed && child.parent === mine.container) mine.container.removeChild(child);
		mine.refs -= 1;
		if (mine.refs > 0) return;
		if (slots.get(slot) === mine) slots.delete(slot);
		if (!rig.destroyed) rig.removeSlotObject(mine.container);
		if (!mine.container.destroyed) mine.container.destroy();
	};
}
