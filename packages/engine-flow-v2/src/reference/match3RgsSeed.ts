/**
 * Invisible Flow v2 — the RGS-decided match-3 starter flow (`docs/design/game-families.md` §2.2,
 * P10.6): the doc a new real-money match-3 project opens on.
 *
 * The server decides everything that is money or chance: it deals the board when the Spin button's
 * bet opens a round, resolves and refills every move, and closes the round. So unlike the rules
 * starter (`match3Seed.ts`) this flow keeps no score and no goal, never deals, refills or shuffles
 * (`withOutcome(vocab, 'rgs')` does not offer those actions), and holds no money: balance, win and
 * bet are the standard slot HUD's own engine readouts.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` swap it for the background, the
 *     board, the moves readout and the slot HUD (`hudBar`, `hudCorners`).
 *   - `boardReady` (a round's board landed) sets the moves left to the server's count and opens the
 *     board to input.
 *   - `swap`, when it was accepted, spends a move (never below 0).
 *   - `roundEnd` (the server closed the round) locks the board until the next bet.
 *
 * The variable is `game`-scoped, like the rules starter's: a round starts at the board's landing,
 * which the `boardReady` chain marks, not at the engine's round reset.
 */

import type { ContainerRef, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';
import { MATCH3_TEMPLATE_ID, MATCH3_VARIABLES } from './match3Seed';

/** The screens an RGS match-3 scaffold has (`engine-layout`'s `match3RgsReferenceLayout()`). */
export const MATCH3_RGS_SCREENS = {
	loading: 'loading',
	background: 'background',
	basegame: 'basegame',
	hud: 'match3Hud',
	hudBar: 'hudBar',
	hudCorners: 'hudCorners',
} as const;

const CONTAINERS: ContainerRef[] = [
	{ id: MATCH3_RGS_SCREENS.background, sceneId: MATCH3_RGS_SCREENS.background, z: -20 },
	{ id: MATCH3_RGS_SCREENS.basegame, sceneId: MATCH3_RGS_SCREENS.basegame, z: 0 },
	{ id: MATCH3_RGS_SCREENS.hud, sceneId: MATCH3_RGS_SCREENS.hud, z: 60 },
	{ id: MATCH3_RGS_SCREENS.hudBar, sceneId: MATCH3_RGS_SCREENS.hudBar, z: 60 },
	{ id: MATCH3_RGS_SCREENS.hudCorners, sceneId: MATCH3_RGS_SCREENS.hudCorners, z: 60 },
	{ id: MATCH3_RGS_SCREENS.loading, sceneId: MATCH3_RGS_SCREENS.loading, z: 100 },
];

/** The screens shown once play begins, back to front. */
const GAME_SCREENS = [
	MATCH3_RGS_SCREENS.background,
	MATCH3_RGS_SCREENS.basegame,
	MATCH3_RGS_SCREENS.hud,
	MATCH3_RGS_SCREENS.hudBar,
	MATCH3_RGS_SCREENS.hudCorners,
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });

/** A node before it is placed on the canvas. */
type Unplaced = Node extends infer N ? (N extends Node ? Omit<N, 'pos'> : never) : never;

const buildGraph = (): FlowDoc['graph'] => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	let row = 0;
	const add = (node: Unplaced): string => {
		nodes.push({ ...node, pos: { x: 260 * (nodes.length % 7), y: 120 * row } } as Node);
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
	const setInput = (id: string, enabled: boolean) =>
		add({ id, kind: 'action', ref: 'boardSetInput', inputs: { enabled: bool(enabled) } });

	const signals = add({ id: 'm3r_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	chain(pin('load'), [
		add({ id: 'm3r_load_show', kind: 'showContainer', ref: MATCH3_RGS_SCREENS.loading }),
	]);
	const showGame = (prefix: string) => [
		add({ id: `${prefix}_hide_loading`, kind: 'hideContainer', ref: MATCH3_RGS_SCREENS.loading }),
		...GAME_SCREENS.map((screen) =>
			add({ id: `${prefix}_show_${screen}`, kind: 'showContainer', ref: screen }),
		),
	];
	const completeLoading = add({
		id: 'm3r_complete_loading',
		kind: 'event',
		ref: `complete:${MATCH3_RGS_SCREENS.loading}`,
	});
	chain({ node: completeLoading, pin: 'exec' }, showGame('m3r_loaded'));
	chain(pin('tapToStart'), [
		add({
			id: 'm3r_music',
			kind: 'fireCue',
			ref: 'soundMusic',
			inputs: {
				name: { kind: 'literal', type: { t: 'enum', name: 'MusicName' }, value: 'bgm_main' },
			},
		}),
		...showGame('m3r_tapped'),
	]);

	chain(pin('boardReady'), [
		add({
			id: 'm3r_reset_moves',
			kind: 'setVariable',
			variable: MATCH3_VARIABLES.movesLeft,
			inputs: { value: trigger('moves') },
		}),
		setInput('m3r_input_on', true),
	]);

	const accepted = add({
		id: 'm3r_swap_accepted',
		kind: 'branch',
		guard: { all: [{ left: trigger('accepted'), op: 'eq', right: bool(true) }] },
	});
	chain(pin('swap'), [accepted]);
	wire(
		{ node: accepted, pin: 'then' },
		add({
			id: 'm3r_spend_move',
			kind: 'changeVariable',
			variable: MATCH3_VARIABLES.movesLeft,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
	);

	chain(pin('roundEnd'), [setInput('m3r_input_off', false)]);

	return { nodes, exec, data: [] };
};

export const MATCH3_RGS_DRIVEN_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: MATCH3_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [{ id: MATCH3_VARIABLES.movesLeft, type: 'int', initial: 0, scope: 'game' }],
};
