import type { ArcadeBrain, ArcadeBrainState, ArcadeBrainTransition } from 'game-config';
import { transitionText } from './characterEdit';

/**
 * A character's brain as the graph Invisible Characters draws (`docs/design/game-families.md`
 * §5.1): the Component Editor's state-machine look — an Entry pill wired to the initial state, an
 * Any pill for the `*` transitions, a card per state (its behaviour under the name) and an arrow
 * per transition labelled with its conditions. The pseudo nodes are placed, never saved; a
 * state's card place is its `pos`.
 */

export const ENTRY_NODE = '__entry';
export const ANY_NODE = '__any';
/** The Entry → initial-state arrow (not a transition: dragging Entry elsewhere re-points it). */
export const INITIAL_EDGE = '__initial';

export type BrainGraphNode = {
	id: string;
	kind: 'entry' | 'any' | 'state';
	label: string;
	pos: { x: number; y: number };
	state?: ArcadeBrainState;
};

export type BrainGraphEdge = {
	id: string;
	from: string;
	to: string;
	label: string;
	transition?: ArcadeBrainTransition;
};

/** Where a state without a `pos` is drawn: a row beside the pseudo nodes. */
const fallbackPos = (index: number) => ({ x: 240 + index * 220, y: 40 + (index % 2) * 120 });

export function brainGraph(brain: ArcadeBrain | undefined): {
	nodes: BrainGraphNode[];
	edges: BrainGraphEdge[];
} {
	const nodes: BrainGraphNode[] = [
		{ id: ENTRY_NODE, kind: 'entry', label: 'Entry', pos: { x: 0, y: 40 } },
		{ id: ANY_NODE, kind: 'any', label: 'Any', pos: { x: 0, y: 200 } },
	];
	const edges: BrainGraphEdge[] = [];
	if (!brain) return { nodes, edges };
	brain.states.forEach((state, i) => {
		nodes.push({
			id: state.id,
			kind: 'state',
			label: state.id,
			pos: state.pos ? { ...state.pos } : fallbackPos(i),
			state,
		});
	});
	if (brain.states.some((s) => s.id === brain.initial)) {
		edges.push({ id: INITIAL_EDGE, from: ENTRY_NODE, to: brain.initial, label: '' });
	}
	for (const transition of brain.transitions) {
		edges.push({
			id: transition.id,
			from: transition.from === '*' ? ANY_NODE : transition.from,
			to: transition.to,
			label: transitionText(transition),
			transition,
		});
	}
	return { nodes, edges };
}

/** The state or transition the inspector shows. */
export type BrainSelection = { kind: 'state' | 'transition'; id: string } | null;

/** What a wire dragged from `source` to `target` means. */
export type BrainConnection =
	{ kind: 'initial'; state: string } | { kind: 'transition'; from: string; to: string } | undefined;

export function brainConnection(source: string, target: string): BrainConnection {
	if (!source || !target || target === ENTRY_NODE || target === ANY_NODE) return undefined;
	if (source === ENTRY_NODE) return { kind: 'initial', state: target };
	return { kind: 'transition', from: source === ANY_NODE ? '*' : source, to: target };
}
