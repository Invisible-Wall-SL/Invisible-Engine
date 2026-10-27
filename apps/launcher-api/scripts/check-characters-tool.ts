/**
 * check:characters-tool — Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3,
 * §5.1, P10.11): the page's pure helpers, run on real config docs.
 *
 *   pnpm --filter launcher-api check:characters-tool
 *
 *  1. THE EDITS MIRROR THE NORMALIZER. Every character, movement, controller, brain and anim-input
 *     edit (`$lib/characters/characterEdit.ts`, P10.13's gravity, jump and flap too) leaves the doc exactly as a save would store it, so
 *     the page never looks dirty for a value a save drops; refused values leave the doc alone.
 *  2. ADD / DUPLICATE / RENAME / DELETE, and the brain's renames and deletes reaching everything that
 *     names a state (transitions, the initial state, `state:<id>` anim inputs).
 *  3. THE GRAPH. Entry → initial, Any → the `*` transitions; what a wire between two cards means.
 *  4. THE SANDBOX drives the game's own characters stage (`engine-game` `createCharacterStage`), not
 *     a copy. Same seed and input ⇒ the same run; a step is exactly `behaviours.js` + `steer` +
 *     `stepSolid` driven by hand; walls stop the character (`hitSolid`); a controller follows the
 *     keys; a bot is the brain; `shootAt` fires; anim inputs are what the stage writes; `variable`
 *     conditions read the sandbox's stand-in variables.
 *     P10.13: gravity, a side-view jump (its height and time, a tap, `up`), a flap, a hop over a
 *     `ground` wall, a one-way platform, all as the stage steps them; a plain top-down run has no
 *     contact readout.
 *  5. THE REGISTRY. The tool, its roles (Game Config's), its stage and its guide (rule 9).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	normalizeGameConfigDoc,
	validateGameConfigDoc,
	type ArcadeCharacter,
	type GameConfigDoc,
} from 'game-config';
import {
	BEHAVIOUR_DEFAULTS,
	DEFAULT_COYOTE_MS,
	brainVelocity,
	createBrain,
	createBrainWorld,
	createRng,
	steer,
	stepBrain,
	stepBody,
	stepSolid,
	type Body,
} from 'engine-mechanics';
import * as edit from '../src/lib/characters/characterEdit.ts';
import {
	ANY_NODE,
	ENTRY_NODE,
	INITIAL_EDGE,
	brainConnection,
	brainGraph,
} from '../src/lib/characters/brainGraph.ts';
import {
	FALLBACK_BODY,
	PLAYER_SIZE,
	PLAYER_TAG,
	SANDBOX_CHARACTER_BODY,
	createSandbox,
	parseVariables,
	replay,
	startOf,
	wallsFor,
	PLATFORM_WALLS,
	HOP_WALLS,
	DEFAULT_WALLS,
	type SandboxInput,
	type SandboxSetup,
} from '../src/lib/characters/sandbox.ts';
import { ROLE_TOOLS, TOOLS, TOOL_STAGES, toolDocPath } from '../src/lib/roles.ts';

let passes = 0;
let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) passes++;
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};
/** JSON with sorted keys: what a doc holds, whatever order an edit wrote it in. */
const canon = (v: unknown): string =>
	JSON.stringify(v, (_k, value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(
					Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
				)
			: value,
	);
const same = (name: string, actual: unknown, expected: unknown): void =>
	check(name, canon(actual) === canon(expected), `${canon(actual)} ≠ ${canon(expected)}`);

const base = (): GameConfigDoc =>
	normalizeGameConfigDoc({
		family: 'arcade',
		outcome: 'rules',
		arcade: {
			bodies: {
				goblin: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
				hero: { shape: 'circle', r: 20, tags: ['player'] },
			},
		},
	})!;
const chars = (doc: GameConfigDoc): ArcadeCharacter[] => doc.arcade?.characters ?? [];

/** Apply `run` and require the doc to be what a save would store. */
function mirrored(name: string, doc: GameConfigDoc, run: (d: GameConfigDoc) => void): void {
	run(doc);
	same(
		`1. ${name}: the doc is what a save stores`,
		normalizeGameConfigDoc(structuredClone(doc)),
		doc,
	);
}

// ── 1 + 2. Characters ─────────────────────────────────────────────────────────────────────────
{
	const doc = base();
	check(
		'2. no look, no character',
		edit.addCharacter(doc, '  ') === undefined && !doc.arcade?.characters,
	);
	let id: string | undefined;
	mirrored('add', doc, (d) => (id = edit.addCharacter(d, 'goblin')));
	same('2. add: id from the look', chars(doc), [{ id: 'goblin', component: 'goblin' }]);
	check('2. add twice: a fresh id', edit.addCharacter(doc, 'goblin') === 'goblin2');
	edit.removeCharacter(doc, 'goblin2');
	mirrored('name', doc, (d) => edit.setCharacterName(d, id!, ' Grunt '));
	same('2. name trimmed', chars(doc)[0].name, 'Grunt');
	mirrored('blank name', doc, (d) => edit.setCharacterName(d, id!, ' '));
	check('2. blank name deleted', !('name' in chars(doc)[0]));
	mirrored('rename', doc, (d) => edit.renameCharacter(d, 'goblin', 'guard'));
	check('2. renamed', chars(doc)[0].id === 'guard');
	edit.addCharacter(doc, 'hero');
	same(
		'2. rename onto a taken id is refused',
		edit.renameCharacter(doc, 'guard', 'hero'),
		'A character is already called "hero".',
	);
	same(
		'2. a blank id is refused',
		edit.renameCharacter(doc, 'guard', ' '),
		'An id cannot be blank.',
	);
	mirrored('duplicate', doc, (d) => edit.duplicateCharacter(d, 'guard'));
	same(
		'2. the copy lands after it with a fresh id',
		chars(doc).map((c) => c.id),
		['guard', 'guardCopy', 'hero'],
	);
	check(
		'2. the copy shares the look until changed, which the validator refuses',
		validateGameConfigDoc(doc).some(
			(i) => i.path === 'arcade.characters[1].component' && i.severity === 'error',
		),
	);
	mirrored('look', doc, (d) => edit.setLook(d, 'guardCopy', 'scout'));
	edit.setLook(doc, 'guardCopy', ' ');
	check('2. a blank look is refused', chars(doc)[1].component === 'scout');
	mirrored('delete', doc, (d) => {
		edit.removeCharacter(d, 'guardCopy');
		edit.removeCharacter(d, 'hero');
	});
	mirrored('delete the last', doc, (d) => edit.removeCharacter(d, 'guard'));
	check('2. the last delete drops the key', !('characters' in (doc.arcade ?? {})));
	same('2. the bodies stay', Object.keys(doc.arcade?.bodies ?? {}), ['goblin', 'hero']);
}

// ── 1. Movement and controller ────────────────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'hero');
	mirrored('movement', doc, (d) => {
		edit.setMovement(d, 'hero', 'accel', '800');
		edit.setMovement(d, 'hero', 'maxSpeed', '240');
	});
	same('1. movement stored', chars(doc)[0].movement, { accel: 800, maxSpeed: 240 });
	mirrored('movement cleared', doc, (d) => {
		edit.setMovement(d, 'hero', 'accel', '');
		edit.setMovement(d, 'hero', 'maxSpeed', '-1');
	});
	check('1. an empty movement is deleted', !('movement' in chars(doc)[0]));
	mirrored('controller', doc, (d) => edit.setController(d, 'hero', 'topDown'));
	same('1. a keyboard controller at the default speed', chars(doc)[0].controller, {
		kind: 'topDown',
		speed: edit.DEFAULT_CONTROLLER_SPEED,
	});
	edit.setControllerSpeed(doc, 'hero', '');
	same('1. a keyboard speed cannot be blank', chars(doc)[0].controller?.speed, 200);
	mirrored('controller kind keeps its speed', doc, (d) => {
		edit.setControllerSpeed(d, 'hero', '320');
		edit.setController(d, 'hero', 'sideScroll');
	});
	same('1. side-scroll at 320', chars(doc)[0].controller, { kind: 'sideScroll', speed: 320 });
	mirrored('pointer', doc, (d) => {
		edit.setController(d, 'hero', 'pointer');
		edit.setPointerAxes(d, 'hero', 'xy');
		edit.setControllerSpeed(d, 'hero', '500');
	});
	same('1. pointer', chars(doc)[0].controller, { kind: 'pointer', axes: 'xy', speed: 500 });
	mirrored('pointer speed cleared', doc, (d) => edit.setControllerSpeed(d, 'hero', ''));
	mirrored('no controller', doc, (d) => edit.setController(d, 'hero', 'none'));
	check('1. none deletes it', !('controller' in chars(doc)[0]));
}

