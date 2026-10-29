import {
	brainVelocity,
	controllerVelocity,
	createBrain,
	createBrainWorld,
	createJumpState,
	createRng,
	JUMP_ACTION,
	jumpProfile,
	samplePath,
	setBrainState,
	steer,
	step,
	stepBrain,
	stepFlap,
	stepHop,
	stepJump,
	stepPlatform,
	stepSolid,
	type Body,
	type Brain,
	type BrainSpawn,
	type ControllerInput,
	type Field,
	type JumpState,
	type Movement,
	type PathSpec,
	type SampledPath,
	type TileGrid,
} from 'engine-mechanics';
import type { SpawnedInstance } from 'engine-flow-v2';
import type { ArcadeBody, ArcadeCharacter } from 'game-config';

/**
 * THE CHARACTERS STAGE of the arcade loop (`docs/design/game-families.md` §4.3, P10.11). Built only
 * when the config has characters: without one, the loop never makes it and steps exactly as P10.8.
 *
 * A body is a character when its component is some character's look. Each step, before anything
 * moves, {@link CharacterStage.decide} gives every character the velocity it wants — from its
 * controller (the player's input) or its brain (`engine-mechanics` `behaviours.js`) — through its
 * movement settings (`steer`). {@link CharacterStage.move} then steps every other body exactly as
 * P10.8 does and each character with the solid response (`stepSolid`), against the bodies whose
 * config body is `solid`. After the frame, {@link CharacterStage.writeLooks} hands each character's
 * `animInputs` to its look, only the values that changed.
 *
 * Who drives: a character with a controller is played, unless Flow handed it to its brain
 * (`setCharacterControl`, a bot); one with only a brain runs it; one with neither moves only as
 * Flow's `setVelocity` says. Every brain draws from its own seeded stream, so a seed replays.
 *
 * GRAVITY, JUMPS AND LEVELS (§4.4, P10.13). A character with `movement.gravity`, a `gravity` jump
 * or a `flap` controller falls: only its `vx` is steered, its `vy` belongs to the pull, the jump
 * (`jumps.js` `stepJump`: height and time, hold, coyote time, buffer) or the flap. A `topDown`
 * character with a `hop` leaves the ground plane on a height arc; while it is up it passes over
 * `ground` bodies. Such characters, and every character once the level has tiles, move with
 * `stepPlatform` (one-way platforms, tiles, sub-steps); the rest keep P10.11's `stepSolid`, so a
 * level with neither replays as before. A jump reads the `jump` action (a `sideScroll` and a flap
 * also `up`), or a pointer pressed above the body (a flap: any press).
 */

/** What the game gives the stage. Every member is optional: a gate gives what it tests. */
export interface ArcadeCharacterIo {
	/** The player's controls: held input-map actions and a pressed pointer, in field px. */
	input?: ControllerInput;
	/** The layout's paths by id, in field px (a brain's `patrol` / `followPath` names one). */
	paths?(): Readonly<Record<string, PathSpec>>;
	/** A Flow variable, for a brain's `variable` condition. */
	variable?(id: string): unknown;
	/** Set an input on a spawned instance's look (called after the frame, only on change). */
	setInstanceInput?(instanceId: string, input: string, value: unknown): void;
	/** Spawn `componentId` into `layer` at (x, y) for a `shootAt`; the new instance's id, if spawned. */
	spawn?(layer: string, componentId: string, x: number, y: number): string | undefined;
	/** The level's tiles in field px (the play field's `tilemap` nodes, P10.13). */
	tiles?(): readonly TileGrid[];
}

/** Who drives a character: its controller (the player) or its brain. */
export type CharacterControl = 'controller' | 'brain';

export const CHARACTER_CONTROLS: readonly CharacterControl[] = ['controller', 'brain'];

/** The signal raised on each brain transition. */
export const CHARACTER_STATE_SIGNAL = 'characterState';

/** A character's look reads `moving` as true above this speed, px/s. */
export const MOVING_ABOVE = 1;

type StageBody = Body & { componentId: string };

