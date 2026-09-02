/**
 * Repro fixture for "on the H1 animation I can only see the FX and not the flipbook".
 *
 * Models spine-pixi's one-object-per-slot rule (`addSlotObject` evicts the slot's previous
 * container from the spine) and drives two bindings onto one slot through `attachToSlot`, the
 * way `<RiggedFlipbook>` does for a clip keyed on `slot1` in two animations. Asserts that both
 * stay inside the rig, that spine only ever sees ONE object on the slot, and that the host goes
 * away with the last binding.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/spineSlotHost.fixture.ts
 */
import assert from 'node:assert/strict';

import { attachToSlot } from '../src/lib/spineSlotHost.ts';

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

/** spine-pixi's slot-object rule, verbatim: registering on a slot evicts the previous object. */
class FakeSpine extends FakeContainer {
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

/** Is `c` somewhere under the spine, i.e. would it draw with the rig? */
const insideRig = (spine: FakeSpine, c: FakeContainer): boolean => {
	let p = c.parent;
	while (p) {
		if (p === spine) return true;
		p = p.parent;
	}
	return false;
};

// ── The bug, without the host: the second binding evicts the first ─────────────────────────────
{
	const spine = new FakeSpine();
	const a = new FakeContainer('clip in animation');
	const b = new FakeContainer('clip in animation_copy');
	spine.addSlotObject('slot1', a);
	spine.addSlotObject('slot1', b);
	assert.equal(insideRig(spine, a), false, 'raw addSlotObject: the first binding is evicted');
	assert.equal(insideRig(spine, b), true);
}

// ── With the host: both bindings stay in, spine sees one object ────────────────────────────────
{
	const spine = new FakeSpine();
	let hosts = 0;
	const createHost = () => new FakeContainer(`host${++hosts}`);
	const a = new FakeContainer('clip in animation');
	const b = new FakeContainer('clip in animation_copy');
	const fx = new FakeContainer('effect on slot2');
	const detachA = attachToSlot(spine, 'slot1', a, createHost);
	const detachB = attachToSlot(spine, 'slot1', b, createHost);
	const detachFx = attachToSlot(spine, 'slot2', fx, createHost);
	assert.equal(insideRig(spine, a), true, 'first binding on slot1 draws with the rig');
	assert.equal(insideRig(spine, b), true, 'second binding on slot1 draws with the rig');
	assert.equal(insideRig(spine, fx), true);
	assert.equal(hosts, 2, 'one host per slot, not per binding');
	assert.equal(spine.registrations, 2, 'spine registered one object per slot');
	assert.equal(spine.slotObjects.get('slot1')?.children.length, 2, 'both under the slot1 host');

	// A binding leaving does not take the slot with it.
	detachA();
	assert.equal(a.parent, null, 'detached binding is out');
	assert.equal(insideRig(spine, b), true, 'the other binding still draws');
	assert.equal(spine.slotObjects.has('slot1'), true, 'host stays while a binding remains');

	// The last one out removes and destroys the host.
	const host1 = spine.slotObjects.get('slot1')!;
	detachB();
	assert.equal(spine.slotObjects.has('slot1'), false, 'last binding out unregisters the host');
	assert.equal(host1.destroyed, true, '…and destroys it');
	assert.equal(insideRig(spine, fx), true, 'slot2 untouched');

	// Re-attaching after teardown creates a fresh host (no stale map entry).
	const c = new FakeContainer('clip again');
	attachToSlot(spine, 'slot1', c, createHost);
	assert.equal(insideRig(spine, c), true);
	assert.equal(hosts, 3, 'a new host after the old one was torn down');

	// Detach is idempotent.
	detachFx();
	detachFx();
	assert.equal(spine.slotObjects.has('slot2'), false);
}

// ── A destroyed spine is not touched on detach ─────────────────────────────────────────────────
{
	const spine = new FakeSpine();
	const a = new FakeContainer('clip');
	const detach = attachToSlot(spine, 'slot1', a, () => new FakeContainer('host'));
	spine.destroyed = true;
	let removed = false;
	spine.removeSlotObject = () => {
		removed = true;
	};
	detach();
	assert.equal(removed, false, 'no removeSlotObject on a destroyed spine');
}

console.log('spineSlotHost fixture: all assertions passed');
