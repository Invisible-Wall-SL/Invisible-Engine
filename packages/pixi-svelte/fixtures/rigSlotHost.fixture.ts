/**
 * Repro fixture for "on the H1 animation I can only see the FX and not the flipbook".
 *
 * Models RigView's one-object-per-slot rule (`addSlotObject` evicts the slot's previous
 * container from the rig) and drives two bindings onto one slot through `attachToSlot`, the
 * way `<RiggedFlipbook>` does for a clip keyed on `slot1` in two animations. Asserts that both
 * stay inside the rig, that rig only ever sees ONE object on the slot, and that the host goes
 * away with the last binding.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/rigSlotHost.fixture.ts
 */
import assert from 'node:assert/strict';

import { attachToSlot } from '../src/lib/rigSlotHost.ts';

class FakeContainer {
	parent: FakeContainer | null = null;
	destroyed = false;
	children: FakeContainer[] = [];
	label: string;
	constructor(label: string) {
		this.label = label;
	}
	addChild(c: FakeContainer) {
		c.parent = this;
		this.children.push(c);
	}
	removeChild(c: FakeContainer) {
		this.children = this.children.filter((x) => x !== c);
		if (c.parent === this) c.parent = null;
	}
	destroy() {
		this.destroyed = true;
	}
}

/** RigView's slot-object rule, verbatim: registering on a slot evicts the previous object. */
class FakeRig extends FakeContainer {
	slotObjects = new Map<string, FakeContainer>();
	registrations = 0;
	constructor() {
		super('spine');
	}
	addSlotObject(slot: string, container: FakeContainer) {
		this.registrations += 1;
		const prev = this.slotObjects.get(slot);
		if (prev) this.removeSlotObject(prev);
		this.addChild(container);
		this.slotObjects.set(slot, container);
	}
	removeSlotObject(container: FakeContainer) {
		for (const [slot, c] of this.slotObjects) {
			if (c === container) this.slotObjects.delete(slot);
		}
		this.removeChild(container);
	}
}

/** Is `c` somewhere under the rig, i.e. would it draw with the rig? */
const insideRig = (rig: FakeRig, c: FakeContainer): boolean => {
	let p = c.parent;
	while (p) {
		if (p === rig) return true;
		p = p.parent;
	}
	return false;
};

// ── The bug, without the host: the second binding evicts the first ─────────────────────────────
{
	const rig = new FakeRig();
	const a = new FakeContainer('clip in animation');
	const b = new FakeContainer('clip in animation_copy');
	rig.addSlotObject('slot1', a);
	rig.addSlotObject('slot1', b);
	assert.equal(insideRig(rig, a), false, 'raw addSlotObject: the first binding is evicted');
	assert.equal(insideRig(rig, b), true);
}

// ── With the host: both bindings stay in, rig sees one object ────────────────────────────────
{
	const rig = new FakeRig();
	let hosts = 0;
	const createHost = () => new FakeContainer(`host${++hosts}`);
	const a = new FakeContainer('clip in animation');
	const b = new FakeContainer('clip in animation_copy');
	const fx = new FakeContainer('effect on slot2');
	const detachA = attachToSlot(rig, 'slot1', a, createHost);
	const detachB = attachToSlot(rig, 'slot1', b, createHost);
	const detachFx = attachToSlot(rig, 'slot2', fx, createHost);
	assert.equal(insideRig(rig, a), true, 'first binding on slot1 draws with the rig');
	assert.equal(insideRig(rig, b), true, 'second binding on slot1 draws with the rig');
	assert.equal(insideRig(rig, fx), true);
	assert.equal(hosts, 2, 'one host per slot, not per binding');
	assert.equal(rig.registrations, 2, 'rig registered one object per slot');
	assert.equal(rig.slotObjects.get('slot1')?.children.length, 2, 'both under the slot1 host');

	// A binding leaving does not take the slot with it.
	detachA();
	assert.equal(a.parent, null, 'detached binding is out');
	assert.equal(insideRig(rig, b), true, 'the other binding still draws');
	assert.equal(rig.slotObjects.has('slot1'), true, 'host stays while a binding remains');

	// The last one out removes and destroys the host.
	const host1 = rig.slotObjects.get('slot1')!;
	detachB();
	assert.equal(rig.slotObjects.has('slot1'), false, 'last binding out unregisters the host');
	assert.equal(host1.destroyed, true, '…and destroys it');
	assert.equal(insideRig(rig, fx), true, 'slot2 untouched');

	// Re-attaching after teardown creates a fresh host (no stale map entry).
	const c = new FakeContainer('clip again');
	attachToSlot(rig, 'slot1', c, createHost);
	assert.equal(insideRig(rig, c), true);
	assert.equal(hosts, 3, 'a new host after the old one was torn down');

	// Detach is idempotent.
	detachFx();
	detachFx();
	assert.equal(rig.slotObjects.has('slot2'), false);
}

// ── A destroyed rig is not touched on detach ─────────────────────────────────────────────────
{
	const rig = new FakeRig();
	const a = new FakeContainer('clip');
	const detach = attachToSlot(rig, 'slot1', a, () => new FakeContainer('host'));
	rig.destroyed = true;
	let removed = false;
	rig.removeSlotObject = () => {
		removed = true;
	};
	detach();
	assert.equal(removed, false, 'no removeSlotObject on a destroyed rig');
}

console.log('rigSlotHost fixture: all assertions passed');
