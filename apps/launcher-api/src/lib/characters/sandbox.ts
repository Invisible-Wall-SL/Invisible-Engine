import {
	brainVelocity,
	controllerVelocity,
	createBrain,
	createBrainWorld,
	createFixedStep,
	createRng,
	samplePath,
	steer,
	stepBody,
	stepBrain,
	stepSolid,
	touching,
	type Body,
	type Brain,
	type ControllerInput,
	type Field,
	type FixedStep,
	type Point,
	type SampledPath,
} from 'engine-mechanics';
import type { ArcadeBody, ArcadeCharacter } from 'game-config';

/**
 * The Invisible Characters SANDBOX (`docs/design/game-families.md` §5.1): one character on a
 * placeholder play field with a keyboard-driven dummy player, a few walls and an optional drawn
 * path, run by `engine-mechanics` directly at a fixed step. The order of a step is the arcade
 * loop's characters stage (`engine-game` `arcadeCharacters.ts`): decide (controller or brain →
 * `steer`), then move (characters with `stepSolid` against the solids). The same seed and the same
 * input give the same run. Nothing here is saved; the page draws `snapshot()`.
 */

/** The dummy player's tag, size and speed (px/s, instant). */
export const PLAYER_TAG = 'player';
export const PLAYER_SIZE = 40;
export const PLAYER_SPEED = 220;
/** A character whose look has no body is drawn and moved as this box. */
export const FALLBACK_BODY: ArcadeBody = { shape: 'box', w: 48, h: 48 };
/** Shots are small circles; they vanish on a wall, off the field or after this long. */
export const SHOT_RADIUS = 6;
export const SHOT_LIFE_MS = 4000;
/** The id every brain's `path` param resolves to when the author draws a path here. */
export const SANDBOX_PATH = 'sandbox';
/** A look input reads `moving` as true above this speed (the loop's `MOVING_ABOVE`). */
export const MOVING_ABOVE = 1;

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
	/** Who drives a character with both a controller and a brain. */
	drive?: 'controller' | 'brain';
	/** Values for `variable` conditions. */
	variables?: Readonly<Record<string, unknown>>;
};

/** The keys held this step (`left/right/up/down`) and a pressed pointer. */
export type SandboxInput = { held: readonly string[]; pointer?: Point };

type SimBody = Body & { label: string };

export type SandboxShot = { id: string; x: number; y: number; r: number };

export type SandboxSnapshot = {
	steps: number;
	player: SimBody;
	character: SimBody;
	shots: SandboxShot[];
	/** The brain's state, when it has one. */
	state?: string;
	speed: number;
	facing: 1 | -1;
	/** Each mapped look input's value, as the loop would write it. */
	animInputs: Record<string, number | boolean>;
	/** Shots that touched the player so far. */
	hits: number;
	/** Who moved the character this step. */
	driver: 'controller' | 'brain' | 'none';
};