// ── 1. Gravity, jumps and flaps (P10.13) ──────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'hero');
	const hero = () => chars(doc)[0];
	const jumpIssues = () =>
		validateGameConfigDoc(doc).filter((i) => i.path.startsWith('arcade.characters[0].controller'));
	check(
		'1. movement lists gravity and max fall, each labelled',
		edit.MOVEMENT_KEYS.includes('gravity') &&
			edit.MOVEMENT_KEYS.includes('maxFall') &&
			edit.MOVEMENT_KEYS.every((k) => !!edit.MOVEMENT_LABELS[k]),
	);
	mirrored('gravity', doc, (d) => {
		edit.setMovement(d, 'hero', 'gravity', '1800');
		edit.setMovement(d, 'hero', 'maxFall', '900');
	});
	same('1. gravity and max fall stored', hero().movement, { gravity: 1800, maxFall: 900 });
	mirrored('gravity cleared', doc, (d) => {
		edit.setMovement(d, 'hero', 'gravity', '');
		edit.setMovement(d, 'hero', 'maxFall', '-5');
	});
	check('1. no gravity, no movement', !('movement' in hero()));

	edit.setJump(doc, 'hero', true);
	check('1. no controller, no jump', !hero().controller);
	edit.setController(doc, 'hero', 'sideScroll');
	mirrored('jump on (side-scroll)', doc, (d) => edit.setJump(d, 'hero', true));
	same('1. a side-scroll takes a gravity jump at the defaults', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: edit.DEFAULT_JUMP_HEIGHT,
		time: edit.DEFAULT_JUMP_TIME,
	});
	same('1. … which the validator accepts', jumpIssues(), []);
	mirrored('jump fields', doc, (d) => {
		edit.setJumpField(d, 'hero', 'height', '150');
		edit.setJumpField(d, 'hero', 'time', '0.5');
		edit.setJumpField(d, 'hero', 'minHeight', '40');
		edit.setJumpField(d, 'hero', 'coyoteMs', '80');
		edit.setJumpField(d, 'hero', 'bufferMs', '120');
		edit.setJumpField(d, 'hero', 'airControl', '0.5');
	});
	same('1. jump fields stored', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: 150,
		time: 0.5,
		minHeight: 40,
		coyoteMs: 80,
		bufferMs: 120,
		airControl: 0.5,
	});
	mirrored('refused jump fields', doc, (d) => {
		edit.setJumpField(d, 'hero', 'height', '');
		edit.setJumpField(d, 'hero', 'time', '0');
		edit.setJumpField(d, 'hero', 'coyoteMs', '-1');
		edit.setJumpField(d, 'hero', 'airControl', '-0.2');
	});
	same(
		'1. height and time cannot be blank or 0; negatives are ignored',
		[edit.jumpOf(hero())?.height, edit.jumpOf(hero())?.time, edit.jumpOf(hero())?.coyoteMs],
		[150, 0.5, 80],
	);
	same('1. … nor a negative air control', edit.jumpOf(hero())?.airControl, 0.5);
	mirrored('jump fields at their defaults', doc, (d) => {
		edit.setJumpField(d, 'hero', 'minHeight', '');
		edit.setJumpField(d, 'hero', 'coyoteMs', String(DEFAULT_COYOTE_MS));
		edit.setJumpField(d, 'hero', 'bufferMs', '');
		edit.setJumpField(d, 'hero', 'airControl', '1');
	});
	same('1. a field at its default is not stored', edit.jumpOf(hero()), {
		kind: 'gravity',
		height: 150,
		time: 0.5,
	});
	same(
		'1. the hint: launch 2h/t, pull 2h/t², a tap cut from minHeight',
		edit.jumpHint({ kind: 'gravity', height: 150, time: 0.5, minHeight: 40 }),
		{ launch: 600, gravity: 1200, cut: Math.sqrt(2 * 1200 * 40) },
	);
	mirrored('to top-down', doc, (d) => edit.setController(d, 'hero', 'topDown'));
	same('1. the kind follows the controller: a top-down hop', edit.jumpOf(hero()), {
		kind: 'hop',
		height: 150,
		time: 0.5,
	});
	same('1. … which the validator accepts', jumpIssues(), []);
	mirrored('back to side-scroll', doc, (d) => edit.setController(d, 'hero', 'sideScroll'));
	same('1. … and back to a gravity jump', edit.jumpOf(hero())?.kind, 'gravity');
	mirrored('jump off', doc, (d) => edit.setJump(d, 'hero', false));
	same('1. jump off deletes it', hero().controller, { kind: 'sideScroll', speed: 200 });
	edit.setJump(doc, 'hero', true);
	mirrored('pointer drops the jump', doc, (d) => edit.setController(d, 'hero', 'pointer'));
	check('1. a pointer has no jump', edit.jumpOf(hero()) === undefined);
	edit.setJump(doc, 'hero', true);
	check('1. … and takes none', edit.jumpOf(hero()) === undefined);
	same('1. only top-down and side-scroll take a jump', edit.JUMP_KIND_FOR, {
		sideScroll: 'gravity',
		topDown: 'hop',
	});

	edit.setController(doc, 'hero', 'sideScroll');
	edit.setControllerSpeed(doc, 'hero', '260');
	mirrored('flap', doc, (d) => edit.setController(d, 'hero', 'flap'));
	same('1. a flap at the default kick keeps the speed', hero().controller, {
		kind: 'flap',
		kick: edit.DEFAULT_FLAP_KICK,
		speed: 260,
	});
	mirrored('flap kick and speed', doc, (d) => {
		edit.setFlapKick(d, 'hero', '420');
		edit.setFlapKick(d, 'hero', '0');
		edit.setFlapKick(d, 'hero', '');
		edit.setControllerSpeed(d, 'hero', '');
	});
	same('1. a kick above 0; a blank flap speed deletes it', hero().controller, {
		kind: 'flap',
		kick: 420,
	});
	check(
		'1. a flap with no gravity is warned about',
		validateGameConfigDoc(doc).some((i) => i.path === 'arcade.characters[0].movement.gravity'),
	);
	edit.setJump(doc, 'hero', true);
	check('1. a flap takes no jump', !('jump' in hero().controller!));
	mirrored('flap → side-scroll', doc, (d) => edit.setController(d, 'hero', 'sideScroll'));
	same('1. off a speedless flap: the default speed', hero().controller, {
		kind: 'sideScroll',
		speed: edit.DEFAULT_CONTROLLER_SPEED,
	});
	mirrored('flap → none', doc, (d) => edit.setController(d, 'hero', 'none'));

	same(
		'1. the true / false sources fit a bool input, the rest a number',
		['moving', 'grounded', 'onWall', 'airborne', 'state:x', 'speed', 'vy', 'height', 'facing'].map(
			(source) => edit.animSourceIsBool(source as Parameters<typeof edit.animSourceIsBool>[0]),
		),
		[true, true, true, true, true, false, false, false, false],
	);
	check(
		'1. the source picker lists every P10.13 source',
		['grounded', 'onWall', 'airborne', 'height'].every((s) =>
			edit.animSourcesFor(hero()).includes(s as never),
		),
	);
}