interface Actor {
	character: ArcadeCharacter;
	brain?: Brain;
	/** Flow's choice; absent ⇒ the controller when there is one. */
	control?: CharacterControl;
	/** The last solid step stopped it. */
	hit: boolean;
	/** The sign of the last non-zero vx; starts facing right. */
	facing: 1 | -1;
	/** What its look was last given, by input. */
	written: Map<string, unknown>;
	/** How it moves: P10.11's solid step, the platform step, or a hop on the plane. */
	physics: 'solid' | 'platform' | 'hop';
	/** The jump, flap or hop clocks (P10.13). */
	jump: JumpState;
	/** The pull the next move falls by, px/s². */
	gravity: number;
	/** What the last move said. */
	grounded: boolean;
	onWall: boolean;
}

export interface CharacterStage {
	/** A body joined the loop: a character gets its brain, a solid is marked solid. */
	attach(body: StageBody): void;
	forget(id: string): void;
	/** Controllers and brains → steer, for every character in `list` (before the step). */
	decide(list: readonly StageBody[], dt: number): void;
	/** Step every body: the rest as P10.8, the characters with solids — those of `solidFrom` (default
	 *  `list`: P11.5 passes the held characters too). Returns the characters moved. */
	move(list: StageBody[], dt: number, area: Field, solidFrom?: readonly StageBody[]): string[];
	/** Hand the looks their `animInputs` (after the frame). */
	writeLooks(): void;
	/** Flow's `character.setState`: aimed bodies enter `state`. */
	setState(targets: readonly StageBody[], state: string): void;
	/** Flow's `setCharacterControl`. */
	setControl(targets: readonly StageBody[], control: CharacterControl): void;
	/** The brain state a character is in, for the probe and the gates. */
	stateOf(id: string): string | undefined;
	/** Who drives a character now: its controller, its brain, or nobody (P11.5's abilities). */
	driverOf(id: string): CharacterControl | undefined;
	/** Where a character stands: grounded and its hop height, for the probe and the gates. */
	contactOf(id: string): { grounded: boolean; onWall: boolean; z: number } | undefined;
	/** Whether one of a touching pair passes over the other: a hop in the air over a `ground` body. */
	passesOver(a: StageBody, b: StageBody): boolean;
	/** The hop height of every hopping character, by id (drawn as a lift and a shadow). */
	lifts(): ReadonlyMap<string, number>;
	clear(): void;
}

/** A character falls when it has a pull of its own, a `gravity` jump or a flap. */
export const fallsUnderGravity = (character: ArcadeCharacter): boolean => {
	const { controller, movement } = character;
	if ((movement?.gravity ?? 0) > 0 || controller?.kind === 'flap') return true;
	return controller?.kind === 'sideScroll' && controller.jump?.kind === 'gravity';
};

/** A character hops when its controller is `topDown` with a `hop`. */
export const hopsOnThePlane = (character: ArcadeCharacter): boolean =>
	character.controller?.kind === 'topDown' && character.controller.jump?.kind === 'hop';

const across = (movement: Movement | undefined, control: number): Movement => ({
	...(movement?.maxSpeed !== undefined ? { maxSpeed: movement.maxSpeed } : {}),
	...(movement?.accel !== undefined ? { accel: movement.accel * control } : {}),
	...(movement?.decel !== undefined ? { decel: movement.decel * control } : {}),
});

/** Steer `vx` only (a falling character's `vy` is the pull's). `control` below 1 in the air: the
 *  rates scale by it, or with no rates the gap closes by that share a step. */
function steerAcross(
	body: Body,
	vx: number,
	movement: Movement | undefined,
	dt: number,
	control: number,
) {
	const vy = body.vy;
	if (control < 1 && movement?.accel === undefined) body.vx += (vx - body.vx) * control;
	else {
		body.vy = 0;
		steer(body, { vx, vy: 0 }, across(movement, control), dt);
	}
	body.vy = vy;
}

