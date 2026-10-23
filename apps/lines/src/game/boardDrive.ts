import {
	foldBoundTransform,
	nodeActorBindings,
	nodeActorOutputs,
	resolveReelGridFromNode,
	resolveTransform,
	type LayoutType,
	type NodeActorChannel,
	type NodeActorSample,
	type ReelGridNode,
	type ResolvedTransform,
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

/** What a node actor's keys do to its node right now: the node fold, run from identity. */
function nodeActorOffset(
	channels: ReadonlySet<NodeActorChannel>,
	sample: NodeActorSample | undefined,
): ResolvedTransform {
	const bindings = nodeActorBindings(channels);
	return foldBoundTransform(
		{ x: 0, y: 0, scale: { x: 1, y: 1 }, rotation: 0, alpha: 1, visible: true },
		bindings,
		nodeActorOutputs(bindings, sample),
	);
}

/**
 * A base-game screen timeline's keys on the `reelGrid` node, as a transform around the board. The
 * node is a placeholder: the reels are `<Board>`, laid out from the node, never a `<LayoutNodeView>`,
 * so the fold that moves every other node cannot reach them. This runs that same fold from identity
 * and applies it about the node's own position (`origin`), as the node's container would, so the
 * board moves, scales, turns and fades as the editor previews the placeholder. With `layoutHeld`
 * the board's layout already sits where the keys put it ({@link heldReelGridNode}), so only the turn,
 * fade and visibility stay on the drawing, about that new position. Every field is set, so a channel
 * that returns to identity is applied rather than left at its last value.
 */
export function boardDriveTransform(
	channels: ReadonlySet<NodeActorChannel>,
	sample: NodeActorSample | undefined,
	origin: { x: number; y: number },
	layoutHeld = false,
): BoardDriveTransform {
	const offset = nodeActorOffset(channels, sample);
	const at = { x: origin.x + offset.x, y: origin.y + offset.y };
	return {
		...at,
		pivot: layoutHeld ? at : { x: origin.x, y: origin.y },
		scale: layoutHeld ? { x: 1, y: 1 } : { x: offset.scale?.x ?? 1, y: offset.scale?.y ?? 1 },
		rotation: offset.rotation ?? 0,
		alpha: offset.alpha ?? 1,
		visible: offset.visible,
	};
}

/**
 * The `reelGrid` node as an ended base-game timeline leaves it, for the board's layout: moved and
 * resized for the ratio on screen, so the reels, and the win line, flights and overlays placed from
 * `boardLayout()`, stay where the timeline put them. `undefined` when it leaves the grid as authored,
 * or in a pose the layout cannot carry, which then stays on the drawing alone: scaled unevenly (the
 * board scales its cells evenly), to nothing or flipped (the layout reads a scale of 0 or below as
 * 1), or on a grid the board is not laid out from (no usable cell size).
 */
export function heldReelGridNode(
	node: ReelGridNode,
	channels: ReadonlySet<NodeActorChannel>,
	sample: NodeActorSample | undefined,
	layoutType: LayoutType,
): ReelGridNode | undefined {
	const offset = nodeActorOffset(channels, sample);
	const s = offset.scale?.x ?? 1;
	if (!(s > 0) || Math.abs(s - (offset.scale?.y ?? 1)) > 1e-9) return undefined;
	if (offset.x === 0 && offset.y === 0 && s === 1) return undefined;
	if (!resolveReelGridFromNode(node, layoutType)) return undefined;
	const authored = resolveTransform(node, layoutType);
	// `boardLayout()` adds the nudge unscaled, where the drawing scaled it with the board about the
	// node: shift by the difference, so the layout lands where the drawing did.
	const nudge = { x: node.boardNudgeX ?? 0, y: node.boardNudgeY ?? 0 };
	return {
		...node,
		overrides: {
			...node.overrides,
			[layoutType]: {
				...node.overrides?.[layoutType],
				x: authored.x + offset.x + nudge.x * (s - 1),
				y: authored.y + offset.y + nudge.y * (s - 1),
				scale: { x: (authored.scale?.x ?? 1) * s, y: (authored.scale?.y ?? 1) * s },
			},
		},
	};
}
