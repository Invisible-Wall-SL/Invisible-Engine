/**
 * Invisible Flow v2 — SALMONS' flow (P11.2; `docs/design/realtime-multiplayer.md` §4, §10): the
 * presentation of an online game, on `engine-layout`'s `salmonsReferenceLayout`. The room decides
 * everything; this flow only shows it.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` swap it for the river and the HUD.
 *   - The HUD binds `score`, `round` and `secondsLeft`, variables the room owns (`server`): the
 *     runtime writes them from each state, and nothing here may set them (`variable-server-owned`).
 *   - `roundEnd` shows the round-over screen, counting down to the next round on `secondsLeft`;
 *     `roundStart` hides it.
 *   - `ability` draws a bear's swipe or a fisherman's cast where it is used, for 300 ms. The
 *     device's own is raised on the press (`predicted`), so it is drawn before the room answers.
 *
 * Played by `scripts/playtest/salmons-play.mjs`; written into the project by
 * `scripts/salmons/export.mjs`. Not exported from the package entry, so no game bundles it.
 */

import type {
	ContainerRef,
	DataEdge,
	DataSource,
	ExecEdge,
	FlowDoc,
	Node,
	PinPath,
} from '../types';

import { ARCADE_FIELD_LAYER, ARCADE_SCREENS, ARCADE_TEMPLATE_ID } from './arcadeSeed';

/** The Salmons layout's own screens (`engine-layout` `SALMONS_SCREENS`). */
export const SALMONS_FLOW_SCREENS = { hud: 'salmonsHud', over: 'salmonsRoundOver' } as const;

/** The ability looks (`engine-layout` `SALMONS_CHARACTER_COMPONENTS`), by the character using one. */
export const SALMONS_ABILITY_LOOKS = { bear: 'salmonsSwipe', fisherman: 'salmonsCast' } as const;

/** How long a swipe or a cast stays drawn. */
export const SALMONS_ABILITY_MS = 300;

const CONTAINERS: ContainerRef[] = [
	{ id: ARCADE_SCREENS.basegame, sceneId: ARCADE_SCREENS.basegame, z: 0 },
	{ id: SALMONS_FLOW_SCREENS.hud, sceneId: SALMONS_FLOW_SCREENS.hud, z: 60 },
	{ id: SALMONS_FLOW_SCREENS.over, sceneId: SALMONS_FLOW_SCREENS.over, z: 80 },
	{ id: ARCADE_SCREENS.loading, sceneId: ARCADE_SCREENS.loading, z: 100 },
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });
const wired: DataSource = { kind: 'wire' };

/** A node before it is placed on the canvas. */
type Unplaced = Node extends infer N ? (N extends Node ? Omit<N, 'pos'> : never) : never;

const buildGraph = (): FlowDoc['graph'] => {
	const nodes: Node[] = [];
	const exec: ExecEdge[] = [];
	const data: DataEdge[] = [];
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

	const signals = add({ id: 'sm_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
		show(`${prefix}_show_hud`, SALMONS_FLOW_SCREENS.hud),
	];

	chain(pin('load'), [show('sm_load_show', ARCADE_SCREENS.loading)]);
	const completeLoading = add({
		id: 'sm_complete_loading',
		kind: 'event',
		ref: `complete:${ARCADE_SCREENS.loading}`,
	});
	chain({ node: completeLoading, pin: 'exec' }, showGame('sm_loaded'));
	chain(pin('tapToStart'), showGame('sm_tapped'));
	chain(pin('roundEnd'), [show('sm_over_show', SALMONS_FLOW_SCREENS.over)]);
	chain(pin('roundStart'), [hide('sm_over_hide', SALMONS_FLOW_SCREENS.over)]);

	// A swipe or a cast where it is used, gone again after a moment.
	const looks = Object.entries(SALMONS_ABILITY_LOOKS);
	const branches = looks.map(([character]) =>
		add({
			id: `sm_ability_${character}`,
			kind: 'branch',
			guard: { all: [{ left: trigger('character'), op: 'eq', right: text(character) }] },
		}),
	);
	branches.forEach((branch, i) => {
		const [character, componentId] = looks[i];
		const spawn = add({
			id: `sm_ability_${character}_spawn`,
			kind: 'spawn',
			layer: ARCADE_FIELD_LAYER,
			componentId,
			inputs: { x: trigger('x'), y: trigger('y') },
		});
		const wait = add({
			id: `sm_ability_${character}_wait`,
			kind: 'delay',
			inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: SALMONS_ABILITY_MS } },
		});
		const gone = add({
			id: `sm_ability_${character}_gone`,
			kind: 'despawn',
			inputs: { instance: wired },
		});
		data.push({ from: { node: spawn, pin: 'instance' }, to: { node: gone, pin: 'instance' } });
		chain({ node: branch, pin: 'then' }, [spawn, wait, gone]);
	});
	branches.forEach((branch, i) =>
		exec.push({
			from: i ? { node: branches[i - 1], pin: 'else' } : pin('ability'),
			to: { node: branch, pin: 'exec' },
		}),
	);
	return { nodes, exec, data };
};

export const SALMONS_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: ARCADE_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [
		{ id: 'score', type: 'int', initial: 0, scope: 'game', server: 'score' },
		{ id: 'round', type: 'int', initial: 0, scope: 'game', server: 'round' },
		{ id: 'secondsLeft', type: 'int', initial: 0, scope: 'game', server: 'secondsLeft' },
	],
};
