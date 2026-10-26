import { isObject, num } from './normalizeParts';
import type { GameConfigDoc } from './types';

/**
 * ARCADE CHARACTERS (`docs/design/game-families.md` §4.3, §9 #14, P10.11): the things on an arcade
 * play field that move by themselves — played by a controller, run by a brain, or both (a bot).
 * Authored in Invisible Characters, stored in `GameConfigDoc.arcade.characters`. SPARSE like the
 * rest of the arcade block: every field is optional but the id and the look, a field at its default
 * is not stored, and a config with no characters stores no key at all.
 *
 * The shapes are read structurally by `engine-mechanics` `behaviours.js`, which owns each
 * behaviour's defaults (this package names the kinds, not the numbers).
 */

/** How a character's velocity follows what it wants. Absent fields are instant / uncapped. */
export type ArcadeMovement = {
	/** px/s² towards the desired velocity; absent ⇒ instant. */
	accel?: number;
	/** px/s² when slowing or stopping; absent ⇒ `accel` (instant when both are absent). */
	decel?: number;
	/** px/s cap on |v|; absent ⇒ no cap. */
	maxSpeed?: number;
	/** Degrees per second the heading may turn; absent ⇒ instant. */
	turnRate?: number;
};

/** The player's controls, when the character is playable. */
export type ArcadeController =
	| { kind: 'topDown'; speed: number }
	| { kind: 'sideScroll'; speed: number }
	| { kind: 'pointer'; axes: 'x' | 'y' | 'xy'; speed?: number };

export const ARCADE_CONTROLLER_KINDS = ['topDown', 'sideScroll', 'pointer'] as const;

export const ARCADE_POINTER_AXES = ['x', 'y', 'xy'] as const;

/** The input-map action names (`FlowDoc.inputs`) the keyboard controllers read. Fixed. */
export const ARCADE_CONTROLLER_ACTIONS = ['left', 'right', 'up', 'down'] as const;

export const ARCADE_BEHAVIOURS = [
	'idle',
	'wander',
	'patrol',
	'followPath',
	'chase',
	'flee',
	'keepDistance',
	'hover',
	'shootAt',
] as const;

export type ArcadeBehaviourKind = (typeof ARCADE_BEHAVIOURS)[number];

export type ArcadeBrainState = {
	id: string;
	behaviour: ArcadeBehaviourKind;
	params?: Record<string, number | string | boolean>;
	/** Where the editor draws the state's card; the runtime ignores it. */
	pos?: { x: number; y: number };
};

export const ARCADE_VARIABLE_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;

export type ArcadeCondition =
	| { kind: 'targetWithin'; tag: string; px: number }
	| { kind: 'targetBeyond'; tag: string; px: number }
	| { kind: 'touching'; tag: string }
	| { kind: 'hitSolid' }
	| { kind: 'timer'; ms: number }
	| {
			kind: 'variable';
			id: string;
			op: (typeof ARCADE_VARIABLE_OPS)[number];
			value: number | boolean | string;
	  }
	| { kind: 'random'; chance: number; every?: number };

export const ARCADE_CONDITIONS = [
	'targetWithin',
	'targetBeyond',
	'touching',
	'hitSolid',
	'timer',
	'variable',
	'random',
] as const satisfies readonly ArcadeCondition['kind'][];

/** How often a `random` condition rolls when it names no `every`, in ms. Never stored. */
export const DEFAULT_ARCADE_RANDOM_EVERY = 1000;

export type ArcadeBrainTransition = {
	id: string;
	/** A state id, or `*` for any state (never re-entering the state it fires from). */
	from: string;
	to: string;
	/** ALL must hold; `[]` fires at once. */
	when: ArcadeCondition[];
};

export type ArcadeBrain = {
	initial: string;
	states: ArcadeBrainState[];
	transitions: ArcadeBrainTransition[];
};

/** The plain sources an `animInputs` entry can read; `state:<id>` is the one templated source. */
export const ARCADE_ANIM_SOURCES = ['speed', 'vx', 'vy', 'facing', 'moving'] as const;

