/**
 * Invisible Flow v2 — the PLATFORMER sample (`docs/design/game-families.md` §4.4, P10.13): a hero
 * runs and jumps along a side-view level twice the screen wide, the camera following it (P10.12).
 * The hero is played: its character's `sideScroll` controller reads this flow's key map and its
 * `gravity` jump (Space, ↑ or W; hold to jump higher, coyote time and a jump buffer); the level's
 * `tilemap` stops it (solid ground and a wall) and holds it up (one-way ledges, from above only).
 * All of that is the config's (`packages/engine-mechanics/fixtures/arcade-ledges.rules.json`); this
 * flow keeps the GAME:
 *
 *   - a round resets LIVES to 3 and COINS to 0, then spawns the hero and the coins;
 *   - `collide` of the hero and a coin counts a coin and takes it away;
 *   - `enterZone` of a `pit` (under each gap) costs a life and puts the hero back at the start, the
 *     camera snapped to it; the `goal` scores 10 coins and puts it back too;
 *   - at no lives the round-over screen holds until a tap, the field is cleared and a new round
 *     starts.
 *
 * It plays on `engine-layout`'s `arcadeLedgesReferenceLayout()`. Not offered in Game Maker: it is
 * what `check:arcade-platformer` and `scripts/playtest/arcade-platformer-play.mjs` play, and stays
 * off the runtime's import graph (`index.ts` does not export it).
 */

import type { DataEdge, DataSource, ExecEdge, FlowDoc, Node, PinPath } from '../types';

import { ARCADE_FIELD_LAYER, ARCADE_SCREENS, ARCADE_TEMPLATE_ID } from './arcadeSeed';

/** The sample's components (`engine-layout` `ARCADE_LEDGES`). */
export const LEDGES_SAMPLE = { hero: 'ledgesHero', coin: 'ledgesCoin' } as const;

export const LEDGES_VARIABLES = { lives: 'lives', coins: 'collected', playing: 'playing' } as const;

export const LEDGES_START_LIVES = 3;

/** The coins the goal is worth. */
export const LEDGES_GOAL_COINS = 10;

/** The config's zones the flow names. */
export const LEDGES_ZONES = { pit: 'pit', goal: 'goal' } as const;