/** Steer both axes, the rates scaled by `control` in the air (a hop). */
function steerAir(
	body: Body,
	want: { vx: number; vy: number },
	movement: Movement | undefined,
	dt: number,
	control: number,
) {
	if (control >= 1) steer(body, want, movement, dt);
	else if (movement?.accel === undefined) {
		body.vx += (want.vx - body.vx) * control;
		body.vy += (want.vy - body.vy) * control;
	} else steer(body, want, { ...across(movement, control), turnRate: movement.turnRate }, dt);
}

const NO_INPUT: ControllerInput = { held: () => false, pointer: () => undefined };

const halfHeight = (body: Body): number =>
	body.shape === 'box' ? body.h / 2 : body.shape === 'circle' ? body.r : 0;

/** Whether the player is pressing jump for this character: the action, `up` for a side view or a
 *  flap, or a pointer pressed above a side view's body (any press, for a flap). A top-down hop has
 *  no touch gesture: its touch steering heads for the pointer, above the body included. */
function jumpPressed(character: ArcadeCharacter, input: ControllerInput, body: Body): boolean {
	const kind = character.controller?.kind;
	if (input.held(JUMP_ACTION)) return true;
	if ((kind === 'sideScroll' || kind === 'flap') && input.held('up')) return true;
	const pointer = input.pointer();
	if (!pointer) return false;
	if (kind === 'flap') return true;
	return kind === 'sideScroll' && pointer.y < body.y - halfHeight(body);
}

/** The pull a falling character falls by when no jump is rising: its own, else its `gravity`
 *  jump's (so a jumper handed to its brain, or to nobody, still comes down). */
const fallPull = (character: ArcadeCharacter): number => {
	const own = character.movement?.gravity;
	if (own !== undefined && own > 0) return own;
	const { controller } = character;
	const jump = controller && 'jump' in controller ? controller.jump : undefined;
	return jump?.kind === 'gravity' ? jumpProfile(jump).gravity : 0;
};