export type ArcadeAnimSource = (typeof ARCADE_ANIM_SOURCES)[number] | `state:${string}`;

export type ArcadeCharacter = {
	/** Unique: the brain's and Flow's name for it. */
	id: string;
	name?: string;
	/** The LOOK: a spawned instance of this component IS this character. */
	component: string;
	movement?: ArcadeMovement;
	/** Present ⇒ playable (driven by the player). */
	controller?: ArcadeController;
	/** Present ⇒ acts on its own (a bot when also playable). */
	brain?: ArcadeBrain;
	/** Component input id → what drives it. */
	animInputs?: Record<string, ArcadeAnimSource>;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const nonNegative = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && n >= 0 ? n : undefined;
};

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === 'string' && (list as readonly string[]).includes(v);

const normalizeMovement = (raw: unknown): ArcadeMovement | undefined => {
	if (!isObject(raw)) return undefined;
	const movement: ArcadeMovement = {};
	for (const key of ['accel', 'decel', 'maxSpeed', 'turnRate'] as const) {
		const n = nonNegative(raw[key]);
		if (n !== undefined) movement[key] = n;
	}
	return Object.keys(movement).length ? movement : undefined;
};

const normalizeController = (raw: unknown): ArcadeController | undefined => {
	if (!isObject(raw)) return undefined;
	if (raw.kind === 'topDown' || raw.kind === 'sideScroll') {
		const speed = nonNegative(raw.speed);
		return speed === undefined ? undefined : { kind: raw.kind, speed };
	}
	if (raw.kind === 'pointer' && includes(ARCADE_POINTER_AXES, raw.axes)) {
		const speed = nonNegative(raw.speed);
		return speed === undefined
			? { kind: 'pointer', axes: raw.axes }
			: { kind: 'pointer', axes: raw.axes, speed };
	}
	return undefined;
};

const normalizeParams = (
	raw: unknown,
): Record<string, number | string | boolean> | undefined => {
	if (!isObject(raw)) return undefined;
	const params: Record<string, number | string | boolean> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!key) continue;
		if (typeof value === 'string' || typeof value === 'boolean') params[key] = value;
		else if (num(value) !== undefined) params[key] = value as number;
	}
	return Object.keys(params).length ? params : undefined;
};

const normalizeState = (raw: unknown): ArcadeBrainState | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	if (!id || !includes(ARCADE_BEHAVIOURS, raw.behaviour)) return undefined;
	const state: ArcadeBrainState = { id, behaviour: raw.behaviour };
	const params = normalizeParams(raw.params);
	if (params) state.params = params;
	if (isObject(raw.pos)) {
		const x = num(raw.pos.x);
		const y = num(raw.pos.y);
		if (x !== undefined && y !== undefined) state.pos = { x, y };
	}
	return state;
};

const normalizeCondition = (raw: unknown): ArcadeCondition | undefined => {
	if (!isObject(raw)) return undefined;
	switch (raw.kind) {
		case 'targetWithin':
		case 'targetBeyond': {
			const tag = text(raw.tag);
			const px = nonNegative(raw.px);
			return tag && px !== undefined ? { kind: raw.kind, tag, px } : undefined;
		}
		case 'touching': {
			const tag = text(raw.tag);
			return tag ? { kind: 'touching', tag } : undefined;
		}
		case 'hitSolid':
			return { kind: 'hitSolid' };
		case 'timer': {
			const ms = nonNegative(raw.ms);
			return ms === undefined ? undefined : { kind: 'timer', ms };
		}
		case 'variable': {
			const id = text(raw.id);
			const value = raw.value;
			const valid =
				typeof value === 'string' || typeof value === 'boolean' || num(value) !== undefined;
			return id && includes(ARCADE_VARIABLE_OPS, raw.op) && valid
				? { kind: 'variable', id, op: raw.op, value: value as number | boolean | string }
				: undefined;
		}
		case 'random': {
			const chance = num(raw.chance);
			if (chance === undefined || chance < 0 || chance > 1) return undefined;
			const every = num(raw.every);
			return every !== undefined && every > 0 && every !== DEFAULT_ARCADE_RANDOM_EVERY
				? { kind: 'random', chance, every }
				: { kind: 'random', chance };
		}
		default:
			return undefined;
	}
};