// ── 1 + 2. Brain ──────────────────────────────────────────────────────────────────────────────
{
	const doc = base();
	edit.addCharacter(doc, 'goblin');
	let patrol: string | undefined;
	mirrored('first state', doc, (d) => (patrol = edit.addState(d, 'goblin', 'patrol')));
	same('2. the first state is the brain and its start', chars(doc)[0].brain?.initial, 'patrol');
	mirrored('more states', doc, (d) => {
		edit.addState(d, 'goblin', 'chase', { x: 400.4, y: 99.6 });
		edit.addState(d, 'goblin', 'chase');
	});
	same(
		'2. ids from the behaviour, made unique; places whole px',
		chars(doc)[0].brain?.states.map((s) => [s.id, s.pos]),
		[
			['patrol', { x: 240, y: 40 }],
			['chase', { x: 400, y: 100 }],
			['chase2', { x: 680, y: 40 }],
		],
	);
	let t1: string | undefined;
	let t2: string | undefined;
	mirrored('transitions', doc, (d) => {
		t1 = edit.addTransition(d, 'goblin', patrol!, 'chase');
		t2 = edit.addTransition(d, 'goblin', '*', 'chase2');
		edit.addCondition(d, 'goblin', t1!, 'targetWithin');
		edit.addCondition(d, 'goblin', t2!, 'random');
		edit.addCondition(d, 'goblin', t2!, 'variable');
	});
	check(
		'2. a transition to no state is refused',
		!edit.addTransition(doc, 'goblin', 'chase', 'nope'),
	);
	mirrored('condition fields', doc, (d) => {
		edit.setConditionField(d, 'goblin', t1!, 0, 'px', '150');
		edit.setConditionField(d, 'goblin', t1!, 0, 'px', '-5');
		edit.setConditionField(d, 'goblin', t1!, 0, 'tag', ' ');
		edit.setConditionField(d, 'goblin', t2!, 0, 'chance', '1.5');
		edit.setConditionField(d, 'goblin', t2!, 0, 'every', '1000');
		edit.setConditionField(d, 'goblin', t2!, 0, 'every', '250');
		edit.setConditionField(d, 'goblin', t2!, 1, 'value', '3');
		edit.setConditionField(d, 'goblin', t2!, 1, 'op', '=>');
		edit.setConditionField(d, 'goblin', t2!, 1, 'id', '');
	});
	same(
		'2. refused values leave the condition; a 1000 ms `every` is the default',
		chars(doc)[0].brain?.transitions.map((t) => t.when),
		[
			[{ kind: 'targetWithin', tag: 'player', px: 150 }],
			[
				{ kind: 'random', chance: 0.5, every: 250 },
				{ kind: 'variable', id: 'flag', op: '==', value: 3 },
			],
		],
	);
	same(
		'3. the label',
		edit.transitionText(chars(doc)[0].brain!.transitions[0]),
		'player within 150 px',
	);
	mirrored('params', doc, (d) => {
		edit.setParam(d, 'goblin', 'chase', 'speed', '220');
		edit.setParam(d, 'goblin', 'chase', 'range', String(BEHAVIOUR_DEFAULTS.chase.range));
		edit.setParam(d, 'goblin', 'chase', 'tag', 'hero');
		edit.setParam(d, 'goblin', 'patrol', 'pingPong', false);
		edit.setParam(d, 'goblin', 'patrol', 'path', 'route');
		edit.setParam(d, 'goblin', 'patrol', 'nonsense', '3');
	});
	same(
		'2. a default param is not stored; an unknown one is refused',
		chars(doc)[0].brain?.states.map((s) => s.params),
		[{ pingPong: false, path: 'route' }, { speed: 220, tag: 'hero' }, undefined],
	);
	mirrored('behaviour switch', doc, (d) => edit.setBehaviour(d, 'goblin', 'chase', 'flee'));
	same('2. the switch keeps the params flee reads', chars(doc)[0].brain?.states[1].params, {
		speed: 220,
		tag: 'hero',
	});
	mirrored('anim inputs', doc, (d) => {
		edit.setAnimInput(d, 'goblin', 'speed', 'speed');
		edit.setAnimInput(d, 'goblin', 'angry', 'state:chase');
	});
	mirrored('rename a state', doc, (d) => edit.renameState(d, 'goblin', 'chase', 'hunt'));
	const brain = chars(doc)[0].brain!;
	same(
		'2. a state rename reaches its transitions and anim inputs',
		[brain.transitions[0].to, chars(doc)[0].animInputs?.angry],
		['hunt', 'state:hunt'],
	);
	same(
		'2. "*" cannot be a state',
		edit.renameState(doc, 'goblin', 'hunt', '*'),
		'"*" means any state; pick another id.',
	);
	mirrored('rename the initial state', doc, (d) => edit.renameState(d, 'goblin', 'patrol', 'walk'));
	same('2. … and the start', [brain.initial, brain.transitions[0].from], ['walk', 'walk']);
	mirrored('move a transition', doc, (d) => edit.moveTransition(d, 'goblin', t2!, -1));
	same(
		'2. transitions reorder',
		brain.transitions.map((t) => t.id),
		[t2, t1],
	);
	mirrored('drop a state', doc, (d) => edit.removeState(d, 'goblin', 'hunt'));
	same(
		'2. dropping a state drops its transitions and the inputs that followed it',
		[brain.transitions.map((t) => t.id), chars(doc)[0].animInputs],
		[[t2], { speed: 'speed' }],
	);
	mirrored('drop the initial state', doc, (d) => edit.removeState(d, 'goblin', 'walk'));
	same('2. the start moves to the first state left', brain.initial, 'chase2');
	mirrored('drop the last state', doc, (d) => edit.removeState(d, 'goblin', 'chase2'));
	check('2. the last state drops the brain', !('brain' in chars(doc)[0]));
	same(
		'2. the issues of one character, by path',
		edit
			.characterIssues(
				[
					{ severity: 'error', path: 'arcade.characters[1].component', message: 'a' },
					{ severity: 'error', path: 'arcade.characters[10]', message: 'b' },
					{ severity: 'error', path: 'arcade.characters[1]', message: 'c' },
				],
				1,
			)
			.map((i) => i.message),
		['a', 'c'],
	);
	same(
		'1. param fallbacks are behaviours.js defaults',
		edit.behaviourParams('wander').map((p) => [p.key, p.fallback]),
		Object.entries(BEHAVIOUR_DEFAULTS.wander),
	);
	same(
		'1. anim sources: the plain ones and one per state',
		edit.animSourcesFor({
			id: 'x',
			component: 'x',
			brain: { initial: 'a', states: [{ id: 'a', behaviour: 'idle' }], transitions: [] },
		}),
		[
			'speed',
			'vx',
			'vy',
			'facing',
			'moving',
			'grounded',
			'onWall',
			'airborne',
			'height',
			'state:a',
		],
	);
}

