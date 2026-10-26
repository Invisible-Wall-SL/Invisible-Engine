import {
	createFixedStep,
	touching,
	type Body,
	type Field,
	type FixedStep,
	type Point,
} from 'engine-mechanics';
import { createCharacterStage } from 'engine-game/src/game/arcadeCharacters';
import type { ArcadeBody, ArcadeCharacter } from 'game-config';
import { parseVariableValue } from './characterEdit';

/**
 * The Invisible Characters SANDBOX (`docs/design/game-families.md` §5.1): one character on a
 * placeholder play field with a keyboard-driven dummy player, a few walls and an optional drawn
 * path. It runs the arcade loop's OWN characters stage (`engine-game` `createCharacterStage`) at a
 * fixed step through a small io shim — the same driver rule, decide → steer → `stepSolid` order and
 * anim-input values as the game, so the sandbox and the game cannot drift. The same seed and the
 * same input give the same run. Nothing here is saved; the page draws `snapshot()`.
 */

/** The dummy player's tag, size and speed (px/s, instant). It is a plain body, as in the game. */
export const PLAYER_TAG = 'player';
export const PLAYER_SIZE = 40;
export const PLAYER_SPEED = 220;
/** A character whose look has no body is drawn and moved as this box. */
export const FALLBACK_BODY: ArcadeBody = { shape: 'box', w: 48, h: 48 };
/** Shots are small circles; they vanish on a wall, off the field, on the player or after this. */
export const SHOT_RADIUS = 6;
export const SHOT_LIFE_MS = 4000;
/** The id every brain's `path` param resolves to when the author draws a path here. */
export const SANDBOX_PATH = 'sandbox';
/** The character's body id (the loop's instance id stand-in): its brain's rng is seeded
 *  `<seed>:character:<id>` by the stage, as in the game. */
export const SANDBOX_CHARACTER_BODY = 'character';

/** Component ids of the sandbox's own bodies; never a project component's (they start `__`). */
const PLAYER_LOOK = '__player';
const WALL_LOOK = '__wall';

export type SandboxWall = { id: string; x: number; y: number; w: number; h: number };

export type SandboxSetup = {
	character: ArcadeCharacter;
	/** `arcade.bodies[character.component]`, when there is one. */
	body?: ArcadeBody;
	field: Field;
	seed: string;
	walls: readonly SandboxWall[];
	/** Points of a drawn path (field px); every `path` a state names resolves to it. */
	path?: readonly Point[];
	hz?: number;
	/** Who drives a character with both a controller and a brain (Flow's `setCharacterControl`). */
	drive?: 'controller' | 'brain';
	/** Values for `variable` conditions (a stand-in for Flow's variables). */
	variables?: Readonly<Record<string, unknown>>;
};

/** The keys held this step (`left/right/up/down`) and a pressed pointer. */
export type SandboxInput = { held: readonly string[]; pointer?: Point };

type SimBody = Body & { componentId: string; label: string };

export type SandboxShot = { id: string; x: number; y: number; r: number };

export type SandboxSnapshot = {
	steps: number;
	player: SimBody;
	character: SimBody;
	shots: SandboxShot[];
	/** The brain's state, when it has one. */
	state?: string;
	speed: number;
	/** Each mapped look input's value, as the stage last wrote it. */
	animInputs: Record<string, unknown>;
	/** Shots that touched the player so far. */
	hits: number;
	/** Who moves the character (the stage's rule: a controller unless handed to the brain). */
	driver: 'controller' | 'brain' | 'none';
};

export type Sandbox = {
	readonly fixed: FixedStep;
	/** One fixed step with this input. */
	step(input: SandboxInput): void;
	/** A frame's time: as many fixed steps as it holds. */
	advance(frameMs: number, input: SandboxInput): number;
	snapshot(): SandboxSnapshot;
	/** Move a body by drag (field px). */
	place(which: 'player' | 'character', at: Point): void;
	setWall(wall: SandboxWall): void;
};

