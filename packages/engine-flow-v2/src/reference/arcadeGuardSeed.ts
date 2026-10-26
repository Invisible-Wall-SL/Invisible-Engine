/**
 * Invisible Flow v2 — the CHARACTERS sample (`docs/design/game-families.md` §4.3, P10.11): a runner
 * crosses a yard a guard walks. The runner is played (its character's `topDown` controller reads
 * this flow's key map; a held touch steers it too); the guard runs on its brain — patrol the
 * `guardRoute` path, chase the runner once it is within 220 px, go back to patrolling beyond
 * 320 px — and the walls stop both of them. All of that is the config's
 * (`packages/engine-mechanics/fixtures/arcade-guard.rules.json`); this flow keeps the GAME:
 *
 *   - a round resets LIVES to 3 and SPOTTED to 0, then spawns the walls, the runner and the guard;
 *   - `characterState` into `chase` counts a SPOTTED;
 *   - `collide` of the runner and the guard costs a life, puts the runner back at the start
 *     (`moveTo`) and sends that guard back to patrolling (`setCharacterState`);
 *   - at no lives the guards rest (`setCharacterState` on every body tagged `guard`), the runner is
 *     handed to its brain, which stands still (`setCharacterControl`), the round-over screen holds
 *     until a tap, the field is cleared and a new round starts.
 *
 * It plays on `engine-layout`'s `arcadeGuardReferenceLayout()`. Not offered in Game Maker: it is
 * what `check:arcade-characters-loop` and `scripts/playtest/arcade-characters-play.mjs` play, and
 * stays off the runtime's import graph (`index.ts` does not export it).
 */