// ── 3. The graph ──────────────────────────────────────────────────────────────────────────────
{
	const g = brainGraph({
		initial: 'b',
		states: [
			{ id: 'a', behaviour: 'idle', pos: { x: 5, y: 6 } },
			{ id: 'b', behaviour: 'chase' },
		],
		transitions: [
			{ id: 't1', from: '*', to: 'a', when: [{ kind: 'timer', ms: 500 }] },
			{ id: 't2', from: 'a', to: 'b', when: [] },
		],
	});
	same(
		'3. nodes',
		g.nodes.map((n) => [n.id, n.kind, n.pos]),
		[
			[ENTRY_NODE, 'entry', { x: 0, y: 40 }],
			[ANY_NODE, 'any', { x: 0, y: 200 }],
			['a', 'state', { x: 5, y: 6 }],
			['b', 'state', { x: 460, y: 160 }],
		],
	);
	same(
		'3. edges',
		g.edges.map((e) => [e.id, e.from, e.to, e.label]),
		[
			[INITIAL_EDGE, ENTRY_NODE, 'b', ''],
			['t1', ANY_NODE, 'a', 'after 500 ms'],
			['t2', 'a', 'b', 'at once'],
		],
	);
	same('3. no brain: only Entry and Any', brainGraph(undefined).nodes.length, 2);
	same('3. Entry → a state picks the start', brainConnection(ENTRY_NODE, 'a'), {
		kind: 'initial',
		state: 'a',
	});
	same('3. Any → a state is a `*` transition', brainConnection(ANY_NODE, 'a'), {
		kind: 'transition',
		from: '*',
		to: 'a',
	});
	same(
		'3. nothing enters Entry or Any',
		[brainConnection('a', ENTRY_NODE), brainConnection('a', ANY_NODE)],
		[undefined, undefined],
	);
}