export type Sandbox = {
	readonly fixed: FixedStep;
	/** One fixed step with this input. */
	step(input: SandboxInput): void;
	/** A frame's time: as many fixed steps as it holds. */
	advance(frameMs: number, input: SandboxInput): number;
	snapshot(): SandboxSnapshot;
	/** Move a body by drag (field px); a wall drag is read from the setup's array by id. */
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

const heldInput = (input: SandboxInput): ControllerInput => ({
	held: (action) => input.held.includes(action),
	pointer: () => input.pointer,
});

/** The character's id in the sim (the loop's instance id stand-in): its brain's rng is seeded
 *  `<seed>:character:<id>`, as the loop seeds it. */
export const SANDBOX_CHARACTER_BODY = 'character';

export function createSandbox(setup: SandboxSetup): Sandbox {
	const { character, field } = setup;
	const look = setup.body ?? FALLBACK_BODY;
	const start = startOf(field);
	const fixed = createFixedStep({ hz: setup.hz ?? 60 });

	const player: SimBody = {
		id: 'player',
		label: 'player',
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
		label: character.name || character.id,
		...shapeOf(look),
		x: start.character.x,
		y: start.character.y,
		vx: 0,
		vy: 0,
		tags: [...(look.tags ?? [])],
		edges: look.edges ?? 'clamp',
	};
	let walls: SimBody[] = setup.walls.map((w) => wallBody(w));
	const shots: (SimBody & { age: number })[] = [];
	let shotCount = 0;
	let hits = 0;
	let hit = false;
	let facing: 1 | -1 = 1;
	let driver: SandboxSnapshot['driver'] = 'none';

	const brain: Brain | undefined = character.brain
		? createBrain(character.brain, {
				rng: createRng(`${setup.seed}:character:${SANDBOX_CHARACTER_BODY}`),
				at: { x: self.x, y: self.y },
			})
		: undefined;

	const paths: Record<string, SampledPath> = {};
	if (setup.path && setup.path.length >= 2) {
		const sampled = samplePath({ points: setup.path });
		paths[SANDBOX_PATH] = sampled;
		for (const state of character.brain?.states ?? []) {
			const named = state.params?.path;
			if (typeof named === 'string' && named) paths[named] = sampled;
		}
	}

	const driveOf = (): SandboxSnapshot['driver'] => {
		if (character.controller && !(setup.drive === 'brain' && brain)) return 'controller';
		return brain ? 'brain' : 'none';
	};

	function step(input: SandboxInput): void {
		const dt = fixed.dt;
		const bodies: SimBody[] = [player, self, ...walls, ...shots];
		driver = driveOf();
		// Decide: the character first, as the loop's stage does before anything moves.
		if (driver === 'controller' && character.controller) {
			const want = controllerVelocity(
				character.controller,
				heldInput(input),
				self,
				character.movement,
				dt,
			);
			steer(self, want, character.movement, dt);
		} else if (driver === 'brain' && brain) {
			const world = createBrainWorld({
				self,
				bodies,
				hitSolid: hit,
				paths,
				variable: (id) => setup.variables?.[id],
			});
			stepBrain(brain, world, dt);
			const want = brainVelocity(brain, self, world, dt);
			steer(self, want, character.movement, dt);
			if (want.spawn) {
				shotCount += 1;
				shots.push({
					id: `shot${shotCount}`,
					label: want.spawn.component,
					shape: 'circle',
					r: SHOT_RADIUS,
					x: want.spawn.x,
					y: want.spawn.y,
					vx: want.spawn.vx,
					vy: want.spawn.vy,
					tags: ['shot'],
					edges: 'pass',
					age: 0,
				});
			}
		}
		// The dummy player: the keyboard, unless the keyboard is driving the character.
		if (driver === 'controller') {
			player.vx = 0;
			player.vy = 0;
		} else {
			const x = (input.held.includes('right') ? 1 : 0) - (input.held.includes('left') ? 1 : 0);
			const y = (input.held.includes('down') ? 1 : 0) - (input.held.includes('up') ? 1 : 0);
			const k = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
			player.vx = x * k * PLAYER_SPEED;
			player.vy = y * k * PLAYER_SPEED;
		}
		// Move.
		const result = stepSolid(self, dt, walls, field);
		hit = result.hitX || result.hitY;
		if (self.vx > 0) facing = 1;
		else if (self.vx < 0) facing = -1;
		stepSolid(player, dt, walls, field);
		for (let i = shots.length - 1; i >= 0; i -= 1) {
			const shot = shots[i];
			stepBody(shot, dt, field);
			shot.age += dt * 1000;
			const out = shot.x < 0 || shot.y < 0 || shot.x > field.w || shot.y > field.h;
			const struck = touching(shot, player);
			if (struck) hits += 1;
			if (out || struck || shot.age >= SHOT_LIFE_MS || walls.some((w) => touching(shot, w))) {
				shots.splice(i, 1);
			}
		}
	}

	function animValue(source: string): number | boolean {
		const speed = Math.hypot(self.vx, self.vy);
		if (source === 'speed') return speed;
		if (source === 'vx') return self.vx;
		if (source === 'vy') return self.vy;
		if (source === 'facing') return facing;
		if (source === 'moving') return speed > MOVING_ABOVE;
		return brain?.state === source.slice('state:'.length);
	}

	return {
		fixed,
		step,
		advance(frameMs, input) {
			return fixed.advance(frameMs, () => step(input));
		},
		snapshot() {
			const animInputs: Record<string, number | boolean> = {};
			for (const [input, source] of Object.entries(character.animInputs ?? {})) {
				animInputs[input] = animValue(source);
			}
			return {
				steps: fixed.steps,
				player: { ...player },
				character: { ...self },
				shots: shots.map((s) => ({ id: s.id, x: s.x, y: s.y, r: SHOT_RADIUS })),
				...(brain ? { state: brain.state } : {}),
				speed: Math.hypot(self.vx, self.vy),
				facing,
				animInputs,
				hits,
				driver,
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

function wallBody(wall: SandboxWall): SimBody {
	return {
		id: wall.id,
		label: wall.id,
		shape: 'box',
		w: wall.w,
		h: wall.h,
		x: wall.x,
		y: wall.y,
		vx: 0,
		vy: 0,
		tags: ['wall'],
		solid: true,
	};
}

/** The wall under a field point, topmost first. */
export function wallAt(walls: readonly SandboxWall[], at: Point): SandboxWall | undefined {
	return [...walls]
		.reverse()
		.find((w) => Math.abs(at.x - w.x) <= w.w / 2 && Math.abs(at.y - w.y) <= w.h / 2);
}

/** Run `steps` fixed steps with one input per step (a recorded run), returning each snapshot. */
export function replay(setup: SandboxSetup, inputs: readonly SandboxInput[]): SandboxSnapshot[] {
	const sandbox = createSandbox(setup);
	return inputs.map((input) => {
		sandbox.step(input);
		return sandbox.snapshot();
	});
}
