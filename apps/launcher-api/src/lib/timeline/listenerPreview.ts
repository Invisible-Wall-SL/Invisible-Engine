import type { LayoutNode, NodeListenerEvent } from 'engine-layout';

/**
 * The stage preview's POINTER (Rive plan Phase 6b): the editor canvas hit-tests its own drawing, so
 * this turns "the pointer is over node X / went down / came up" into the pointer events the game's
 * wrappers deliver (`LayoutNodeView`, Pixi), and hands each to the same `ComponentEventDispatcher`
 * the game runs. As in Pixi, an event goes to the node under the pointer and bubbles to every
 * listening node around it, deepest first; `enter` / `leave` fire as the set of listening nodes
 * under the pointer changes; `click` follows an `up` on a node that also took the `down`.
 */

/** `root` … the node `id`, or `[]` when it is not in the tree. */
export function nodePath(root: LayoutNode | undefined, id: string | null): LayoutNode[] {
	if (!root || !id) return [];
	const walk = (n: LayoutNode, trail: LayoutNode[]): LayoutNode[] | null => {
		const here = [...trail, n];
		if (n.id === id) return here;
		if (n.kind !== 'container') return null;
		for (const child of n.children) {
			const found = walk(child, here);
			if (found) return found;
		}
		return null;
	};
	return walk(root, []) ?? [];
}

/** The listening nodes from `root` down to the hit node `id`, deepest first. */
export function listeningChain(root: LayoutNode | undefined, id: string | null): LayoutNode[] {
	return nodePath(root, id)
		.filter((n) => n.on?.length)
		.reverse();
}

export interface Point {
	x: number;
	y: number;
}
/** What the hit-test reads of a node's transform: its parent-space placement. */
export interface HitTransform {
	x: number;
	y: number;
	rotation?: number;
	scale?: { x: number; y: number };
	visible: boolean;
}

/** `p` (in the space `t` places a node in) in that node's own space; null when a zero scale
 *  collapses it (nothing in it can be hit). */
export function toLocal(p: Point, t: HitTransform): Point | null {
	const sx = t.scale?.x ?? 1;
	const sy = t.scale?.y ?? 1;
	if (sx === 0 || sy === 0) return null;
	const dx = p.x - t.x;
	const dy = p.y - t.y;
	const cos = Math.cos(-(t.rotation ?? 0));
	const sin = Math.sin(-(t.rotation ?? 0));
	return { x: (dx * cos - dy * sin) / sx, y: (dx * sin + dy * cos) / sy };
}

/**
 * The DEEPEST node under `p`, topmost first among `nodes` (the last drawn wins) — into containers,
 * each child in its parent's local space (the composition the canvas draws with): a listener on a
 * nested node must hear the pointer. A hidden node and all inside it are skipped. A container
 * with children is hit through them (the game's hit area is its children's) — by its own box
 * only when it is bound to a value; a leaf by its own box (`inBox`, `p` in the node's parent
 * space). `transform(node, nested)` is the node's placement — top-level in the stage's space,
 * nested in its parent's.
 */
export function deepHit<T extends HitTransform>(
	nodes: readonly LayoutNode[],
	p: Point,
	transform: (node: LayoutNode, nested: boolean) => T,
	inBox: (node: LayoutNode, t: T, p: Point) => boolean,
	nested = false,
): string | null {
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		const t = transform(node, nested);
		if (!t.visible) continue;
		if (node.kind === 'container' && node.children.length) {
			const local = toLocal(p, t);
			const found = local && deepHit(node.children, local, transform, inBox, true);
			if (found) return found;
			if (!node.bind) continue;
		}
		if (inBox(node, t, p)) return node.id;
	}
	return null;
}

export class StagePointer {
	private over: LayoutNode[] = [];
	private pressed: LayoutNode[] = [];

	constructor(private readonly send: (node: LayoutNode, event: NodeListenerEvent) => void) {}

	/** The pointer is now over `chain` (deepest first): `leave` what it left, `enter` what it
	 *  entered. */
	move(chain: LayoutNode[]): void {
		const ids = new Set(chain.map((n) => n.id));
		const was = new Set(this.over.map((n) => n.id));
		for (const n of this.over) if (!ids.has(n.id)) this.send(n, 'leave');
		for (const n of chain) if (!was.has(n.id)) this.send(n, 'enter');
		this.over = chain;
	}

	down(chain: LayoutNode[]): void {
		this.move(chain);
		this.pressed = chain;
		for (const n of chain) this.send(n, 'down');
	}

	up(chain: LayoutNode[]): void {
		this.move(chain);
		for (const n of chain) this.send(n, 'up');
		const pressed = new Set(this.pressed.map((n) => n.id));
		for (const n of chain) if (pressed.has(n.id)) this.send(n, 'click');
		this.pressed = [];
	}

	/** The pointer left the stage (or the preview stopped): every node it was over is left. */
	leave(): void {
		this.move([]);
		this.pressed = [];
	}
}