// ── 4. The sandbox ────────────────────────────────────────────────────────────────────────────
const field = { w: 1280, h: 720 };
const still: SandboxInput = { held: [] };
const run = (n: number, input: SandboxInput = still): SandboxInput[] => Array(n).fill(input);
const guard: ArcadeCharacter = {
	id: 'guard',
	component: 'goblin',
	movement: { accel: 600, maxSpeed: 150 },
	brain: {
		initial: 'wander',
		states: [
			{ id: 'wander', behaviour: 'wander' },
			{ id: 'chase', behaviour: 'chase', params: { range: 2000 } },
		],
		transitions: [
			{
				id: 't1',
				from: 'wander',
				to: 'chase',
				when: [{ kind: 'random', chance: 0.5, every: 300 }],
			},
			{ id: 't2', from: 'chase', to: 'wander', when: [{ kind: 'timer', ms: 700 }] },
		],
	},
	animInputs: { run: 'moving', chasing: 'state:chase', speed: 'speed' },
};
const setup = (over: Partial<SandboxSetup> = {}): SandboxSetup => ({
	character: guard,
	body: { shape: 'box', w: 40, h: 40, tags: ['enemy'] },
	field,
	seed: '7',
	walls: [],
	...over,
});
{
	const inputs = [...run(60, { held: ['up'] }), ...run(120)];
	const a = replay(setup(), inputs);
	const b = replay(setup(), inputs);
	same('4. same seed, same input ⇒ the same run', a, b);
	check(
		'4. another seed ⇒ another run (wander and random draw from the seed)',
		canon(replay(setup({ seed: '8' }), inputs)) !== canon(a),
	);
	check('4. the brain changed state in the run', new Set(a.map((s) => s.state)).size === 2);

	// The same steps by hand, straight from engine-mechanics, as the arcade loop takes them.
	const start = startOf(field);
	const self: Body = {
		id: SANDBOX_CHARACTER_BODY,
		shape: 'box',
		w: 40,
		h: 40,
		x: start.character.x,
		y: start.character.y,
		vx: 0,
		vy: 0,
		tags: ['enemy'],
		edges: 'clamp',
	};
	const player: Body = {
		id: 'player',
		shape: 'box',
		w: PLAYER_SIZE,
		h: PLAYER_SIZE,
		x: start.player.x,
		y: start.player.y,
		vx: 0,
		vy: 0,
		tags: [PLAYER_TAG],
	};
	const brain = createBrain(guard.brain!, {
		rng: createRng(`7:character:${SANDBOX_CHARACTER_BODY}`),
		at: { x: self.x, y: self.y },
	});
	const dt = 1 / 60;
	let hit = false;
	let drift = 0;
	inputs.forEach((input, i) => {
		const world = createBrainWorld({ self, bodies: [player, self], hitSolid: hit });
		stepBrain(brain, world, dt);
		steer(self, brainVelocity(brain, self, world, dt), guard.movement, dt);
		player.vy = input.held.includes('up') ? -220 : 0;
		const r = stepSolid(self, dt, [], field);
		hit = r.hitX || r.hitY;
		stepBody(player, dt, field);
		const s = a[i];
		drift = Math.max(
			drift,
			Math.abs(s.character.x - self.x),
			Math.abs(s.character.y - self.y),
			Math.abs(s.player.y - player.y),
			s.state === brain.state ? 0 : Infinity,
		);
	});
	same('4. every step is behaviours.js + steer + stepSolid, exactly', drift, 0);
	const source = readFileSync(
		fileURLToPath(new URL('../src/lib/characters/sandbox.ts', import.meta.url)),
		'utf8',
	);
	check(
		"4. the sandbox drives the game's own characters stage (createCharacterStage), not a copy",
		source.includes("from 'engine-game/src/game/arcadeCharacters'") &&
			source.includes('createCharacterStage(') &&
			!/import\s*\{[^}]*\b(brainVelocity|controllerVelocity|stepBrain|steer|stepSolid)\b[^}]*\}\s*from 'engine-mechanics'/.test(
				source,
			),
	);
	const last = a[a.length - 1];
	same('4. anim inputs read as the loop writes them', last.animInputs, {
		run: last.speed > 1,
		chasing: last.state === 'chase',
		speed: last.speed,
	});
}
{
	// A chaser behind a wall: the wall stops it and the brain sees `hitSolid`.
	const chaser: ArcadeCharacter = {
		id: 'c',
		component: 'c',
		brain: {
			initial: 'chase',
			states: [
				{ id: 'chase', behaviour: 'chase', params: { range: 5000 } },
				{ id: 'stuck', behaviour: 'idle' },
			],
			transitions: [{ id: 't', from: 'chase', to: 'stuck', when: [{ kind: 'hitSolid' }] }],
		},
	};
	const wall = { id: 'w', x: 640, y: 360, w: 40, h: 700 };
	const s = replay(setup({ character: chaser, body: undefined, walls: [wall] }), run(240));
	const end = s[s.length - 1];
	check('4. no body ⇒ the fallback box', end.character.shape === FALLBACK_BODY.shape);
	check('4. the wall stops the chaser', end.character.x >= wall.x + wall.w / 2 + 24 - 1e-6);
	same('4. … and the brain saw it', end.state, 'stuck');
}
{
	// A played character: the keys drive it, the dummy player stands still.
	const hero: ArcadeCharacter = {
		id: 'h',
		component: 'h',
		controller: { kind: 'topDown', speed: 300 },
	};
	const s = replay(setup({ character: hero }), run(30, { held: ['left', 'up'] }));
	const end = s[s.length - 1];
	const start = startOf(field);
	check(
		'4. a controller drives the character',
		end.driver === 'controller' && end.character.x < start.character.x,
	);
	same('4. a diagonal at the controller speed', Math.round(end.speed), 300);
	same(
		'4. the dummy player stays put',
		[end.player.x, end.player.y],
		[start.player.x, start.player.y],
	);
	const bot = replay(
		setup({
			character: {
				...hero,
				brain: { initial: 'i', states: [{ id: 'i', behaviour: 'idle' }], transitions: [] },
			},
			drive: 'brain',
		}),
		run(10, { held: ['left'] }),
	);
	check(
		'4. a bot: the brain drives, the keys move the dummy player',
		bot[9].driver === 'brain' && bot[9].player.x < start.player.x,
	);
}
{
	const shooter: ArcadeCharacter = {
		id: 's',
		component: 's',
		brain: {
			initial: 'shoot',
			states: [
				{
					id: 'shoot',
					behaviour: 'shootAt',
					params: { component: 'bolt', layer: 'shots', every: 500, range: 5000, speed: 900 },
				},
			],
			transitions: [],
		},
	};
	const s = replay(setup({ character: shooter }), run(90));
	check(
		'4. shootAt fires shots',
		s.some((x) => x.shots.length > 0),
	);
	check('4. a shot that reaches the player hits it', s[s.length - 1].hits >= 1);
	const sandbox = createSandbox(setup({ character: shooter }));
	for (let f = 0; f < 30; f++) sandbox.advance(34, still);
	same('4. frames run whole fixed steps: 1020 ms is 61 of them', sandbox.snapshot().steps, 61);
}

