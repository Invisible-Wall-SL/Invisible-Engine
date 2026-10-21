import {
	foldBoundTransform,
	nodeActorBindings,
	nodeActorOutputs,
	type NodeActorChannel,
	type NodeActorSample,
} from 'engine-layout';

/** The engine-drawn board's wrapper transform, in the base game's design space. */
export interface BoardDriveTransform {
	x: number;
	y: number;
	pivot: { x: number; y: number };
	scale: { x: number; y: number };
	rotation: number;
	alpha: number;
	visible: boolean;
}

export const BOARD_UNDRIVEN: BoardDriveTransform = Object.freeze({
	x: 0,
	y: 0,
	pivot: Object.freeze({ x: 0, y: 0 }),
	scale: Object.freeze({ x: 1, y: 1 }),
	rotation: 0,
	alpha: 1,
	visible: true,
});

/**
 * A base-game screen timeline's keys on the `reelGrid` node, as a transform around the board. The
 * node is a placeholder: the reels are `<Board>`, laid out from the node, never a `<LayoutNodeView>`,
 * so the fold that moves every other node cannot reach them. This runs that same fold
 * (`foldBoundTransform` over the node actor's bindings) from identity and applies it about the
 * node's own position (`origin`), as the node's container would, so the board moves, scales, turns
 * and fades as the editor previews the placeholder. Every field is set, so a channel that returns to
 * identity is applied rather than left at its last value.
 */
export function boardDriveTransform(
	channels: ReadonlySet<NodeActorChannel>,
	sample: NodeActorSample | undefined,
	origin: { x: number; y: number },
): BoardDriveTransform {
	const bindings = nodeActorBindings(channels);
	const offset = foldBoundTransform(
		{ x: 0, y: 0, scale: { x: 1, y: 1 }, rotation: 0, alpha: 1, visible: true },
		bindings,
		nodeActorOutputs(bindings, sample),
	);
	return {
		x: origin.x + offset.x,
		y: origin.y + offset.y,
		pivot: { x: origin.x, y: origin.y },
		scale: { x: offset.scale?.x ?? 1, y: offset.scale?.y ?? 1 },
		rotation: offset.rotation ?? 0,
		alpha: offset.alpha ?? 1,
		visible: offset.visible,
	};
}
