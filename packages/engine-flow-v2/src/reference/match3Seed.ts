/**
 * Invisible Flow v2 — the match-3 starter flow (`docs/design/game-families.md` §3.4, P10.5): the
 * doc a new rules-decided match-3 project opens on.
 *
 * It owns `load`, so it drives every screen, and it owns the RULES (§2.3): the board says what
 * happened, and this flow keeps the score, spends the moves and decides when a round is won or lost.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` swap it for the board and the HUD.
 *   - `boardReady` (every deal) sets the round's variables from the config: the score to 0, the
 *     moves left to the config's Moves, the target to its score goal; and opens the board to input.
 *   - `swap`, when it was accepted, spends a move; `match` adds the step's points.
 *   - `settled` checks the goal first, then the moves left. A won or lost round locks the board,
 *     holds on its screen until the player taps it, then deals a fresh board (a new round).
 *   - `noMoves` shuffles the board.
 *
 * The variables are `game`-scoped: a match-3 round starts at a deal, not at a spin press, so the
 * `boardReady` chain resets them rather than the engine's round reset.
 */

import type { ContainerRef, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

/** The match-3 template's id — its vocabulary's (`match3.ts`) and its starter flow's. Declared here,
 *  where nothing imports the standard palette, so a plain Node script can load the starter flow. */
export const MATCH3_TEMPLATE_ID = 'match3';

/** The screens a match-3 scaffold has (`engine-layout`'s match-3 scene set). */
export const MATCH3_SCREENS = {
	loading: 'loading',
	basegame: 'basegame',
	hud: 'match3Hud',
	won: 'roundWon',
	lost: 'roundLost',
} as const;

/** The starter flow's variables. A HUD readout binds one as `var:<id>`. */
export const MATCH3_VARIABLES = { score: 'score', movesLeft: 'movesLeft', target: 'target' };

const CONTAINERS: ContainerRef[] = [
	{ id: MATCH3_SCREENS.basegame, sceneId: MATCH3_SCREENS.basegame, z: 0 },
	{ id: MATCH3_SCREENS.hud, sceneId: MATCH3_SCREENS.hud, z: 60 },
	{ id: MATCH3_SCREENS.won, sceneId: MATCH3_SCREENS.won, z: 80 },
	{ id: MATCH3_SCREENS.lost, sceneId: MATCH3_SCREENS.lost, z: 80 },
	{ id: MATCH3_SCREENS.loading, sceneId: MATCH3_SCREENS.loading, z: 100 },
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });

/** A node before it is placed on the canvas. */
type Unplaced = Node extends infer N ? (N extends Node ? Omit<N, 'pos'> : never) : never;