/** Where a round puts each piece, in field px (the config's field: the level, 2880 × 800). */
export const LEDGES_PLACES = {
	hero: { x: 120, y: 676 },
	coins: [
		{ x: 448, y: 540 },
		{ x: 704, y: 412 },
		{ x: 832, y: 412 },
		{ x: 1312, y: 540 },
		{ x: 1856, y: 660 },
		{ x: 2240, y: 540 },
		{ x: 2240, y: 660 },
	],
} as const;

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

	const signals = add({ id: 'al_signals', kind: 'gameSignals' });
	const pin = (name: string): PinPath => ({ node: signals, pin: name });

	chain(pin('load'), [show('al_load_show', ARCADE_SCREENS.loading)]);
	const showGame = (prefix: string) => [
		hide(`${prefix}_hide_loading`, ARCADE_SCREENS.loading),
		show(`${prefix}_show_field`, ARCADE_SCREENS.basegame),
		show(`${prefix}_show_hud`, ARCADE_SCREENS.hud),
	];
	const loaded = add({ id: 'al_loaded', kind: 'event', ref: `complete:${ARCADE_SCREENS.loading}` });
	chain({ node: loaded, pin: 'exec' }, [...showGame('al_loaded'), startSoon('al_loaded_start')]);
	chain(pin('tapToStart'), [...showGame('al_tapped'), startSoon('al_tapped_start')]);

	// A round: reset the HUD, spawn the hero and the coins.
	const onStart = add({ id: 'al_on_start', kind: 'onTimer', timer: START_TIMER });
	chain({ node: onStart, pin: 'exec' }, [
		setVar('al_round_lives', LEDGES_VARIABLES.lives, int(LEDGES_START_LIVES)),
		setVar('al_round_collected', LEDGES_VARIABLES.coins, int(0)),
		setVar('al_round_playing', LEDGES_VARIABLES.playing, bool(true)),
		spawn('al_round_hero', LEDGES_SAMPLE.hero, LEDGES_PLACES.hero),
		...LEDGES_PLACES.coins.map((at, i) => spawn(`al_round_coin${i}`, LEDGES_SAMPLE.coin, at)),
	]);

	// A coin: count it, take it away.
	const picked = when('al_coin_playing', variable(LEDGES_VARIABLES.playing), bool(true));
	chain(pin('collide'), [picked]);
	chain({ node: picked, pin: 'then' }, [
		add({
			id: 'al_coin_count',
			kind: 'changeVariable',
			variable: LEDGES_VARIABLES.coins,
			op: 'add',
			inputs: { by: int(1) },
		}),
		add({ id: 'al_coin_gone', kind: 'despawn', inputs: { instance: trigger('b') } }),
	]);

	const backToStart = (prefix: string) => [
		action(`${prefix}_back`, 'moveTo', {
			instance: trigger('instance'),
			x: float(LEDGES_PLACES.hero.x),
			y: float(LEDGES_PLACES.hero.y),
		}),
		action(`${prefix}_still`, 'setVelocity', {
			instance: trigger('instance'),
			vx: float(0),
			vy: float(0),
		}),
		action(`${prefix}_follow`, 'cameraFollow', { tagged: text('player'), snap: bool(true) }),
	];

	// A pit: a life, back to the start. The goal: ten coins, back to the start.
	const zonePlaying = when('al_zone_playing', variable(LEDGES_VARIABLES.playing), bool(true));
	chain(pin('enterZone'), [zonePlaying]);
	const pit = when('al_zone_pit', trigger('zone'), text(LEDGES_ZONES.pit));
	chain({ node: zonePlaying, pin: 'then' }, [pit]);
	chain({ node: pit, pin: 'then' }, [
		add({
			id: 'al_pit_life',
			kind: 'changeVariable',
			variable: LEDGES_VARIABLES.lives,
			op: 'sub',
			min: 0,
			inputs: { by: int(1) },
		}),
		...backToStart('al_pit'),
	]);
	const goal = when('al_zone_goal', trigger('zone'), text(LEDGES_ZONES.goal));
	chain({ node: pit, pin: 'else' }, [goal]);
	chain({ node: goal, pin: 'then' }, [
		add({
			id: 'al_goal_bonus',
			kind: 'changeVariable',
			variable: LEDGES_VARIABLES.coins,
			op: 'add',
			inputs: { by: int(LEDGES_GOAL_COINS) },
		}),
		...backToStart('al_goal'),
	]);

	// The last life: the round-over screen holds, the level is cleared, again.
	const sweep = add({
		id: 'al_over_sweep',
		kind: 'forEach',
		mode: 'sequence',
		inputs: { in: { kind: 'accessor', path: { on: 'live', layer: ARCADE_FIELD_LAYER } } },
	});
	const lastLife = add({
		id: 'al_last_life',
		kind: 'onVariable',
		variable: LEDGES_VARIABLES.lives,
		on: 'crosses',
		threshold: 0,
		direction: 'down',
	});
	chain({ node: lastLife, pin: 'exec' }, [
		setVar('al_over_playing', LEDGES_VARIABLES.playing, bool(false)),
		show('al_over_show', ARCADE_SCREENS.over, true),
		hide('al_over_hide', ARCADE_SCREENS.over),
		sweep,
	]);
	chain({ node: sweep, pin: 'body' }, [
		add({
			id: 'al_over_gone',
			kind: 'despawn',
			inputs: { instance: { kind: 'accessor', path: { on: 'item' } } },
		}),
	]);
	chain({ node: sweep, pin: 'done' }, [startSoon('al_again')]);

	return { nodes, exec, data };
};

export const ARCADE_LEDGES_SEED_DOC: FlowDoc = {
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
		{ id: LEDGES_VARIABLES.lives, type: 'int', initial: LEDGES_START_LIVES, scope: 'game' },
		{ id: LEDGES_VARIABLES.coins, type: 'int', initial: 0, scope: 'game' },
		{ id: LEDGES_VARIABLES.playing, type: 'bool', initial: false, scope: 'game' },
	],
	inputs: [
		{ action: 'left', keys: ['ArrowLeft', 'a'] },
		{ action: 'right', keys: ['ArrowRight', 'd'] },
		{ action: 'up', keys: ['ArrowUp', 'w'] },
		{ action: 'jump', keys: [' '] },
	],
};