import type { DataEdge, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

import { ARCADE_FIELD_LAYER, ARCADE_SCREENS, ARCADE_TEMPLATE_ID } from './arcadeSeed';

/** The sample's components (`engine-layout` `ARCADE_GUARD`). */
export const GUARD_SAMPLE = {
	runner: 'arcadeRunner',
	guard: 'arcadeGuard',
	wallH: 'arcadeWallH',
	wallV: 'arcadeWallV',
} as const;

export const GUARD_VARIABLES = { lives: 'lives', spotted: 'spotted', playing: 'playing' } as const;

export const GUARD_START_LIVES = 3;

/** Where a round puts each piece, in field px (the config's field: 1422 × 800). */
export const GUARD_PLACES = {
	runner: { x: 120, y: 720 },
	guard: { x: 440, y: 190 },
	walls: [
		{ componentId: GUARD_SAMPLE.wallV, x: 711, y: 400 },
		{ componentId: GUARD_SAMPLE.wallH, x: 240, y: 400 },
		{ componentId: GUARD_SAMPLE.wallH, x: 1182, y: 400 },
	],
} as const;

/** The guard brain's states the flow names (the config's). */
export const GUARD_STATES = { patrol: 'patrol', chase: 'chase', rest: 'rest' } as const;

const START_TIMER = 'startRound';

const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const float = (value: number): DataSource => ({ kind: 'literal', type: { t: 'float' }, value });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });
const control = (value: 'controller' | 'brain'): DataSource => ({
	kind: 'literal',
	type: { t: 'enum', name: 'ArcadeCharacterControl' },
	value,
});

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
	const action = (id: string, ref: string, inputs: Record<string, DataSource>) =>
		add({ id, kind: 'action', ref, inputs });
	const when = (id: string, left: DataSource, right: DataSource) =>
		add({ id, kind: 'branch', guard: { all: [{ left, op: 'eq', right }] } });
	const show = (id: string, ref: string, awaitComplete = false) =>
		add({ id, kind: 'showContainer', ref, ...(awaitComplete ? { awaitComplete: true } : {}) });
	const hide = (id: string, ref: string) => add({ id, kind: 'hideContainer', ref });
	const setVar = (id: string, name: string, value: DataSource) =>
		add({ id, kind: 'setVariable', variable: name, inputs: { value } });
	const spawn = (id: string, componentId: string, at: { x: number; y: number }) =>
		add({
			id,
			kind: 'spawn',
			layer: ARCADE_FIELD_LAYER,
			componentId,
			inputs: { x: float(at.x), y: float(at.y) },
		});
	const startSoon = (id: string) =>
		add({
			id,
			kind: 'startTimer',
			timer: START_TIMER,
			inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: 50 } },
		});

	const signals = add({ id: 'ag_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	chain(pin('load'), [show('ag_load_show', ARCADE_SCREENS.loading)]);
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
		show(`${prefix}_show_hud`, ARCADE_SCREENS.hud),
	];
	const loaded = add({ id: 'ag_loaded', kind: 'event', ref: `complete:${ARCADE_SCREENS.loading}` });
	chain({ node: loaded, pin: 'exec' }, [...showGame('ag_loaded'), startSoon('ag_loaded_start')]);
	chain(pin('tapToStart'), [...showGame('ag_tapped'), startSoon('ag_tapped_start')]);

	// A round: reset the HUD, build the yard, spawn the runner and the guard.
	const onStart = add({ id: 'ag_on_start', kind: 'onTimer', timer: START_TIMER });
	chain({ node: onStart, pin: 'exec' }, [
		setVar('ag_round_lives', GUARD_VARIABLES.lives, int(GUARD_START_LIVES)),
		setVar('ag_round_spotted', GUARD_VARIABLES.spotted, int(0)),
		setVar('ag_round_playing', GUARD_VARIABLES.playing, bool(true)),
		...GUARD_PLACES.walls.map((wall, i) => spawn(`ag_round_wall${i}`, wall.componentId, wall)),
		spawn('ag_round_runner', GUARD_SAMPLE.runner, GUARD_PLACES.runner),
		spawn('ag_round_guard', GUARD_SAMPLE.guard, GUARD_PLACES.guard),
	]);

	// The guard's brain spotted the runner.
	const spotted = when('ag_spotted', trigger('to'), text(GUARD_STATES.chase));
	chain(pin('characterState'), [spotted]);
	chain({ node: spotted, pin: 'then' }, [
		add({
			id: 'ag_spotted_count',
			kind: 'changeVariable',
			variable: GUARD_VARIABLES.spotted,
			op: 'add',
			inputs: { by: int(1) },
		}),
	]);

	// Caught: a life, the runner back at the start, that guard back on its rounds.
	const caught = when('ag_caught_playing', variable(GUARD_VARIABLES.playing), bool(true));
	chain(pin('collide'), [caught]);
	chain({ node: caught, pin: 'then' }, [
		add({
			id: 'ag_caught_life',
			kind: 'changeVariable',
			variable: GUARD_VARIABLES.lives,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
		action('ag_caught_back', 'moveTo', {
			instance: trigger('a'),
			x: float(GUARD_PLACES.runner.x),
			y: float(GUARD_PLACES.runner.y),
		}),
		action('ag_caught_patrol', 'setCharacterState', {
			instance: trigger('b'),
			state: text(GUARD_STATES.patrol),
		}),
	]);

	// The last life: everyone stops, the round-over screen holds, the yard is cleared, again.
	const sweep = add({
		id: 'ag_over_sweep',
		kind: 'forEach',
		mode: 'sequence',
		inputs: { in: { kind: 'accessor', path: { on: 'live', layer: ARCADE_FIELD_LAYER } } },
	});
	const lastLife = add({
		id: 'ag_last_life',
		kind: 'onVariable',
		variable: GUARD_VARIABLES.lives,
		on: 'crosses',
		threshold: 0,
		direction: 'down',
	});
	chain({ node: lastLife, pin: 'exec' }, [
		setVar('ag_over_playing', GUARD_VARIABLES.playing, bool(false)),
		action('ag_over_rest', 'setCharacterState', {
			tagged: text('guard'),
			state: text(GUARD_STATES.rest),
		}),
		action('ag_over_stand', 'setCharacterControl', {
			tagged: text('player'),
			control: control('brain'),
		}),
		show('ag_over_show', ARCADE_SCREENS.over, true),
		hide('ag_over_hide', ARCADE_SCREENS.over),
		sweep,
	]);
	chain({ node: sweep, pin: 'body' }, [
		add({
			id: 'ag_over_gone',
			kind: 'despawn',
			inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
		}),
	]);
	chain({ node: sweep, pin: 'done' }, [startSoon('ag_again')]);

	return { nodes, exec, data };
};

export const ARCADE_GUARD_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: ARCADE_TEMPLATE_ID,
	graph: buildGraph(),
	containers: [
		{ id: ARCADE_SCREENS.basegame, sceneId: ARCADE_SCREENS.basegame, z: 0 },
		{ id: ARCADE_SCREENS.hud, sceneId: ARCADE_SCREENS.hud, z: 60 },
		{ id: ARCADE_SCREENS.over, sceneId: ARCADE_SCREENS.over, z: 80 },
		{ id: ARCADE_SCREENS.loading, sceneId: ARCADE_SCREENS.loading, z: 100 },
	],
	variables: [
		{ id: GUARD_VARIABLES.lives, type: 'int', initial: GUARD_START_LIVES, scope: 'game' },
		{ id: GUARD_VARIABLES.spotted, type: 'int', initial: 0, scope: 'game' },
		{ id: GUARD_VARIABLES.playing, type: 'bool', initial: false, scope: 'game' },
	],
	inputs: [
		{ action: 'left', keys: ['ArrowLeft', 'a'] },
		{ action: 'right', keys: ['ArrowRight', 'd'] },
		{ action: 'up', keys: ['ArrowUp', 'w'] },
		{ action: 'down', keys: ['ArrowDown', 's'] },
	],
};
