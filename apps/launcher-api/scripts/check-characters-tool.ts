/**
 * check:characters-tool — Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3,
 * §5.1, P10.11): the page's pure helpers, run on real config docs.
 *
 *   pnpm --filter launcher-api check:characters-tool
 *
 *  1. THE EDITS MIRROR THE NORMALIZER. Every character, movement, controller, brain and anim-input
 *     edit (`$lib/characters/characterEdit.ts`) leaves the doc exactly as a save would store it, so
 *     the page never looks dirty for a value a save drops; refused values leave the doc alone.
 *  2. ADD / DUPLICATE / RENAME / DELETE, and the brain's renames and deletes reaching everything that
 *     names a state (transitions, the initial state, `state:<id>` anim inputs).
 *  3. THE GRAPH. Entry → initial, Any → the `*` transitions; what a wire between two cards means.
 *  4. THE SANDBOX. Same seed and input ⇒ the same run; a step is exactly `behaviours.js` + `steer` +
 *     `stepSolid` driven by hand; walls stop the character (`hitSolid`); a controller follows the
 *     keys; `shootAt` fires; anim inputs read as the loop writes them.
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
	brainVelocity,
	createBrain,
	createBrainWorld,
	createRng,
	steer,
	stepBrain,
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
	replay,
	startOf,
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
		['speed', 'vx', 'vy', 'facing', 'moving', 'state:a'],
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
		stepSolid(player, dt, [], field);
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