const buildGraph = (): FlowDoc['graph'] => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	let row = 0;
	const add = (node: Unplaced): string => {
		nodes.push({ ...node, pos: { x: 260 * (nodes.length % 6), y: 120 * row } } as Node);
		return node.id;
	};
	const wire = (from: PinPath, to: string) => exec.push({ from, to: { node: to, pin: 'exec' } });
	/** Chain `ids` one after another off `from`. */
	const chain = (from: PinPath, ids: string[]) => {
		let tail = from;
		for (const id of ids) {
			wire(tail, id);
			tail = { node: id, pin: 'exec' };
		}
		row++;
	};
	const show = (id: string, ref: string, awaitComplete = false) =>
		add({ id, kind: 'showContainer', ref, ...(awaitComplete ? { awaitComplete: true } : {}) });
	const hide = (id: string, ref: string) => add({ id, kind: 'hideContainer', ref });
	const action = (id: string, ref: string, inputs?: Record<string, DataSource>) =>
		add({ id, kind: 'action', ref, ...(inputs ? { inputs } : {}) });

	const signals = add({ id: 'm3_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	chain(pin('load'), [show('m3_load_show', MATCH3_SCREENS.loading)]);
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, MATCH3_SCREENS.loading),
		show(`${prefix}_show_board`, MATCH3_SCREENS.basegame),
		show(`${prefix}_show_hud`, MATCH3_SCREENS.hud),
	];
	const completeLoading = add({
		id: 'm3_complete_loading',
		kind: 'event',
		ref: `complete:${MATCH3_SCREENS.loading}`,
	});
	chain({ node: completeLoading, pin: 'exec' }, showGame('m3_loaded'));
	chain(pin('tapToStart'), [
		add({
			id: 'm3_music',
			kind: 'fireCue',
			ref: 'soundMusic',
			inputs: {
				name: { kind: 'literal', type: { t: 'enum', name: 'MusicName' }, value: 'bgm_main' },
			},
		}),
		...showGame('m3_tapped'),
	]);

	chain(pin('boardReady'), [
		add({
			id: 'm3_reset_score',
			kind: 'setVariable',
			variable: MATCH3_VARIABLES.score,
			inputs: { value: int(0) },
		}),
		add({
			id: 'm3_reset_moves',
			kind: 'setVariable',
			variable: MATCH3_VARIABLES.movesLeft,
			inputs: { value: trigger('moves') },
		}),
		add({
			id: 'm3_reset_target',
			kind: 'setVariable',
			variable: MATCH3_VARIABLES.target,
			inputs: { value: trigger('target') },
		}),
		action('m3_input_on', 'boardSetInput', { enabled: bool(true) }),
	]);

	const accepted = add({
		id: 'm3_swap_accepted',
		kind: 'branch',
		guard: { all: [{ left: trigger('accepted'), op: 'eq', right: bool(true) }] },
	});
	chain(pin('swap'), [accepted]);
	wire(
		{ node: accepted, pin: 'then' },
		add({
			id: 'm3_spend_move',
			kind: 'changeVariable',
			variable: MATCH3_VARIABLES.movesLeft,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
	);

	chain(pin('match'), [
		add({
			id: 'm3_add_points',
			kind: 'changeVariable',
			variable: MATCH3_VARIABLES.score,
			op: 'add',
			inputs: { by: trigger('points') },
		}),
	]);

	// A round ends on its goal first: the move that reaches it wins even if it was the last one.
	const won = add({
		id: 'm3_goal_reached',
		kind: 'branch',
		guard: {
			all: [
				{ left: variable(MATCH3_VARIABLES.target), op: 'gt', right: int(0) },
				{
					left: variable(MATCH3_VARIABLES.score),
					op: 'gte',
					right: variable(MATCH3_VARIABLES.target),
				},
			],
		},
	});
	chain(pin('settled'), [won]);
	const roundOver = (prefix: string, screen: string): string[] => [
		action(`${prefix}_lock`, 'boardSetInput', { enabled: bool(false) }),
		show(`${prefix}_show`, screen, true),
		hide(`${prefix}_hide`, screen),
		action(`${prefix}_deal`, 'boardRefill'),
	];
	chain({ node: won, pin: 'then' }, roundOver('m3_won', MATCH3_SCREENS.won));
	const outOfMoves = add({
		id: 'm3_out_of_moves',
		kind: 'branch',
		guard: { all: [{ left: variable(MATCH3_VARIABLES.movesLeft), op: 'lte', right: int(0) }] },
	});
	wire({ node: won, pin: 'else' }, outOfMoves);
	chain({ node: outOfMoves, pin: 'then' }, roundOver('m3_lost', MATCH3_SCREENS.lost));

	chain(pin('noMoves'), [action('m3_shuffle', 'boardShuffle')]);

	return { nodes, exec, data: [] };
};

export const MATCH3_DRIVEN_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: MATCH3_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [
		{ id: MATCH3_VARIABLES.score, type: 'int', initial: 0, scope: 'game' },
		{ id: MATCH3_VARIABLES.movesLeft, type: 'int', initial: 0, scope: 'game' },
		{ id: MATCH3_VARIABLES.target, type: 'int', initial: 0, scope: 'game' },
	],
};
