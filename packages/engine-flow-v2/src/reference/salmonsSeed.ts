/**
 * Invisible Flow v2 — SALMONS' flow (P11.2; `docs/design/realtime-multiplayer.md` §4, §10): the
 * presentation of an online game, on `engine-layout`'s `salmonsReferenceLayout`. The room decides
 * everything; this flow only shows it. The original game's screens (2026-11-18): no HUD.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` swap it for the river.
 *   - A game with a lobby (`rules.lobby`): while the room's `phase` is `waiting` the lobby screen
 *     (with the start menu) is up (checked as the game shows, and on the device's own `lobby`),
 *     with its countdown once `countdown` starts the clock; `roundStart` hides both.
 *   - `caught` of the device's own player shows the death screen; it goes once the room has the
 *     player back (`status`, a variable the room owns, is no longer `out`), or when the game is won.
 *   - `gameWon` (the first salmon at the source; the room locks) shows the win animation, whose
 *     button leaves for a new room; a `roundStart` (a game of rounds) hides it.
 *   - What those screens draw (the catcher's name, the winner, the buttons that respawn or leave
 *     for a new river) is drawn in code by the runtime (`engine-layout/salmons-art` `screens`);
 *     the golden salmon's gold, the fishing line and the bear's claw are drawn from the room's
 *     state, not here. The variables the room owns (`server`) are written by the runtime from each
 *     state, and nothing here may set them (`variable-server-owned`).
 *
 * Played by `scripts/playtest/salmons-play.mjs`; written into the project by
 * `scripts/salmons/export.mjs`. Not exported from the package entry, so no game bundles it.
 */

import type { ContainerRef, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

import { ARCADE_SCREENS, ARCADE_TEMPLATE_ID } from './arcadeSeed';

/** The Salmons layout's own screens (`engine-layout` `SALMONS_SCREENS`). */
export const SALMONS_FLOW_SCREENS = {
	caught: 'salmonsCaught',
	won: 'salmonsWon',
	lobby: 'salmonsLobby',
	countdown: 'salmonsCountdown',
} as const;

const CONTAINERS: ContainerRef[] = [
	{ id: ARCADE_SCREENS.basegame, sceneId: ARCADE_SCREENS.basegame, z: 0 },
	{ id: SALMONS_FLOW_SCREENS.caught, sceneId: SALMONS_FLOW_SCREENS.caught, z: 80 },
	{ id: SALMONS_FLOW_SCREENS.won, sceneId: SALMONS_FLOW_SCREENS.won, z: 82 },
	{ id: SALMONS_FLOW_SCREENS.lobby, sceneId: SALMONS_FLOW_SCREENS.lobby, z: 85 },
	{ id: SALMONS_FLOW_SCREENS.countdown, sceneId: SALMONS_FLOW_SCREENS.countdown, z: 86 },
	{ id: ARCADE_SCREENS.loading, sceneId: ARCADE_SCREENS.loading, z: 100 },
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });
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
	const chain = (from: PinPath, ids: string[]) => {
		let tail = from;
		for (const id of ids) {
			exec.push({ from: tail, to: { node: id, pin: 'exec' } });
			tail = { node: id, pin: 'exec' };
		}
		row++;
	};
	const show = (id: string, ref: string) => add({ id, kind: 'showContainer', ref });
	const hide = (id: string, ref: string) => add({ id, kind: 'hideContainer', ref });
	const mine = (id: string) =>
		add({
			id,
			kind: 'branch',
			guard: { all: [{ left: trigger('me'), op: 'eq', right: bool(true) }] },
		});

	const signals = add({ id: 'sm_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
	];

	chain(pin('load'), [show('sm_load_show', ARCADE_SCREENS.loading)]);
	const completeLoading = add({
		id: 'sm_complete_loading',
		kind: 'event',
		ref: `complete:${ARCADE_SCREENS.loading}`,
	});
	// The lobby (a game with `rules.lobby`): shown while the room waits for its first round, its
	// countdown once the clock runs; checked from the room's `phase` once the game shows (a signal
	// raised while the device still loads reaches no flow) and on the device's own `lobby`.
	const lobbyCheck = (prefix: string) => {
		const waiting = add({
			id: `${prefix}_waiting`,
			kind: 'branch',
			guard: { all: [{ left: variable('phase'), op: 'eq', right: text('waiting') }] },
		});
		const counting = add({
			id: `${prefix}_counting`,
			kind: 'branch',
			guard: { all: [{ left: variable('secondsLeft'), op: 'gt', right: int(0) }] },
		});
		chain({ node: waiting, pin: 'then' }, [
			show(`${prefix}_show_lobby`, SALMONS_FLOW_SCREENS.lobby),
			counting,
		]);
		chain({ node: counting, pin: 'then' }, [
			show(`${prefix}_show_countdown`, SALMONS_FLOW_SCREENS.countdown),
		]);
		return waiting;
	};
	chain({ node: completeLoading, pin: 'exec' }, [
		...showGame('sm_loaded'),
		lobbyCheck('sm_loaded'),
	]);
	chain(pin('tapToStart'), [...showGame('sm_tapped'), lobbyCheck('sm_tapped')]);
	const myLobby = mine('sm_lobby_mine');
	exec.push({ from: pin('lobby'), to: { node: myLobby, pin: 'exec' } });
	chain({ node: myLobby, pin: 'then' }, [lobbyCheck('sm_lobby')]);
	chain(pin('countdown'), [show('sm_countdown_show', SALMONS_FLOW_SCREENS.countdown)]);

	// The device's own player caught: the death screen, until the room has it back.
	const myCatch = mine('sm_caught_mine');
	exec.push({ from: pin('caught'), to: { node: myCatch, pin: 'exec' } });
	chain({ node: myCatch, pin: 'then' }, [show('sm_caught_show', SALMONS_FLOW_SCREENS.caught)]);
	const status = add({ id: 'sm_status', kind: 'onVariable', variable: 'status' });
	const back = add({
		id: 'sm_status_back',
		kind: 'branch',
		guard: { all: [{ left: variable('status'), op: 'ne', right: text('out') }] },
	});
	chain({ node: status, pin: 'exec' }, [back]);
	chain({ node: back, pin: 'then' }, [hide('sm_caught_hide', SALMONS_FLOW_SCREENS.caught)]);

	chain(pin('gameWon'), [
		hide('sm_won_caught_hide', SALMONS_FLOW_SCREENS.caught),
		show('sm_won_show', SALMONS_FLOW_SCREENS.won),
	]);
	chain(pin('roundStart'), [
		hide('sm_won_hide', SALMONS_FLOW_SCREENS.won),
		hide('sm_start_caught_hide', SALMONS_FLOW_SCREENS.caught),
		hide('sm_lobby_hide', SALMONS_FLOW_SCREENS.lobby),
		hide('sm_countdown_hide', SALMONS_FLOW_SCREENS.countdown),
	]);
	return { nodes, exec, data: [] };
};

export const SALMONS_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: ARCADE_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [
		{ id: 'secondsLeft', type: 'int', initial: 0, scope: 'game', server: 'secondsLeft' },
		{ id: 'phase', type: 'string', initial: '', scope: 'game', server: 'phase' },
		{ id: 'status', type: 'string', initial: 'free', scope: 'game', server: 'status' },
	],
};
