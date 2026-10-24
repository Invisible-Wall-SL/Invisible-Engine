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
 * `dy` from where the press on the node began (0 with no press), `global`, the stage point an
 * Align Target maps into its target's parent, and `press`, the press it belongs to (unique across
 * every node; 0 with no press), which is when an Align Target takes its offset again.
 */
export interface PointerAt extends Record<PointerPayloadField, number> {
	global: PointerPoint;
	press: number;
}

let pressSerial = 0;

/** How far (instance pixels) a press must travel before it is a drag: a tap's jitter is not one. */
export const DRAG_SLOP = 4;

interface Press {
	id: number;
	serial: number;
	start: PointerPoint;
	/** The last move heard: Pixi hands `globalpointermove` twice to a container that is both under
	 *  the pointer and an interactive ancestor of what is, so a repeat of it is not a move. */
	last: PointerPoint;
	lastGlobal: PointerPoint;
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
			press: this.press?.serial ?? 0,
		};
	}

	/**
	 * `pointerdown` on the node: a press begins. A press still on (another finger, or a touch the
	 * browser cancelled — Pixi forwards no `pointercancel`, so its release never comes) is
	 * replaced, its drag ended first at the last place it was heard, so no drag is left open.
	 */
	down(id: number, local: PointerPoint, global: PointerPoint): void {
		const old = this.press;
		if (old?.dragging) this.send('dragEnd', this.at(old.last, old.lastGlobal));
		const start = { x: local.x, y: local.y };
		this.press = {
			id,
			serial: ++pressSerial,
			start,
			last: start,
			lastGlobal: { x: global.x, y: global.y },
			dragging: false,
		};
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
		press.lastGlobal = { x: global.x, y: global.y };
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
