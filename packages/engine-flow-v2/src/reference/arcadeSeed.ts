/**
 * Invisible Flow v2 — the arcade starter flow (`docs/design/game-families.md` §3.4, P10.8): the doc
 * a new arcade project opens on, and the catcher / dodger sample (§9 #6). A salmon swims along the
 * bottom of the river; bears and hooks fall towards it and fish drift down. Catch a fish for 10
 * points; a bear or a hook costs a life; at no lives the round is over.
 *
 * It owns `load`, so it drives every screen, and it owns the RULES (§2.3): the arcade loop says what
 * touched what, and this flow keeps the score and the lives and decides when the round ends.
 *
 *   - `load` shows the splash; `complete:loading` / `tapToStart` swap it for the river and the HUD
 *     and start a round through the `startRound` timer (a tap raises both; the second only restarts
 *     the timer, so one round starts).
 *   - A round resets the score and the lives, spawns the salmon and starts three repeating timers,
 *     each spawning a bear, a hook or a fish at a seeded random x above the field, falling. The
 *     salmon and the spawns are placed from `$engine.fieldWidth` / `fieldHeight`, so the sample
 *     follows the field's size.
 *   - The key map's `left` / `right` set the salmon's velocity while held (`setVelocity`, aimed at
 *     every body tagged `player`).
 *   - `collide` with a `hazard` despawns it and takes a life; with a `pickup` despawns it and scores.
 *   - `leaveBounds` despawns whatever fell off the field.
 *   - At no lives (`onVariable` lives crosses 0) the timers stop, the round-over screen holds until
 *     a tap, the field is cleared (`forEach` over `$live.field`) and a new round starts.
 *
 * The variables are `game`-scoped: an arcade round starts here, not at a spin press.
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

/** The arcade template's id — its vocabulary's (`arcade.ts`) and its starter flow's. Declared here,
 *  where nothing imports the standard palette, so a plain Node script can load the starter flow. */
export const ARCADE_TEMPLATE_ID = 'arcade';

/** The screens an arcade scaffold has (`engine-layout`'s arcade scene set). */
export const ARCADE_SCREENS = {
	loading: 'loading',
	basegame: 'basegame',
	hud: 'arcadeHud',
	over: 'roundOver',
} as const;

/** The play field's spawn layer, on the basegame screen. */
export const ARCADE_FIELD_LAYER = 'field';

/** The sample's spawnable components (`engine-layout` `ARCADE_SAMPLE_COMPONENTS`). */
export const ARCADE_SAMPLE = {
	player: 'arcadeSalmon',
	bear: 'arcadeBear',
	hook: 'arcadeHook',
	fish: 'arcadeFish',
} as const;

/** The starter flow's variables. A HUD readout binds one as `var:<id>`. */
export const ARCADE_VARIABLES = { score: 'score', lives: 'lives', playing: 'playing' } as const;

/** Lives a round starts with; points a fish is worth. */
export const ARCADE_START_LIVES = 3;
export const ARCADE_FISH_POINTS = 10;

/** How far above the field's bottom edge the salmon swims. */
export const ARCADE_PLAYER_LIFT = 80;
const PLAYER_SPEED = 520;
/** The timer that starts a round, and how soon after it is asked for. */
const START_TIMER = 'startRound';
const START_DELAY_MS = 50;

/** Each spawner: its timer, what it spawns, how often (ms) and how fast it falls (px/s). */
const SPAWNERS = [
	{ timer: 'spawnBear', componentId: ARCADE_SAMPLE.bear, every: 900, vy: 240 },
	{ timer: 'spawnHook', componentId: ARCADE_SAMPLE.hook, every: 1400, vy: 380 },
	{ timer: 'spawnFish', componentId: ARCADE_SAMPLE.fish, every: 1700, vy: 200 },
] as const;

const CONTAINERS: ContainerRef[] = [
	{ id: ARCADE_SCREENS.basegame, sceneId: ARCADE_SCREENS.basegame, z: 0 },
	{ id: ARCADE_SCREENS.hud, sceneId: ARCADE_SCREENS.hud, z: 60 },
	{ id: ARCADE_SCREENS.over, sceneId: ARCADE_SCREENS.over, z: 80 },
	{ id: ARCADE_SCREENS.loading, sceneId: ARCADE_SCREENS.loading, z: 100 },
];

