import {
	DEFAULT_SWIPE_THRESHOLD,
	type NodeListenerEvent,
	type PointerPayloadField,
	type SwipeFilter,
} from './types';

/**
 * The POINTER of a component listener (game-families §3.2, P10.4), pure and Pixi-free like the
 * dispatcher it feeds: `LayoutNodeView`'s listener wrapper hands a {@link PointerGesture} the Pixi
 * events, already put in the instance's space, and the gesture turns them into the listener events
 * with the reading each carries.
 *
 * A drag keeps tracking off the node: the wrapper feeds {@link PointerGesture.move} from
 * `globalpointermove` and {@link PointerGesture.release} from `pointerupoutside` as well as
 * `pointerup`, so a press that leaves the node still drags and still ends.
 */

export interface PointerPoint {
	x: number;
	y: number;
}

/**
 * Where the pointer is when a listener runs: `x` / `y` in the instance's space (its root's), `dx` /
 * `dy` from where the press on the node began (0 with no press), and `global`, the stage point an
 * Align Target maps into its target's parent.
 */
export interface PointerAt extends Record<PointerPayloadField, number> {
	global: PointerPoint;
}

/** How far (instance pixels) a press must travel before it is a drag: a tap's jitter is not one. */
export const DRAG_SLOP = 4;

interface Press {
	id: number;
	start: PointerPoint;
	/** The last move heard: Pixi hands `globalpointermove` twice to a container that is both under
	 *  the pointer and an interactive ancestor of what is, so a repeat of it is not a move. */
	last: PointerPoint;
	dragging: boolean;
}

export class PointerGesture {
	private press: Press | undefined;
	private readonly send: (event: NodeListenerEvent, at: PointerAt) => void;
	private readonly slop: number;

	constructor(send: (event: NodeListenerEvent, at: PointerAt) => void, slop = DRAG_SLOP) {
		this.send = send;
		this.slop = slop;
	}

	/** The reading at `local` (`global` on the stage), against the press when there is one. */
	at(local: PointerPoint, global: PointerPoint): PointerAt {
		const start = this.press?.start;
		return {
			x: local.x,
			y: local.y,
			dx: start ? local.x - start.x : 0,
			dy: start ? local.y - start.y : 0,
			global: { x: global.x, y: global.y },
		};
	}

	/** `pointerdown` on the node: a press begins, unless another pointer's press is still on (a
	 *  second finger is a `down`, but the first press keeps the drag, so it still ends). */
	down(id: number, local: PointerPoint, global: PointerPoint): void {
		if (this.press && this.press.id !== id) {
			this.send('down', this.at(local, global));
			return;
		}
		const start = { x: local.x, y: local.y };
		this.press = { id, start, last: start, dragging: false };
		this.send('down', this.at(local, global));
	}

	/** `pointermove` over the node. */
	hover(local: PointerPoint, global: PointerPoint): void {
		this.send('move', this.at(local, global));
	}

	/** A move anywhere (`globalpointermove`): the press's own pointer drags once past the slop; a
	 *  move to where it already was is none. */
	move(id: number, local: PointerPoint, global: PointerPoint): void {
		const press = this.press;
		if (!press || press.id !== id) return;
		if (local.x === press.last.x && local.y === press.last.y) return;
		press.last = { x: local.x, y: local.y };
		if (!press.dragging) {
			if (Math.hypot(local.x - press.start.x, local.y - press.start.y) < this.slop) return;
			press.dragging = true;
			this.send('dragStart', this.at(local, global));
		}
		this.send('drag', this.at(local, global));
	}

	/**
	 * A release: `over` is `pointerup` on the node (it sends `up`, as it always has, pressed here or
	 * not), else `pointerupoutside`. The press's own release then ends its drag and offers a swipe.
	 */
	release(id: number, local: PointerPoint, global: PointerPoint, over: boolean): void {
		const at = this.at(local, global);
		if (over) this.send('up', at);
		const press = this.press;
		if (!press || press.id !== id) return;
		this.press = undefined;
		if (press.dragging) this.send('dragEnd', at);
		this.send('swipe', at);
	}

	/** A plain event (`enter`, `leave`, `click`) at the current reading. */
	plain(event: NodeListenerEvent, local: PointerPoint, global: PointerPoint): void {
		this.send(event, this.at(local, global));
	}
}

/**
 * Does a release `at` this far from its press answer a `swipe` listener's filter? It travelled at
 * least the threshold, and its dominant axis (a tie reads as horizontal) points the asked way.
 */
export function swipeMatches(
	filter: SwipeFilter | undefined,
	at: Pick<PointerAt, 'dx' | 'dy'>,
): boolean {
	const threshold = filter?.threshold ?? DEFAULT_SWIPE_THRESHOLD;
	if (Math.hypot(at.dx, at.dy) < threshold || (at.dx === 0 && at.dy === 0)) return false;
	if (!filter?.direction) return true;
	const direction =
		Math.abs(at.dx) >= Math.abs(at.dy) ? (at.dx > 0 ? 'right' : 'left') : at.dy > 0 ? 'down' : 'up';
	return direction === filter.direction;
}