/** A transition with an unreadable condition is dropped WHOLE: dropping only the condition would
 *  loosen `when` and fire it where the author never meant it to. */
const normalizeTransition = (raw: unknown): ArcadeBrainTransition | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	const from = text(raw.from);
	const to = text(raw.to);
	if (!id || !from || !to) return undefined;
	const rawWhen = Array.isArray(raw.when) ? raw.when : [];
	const when = rawWhen.map(normalizeCondition);
	if (when.some((c) => c === undefined)) return undefined;
	return { id, from, to, when: when as ArcadeCondition[] };
};

const uniqueById = <T extends { id: string }>(items: (T | undefined)[]): T[] => {
	const kept: T[] = [];
	for (const item of items) if (item && !kept.some((k) => k.id === item.id)) kept.push(item);
	return kept;
};

const normalizeBrain = (raw: unknown): ArcadeBrain | undefined => {
	if (!isObject(raw)) return undefined;
	const states = uniqueById(
		(Array.isArray(raw.states) ? raw.states : []).map(normalizeState),
	);
	if (!states.length) return undefined;
	const transitions = uniqueById(
		(Array.isArray(raw.transitions) ? raw.transitions : []).map(normalizeTransition),
	);
	// A brain always starts somewhere: no initial names the first state. A named one is kept as
	// typed, so an initial that names no state reaches the validator instead of being re-pointed.
	return { initial: text(raw.initial) || states[0].id, states, transitions };
};

const isAnimSource = (v: string): v is ArcadeAnimSource =>
	includes(ARCADE_ANIM_SOURCES, v) || (v.startsWith('state:') && v.length > 'state:'.length);

const normalizeAnimInputs = (raw: unknown): Record<string, ArcadeAnimSource> | undefined => {
	if (!isObject(raw)) return undefined;
	const inputs: Record<string, ArcadeAnimSource> = {};
	for (const [key, value] of Object.entries(raw)) {
		const input = key.trim();
		const source = text(value);
		if (input && isAnimSource(source)) inputs[input] = source;
	}
	return Object.keys(inputs).length ? inputs : undefined;
};

const normalizeCharacter = (raw: unknown): ArcadeCharacter | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	const component = text(raw.component);
	if (!id || !component) return undefined;
	const name = text(raw.name);
	const character: ArcadeCharacter = name ? { id, name, component } : { id, component };
	const movement = normalizeMovement(raw.movement);
	if (movement) character.movement = movement;
	const controller = normalizeController(raw.controller);
	if (controller) character.controller = controller;
	const brain = normalizeBrain(raw.brain);
	if (brain) character.brain = brain;
	const animInputs = normalizeAnimInputs(raw.animInputs);
	if (animInputs) character.animInputs = animInputs;
	return character;
};

/**
 * Normalize `arcade.characters`, or `undefined` when none is usable. A character with no id or no
 * look is dropped (nothing could spawn it); a repeated id keeps the first. Two characters sharing a
 * component are both kept, for the validator to refuse.
 */
export function normalizeArcadeCharacters(raw: unknown): ArcadeCharacter[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const characters = uniqueById(raw.map(normalizeCharacter));
	return characters.length ? characters : undefined;
}

/**
 * The component ids a config's characters spawn at RUNTIME — each character's look and every
 * `shootAt` projectile — distinct, in authored order. The bake seeds them like `betModeCardIds`
 * (rule 8): a character placed in no scene still ships its def and art. Empty without characters,
 * so such a project ships byte-identical.
 */
export const characterComponentIds = (doc: Pick<GameConfigDoc, 'arcade'>): string[] => {
	const ids = new Set<string>();
	for (const character of doc.arcade?.characters ?? []) {
		const look = character.component?.trim();
		if (look) ids.add(look);
		for (const state of character.brain?.states ?? []) {
			const shot = state.behaviour === 'shootAt' ? state.params?.component : undefined;
			if (typeof shot === 'string' && shot.trim()) ids.add(shot.trim());
		}
	}
	return [...ids];
};