const trigger = (member: string): DataSource => ({
	kind: 'accessor',
	path: { on: 'trigger', member },
});
const variable = (id: string): DataSource => ({ kind: 'accessor', path: { on: 'var', id } });
const int = (value: number): DataSource => ({ kind: 'literal', type: { t: 'int' }, value });
const float = (value: number): DataSource => ({ kind: 'literal', type: { t: 'float' }, value });
const bool = (value: boolean): DataSource => ({ kind: 'literal', type: { t: 'bool' }, value });
const text = (value: string): DataSource => ({ kind: 'literal', type: { t: 'string' }, value });
const wired: DataSource = { kind: 'wire' };
const engine = (key: string): DataSource => ({ kind: 'accessor', path: { on: 'engine', key } });

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
	const wire = (from: PinPath, to: string) => exec.push({ from, to: { node: to, pin: 'exec' } });
	const feed = (from: string, fromPin: string, to: string, toPin: string) =>
		data.push({ from: { node: from, pin: fromPin }, to: { node: to, pin: toPin } });
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
	const playing = (id: string, is: boolean) =>
		add({
			id,
			kind: 'branch',
			guard: { all: [{ left: variable(ARCADE_VARIABLES.playing), op: 'eq', right: bool(is) }] },
		});

	const signals = add({ id: 'ar_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	/** The salmon, at the middle of the field's bottom, whatever size the field is. */
	const playerSpawn = (prefix: string): string => {
		const x = add({
			id: `${prefix}_player_x`,
			kind: 'compute',
			compute: { op: 'div', a: engine('fieldWidth'), b: float(2) },
		});
		const y = add({
			id: `${prefix}_player_y`,
			kind: 'compute',
			compute: { op: 'sub', a: engine('fieldHeight'), b: float(ARCADE_PLAYER_LIFT) },
		});
		const spawn = add({
			id: `${prefix}_player`,
			kind: 'spawn',
			layer: ARCADE_FIELD_LAYER,
			componentId: ARCADE_SAMPLE.player,
			inputs: { x: wired, y: wired },
		});
		feed(x, 'out', spawn, 'x');
		feed(y, 'out', spawn, 'y');
		return spawn;
	};

	/** A round: reset the variables, spawn the salmon, start the spawners. */
	const startRound = (prefix: string): string[] => [
		add({
			id: `${prefix}_score`,
			kind: 'setVariable',
			variable: ARCADE_VARIABLES.score,
			inputs: { value: int(0) },
		}),
		add({
			id: `${prefix}_lives`,
			kind: 'setVariable',
			variable: ARCADE_VARIABLES.lives,
			inputs: { value: int(ARCADE_START_LIVES) },
		}),
		add({
			id: `${prefix}_playing`,
			kind: 'setVariable',
			variable: ARCADE_VARIABLES.playing,
			inputs: { value: bool(true) },
		}),
		playerSpawn(prefix),
		...SPAWNERS.map((s) =>
			add({
				id: `${prefix}_${s.timer}`,
				kind: 'startTimer',
				timer: s.timer,
				repeat: true,
				inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: s.every } },
			}),
		),
	];

	chain(pin('load'), [show('ar_load_show', ARCADE_SCREENS.loading)]);
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
		show(`${prefix}_show_hud`, ARCADE_SCREENS.hud),
	];
	const completeLoading = add({
		id: 'ar_complete_loading',
		kind: 'event',
		ref: `complete:${ARCADE_SCREENS.loading}`,
	});
	// Both entries start the round through one timer: starting a running timer restarts it, so the
	// two of them (a tap on the loading screen raises both) start one round, not two.
	const startSoon = (id: string) =>
		add({
			id,
			kind: 'startTimer',
			timer: START_TIMER,
			inputs: { ms: { kind: 'literal', type: { t: 'ms' }, value: START_DELAY_MS } },
		});
	chain({ node: completeLoading, pin: 'exec' }, [
		...showGame('ar_loaded'),
		startSoon('ar_loaded_start'),
	]);
	chain(pin('tapToStart'), [
		add({
			id: 'ar_music',
			kind: 'fireCue',
			ref: 'soundMusic',
			inputs: {
				name: { kind: 'literal', type: { t: 'enum', name: 'MusicName' }, value: 'bgm_main' },
			},
		}),
		...showGame('ar_tapped'),
		startSoon('ar_tapped_start'),
	]);
	const onStart = add({ id: 'ar_on_start', kind: 'onTimer', timer: START_TIMER });
	chain({ node: onStart, pin: 'exec' }, startRound('ar_round'));

	// Each spawner: while playing, spawn at a random x above the field and let it fall.
	for (const s of SPAWNERS) {
		const on = add({ id: `ar_on_${s.timer}`, kind: 'onTimer', timer: s.timer });
		const gate = playing(`ar_${s.timer}_playing`, true);
		const spawn = add({
			id: `ar_${s.timer}_spawn`,
			kind: 'spawn',
			layer: ARCADE_FIELD_LAYER,
			componentId: s.componentId,
			// A seeded spot across the field's width.
			inputs: { x: engine('randomX'), y: float(-60) },
		});
		const fall = action(`ar_${s.timer}_fall`, 'setVelocity', {
			instance: wired,
			vx: float(0),
			vy: float(s.vy),
		});
		feed(spawn, 'instance', fall, 'instance');
		chain({ node: on, pin: 'exec' }, [gate]);
		chain({ node: gate, pin: 'then' }, [spawn, fall]);
	}

	// Steering: a held key sets the salmon's speed; letting go stops it.
	for (const [key, vx] of [
		['left', -PLAYER_SPEED],
		['right', PLAYER_SPEED],
	] as const) {
		const down = add({ id: `ar_${key}_down`, kind: 'onInput', action: key, phase: 'down' });
		const gate = playing(`ar_${key}_playing`, true);
		chain({ node: down, pin: 'exec' }, [gate]);
		chain({ node: gate, pin: 'then' }, [
			action(`ar_${key}_go`, 'setVelocity', { tagged: text('player'), vx: float(vx) }),
		]);
		const up = add({ id: `ar_${key}_up`, kind: 'onInput', action: key, phase: 'up' });
		chain({ node: up, pin: 'exec' }, [
			action(`ar_${key}_stop`, 'setVelocity', { tagged: text('player'), vx: float(0) }),
		]);
	}

	// The round ends: stop spawning, hold the round-over screen, clear the field, play again.
	const sweep = add({
		id: 'ar_over_sweep',
		kind: 'forEach',
		mode: 'sequence',
		inputs: { in: { kind: 'accessor', path: { on: 'live', layer: ARCADE_FIELD_LAYER } } },
	});
	const roundOver = [
		add({
			id: 'ar_over_playing',
			kind: 'setVariable',
			variable: ARCADE_VARIABLES.playing,
			inputs: { value: bool(false) },
		}),
		...SPAWNERS.map((s) => add({ id: `ar_over_${s.timer}`, kind: 'stopTimer', timer: s.timer })),
		action('ar_over_still', 'setVelocity', { tagged: text('player'), vx: float(0) }),
		show('ar_over_show', ARCADE_SCREENS.over, true),
		hide('ar_over_hide', ARCADE_SCREENS.over),
		sweep,
	];
	chain({ node: sweep, pin: 'body' }, [
		add({
			id: 'ar_over_gone',
			kind: 'despawn',
			inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
		}),
	]);
	chain({ node: sweep, pin: 'done' }, [startSoon('ar_again')]);

	// Touches: a hazard takes a life (the last one ends the round); a pickup scores.
	const touchPlaying = playing('ar_touch_playing', true);
	chain(pin('collide'), [touchPlaying]);
	const hazard = add({
		id: 'ar_touch_hazard',
		kind: 'branch',
		guard: { all: [{ left: trigger('tagB'), op: 'eq', right: text('hazard') }] },
	});
	chain({ node: touchPlaying, pin: 'then' }, [hazard]);
	chain({ node: hazard, pin: 'then' }, [
		add({ id: 'ar_hit_gone', kind: 'despawn', inputs: { instance: trigger('b') } }),
		add({
			id: 'ar_hit_life',
			kind: 'changeVariable',
			variable: ARCADE_VARIABLES.lives,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
	]);
	// The last life ends the round once: the write that takes lives to 0 crosses the threshold, and
	// two hazards in one frame cross it once between them (a second chain's 0 → 0 crosses nothing).
	const lastLife = add({
		id: 'ar_last_life',
		kind: 'onVariable',
		variable: ARCADE_VARIABLES.lives,
		on: 'crosses',
		threshold: 0,
		direction: 'down',
	});
	chain({ node: lastLife, pin: 'exec' }, roundOver);
	const pickup = add({
		id: 'ar_touch_pickup',
		kind: 'branch',
		guard: { all: [{ left: trigger('tagB'), op: 'eq', right: text('pickup') }] },
	});
	wire({ node: hazard, pin: 'else' }, pickup);
	chain({ node: pickup, pin: 'then' }, [
		add({ id: 'ar_catch_gone', kind: 'despawn', inputs: { instance: trigger('b') } }),
		add({
			id: 'ar_catch_score',
			kind: 'changeVariable',
			variable: ARCADE_VARIABLES.score,
			op: 'add',
			inputs: { by: int(ARCADE_FISH_POINTS) },
		}),
	]);

	chain(pin('leaveBounds'), [
		add({ id: 'ar_fell_gone', kind: 'despawn', inputs: { instance: trigger('instance') } }),
	]);

	return { nodes, exec, data };
};

export const ARCADE_DRIVEN_SEED_DOC: FlowDoc = {
	version: 2,
	templateId: ARCADE_TEMPLATE_ID,
	graph: buildGraph(),
	containers: CONTAINERS,
	variables: [
		{ id: ARCADE_VARIABLES.score, type: 'int', initial: 0, scope: 'game' },
		{ id: ARCADE_VARIABLES.lives, type: 'int', initial: ARCADE_START_LIVES, scope: 'game' },
		{ id: ARCADE_VARIABLES.playing, type: 'bool', initial: false, scope: 'game' },
	],
	inputs: [
		{ action: 'left', keys: ['ArrowLeft', 'a'] },
		{ action: 'right', keys: ['ArrowRight', 'd'] },
	],
};