export const DEFAULT_WALLS = (field: Field): SandboxWall[] => [
	{ id: 'wall1', x: field.w * 0.5, y: field.h * 0.22, w: 24, h: field.h * 0.3 },
	{ id: 'wall2', x: field.w * 0.5, y: field.h * 0.78, w: 24, h: field.h * 0.3 },
];

/** Where the bodies start: the player left, the character right, both mid-height. */
export const startOf = (field: Field) => ({
	player: { x: field.w * 0.2, y: field.h / 2 },
	character: { x: field.w * 0.75, y: field.h / 2 },
});

const shapeOf = (
	body: ArcadeBody,
): { shape: 'box'; w: number; h: number } | { shape: 'circle'; r: number } =>
	body.shape === 'box' ? { shape: 'box', w: body.w, h: body.h } : { shape: 'circle', r: body.r };

function wallBody(wall: SandboxWall): SimBody {
	return {
		id: wall.id,
		componentId: WALL_LOOK,
		label: wall.id,
		shape: 'box',
		w: wall.w,
		h: wall.h,
		x: wall.x,
		y: wall.y,
		vx: 0,
		vy: 0,
		tags: ['wall'],
		edges: 'pass',
		solid: true,
	};
}

export function createSandbox(setup: SandboxSetup): Sandbox {
	const { character, field } = setup;
	const look = setup.body ?? FALLBACK_BODY;
	const start = startOf(field);
	const fixed = createFixedStep({ hz: setup.hz ?? 60 });

	const player: SimBody = {
		id: 'player',
		componentId: PLAYER_LOOK,
		label: PLAYER_TAG,
		shape: 'box',
		w: PLAYER_SIZE,
		h: PLAYER_SIZE,
		x: start.player.x,
		y: start.player.y,
		vx: 0,
		vy: 0,
		tags: [PLAYER_TAG],
	};
	const self: SimBody = {
		id: SANDBOX_CHARACTER_BODY,
		componentId: character.component,
		label: character.name || character.id,
		...shapeOf(look),
		x: start.character.x,
		y: start.character.y,
		vx: 0,
		vy: 0,
		tags: [...(look.tags ?? [])],
		edges: look.edges ?? 'clamp',
	};
	let walls: SimBody[] = setup.walls.map(wallBody);
	const shots: (SimBody & { age: number })[] = [];
	const looks: Record<string, unknown> = {};
	let shotCount = 0;
	let hits = 0;
	let input: SandboxInput = { held: [] };

	const paths: Record<string, { points: Point[] }> = {};
	if (setup.path && setup.path.length >= 2) {
		const spec = { points: [...setup.path] };
		paths[SANDBOX_PATH] = spec;
		for (const state of character.brain?.states ?? []) {
			const named = state.params?.path;
			if (typeof named === 'string' && named) paths[named] = spec;
		}
	}

	const all = (): SimBody[] => [player, self, ...walls, ...shots];
	const stage = createCharacterStage({
		characters: [character],
		bodies: { [character.component]: look },
		seed: setup.seed,
		io: {
			input: {
				held: (action) => input.held.includes(action),
				pointer: () => input.pointer,
			},
			paths: () => paths,
			variable: (id) => setup.variables?.[id],
			setInstanceInput: (_id, name, value) => {
				looks[name] = value;
			},
			spawn: (layer, componentId, x, y) => {
				shotCount += 1;
				const shot = {
					id: `shot${shotCount}`,
					componentId,
					label: `${layer}:${componentId}`,
					shape: 'circle' as const,
					r: SHOT_RADIUS,
					x,
					y,
					vx: 0,
					vy: 0,
					tags: ['shot'],
					edges: 'pass' as const,
					age: 0,
				};
				shots.push(shot);
				return shot.id;
			},
		},
		raise: () => {},
		handle: (body) => ({
			id: body.id,
			layer: 'sandbox',
			componentId: body.componentId,
			x: body.x,
			y: body.y,
		}),
		bodyOf: (id) => all().find((b) => b.id === id),
	});
	stage.attach(self);
	if (setup.drive === 'brain') stage.setControl([self], 'brain');

	const driver = (): SandboxSnapshot['driver'] => {
		if (character.controller && !(setup.drive === 'brain' && character.brain)) return 'controller';
		return character.brain ? 'brain' : 'none';
	};

	function step(next: SandboxInput): void {
		input = next;
		const dt = fixed.dt;
		const playing = driver() === 'controller';
		// The dummy player: the keyboard, unless the keyboard is playing the character.
		const x = playing
			? 0
			: (next.held.includes('right') ? 1 : 0) - (next.held.includes('left') ? 1 : 0);
		const y = playing
			? 0
			: (next.held.includes('down') ? 1 : 0) - (next.held.includes('up') ? 1 : 0);
		const k = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
		player.vx = x * k * PLAYER_SPEED;
		player.vy = y * k * PLAYER_SPEED;
		stage.decide(all(), dt);
		stage.move(all(), dt, field);
		stage.writeLooks();
		for (let i = shots.length - 1; i >= 0; i -= 1) {
			const shot = shots[i];
			shot.age += dt * 1000;
			const out = shot.x < 0 || shot.y < 0 || shot.x > field.w || shot.y > field.h;
			const struck = touching(shot, player);
			if (struck) hits += 1;
			if (out || struck || shot.age >= SHOT_LIFE_MS || walls.some((w) => touching(shot, w))) {
				stage.forget(shot.id);
				shots.splice(i, 1);
			}
		}
	}

	return {
		fixed,
		step,
		advance(frameMs, next) {
			return fixed.advance(frameMs, () => step(next));
		},
		snapshot() {
			const animInputs: Record<string, unknown> = {};
			for (const name of Object.keys(character.animInputs ?? {})) {
				if (name in looks) animInputs[name] = looks[name];
			}
			const state = stage.stateOf(self.id);
			return {
				steps: fixed.steps,
				player: { ...player },
				character: { ...self },
				shots: shots.map((s) => ({ id: s.id, x: s.x, y: s.y, r: SHOT_RADIUS })),
				...(state !== undefined ? { state } : {}),
				speed: Math.hypot(self.vx, self.vy),
				animInputs,
				hits,
				driver: driver(),
			};
		},
		place(which, at) {
			const body = which === 'player' ? player : self;
			body.x = at.x;
			body.y = at.y;
			body.vx = 0;
			body.vy = 0;
		},
		setWall(wall) {
			walls = walls.map((w) => (w.id === wall.id ? wallBody(wall) : w));
		},
	};
}

/** The wall under a field point, topmost first. */
export function wallAt(walls: readonly SandboxWall[], at: Point): SandboxWall | undefined {
	return [...walls]
		.reverse()
		.find((w) => Math.abs(at.x - w.x) <= w.w / 2 && Math.abs(at.y - w.y) <= w.h / 2);
}

/** Run one fixed step per input (a recorded run), returning each snapshot. */
export function replay(setup: SandboxSetup, inputs: readonly SandboxInput[]): SandboxSnapshot[] {
	const sandbox = createSandbox(setup);
	return inputs.map((input) => {
		sandbox.step(input);
		return sandbox.snapshot();
	});
}

/** Parse the sandbox's variables field: `name = value`, one per line or comma; each value read as a
 *  `variable` condition's value is (`true`, `false`, a number, else text). */
export function parseVariables(text: string): Record<string, number | boolean | string> {
	const out: Record<string, number | boolean | string> = {};
	for (const part of text.split(/[\n,]/)) {
		const at = part.indexOf('=');
		const name = at < 0 ? '' : part.slice(0, at).trim();
		if (name) out[name] = parseVariableValue(part.slice(at + 1));
	}
	return out;
}
