/**
 * Invisible Flow v2 — the SCROLLING arcade sample (`docs/design/game-families.md` §4.4, P10.12): a
 * river longer than the screen. The salmon starts at the river's mouth (the world's bottom) and
 * swims up it; the camera follows it with a dead zone, eases and leads it; bears and fish are
 * spawned just above the view and drift down with the current; what the camera leaves behind is
 * despawned by the play field's `despawnOutsideView`. Reaching the spawning ground (a zone at the
 * top) scores a lap and sends the salmon, and the camera with a snap, back to the mouth. A bear
 * costs a life and shakes the camera; at no lives the round is over.
 *
 * It plays on `engine-layout`'s `arcadeRiverReferenceLayout()` and the config
 * `packages/engine-mechanics/fixtures/arcade-river.rules.json`. Not offered in Game Maker:
 * it is what `check:arcade-camera` and `scripts/playtest/arcade-camera-play.mjs` play, and stays off
 * the runtime's import graph (`index.ts` does not export it).
 */

import type { DataEdge, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

import {
	ARCADE_FIELD_LAYER,
	ARCADE_SAMPLE,
	ARCADE_SCREENS,
	ARCADE_START_LIVES,
	ARCADE_TEMPLATE_ID,
	ARCADE_VARIABLES,
} from './arcadeSeed';

/** The zone at the top of the river, in the river config. */
export const RIVER_GOAL_ZONE = 'spawningGround';
/** Points a lap is worth; a fish's. */
export const RIVER_LAP_POINTS = 100;
export const RIVER_FISH_POINTS = 10;
/** How far above the world's bottom the salmon starts. */
export const RIVER_START_LIFT = 120;
/** How far above the view's top a spawn appears (inside the field's despawn margin). */
export const RIVER_SPAWN_AHEAD = 120;
/** The camera's rattle when a bear hits. */
export const RIVER_SHAKE = { strength: 14, duration: 350 } as const;
const SPEED = 460;
const START_TIMER = 'startRound';

/** Each spawner: its timer, what it spawns, how often (ms) and how fast the current carries it. */
export const RIVER_SPAWNERS = [
	{ timer: 'spawnBear', componentId: ARCADE_SAMPLE.bear, every: 1100, vy: 90 },
	{ timer: 'spawnFish', componentId: ARCADE_SAMPLE.fish, every: 1500, vy: 60 },
] as const;

const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const float = (value: number): DataSource => ({ kind: 'literal', type: { t: 'float' }, value });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });
const ms = (value: number): DataSource => ({ kind: 'literal', type: { t: 'ms' }, value });
const wired: DataSource = { kind: 'wire' };
const engine = (key: string): DataSource => ({ kind: 'accessor', path: { on: 'engine', key } });

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
	const feed = (from: string, fromPin: string, to: string, toPin: string) =>
		data.push({ from: { node: from, pin: fromPin }, to: { node: to, pin: toPin } });
	const action = (id: string, ref: string, inputs?: Record<string, DataSource>) =>
		add({ id, kind: 'action', ref, ...(inputs ? { inputs } : {}) });
	const compute = (id: string, op: 'add' | 'sub' | 'div', a: DataSource, b: DataSource) =>
		add({ id, kind: 'compute', compute: { op, a, b } });
	const when = (id: string, left: DataSource, right: DataSource) =>
		add({ id, kind: 'branch', guard: { all: [{ left, op: 'eq', right }] } });
	const playing = (id: string) => when(id, variable(ARCADE_VARIABLES.playing), bool(true));
	const show = (id: string, ref: string, awaitComplete = false) =>
		add({ id, kind: 'showContainer', ref, ...(awaitComplete ? { awaitComplete: true } : {}) });
	const hide = (id: string, ref: string) => add({ id, kind: 'hideContainer', ref });
	const setVar = (id: string, name: string, value: DataSource) =>
		add({ id, kind: 'setVariable', variable: name, inputs: { value } });

	const signals = add({ id: 'rv_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	/** Where a lap starts: the river's mouth, across the middle. */
	const mouth = (prefix: string): { x: string; y: string } => ({
		x: compute(`${prefix}_x`, 'div', engine('fieldWidth'), float(2)),
		y: compute(`${prefix}_y`, 'sub', engine('fieldHeight'), float(RIVER_START_LIFT)),
	});

	const startSoon = (id: string) =>
		add({ id, kind: 'startTimer', timer: START_TIMER, inputs: { ms: ms(50) } });
	chain(pin('load'), [show('rv_load_show', ARCADE_SCREENS.loading)]);
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
		show(`${prefix}_show_hud`, ARCADE_SCREENS.hud),
	];
	const loaded = add({ id: 'rv_loaded', kind: 'event', ref: `complete:${ARCADE_SCREENS.loading}` });
	chain({ node: loaded, pin: 'exec' }, [...showGame('rv_loaded'), startSoon('rv_loaded_start')]);
	chain(pin('tapToStart'), [...showGame('rv_tapped'), startSoon('rv_tapped_start')]);

	// A round: reset, spawn the salmon at the mouth, follow it (snapped), start the spawners.
	const start = mouth('rv_round_mouth');
	const salmon = add({
		id: 'rv_round_salmon',
		kind: 'spawn',
		layer: ARCADE_FIELD_LAYER,
		componentId: ARCADE_SAMPLE.player,
		inputs: { x: wired, y: wired },
	});
	feed(start.x, 'out', salmon, 'x');
	feed(start.y, 'out', salmon, 'y');
	const onStart = add({ id: 'rv_on_start', kind: 'onTimer', timer: START_TIMER });
	chain({ node: onStart, pin: 'exec' }, [
		setVar('rv_round_score', ARCADE_VARIABLES.score, int(0)),
		setVar('rv_round_lives', ARCADE_VARIABLES.lives, int(ARCADE_START_LIVES)),
		setVar('rv_round_playing', ARCADE_VARIABLES.playing, bool(true)),
		salmon,
		action('rv_round_follow', 'cameraFollow', { tagged: text('player'), snap: bool(true) }),
		...RIVER_SPAWNERS.map((s) =>
			add({
				id: `rv_round_${s.timer}`,
				kind: 'startTimer',
				timer: s.timer,
				repeat: true,
				inputs: { ms: ms(s.every) },
			}),
		),
	]);

	// Spawn ahead: just above the view's top edge, at a seeded x, carried down by the current.
	for (const s of RIVER_SPAWNERS) {
		const on = add({ id: `rv_on_${s.timer}`, kind: 'onTimer', timer: s.timer });
		const gate = playing(`rv_${s.timer}_playing`);
		const y = compute(`rv_${s.timer}_y`, 'sub', engine('cameraY'), float(RIVER_SPAWN_AHEAD));
		const spawn = add({
			id: `rv_${s.timer}_spawn`,
			kind: 'spawn',
			layer: ARCADE_FIELD_LAYER,
			componentId: s.componentId,
			inputs: { x: engine('randomX'), y: wired },
		});
		feed(y, 'out', spawn, 'y');
		const drift = action(`rv_${s.timer}_drift`, 'setVelocity', {
			instance: wired,
			vx: float(0),
			vy: float(s.vy),
		});
		feed(spawn, 'instance', drift, 'instance');
		chain({ node: on, pin: 'exec' }, [gate]);
		chain({ node: gate, pin: 'then' }, [spawn, drift]);
	}

	// Four-way steering while a key is held.
	for (const [key, vx, vy] of [
		['left', -SPEED, undefined],
		['right', SPEED, undefined],
		['up', undefined, -SPEED],
		['down', undefined, SPEED],
	] as const) {
		const axis = vx !== undefined ? 'vx' : 'vy';
		const down = add({ id: `rv_${key}_down`, kind: 'onInput', action: key, phase: 'down' });
		const gate = playing(`rv_${key}_playing`);
		chain({ node: down, pin: 'exec' }, [gate]);
		chain({ node: gate, pin: 'then' }, [
			action(`rv_${key}_go`, 'setVelocity', {
				tagged: text('player'),
				[axis]: float((vx ?? vy) as number),
			}),
		]);
		const up = add({ id: `rv_${key}_up`, kind: 'onInput', action: key, phase: 'up' });
		chain({ node: up, pin: 'exec' }, [
			action(`rv_${key}_stop`, 'setVelocity', { tagged: text('player'), [axis]: float(0) }),
		]);
	}

	// Touches: a bear takes a life and shakes the camera; a fish scores.
	const touching = playing('rv_touch_playing');
	chain(pin('collide'), [touching]);
	const bear = when('rv_touch_hazard', trigger('tagB'), text('hazard'));
	chain({ node: touching, pin: 'then' }, [bear]);
	chain({ node: bear, pin: 'then' }, [
		add({ id: 'rv_hit_gone', kind: 'despawn', inputs: { instance: trigger('b') } }),
		action('rv_hit_shake', 'cameraShake', {
			strength: float(RIVER_SHAKE.strength),
			duration: float(RIVER_SHAKE.duration),
		}),
		add({
			id: 'rv_hit_life',
			kind: 'changeVariable',
			variable: ARCADE_VARIABLES.lives,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
	]);
	const fish = when('rv_touch_pickup', trigger('tagB'), text('pickup'));
	exec.push({ from: { node: bear, pin: 'else' }, to: { node: fish, pin: 'exec' } });
	chain({ node: fish, pin: 'then' }, [
		add({ id: 'rv_catch_gone', kind: 'despawn', inputs: { instance: trigger('b') } }),
		add({
			id: 'rv_catch_score',
			kind: 'changeVariable',
			variable: ARCADE_VARIABLES.score,
			op: 'add',
			inputs: { by: int(RIVER_FISH_POINTS) },
		}),
	]);

	// A lap: the salmon reached the spawning ground — score it, back to the mouth, camera snapped.
	const lapPlaying = playing('rv_lap_playing');
	chain(pin('enterZone'), [lapPlaying]);
	const goal = when('rv_lap_goal', trigger('zone'), text(RIVER_GOAL_ZONE));
	chain({ node: lapPlaying, pin: 'then' }, [goal]);
	const back = mouth('rv_lap_mouth');
	const moveBack = action('rv_lap_back', 'moveTo', { tagged: text('player'), x: wired, y: wired });
	feed(back.x, 'out', moveBack, 'x');
	feed(back.y, 'out', moveBack, 'y');
	chain({ node: goal, pin: 'then' }, [
		add({
			id: 'rv_lap_score',
			kind: 'changeVariable',
			variable: ARCADE_VARIABLES.score,
			op: 'add',
			inputs: { by: int(RIVER_LAP_POINTS) },
		}),
		moveBack,
		action('rv_lap_follow', 'cameraFollow', { tagged: text('player'), snap: bool(true) }),
	]);

	// The round ends at no lives: stop spawning, hold round-over, clear the river, play again.
	const sweep = add({
		id: 'rv_over_sweep',
		kind: 'forEach',
		mode: 'sequence',
		inputs: { in: { kind: 'accessor', path: { on: 'live', layer: ARCADE_FIELD_LAYER } } },
	});
	const lastLife = add({
		id: 'rv_last_life',
		kind: 'onVariable',
		variable: ARCADE_VARIABLES.lives,
		on: 'crosses',
		threshold: 0,
		direction: 'down',
	});
	chain({ node: lastLife, pin: 'exec' }, [
		setVar('rv_over_playing', ARCADE_VARIABLES.playing, bool(false)),
		...RIVER_SPAWNERS.map((s) =>
			add({ id: `rv_over_${s.timer}`, kind: 'stopTimer', timer: s.timer }),
		),
		action('rv_over_still', 'setVelocity', { tagged: text('player'), vx: float(0), vy: float(0) }),
		show('rv_over_show', ARCADE_SCREENS.over, true),
		hide('rv_over_hide', ARCADE_SCREENS.over),
		sweep,
	]);
	chain({ node: sweep, pin: 'body' }, [
		add({
			id: 'rv_over_gone',
			kind: 'despawn',
			inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
		}),
	]);
	chain({ node: sweep, pin: 'done' }, [startSoon('rv_again')]);

	return { nodes, exec, data };
};

export const ARCADE_RIVER_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: ARCADE_TEMPLATE_ID,
	// `@__PURE__`: a runtime built without this family drops the seed.
	graph: /* @__PURE__ */ buildGraph(),
	containers: [
		{ id: ARCADE_SCREENS.basegame, sceneId: ARCADE_SCREENS.basegame, z: 0 },
		{ id: ARCADE_SCREENS.hud, sceneId: ARCADE_SCREENS.hud, z: 60 },
		{ id: ARCADE_SCREENS.over, sceneId: ARCADE_SCREENS.over, z: 80 },
		{ id: ARCADE_SCREENS.loading, sceneId: ARCADE_SCREENS.loading, z: 100 },
	],
	variables: [
		{ id: ARCADE_VARIABLES.score, type: 'int', initial: 0, scope: 'game' },
		{ id: ARCADE_VARIABLES.lives, type: 'int', initial: ARCADE_START_LIVES, scope: 'game' },
		{ id: ARCADE_VARIABLES.playing, type: 'bool', initial: false, scope: 'game' },
	],
	inputs: [
		{ action: 'left', keys: ['ArrowLeft', 'a'] },
		{ action: 'right', keys: ['ArrowRight', 'd'] },
		{ action: 'up', keys: ['ArrowUp', 'w'] },
		{ action: 'down', keys: ['ArrowDown', 's'] },
	],
};
