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