{
	// `variable` conditions read the sandbox's stand-in variables.
	same(
		'4. variables parse as condition values',
		parseVariables('flag = true, score=3\nname = bob, bad'),
		{
			flag: true,
			score: 3,
			name: 'bob',
		},
	);
	const gated: ArcadeCharacter = {
		id: 'v',
		component: 'v',
		brain: {
			initial: 'a',
			states: [
				{ id: 'a', behaviour: 'idle' },
				{ id: 'b', behaviour: 'idle' },
			],
			transitions: [
				{
					id: 't',
					from: 'a',
					to: 'b',
					when: [{ kind: 'variable', id: 'flag', op: '==', value: true }],
				},
			],
		},
	};
	same(
		'4. a variable condition holds only with the variable set',
		[
			replay(setup({ character: gated }), run(2))[1].state,
			replay(setup({ character: gated, variables: { flag: true } }), run(2))[1].state,
		],
		['a', 'b'],
	);
}

// ── 4. The sandbox under gravity (P10.13) ─────────────────────────────────────────────────────
{
	const box = { shape: 'box' as const, w: 40, h: 40 };
	const floorY = field.h - 20;
	const jumper: ArcadeCharacter = {
		id: 'j',
		component: 'j',
		controller: {
			kind: 'sideScroll',
			speed: 200,
			jump: { kind: 'gravity', height: 120, time: 0.4 },
		},
	};
	const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;
	const fall = replay(setup({ character: jumper, body: box }), run(90));
	const landed = fall[fall.length - 1];
	check(
		'4. a gravity jumper falls to the floor and stands on it',
		near(landed.character.y, floorY) && landed.contact?.grounded === true,
		JSON.stringify(landed.contact),
	);
	for (const key of ['jump', 'up']) {
		const s = replay(setup({ character: jumper, body: box }), [
			...run(90),
			...run(40, { held: [key] }),
		]);
		const top = Math.min(...s.slice(90).map((x) => x.character.y));
		check(
			`4. ${key} jumps exactly the jump's height`,
			near(floorY - top, 120),
			String(floorY - top),
		);
	}
	const tap = replay(
		setup({
			character: {
				...jumper,
				controller: {
					kind: 'sideScroll',
					speed: 200,
					jump: { kind: 'gravity', height: 120, time: 0.4, minHeight: 30 },
				},
			},
			body: box,
		}),
		[...run(90), { held: ['jump'] }, ...run(40)],
	);
	const tapTop = floorY - Math.min(...tap.slice(90).map((x) => x.character.y));
	check('4. a tap jumps lower than a held press', tapTop > 30 && tapTop < 80, String(tapTop));

	// One-way: a fall lands on it from above; a jump from below passes up through it.
	const plank = { id: 'p', x: 960, y: field.h - 80, w: 200, h: 16, kind: 'oneWay' as const };
	const onPlank = replay(setup({ character: jumper, body: box, walls: [plank] }), run(90));
	check(
		'4. a fall lands on a one-way platform',
		near(onPlank[89].character.y, plank.y - plank.h / 2 - 20) &&
			onPlank[89].contact?.grounded === true,
		String(onPlank[89].character.y),
	);
	const under = createSandbox(setup({ character: jumper, body: box, walls: [plank] }));
	under.place('character', { x: 960, y: floorY });
	for (let i = 0; i < 10; i++) under.step(still);
	for (let i = 0; i < 60; i++) under.step({ held: ['jump'] });
	check(
		'4. a jump from below passes up through it and lands on top',
		near(under.snapshot().character.y, plank.y - plank.h / 2 - 20),
		String(under.snapshot().character.y),
	);

	// A flap: each press kicks it up; holding does not kick again.
	const flapper: ArcadeCharacter = {
		id: 'f',
		component: 'f',
		movement: { gravity: 900 },
		controller: { kind: 'flap', kick: 300 },
	};
	const flaps = replay(setup({ character: flapper, body: box }), [
		...run(90),
		...run(20, { held: ['jump'] }),
		...run(60),
	]);
	const peak = Math.min(...flaps.slice(90).map((x) => x.character.y));
	same(
		'4. one held press is one flap: kick²/2g up',
		Math.round(floorY - peak),
		Math.round((300 * 300) / (2 * 900)),
	);
	check('4. … then it falls back', near(flaps[flaps.length - 1].character.y, floorY));

	// A hop: a height above the plane, over a ground wall, not over a solid one.
	const hopper: ArcadeCharacter = {
		id: 'h',
		component: 'h',
		controller: { kind: 'topDown', speed: 300, jump: { kind: 'hop', height: 60, time: 0.3 } },
	};
	const low = { id: 'g', x: 860, y: field.h / 2, w: 24, h: 300, kind: 'ground' as const };
	const leftHop = (walls: SandboxSetup['walls'], held: string[]) =>
		replay(setup({ character: hopper, body: box, walls }), run(40, { held }));
	const hop = leftHop([low], ['left', 'jump']);
	const zs = hop.map((x) => x.contact?.z ?? 0);
	check(
		'4. a hop rises its height over the plane',
		near(Math.max(...zs), 60),
		String(Math.max(...zs)),
	);
	check(
		'4. … and stays on its row',
		hop.every((x) => x.character.y === startOf(field).character.y),
	);
	check('4. a hop passes over a ground wall', hop[39].character.x < low.x - 12 - 20);
	check(
		'4. walking into it stops',
		near(leftHop([low], ['left'])[39].character.x, low.x + 12 + 20),
	);
	check(
		'4. a hop does not pass over a solid wall',
		near(leftHop([{ ...low, kind: 'solid' }], ['left', 'jump'])[39].character.x, low.x + 12 + 20),
	);
	check(
		'4. a plain top-down character has no contact readout',
		!(
			'contact' in
			replay(
				setup({
					character: { id: 'p', component: 'p', controller: { kind: 'topDown', speed: 200 } },
				}),
				run(5),
			)[4]
		),
	);
	same(
		'4. the walls a run starts with follow how it moves',
		[wallsFor(field, jumper), wallsFor(field, hopper), wallsFor(field, guard)],
		[PLATFORM_WALLS(field), HOP_WALLS(field), DEFAULT_WALLS(field)],
	);
}

// ── 5. The registry ───────────────────────────────────────────────────────────────────────────
{
	const tool = TOOLS.characters;
	same(
		'5. the tool',
		[tool?.name, tool?.url, tool?.kind],
		['Invisible Characters', '/characters', 'online'],
	);
	for (const [role, ids] of Object.entries(ROLE_TOOLS)) {
		if (role === 'admin') continue;
		check(
			`5. ${role}: Characters with Game Config`,
			ids.includes('characters') === ids.includes('gameConfig'),
		);
	}
	check(
		'5. placed in a stage',
		TOOL_STAGES.some((s) => s.tools.includes('characters')),
	);
	same('5. the guide slug', toolDocPath('characters'), 'docs/invisible-characters');
	const docs = fileURLToPath(new URL('../../../docs/tools/', import.meta.url));
	check(
		'5. docs/tools/invisible-characters.md exists',
		existsSync(`${docs}invisible-characters.md`),
	);
	check(
		'5. its row in docs/tools/README.md',
		readFileSync(`${docs}README.md`, 'utf8').includes('(invisible-characters.md)'),
	);
}

console.log(`check:characters-tool — ${passes}/${passes + fails} passed`);
if (fails) process.exit(1);