export function createCharacterStage(options: {
	characters: readonly ArcadeCharacter[];
	bodies: Readonly<Record<string, ArcadeBody>>;
	seed: string | number;
	io: ArcadeCharacterIo;
	/** Queue a signal for after the frame. */
	raise(name: string, payload: Record<string, unknown>): void;
	/** A handle at the body's place now. */
	handle(body: StageBody): SpawnedInstance;
	/** The loop's body for an id, if it has one yet. */
	bodyOf(id: string): StageBody | undefined;
}): CharacterStage {
	const { io } = options;
	const byLook = new Map<string, ArcadeCharacter>();
	for (const character of options.characters)
		if (!byLook.has(character.component)) byLook.set(character.component, character);
	const actors = new Map<string, Actor>();
	const isGround = (body: Body) => options.bodies[(body as StageBody).componentId]?.ground === true;
	/** A shot's velocity, for a spawn whose body the loop has not made yet. */
	const shotVelocity = new Map<string, { vx: number; vy: number }>();

	let pathSource: Readonly<Record<string, PathSpec>> | undefined;
	let sampled: Record<string, SampledPath> = {};
	const sampledPaths = (): Record<string, SampledPath> => {
		const source = io.paths?.();
		if (source === pathSource) return sampled;
		pathSource = source;
		sampled = {};
		for (const [id, spec] of Object.entries(source ?? {}))
			if (spec.points.length) sampled[id] = samplePath(spec);
		return sampled;
	};

	const driver = (actor: Actor): CharacterControl | undefined => {
		const { controller } = actor.character;
		if (controller && !(actor.control === 'brain' && actor.brain)) return 'controller';
		return actor.brain ? 'brain' : undefined;
	};

	const shoot = (spawn: BrainSpawn) => {
		const id = io.spawn?.(spawn.layer, spawn.component, spawn.x, spawn.y);
		if (!id) return;
		const body = options.bodyOf(id);
		if (body) {
			body.vx = spawn.vx;
			body.vy = spawn.vy;
		} else shotVelocity.set(id, { vx: spawn.vx, vy: spawn.vy });
	};

	const looks = (actor: Actor, body: StageBody): [string, unknown][] =>
		Object.entries(actor.character.animInputs ?? {}).map(([input, source]) => {
			const speed = Math.hypot(body.vx, body.vy);
			if (source === 'speed') return [input, speed];
			if (source === 'vx') return [input, body.vx];
			if (source === 'vy') return [input, body.vy];
			if (source === 'facing') return [input, actor.facing];
			if (source === 'moving') return [input, speed > MOVING_ABOVE];
			if (source === 'grounded') return [input, actor.grounded];
			if (source === 'onWall') return [input, actor.onWall];
			if (source === 'airborne')
				return [input, actor.physics === 'hop' ? actor.jump.z > 0 : !actor.grounded];
			if (source === 'height') return [input, actor.jump.z];
			return [input, actor.brain?.state === source.slice('state:'.length)];
		});

	return {
		attach(body) {
			const spec = options.bodies[body.componentId];
			if (spec?.solid) body.solid = true;
			else if (spec?.oneWay) (body as StageBody & { oneWay?: boolean }).oneWay = true;
			const shot = shotVelocity.get(body.id);
			if (shot) {
				body.vx = shot.vx;
				body.vy = shot.vy;
				shotVelocity.delete(body.id);
			}
			const character = byLook.get(body.componentId);
			if (!character || actors.has(body.id)) return;
			actors.set(body.id, {
				character,
				...(character.brain
					? {
							brain: createBrain(character.brain, {
								rng: createRng(`${options.seed}:character:${body.id}`),
								at: { x: body.x, y: body.y },
							}),
						}
					: {}),
				hit: false,
				facing: 1,
				written: new Map(),
				physics: hopsOnThePlane(character)
					? 'hop'
					: fallsUnderGravity(character)
						? 'platform'
						: 'solid',
				jump: createJumpState(),
				gravity: fallPull(character),
				// A character that never falls stands on the plane throughout.
				grounded: !fallsUnderGravity(character) && !hopsOnThePlane(character),
				onWall: false,
			});
		},
		forget(id) {
			actors.delete(id);
			shotVelocity.delete(id);
		},
		decide(list, dt) {
			const paths = sampledPaths();
			for (const body of list) {
				const actor = actors.get(body.id);
				if (!actor) continue;
				const { character } = actor;
				const drive = driver(actor);
				const controller = drive === 'controller' ? character.controller : undefined;
				const jump = controller && 'jump' in controller ? controller.jump : undefined;
				const airborne = actor.physics === 'hop' ? actor.jump.z > 0 : !actor.grounded;
				const control = airborne ? (jump?.airControl ?? 1) : 1;
				if (controller) {
					const input = io.input ?? NO_INPUT;
					const want = controllerVelocity(controller, input, body, character.movement, dt);
					const pressed = jumpPressed(character, input, body);
					if (actor.physics === 'platform') {
						steerAcross(body, want.vx, character.movement, dt, control);
						actor.gravity = fallPull(character);
						if (controller.kind === 'flap') stepFlap(controller, actor.jump, body, pressed);
						else if (jump?.kind === 'gravity')
							actor.gravity = stepJump(jump, actor.jump, body, {
								pressed,
								grounded: actor.grounded,
								dt,
								fallGravity: character.movement?.gravity,
							}).gravity;
					} else if (actor.physics === 'hop' && jump) {
						steerAir(body, want, character.movement, dt, control);
						stepHop(jump, actor.jump, { pressed, dt });
					} else steer(body, want, character.movement, dt);
				} else if (drive === 'brain' && actor.brain) {
					const world = createBrainWorld({
						self: body,
						bodies: list,
						hitSolid: actor.hit,
						paths,
						variable: (id) => io.variable?.(id),
					});
					const change = stepBrain(actor.brain, world, dt);
					if (change)
						options.raise(CHARACTER_STATE_SIGNAL, {
							instance: options.handle(body),
							character: character.id,
							from: change.from,
							to: change.to,
						});
					const want = brainVelocity(actor.brain, body, world, dt);
					if (actor.physics === 'platform') {
						steerAcross(body, want.vx, character.movement, dt, 1);
						actor.gravity = fallPull(character);
					} else steer(body, want, character.movement, dt);
					if (want.spawn) shoot(want.spawn);
				} else if (actor.physics === 'platform') actor.gravity = fallPull(character);
				if (actor.physics === 'platform' && !controller) actor.jump.rising = false;
				// A hop handed to its brain, or to nobody, comes back down.
				if (actor.physics === 'hop' && !controller) {
					const hop =
						character.controller?.kind === 'topDown' ? character.controller.jump : undefined;
					if (hop) stepHop(hop, actor.jump, { pressed: false, dt });
				}
			}
		},
		move(list, dt, area, solidFrom = list) {
			step(
				list.filter((body) => !actors.has(body.id)),
				dt,
				area,
			);
			const solids = solidFrom.filter(
				(body) => body.solid === true || (body as { oneWay?: boolean }).oneWay === true,
			);
			const tiles = io.tiles?.() ?? [];
			const moved: string[] = [];
			for (const body of list) {
				const actor = actors.get(body.id);
				if (!actor) continue;
				const { x, y } = body;
				let hit: { hitX: boolean; hitY: boolean };
				if (actor.physics === 'solid' && !tiles.length) {
					hit = stepSolid(
						body,
						dt,
						solids.filter((s) => s.solid === true),
						area,
					);
					actor.onWall = hit.hitX;
				} else {
					const up = actor.physics === 'hop' && actor.jump.z > 0;
					const falls = actor.physics === 'platform';
					const contact = stepPlatform(body, dt, {
						solids: up ? solids.filter((s) => !isGround(s)) : solids,
						tiles,
						field: area,
						gravity: actor.physics === 'platform' ? actor.gravity : 0,
						maxFall: actor.character.movement?.maxFall,
					});
					actor.grounded = falls ? contact.grounded : actor.physics !== 'hop' || actor.jump.z <= 0;
					actor.onWall = contact.onWall;
					hit = contact;
				}
				actor.hit = hit.hitX || hit.hitY;
				if (body.vx > 0) actor.facing = 1;
				else if (body.vx < 0) actor.facing = -1;
				if (body.x !== x || body.y !== y) moved.push(body.id);
			}
			return moved;
		},
		writeLooks() {
			const set = io.setInstanceInput;
			if (!set) return;
			for (const [id, actor] of actors) {
				if (!actor.character.animInputs) continue;
				const body = options.bodyOf(id);
				if (!body) continue;
				for (const [input, value] of looks(actor, body)) {
					if (actor.written.has(input) && actor.written.get(input) === value) continue;
					actor.written.set(input, value);
					set(id, input, value);
				}
			}
		},
		setState(targets, state) {
			for (const body of targets) {
				const brain = actors.get(body.id)?.brain;
				if (brain) setBrainState(brain, state);
			}
		},
		setControl(targets, control) {
			for (const body of targets) {
				const actor = actors.get(body.id);
				if (actor) actor.control = control;
			}
		},
		stateOf: (id) => actors.get(id)?.brain?.state,
		driverOf(id) {
			const actor = actors.get(id);
			return actor ? driver(actor) : undefined;
		},
		contactOf(id) {
			const actor = actors.get(id);
			if (!actor || actor.physics === 'solid') return undefined;
			return { grounded: actor.grounded, onWall: actor.onWall, z: actor.jump.z };
		},
		passesOver(a, b) {
			const up = (body: StageBody) => {
				const actor = actors.get(body.id);
				return actor?.physics === 'hop' && actor.jump.z > 0;
			};
			return (up(a) && isGround(b)) || (up(b) && isGround(a));
		},
		lifts() {
			const out = new Map<string, number>();
			for (const [id, actor] of actors) if (actor.physics === 'hop') out.set(id, actor.jump.z);
			return out;
		},
		clear() {
			actors.clear();
			shotVelocity.clear();
		},
	};
}
