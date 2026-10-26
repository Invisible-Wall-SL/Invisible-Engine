import {
	brainVelocity,
	controllerVelocity,
	createBrain,
	createBrainWorld,
	createRng,
	samplePath,
	setBrainState,
	steer,
	step,
	stepBrain,
	stepSolid,
	type Body,
	type Brain,
	type BrainSpawn,
	type ControllerInput,
	type Field,
	type PathSpec,
	type SampledPath,
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
}

export interface CharacterStage {
	/** A body joined the loop: a character gets its brain, a solid is marked solid. */
	attach(body: StageBody): void;
	forget(id: string): void;
	/** Controllers and brains → steer, for every character in `list` (before the step). */
	decide(list: readonly StageBody[], dt: number): void;
	/** Step every body: the rest as P10.8, the characters with solids. Returns the characters moved. */
	move(list: StageBody[], dt: number, area: Field): string[];
	/** Hand the looks their `animInputs` (after the frame). */
	writeLooks(): void;
	/** Flow's `character.setState`: aimed bodies enter `state`. */
	setState(targets: readonly StageBody[], state: string): void;
	/** Flow's `setCharacterControl`. */
	setControl(targets: readonly StageBody[], control: CharacterControl): void;
	/** The brain state a character is in, for the probe and the gates. */
	stateOf(id: string): string | undefined;
	clear(): void;
}

const NO_INPUT: ControllerInput = { held: () => false, pointer: () => undefined };

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
			return [input, actor.brain?.state === source.slice('state:'.length)];
		});

	return {
		attach(body) {
			if (options.bodies[body.componentId]?.solid) body.solid = true;
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
				if (drive === 'controller' && character.controller) {
					const want = controllerVelocity(
						character.controller,
						io.input ?? NO_INPUT,
						body,
						character.movement,
						dt,
					);
					steer(body, want, character.movement, dt);
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
					steer(body, want, character.movement, dt);
					if (want.spawn) shoot(want.spawn);
				}
			}
		},
		move(list, dt, area) {
			step(
				list.filter((body) => !actors.has(body.id)),
				dt,
				area,
			);
			const solids = list.filter((body) => body.solid === true);
			const moved: string[] = [];
			for (const body of list) {
				const actor = actors.get(body.id);
				if (!actor) continue;
				const { x, y } = body;
				const hit = stepSolid(body, dt, solids, area);
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
		clear() {
			actors.clear();
			shotVelocity.clear();
		},
	};
}
