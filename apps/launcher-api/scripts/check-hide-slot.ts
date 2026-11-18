/**
 * Offline check for the HIDE SLOT (engine-layout `hideSlot.ts`, `LayoutNodeView.svelte`):
 *   pnpm check:all --only apps/launcher-api/scripts/check-hide-slot.ts
 *
 * A node hides by unmounting, and pixi-svelte mounts a child with `addChild` + `sortChildren`, so a
 * node shown again lands LAST among its equal-`zIndex` siblings: a rig a component's state machine
 * hides then shows jumped over the frame authored after it. Pins, against real Pixi containers:
 *   - which nodes take a slot: a layout gate, a `visible` binding (own or a timeline's), a gated
 *     `hiddenUntilSignal`; never a plain node, an ungated reveal, or an instance that hoists a tap;
 *   - background < rig < frame, the rig hidden then shown in its slot, draws in the same order;
 *   - a never-hidden sibling stays a direct child of the parent (no wrapper — parity);
 *   - `LayoutNodeView` renders the body in the slot and pixi-svelte still mounts by add + sort (the
 *     two facts the ordering above models).
 */
import { readFileSync } from 'node:fs';
import { Container } from 'pixi.js';

import { nodeActorBindings } from '../../../packages/engine-layout/src/lib/cinematicNodes.ts';
import { needsHideSlot } from '../../../packages/engine-layout/src/lib/hideSlot.ts';
import type { LayoutNode, ValueBinding } from 'engine-layout';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const node = (id: string, extra: Record<string, unknown> = {}): LayoutNode =>
	({ id, kind: 'sprite', transform: { x: 0, y: 0 }, ...extra }) as unknown as LayoutNode;
const timelineVisible = nodeActorBindings(new Set(['visible']));
const ownVisible: ValueBinding[] = [{ target: 'visible' } as ValueBinding];

console.log('which nodes take a slot');
check('a plain node does not', !needsHideSlot(node('a'), undefined, true, false));
check(
	'a node bound to x only does not',
	!needsHideSlot(node('a'), nodeActorBindings(new Set(['x'])), true, false),
);
check('a timeline visibility track does', needsHideSlot(node('a'), timelineVisible, true, false));
check('an own visible binding does', needsHideSlot(node('a'), ownVisible, false, false));
check(
	'a visibleFor gate does',
	needsHideSlot(node('a', { visibleFor: ['desktop'] }), undefined, false, false),
);
check(
	'an override visible does',
	needsHideSlot(
		node('a', { overrides: { portrait: { visible: false } } }),
		undefined,
		false,
		false,
	),
);
check(
	'an override without visible does not',
	!needsHideSlot(node('a', { overrides: { portrait: { x: 4 } } }), undefined, false, false),
);
check(
	'a gated hiddenUntilSignal does',
	needsHideSlot(node('a', { hiddenUntilSignal: 'go' }), undefined, true, false),
);
check(
	'an ungated hiddenUntilSignal does not',
	!needsHideSlot(node('a', { hiddenUntilSignal: 'go' }), undefined, false, false),
);
check(
	'an instance that may hoist a tap does not',
	!needsHideSlot(node('a'), timelineVisible, true, true),
);

// pixi-svelte's `addToParent`: add, then sort by zIndex (stable).
const mount = <T extends Container>(parent: Container, child: T): T => {
	parent.addChild(child);
	parent.sortChildren();
	return child;
};
const drawOrder = (root: Container): string[] => {
	const out: string[] = [];
	const walk = (c: Container): void => {
		for (const child of c.children) {
			if (child.label) out.push(child.label);
			walk(child);
		}
	};
	walk(root);
	return out;
};

/** A node view as `LayoutNodeView` mounts it: its body, in a slot when `needsHideSlot`. */
const view = (parent: Container, n: LayoutNode, bindings?: readonly ValueBinding[]) => {
	const host = needsHideSlot(n, bindings, false, false) ? mount(parent, new Container()) : parent;
	let body: Container | undefined = mount(host, new Container({ label: n.id }));
	return {
		body: () => body,
		hide: () => {
			body?.destroy();
			body = undefined;
		},
		show: () => {
			body = mount(host, new Container({ label: n.id }));
		},
	};
};

console.log('draw order across hide → show');
{
	const parent = new Container();
	view(parent, node('background'));
	const rig = view(parent, node('rig', { kind: 'spine' }), timelineVisible);
	const frame = view(parent, node('frame'));
	const before = drawOrder(parent).join(' < ');
	check('mounted in authored order', before === 'background < rig < frame', before);
	rig.hide();
	const hidden = drawOrder(parent).join(' < ');
	check('hidden, the rig draws nothing', hidden === 'background < frame', hidden);
	rig.show();
	const after = drawOrder(parent).join(' < ');
	check('shown again, the rig keeps its place', after === 'background < rig < frame', after);
	check('the rig slot is still the middle child', parent.getChildIndex(rig.body()!.parent!) === 1);
	check('a never-hidden sibling stays a direct child', frame.body()!.parent === parent);
	rig.hide();
	rig.show();
	const twice = drawOrder(parent).join(' < ');
	check('a second hide → show keeps it too', twice === 'background < rig < frame', twice);
}
{
	const parent = new Container();
	mount(parent, new Container({ label: 'background' }));
	const rig = mount(parent, new Container({ label: 'rig' }));
	mount(parent, new Container({ label: 'frame' }));
	rig.destroy();
	mount(parent, new Container({ label: 'rig' }));
	const bare = drawOrder(parent).join(' < ');
	check('without a slot a remount lands last (what the slot prevents)', bare.endsWith('rig'), bare);
}

console.log('the wiring the model above stands for');
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const nodeView = read('../../../packages/engine-layout/src/lib/LayoutNodeView.svelte');
check(
	'LayoutNodeView asks needsHideSlot once',
	/const hideSlot = untrack\([\s\S]*?needsHideSlot\(node, allBindings,/.test(nodeView),
);
check(
	'LayoutNodeView renders the body inside the slot at the node zIndex',
	/\{:else if hideSlot\}\s*<Container zIndex=\{transform\.zIndex\}>\s*\{@render nodeBody\(\)\}\s*<\/Container>/.test(
		nodeView,
	),
);
check(
	'the body still unmounts on hide (a rig restarts on show)',
	nodeView.includes('{#if transform.visible && revealed}'),
);
const pixiContext = read('../../../packages/pixi-svelte/src/lib/context.svelte.ts');
check(
	'pixi-svelte mounts a child by add + sort',
	/context\.parent\.addChild\(node\);\s*context\.parent\.sortChildren\(\);/.test(pixiContext),
);

if (failures) {
	console.log(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nhide slot: all checks passed');
