import {
	ARCADE_ANIM_SOURCES,
	ARCADE_BEHAVIOURS,
	ARCADE_VARIABLE_OPS,
	DEFAULT_ARCADE_RANDOM_EVERY,
	type ArcadeAnimSource,
	type ArcadeBehaviourKind,
	type ArcadeBrain,
	type ArcadeBrainState,
	type ArcadeBrainTransition,
	type ArcadeCharacter,
	type ArcadeCondition,
	type ArcadeController,
	type ArcadeJump,
	type ArcadeJumpKind,
	type ArcadeMovement,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import {
	BEHAVIOUR_DEFAULTS,
	DEFAULT_BUFFER_MS,
	DEFAULT_COYOTE_MS,
	jumpProfile,
	type JumpProfile,
} from 'engine-mechanics';

/**
 * How Invisible Characters (`/characters`, `docs/design/game-families.md` §4.3, §5.1) edits
 * `GameConfigDoc.arcade.characters`. Every edit writes what `normalizeGameConfigDoc` would store
 * and nothing else (sparse: a blank or default field is DELETED), so the page never looks dirty
 * for a value a save would drop. `check:characters-tool` runs each edit and re-normalizes.
 *
 * The bodies a character's look uses (`arcade.bodies[component]`) are edited with `/config`'s own
 * setters (`routes/(app)/config/familyDoc.ts`); nothing here duplicates them.
 */

export type CharacterMovementKey = keyof ArcadeMovement;
export const MOVEMENT_KEYS: readonly CharacterMovementKey[] = [
	'accel',
	'decel',
	'maxSpeed',
	'turnRate',
	'gravity',
	'maxFall',
];

/** What each movement field is called on the page, with its unit. */
export const MOVEMENT_LABELS: Record<CharacterMovementKey, string> = {
	accel: 'Accel px/s²',
	decel: 'Decel px/s²',
	maxSpeed: 'Max speed px/s',
	turnRate: 'Turn rate °/s',
	gravity: 'Gravity px/s²',
	maxFall: 'Max fall px/s',
};

export type ControllerChoice = ArcadeController['kind'] | 'none';

/** What a fresh keyboard controller moves at, px/s. */
export const DEFAULT_CONTROLLER_SPEED = 200;

/** A fresh flap's upward kick, px/s. */
export const DEFAULT_FLAP_KICK = 360;

/** A fresh jump: px to the apex, and seconds to get there. */
export const DEFAULT_JUMP_HEIGHT = 120;
export const DEFAULT_JUMP_TIME = 0.4;

export type JumpField = 'height' | 'time' | 'minHeight' | 'coyoteMs' | 'bufferMs' | 'airControl';

/** The controllers that take a jump, and the kind each takes (the validator refuses the other). */
export const JUMP_KIND_FOR: Partial<Record<ArcadeController['kind'], ArcadeJumpKind>> = {
	sideScroll: 'gravity',
	topDown: 'hop',
};

export type BehaviourParamKind = 'number' | 'string' | 'bool' | 'axis';

export type BehaviourParam = {
	key: string;
	kind: BehaviourParamKind;
	/** The value `behaviours.js` uses when the state leaves it out (from `BEHAVIOUR_DEFAULTS`). */
	fallback?: number | string | boolean;
	/** What the field means, for the inspector. */
	hint?: string;
};

/** The params of each behaviour as the inspector lists them. Numbers and their defaults come from
 *  `engine-mechanics` `BEHAVIOUR_DEFAULTS`; the keys it has no default for are listed here. */
const EXTRA_PARAMS: Partial<Record<ArcadeBehaviourKind, BehaviourParam[]>> = {
	patrol: [
		{ key: 'path', kind: 'string', hint: 'a path node id; empty ⇒ from the spawn point by dx, dy' },
		{ key: 'pingPong', kind: 'bool', fallback: true, hint: 'turn back at an open path’s end' },
	],
	followPath: [{ key: 'path', kind: 'string', hint: 'a path node id' }],
	shootAt: [
		{ key: 'component', kind: 'string', hint: 'the component a shot spawns' },
		{ key: 'layer', kind: 'string', hint: 'the spawn layer it spawns into' },
	],
};

export function behaviourParams(behaviour: ArcadeBehaviourKind): BehaviourParam[] {
	const defaults: Record<string, number | string> = BEHAVIOUR_DEFAULTS[behaviour] ?? {};
	const listed: BehaviourParam[] = Object.entries(defaults).map(([key, fallback]) => ({
		key,
		kind: key === 'axis' ? 'axis' : typeof fallback === 'number' ? 'number' : 'string',
		fallback,
	}));
	return [...listed, ...(EXTRA_PARAMS[behaviour] ?? [])];
}

export const isBehaviour = (v: unknown): v is ArcadeBehaviourKind =>
	typeof v === 'string' && (ARCADE_BEHAVIOURS as readonly string[]).includes(v);

// ── the block ──────────────────────────────────────────────────────────────────────────────────

export const charactersOf = (doc: GameConfigDoc): ArcadeCharacter[] => doc.arcade?.characters ?? [];

export const findCharacter = (doc: GameConfigDoc, id: string): ArcadeCharacter | undefined =>
	charactersOf(doc).find((c) => c.id === id);

function list(doc: GameConfigDoc): ArcadeCharacter[] {
	doc.arcade ??= {};
	return (doc.arcade.characters ??= []);
}

function prune(doc: GameConfigDoc): void {
	if (doc.arcade?.characters && !doc.arcade.characters.length) delete doc.arcade.characters;
	if (doc.arcade && !Object.keys(doc.arcade).length) delete doc.arcade;
}

/** `base`, or `base2`, `base3`… — the first not in `taken`. */
export function freshId(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const stem = base.trim() || 'id';
	if (!used.has(stem)) return stem;
	let n = 2;
	while (used.has(`${stem}${n}`)) n += 1;
	return `${stem}${n}`;
}

/** Add a character whose look is `component`; its id is the component's (made unique). Returns
 *  the new id, or `undefined` without a component — the normalizer drops a character with none. */
export function addCharacter(doc: GameConfigDoc, component: string): string | undefined {
	const look = component.trim();
	if (!look) return undefined;
	const id = freshId(
		look,
		charactersOf(doc).map((c) => c.id),
	);
	list(doc).push({ id, component: look });
	return id;
}

/** Copy a character under a fresh id, right after it. The copy keeps the look, which the
 *  validator refuses until one of the two picks another (a component is one character). */
export function duplicateCharacter(doc: GameConfigDoc, id: string): string | undefined {
	const characters = charactersOf(doc);
	const index = characters.findIndex((c) => c.id === id);
	if (index < 0) return undefined;
	// A JSON copy: the page's doc is a `$state` proxy, which `structuredClone` refuses.
	const copy = JSON.parse(JSON.stringify(characters[index])) as ArcadeCharacter;
	copy.id = freshId(
		`${id}Copy`,
		characters.map((c) => c.id),
	);
	characters.splice(index + 1, 0, copy);
	return copy.id;
}

/** Rename a character. Returns why it was refused, or `null`. */
export function renameCharacter(doc: GameConfigDoc, id: string, next: string): string | null {
	const character = findCharacter(doc, id);
	const value = next.trim();
	if (!character) return 'No such character.';
	if (!value) return 'An id cannot be blank.';
	if (value === id) return null;
	if (findCharacter(doc, value)) return `A character is already called "${value}".`;
	character.id = value;
	return null;
}

export function removeCharacter(doc: GameConfigDoc, id: string): void {
	const characters = doc.arcade?.characters;
	if (!characters) return;
	const index = characters.findIndex((c) => c.id === id);
	if (index >= 0) characters.splice(index, 1);
	prune(doc);
}

/** The display name; blank deletes it. */
export function setCharacterName(doc: GameConfigDoc, id: string, name: string): void {
	const character = findCharacter(doc, id);
	if (!character) return;
	const value = name.trim();
	if (value) character.name = value;
	else delete character.name;
}

/** The look. Blank is refused (the character would be dropped on save). */
export function setLook(doc: GameConfigDoc, id: string, component: string): void {
	const character = findCharacter(doc, id);
	const value = component.trim();
	if (character && value) character.component = value;
}

// ── movement ───────────────────────────────────────────────────────────────────────────────────

const nonNegative = (value: string): number | undefined => {
	const n = Number(value);
	return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** One movement field; blank or not a number ≥ 0 deletes it (instant / uncapped). */
export function setMovement(
	doc: GameConfigDoc,
	id: string,
	key: CharacterMovementKey,
	value: string,
): void {
	const character = findCharacter(doc, id);
	if (!character) return;
	const n = nonNegative(value);
	const movement: ArcadeMovement = character.movement ?? {};
	if (n === undefined) delete movement[key];
	else movement[key] = n;
	if (Object.keys(movement).length) character.movement = movement;
	else delete character.movement;
}

// ── controller ─────────────────────────────────────────────────────────────────────────────────

/** Pick the controller; `none` deletes it. The new one keeps the speed it had (a keyboard one
 *  falls back to the default) and, between top-down and side-scroll, the jump, re-kinded. */
export function setController(doc: GameConfigDoc, id: string, kind: ControllerChoice): void {
	const character = findCharacter(doc, id);
	if (!character) return;
	const was = character.controller;
	if (kind === 'none') {
		delete character.controller;
		return;
	}
	if (was?.kind === kind) return;
	if (kind === 'pointer') {
		character.controller = { kind, axes: 'x' };
		return;
	}
	if (kind === 'flap') {
		character.controller =
			was?.speed === undefined
				? { kind, kick: DEFAULT_FLAP_KICK }
				: { kind, kick: DEFAULT_FLAP_KICK, speed: was.speed };
		return;
	}
	const jump = was && 'jump' in was ? was.jump : undefined;
	const speed = was?.speed ?? DEFAULT_CONTROLLER_SPEED;
	character.controller = jump
		? { kind, speed, jump: { ...jump, kind: JUMP_KIND_FOR[kind]! } }
		: { kind, speed };
}

/** The controller's speed. A keyboard one needs a number ≥ 0 (anything else is ignored); a
 *  pointer or flap one deletes it when blank (a pointer then moves at `movement.maxSpeed`, or
 *  snaps; a flap only rises and falls). */
export function setControllerSpeed(doc: GameConfigDoc, id: string, value: string): void {
	const controller = findCharacter(doc, id)?.controller;
	if (!controller) return;
	const n = nonNegative(value);
	if (controller.kind === 'pointer' || controller.kind === 'flap') {
		if (n === undefined) delete controller.speed;
		else controller.speed = n;
	} else if (n !== undefined) controller.speed = n;
}

/** A flap's kick, px/s up. Not a number above 0 is ignored (the flap would be dropped). */
export function setFlapKick(doc: GameConfigDoc, id: string, value: string): void {
	const controller = findCharacter(doc, id)?.controller;
	const n = Number(value);
	if (controller?.kind === 'flap' && value.trim() !== '' && Number.isFinite(n) && n > 0) {
		controller.kick = n;
	}
}

/** The controller's jump, when it takes one. */
export function jumpOf(character: ArcadeCharacter | undefined): ArcadeJump | undefined {
	const controller = character?.controller;
	return controller && 'jump' in controller ? controller.jump : undefined;
}

/** Turn the jump on (at the default height and time, of the kind the controller takes) or off. */
export function setJump(doc: GameConfigDoc, id: string, on: boolean): void {
	const controller = findCharacter(doc, id)?.controller;
	if (!controller || (controller.kind !== 'topDown' && controller.kind !== 'sideScroll')) return;
	if (!on) delete controller.jump;
	else if (!controller.jump) {
		controller.jump = {
			kind: JUMP_KIND_FOR[controller.kind]!,
			height: DEFAULT_JUMP_HEIGHT,
			time: DEFAULT_JUMP_TIME,
		};
	}
}

/** The default a blank optional jump field stands for; `undefined` ⇒ the field has none. */
export const JUMP_FIELD_DEFAULTS: Partial<Record<JumpField, number>> = {
	coyoteMs: DEFAULT_COYOTE_MS,
	bufferMs: DEFAULT_BUFFER_MS,
	airControl: 1,
};

/** One jump field. Height and time need a number above 0 (anything else is ignored); the tap
 *  height is deleted when blank or not above 0; coyote and buffer ms when blank or at their
 *  default (a negative is ignored); air control when blank or 1 and up (a negative is ignored). */
export function setJumpField(doc: GameConfigDoc, id: string, key: JumpField, value: string): void {
	const jump = jumpOf(findCharacter(doc, id));
	if (!jump) return;
	const text = value.trim();
	const n = Number(text);
	const number = text !== '' && Number.isFinite(n) ? n : undefined;
	if (key === 'height' || key === 'time') {
		if (number !== undefined && number > 0) jump[key] = number;
	} else if (key === 'minHeight') {
		if (number !== undefined && number > 0) jump.minHeight = number;
		else delete jump.minHeight;
	} else if (key === 'airControl') {
		if (number === undefined || number >= 1) delete jump.airControl;
		else if (number >= 0) jump.airControl = number;
	} else if (number === undefined || number === JUMP_FIELD_DEFAULTS[key]) delete jump[key];
	else if (number >= 0) jump[key] = number;
}

/** What a jump's height and time come to: its launch speed, its pull, a tap's cut speed. */
export const jumpHint = (jump: ArcadeJump): JumpProfile => jumpProfile(jump);

export function setPointerAxes(doc: GameConfigDoc, id: string, axes: 'x' | 'y' | 'xy'): void {
	const controller = findCharacter(doc, id)?.controller;
	if (controller?.kind === 'pointer') controller.axes = axes;
}

// ── brain ──────────────────────────────────────────────────────────────────────────────────────

/** Where a new state's card lands when none is given: a row, 220 px apart. */
const autoPos = (brain: ArcadeBrain | undefined): { x: number; y: number } => ({
	x: 240 + (brain?.states.length ?? 0) * 220,
	y: 40 + ((brain?.states.length ?? 0) % 2) * 120,
});

const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Add a state running `behaviour` (its id the behaviour's, made unique). A character without a
 *  brain gets one, starting in it. Returns the state id. */
export function addState(
	doc: GameConfigDoc,
	id: string,
	behaviour: ArcadeBehaviourKind,
	pos?: { x: number; y: number },
): string | undefined {
	const character = findCharacter(doc, id);
	if (!character) return undefined;
	const brain = character.brain;
	const stateId = freshId(
		behaviour,
		(brain?.states ?? []).map((s) => s.id),
	);
	const state: ArcadeBrainState = { id: stateId, behaviour, pos: round(pos ?? autoPos(brain)) };
	if (brain) brain.states.push(state);
	else character.brain = { initial: stateId, states: [state], transitions: [] };
	return stateId;
}

const brainOf = (doc: GameConfigDoc, id: string) => findCharacter(doc, id)?.brain;
const stateIn = (brain: ArcadeBrain | undefined, stateId: string) =>
	brain?.states.find((s) => s.id === stateId);

/** Remove a state, every transition into or out of it, and the anim inputs that followed it. The
 *  last state removes the brain; an initial state hands the start to the first left. */
export function removeState(doc: GameConfigDoc, id: string, stateId: string): void {
	const character = findCharacter(doc, id);
	const brain = character?.brain;
	if (!character || !brain) return;
	brain.states = brain.states.filter((s) => s.id !== stateId);
	brain.transitions = brain.transitions.filter((t) => t.from !== stateId && t.to !== stateId);
	for (const [input, source] of Object.entries(character.animInputs ?? {})) {
		if (source === `state:${stateId}`) delete character.animInputs![input];
	}
	if (character.animInputs && !Object.keys(character.animInputs).length) {
		delete character.animInputs;
	}
	if (!brain.states.length) {
		delete character.brain;
		return;
	}
	if (brain.initial === stateId) brain.initial = brain.states[0].id;
}

/** Rename a state everywhere it is named: transitions, the initial state, `state:<id>` sources.
 *  Returns why it was refused, or `null`. `*` is the any-state wildcard and cannot be a state. */
export function renameState(
	doc: GameConfigDoc,
	id: string,
	stateId: string,
	next: string,
): string | null {
	const character = findCharacter(doc, id);
	const brain = character?.brain;
	const state = stateIn(brain, stateId);
	const value = next.trim();
	if (!character || !brain || !state) return 'No such state.';
	if (!value) return 'A state id cannot be blank.';
	if (value === '*') return '"*" means any state; pick another id.';
	if (value === stateId) return null;
	if (stateIn(brain, value)) return `The brain already has a state "${value}".`;
	state.id = value;
	if (brain.initial === stateId) brain.initial = value;
	for (const t of brain.transitions) {
		if (t.from === stateId) t.from = value;
		if (t.to === stateId) t.to = value;
	}
	for (const [input, source] of Object.entries(character.animInputs ?? {})) {
		if (source === `state:${stateId}`) character.animInputs![input] = `state:${value}`;
	}
	return null;
}

/** Switch a state's behaviour, keeping only the params the new one reads. */
export function setBehaviour(
	doc: GameConfigDoc,
	id: string,
	stateId: string,
	behaviour: ArcadeBehaviourKind,
): void {
	const state = stateIn(brainOf(doc, id), stateId);
	if (!state || state.behaviour === behaviour) return;
	state.behaviour = behaviour;
	const keys = new Set(behaviourParams(behaviour).map((p) => p.key));
	for (const key of Object.keys(state.params ?? {})) if (!keys.has(key)) delete state.params![key];
	if (state.params && !Object.keys(state.params).length) delete state.params;
}

/** One behaviour param. Blank, unreadable or at its default deletes it. */
export function setParam(
	doc: GameConfigDoc,
	id: string,
	stateId: string,
	key: string,
	value: string | boolean,
): void {
	const state = stateIn(brainOf(doc, id), stateId);
	const param = state && behaviourParams(state.behaviour).find((p) => p.key === key);
	if (!state || !param) return;
	let next: number | string | boolean | undefined;
	if (param.kind === 'bool') next = typeof value === 'boolean' ? value : value === 'true';
	else if (param.kind === 'number') {
		const n = Number(value);
		next = typeof value === 'string' && value.trim() !== '' && Number.isFinite(n) ? n : undefined;
	} else next = typeof value === 'string' && value.trim() ? value.trim() : undefined;
	const params = (state.params ??= {});
	if (next === undefined || next === param.fallback) delete params[key];
	else params[key] = next;
	if (!Object.keys(params).length) delete state.params;
}

export function setInitial(doc: GameConfigDoc, id: string, stateId: string): void {
	const brain = brainOf(doc, id);
	if (brain && stateIn(brain, stateId)) brain.initial = stateId;
}

/** Where the state's card sits (whole px). */
export function setStatePos(
	doc: GameConfigDoc,
	id: string,
	stateId: string,
	pos: { x: number; y: number },
): void {
	const state = stateIn(brainOf(doc, id), stateId);
	if (state && Number.isFinite(pos.x) && Number.isFinite(pos.y)) state.pos = round(pos);
}

/** Add a transition `from` (a state or `*`) → `to`, waiting on nothing yet. Returns its id. */
export function addTransition(
	doc: GameConfigDoc,
	id: string,
	from: string,
	to: string,
): string | undefined {
	const brain = brainOf(doc, id);
	if (!brain || !stateIn(brain, to) || (from !== '*' && !stateIn(brain, from))) return undefined;
	const tid = nextTransitionId(brain);
	brain.transitions.push({ id: tid, from, to, when: [] });
	return tid;
}

function nextTransitionId(brain: ArcadeBrain): string {
	const taken = new Set(brain.transitions.map((t) => t.id));
	let n = brain.transitions.length + 1;
	while (taken.has(`t${n}`)) n += 1;
	return `t${n}`;
}

const transitionIn = (doc: GameConfigDoc, id: string, tid: string) =>
	brainOf(doc, id)?.transitions.find((t) => t.id === tid);

export function removeTransition(doc: GameConfigDoc, id: string, tid: string): void {
	const brain = brainOf(doc, id);
	if (brain) brain.transitions = brain.transitions.filter((t) => t.id !== tid);
}

/** Move a transition up (-1) or down (+1): the first whose conditions hold fires. */
export function moveTransition(doc: GameConfigDoc, id: string, tid: string, by: -1 | 1): void {
	const brain = brainOf(doc, id);
	if (!brain) return;
	const i = brain.transitions.findIndex((t) => t.id === tid);
	const j = i + by;
	if (i < 0 || j < 0 || j >= brain.transitions.length) return;
	[brain.transitions[i], brain.transitions[j]] = [brain.transitions[j], brain.transitions[i]];
}

/** A condition of `kind` with values that already work. */
export function newCondition(kind: ArcadeCondition['kind']): ArcadeCondition {
	switch (kind) {
		case 'targetWithin':
			return { kind, tag: 'player', px: 200 };
		case 'targetBeyond':
			return { kind, tag: 'player', px: 300 };
		case 'touching':
			return { kind, tag: 'player' };
		case 'hitSolid':
			return { kind };
		case 'timer':
			return { kind, ms: 1000 };
		case 'variable':
			return { kind, id: 'flag', op: '==', value: true };
		case 'random':
			return { kind, chance: 0.5 };
	}
}

export function addCondition(
	doc: GameConfigDoc,
	id: string,
	tid: string,
	kind: ArcadeCondition['kind'],
): void {
	transitionIn(doc, id, tid)?.when.push(newCondition(kind));
}

export function removeCondition(doc: GameConfigDoc, id: string, tid: string, index: number): void {
	transitionIn(doc, id, tid)?.when.splice(index, 1);
}

/** A variable condition's value as typed: `true` / `false`, a number, or text. */
export function parseVariableValue(text: string): number | boolean | string {
	const value = text.trim();
	if (value === 'true') return true;
	if (value === 'false') return false;
	const n = Number(value);
	return value !== '' && Number.isFinite(n) ? n : value;
}

export type ConditionField = 'tag' | 'px' | 'ms' | 'id' | 'op' | 'value' | 'chance' | 'every';

/** One field of a condition. Anything the normalizer would refuse leaves it as it was (it would
 *  drop the WHOLE transition otherwise). */
export function setConditionField(
	doc: GameConfigDoc,
	id: string,
	tid: string,
	index: number,
	field: ConditionField,
	text: string,
): void {
	const c = transitionIn(doc, id, tid)?.when[index];
	if (!c) return;
	const value = text.trim();
	const n = Number(value);
	const number = value !== '' && Number.isFinite(n) ? n : undefined;
	if (field === 'tag' && 'tag' in c && value) c.tag = value;
	else if (field === 'px' && 'px' in c && number !== undefined && number >= 0) c.px = number;
	else if (field === 'ms' && c.kind === 'timer' && number !== undefined && number >= 0)
		c.ms = number;
	else if (field === 'id' && c.kind === 'variable' && value) c.id = value;
	else if (field === 'op' && c.kind === 'variable') {
		const op = ARCADE_VARIABLE_OPS.find((o) => o === value);
		if (op) c.op = op;
	} else if (field === 'value' && c.kind === 'variable') c.value = parseVariableValue(text);
	else if (field === 'chance' && c.kind === 'random' && number !== undefined) {
		if (number >= 0 && number <= 1) c.chance = number;
	} else if (field === 'every' && c.kind === 'random') {
		if (number === undefined || number === DEFAULT_ARCADE_RANDOM_EVERY) delete c.every;
		else if (number > 0) c.every = number;
	}
}

/** A transition's conditions in a line: `player within 200 px · after 500 ms`. */
export function conditionText(c: ArcadeCondition): string {
	switch (c.kind) {
		case 'targetWithin':
			return `${c.tag} within ${c.px} px`;
		case 'targetBeyond':
			return `${c.tag} beyond ${c.px} px`;
		case 'touching':
			return `touching ${c.tag}`;
		case 'hitSolid':
			return 'hit a wall';
		case 'timer':
			return `after ${c.ms} ms`;
		case 'variable':
			return `${c.id} ${c.op} ${JSON.stringify(c.value)}`;
		case 'random':
			return `${Math.round(c.chance * 100)}% every ${c.every ?? DEFAULT_ARCADE_RANDOM_EVERY} ms`;
	}
}

export const transitionText = (t: ArcadeBrainTransition): string =>
	t.when.length ? t.when.map(conditionText).join(' · ') : 'at once';

// ── anim inputs ────────────────────────────────────────────────────────────────────────────────

/** The sources a look input can follow: the plain ones and `state:<id>` per brain state. */
export function animSourcesFor(character: ArcadeCharacter): ArcadeAnimSource[] {
	return [
		...ARCADE_ANIM_SOURCES,
		...(character.brain?.states ?? []).map((s) => `state:${s.id}` as const),
	];
}

/** The sources that read true / false (a `bool` look input); the rest are numbers. */
const BOOL_ANIM_SOURCES: readonly string[] = ['moving', 'grounded', 'onWall', 'airborne'];

export const animSourceIsBool = (source: ArcadeAnimSource): boolean =>
	BOOL_ANIM_SOURCES.includes(source) || source.startsWith('state:');

/** Map a look input to a source; `''` unmaps it. */
export function setAnimInput(
	doc: GameConfigDoc,
	id: string,
	input: string,
	source: ArcadeAnimSource | '',
): void {
	const character = findCharacter(doc, id);
	const key = input.trim();
	if (!character || !key) return;
	const inputs = (character.animInputs ??= {});
	if (source) inputs[key] = source;
	else delete inputs[key];
	if (!Object.keys(inputs).length) delete character.animInputs;
}

// ── issues ─────────────────────────────────────────────────────────────────────────────────────

/** The validator's issues about the character at `index` (its paths start `arcade.characters[i]`). */
export const characterIssues = (issues: GameConfigIssue[], index: number): GameConfigIssue[] =>
	issues.filter(
		(i) =>
			i.path === `arcade.characters[${index}]` || i.path.startsWith(`arcade.characters[${index}].`),
	);

/** The issues of one brain state or transition (by its index in the brain). */
export const brainItemIssues = (
	issues: GameConfigIssue[],
	index: number,
	item: 'states' | 'transitions',
	at: number,
): GameConfigIssue[] =>
	issues.filter((i) => i.path === `arcade.characters[${index}].brain.${item}[${at}]`);
