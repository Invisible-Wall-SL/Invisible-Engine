import {
	abilitySpecs,
	abilityTargets,
	endStatuses,
	GRACE_MS,
	STATUS,
	stepsOf,
	useAbilities,
	type AbilityActor,
	type AbilitySpec,
	type Body,
	type ControllerInput,
} from 'engine-mechanics';
import type { SpawnedInstance } from 'engine-flow-v2';
import type { ArcadeCharacter, ResolvedArcadeAbility } from 'game-config';

import type { CharacterControl } from './arcadeCharacters';

/**
 * THE ABILITIES STAGE of the arcade loop (`docs/design/game-families.md` §4.3, P11.5). Built only
 * when the config has abilities (`arcade.abilities`): without one the loop never makes it and steps
 * as before.
 *
 * It runs `engine-mechanics` `abilities.js`, the code an online room runs (`onlineRules.js`), on
 * the loop's characters, once a step after they moved, in spawn order: a character uses an ability
 * while its button is held (the Flow input map's `ability1` / `ability2`, when the player drives
 * it), whenever a target is in reach (when its brain does), or when Flow asks (`useAbility`). A hit
 * `stun` holds its target still and a `catch` puts it out (still, hidden, touching nothing) for the
 * ability's `ms`; a caught character is then put back where it spawned. Neither can be hit again for
 * a second. A `hook` has no line offline: it raises `hit` (effect `hook`) on the nearest target.
 * Scores are Flow's: `hit` / `caught` carry the ability's `points`.
 *
 * The signals are an online room's own names (`ability`, `hit`, `caught`), with the instances added,
 * so one graph presents both.
 */

/** The signals the stage raises (`ARCADE_VOCAB`'s, shared with an online room). */
export const ABILITY_SIGNALS = { ability: 'ability', hit: 'hit', caught: 'caught' } as const;

/** The ability buttons, as input-map actions and Flow's `useAbility` names them. */
export const ABILITY_BUTTONS = ['ability1', 'ability2'] as const;

export type AbilityButton = (typeof ABILITY_BUTTONS)[number];

type StageBody = Body & { componentId: string };

type Actor = AbilityActor & { body: StageBody; home: { x: number; y: number } };

type Spec = AbilitySpec<ResolvedArcadeAbility>;

export interface AbilityStage {
	/** A character joined the loop. */
	attach(body: StageBody, character: ArcadeCharacter): void;
	forget(id: string): void;
	/** Whether a character is held (stunned or out): it neither decides nor moves. */
	held(id: string): boolean;
	/** Whether a character is out: hidden, touching nothing. */
	isOut(id: string): boolean;
	/** The bodies that are out. */
	out(): ReadonlySet<string>;
	/** After the move of step `stamp`: use the abilities, then end the statuses due. Returns the
	 *  bodies it put back. */
	step(stamp: number): string[];
	/** Flow's `useAbility`: the aimed characters use `button` on the next step. */
	use(targets: readonly StageBody[], button: AbilityButton): void;
	clear(): void;
}

export function createAbilityStage(options: {
	abilities: readonly ResolvedArcadeAbility[];
	fixedHz: number;
	input?: ControllerInput;
	/** Who drives a character now. */
	driverOf(id: string): CharacterControl | undefined;
	raise(name: string, payload: Record<string, unknown>): void;
	handle(body: StageBody): SpawnedInstance;
}): AbilityStage {
	const specs: Spec[] = abilitySpecs(options.abilities, options.fixedHz);
	const grace = stepsOf(GRACE_MS, options.fixedHz);
	const actors = new Map<string, Actor>();
	const asked = new Map<string, Set<AbilityButton>>();
	const outs = new Set<string>();
	const reach = { present: () => true, placeOf: (target: Actor) => target.body };
	const held = (actor: Actor | undefined) =>
		!!actor && (actor.status === STATUS.stunned || actor.status === STATUS.out);

	return {
		attach(body, character) {
			if (actors.has(body.id)) return;
			actors.set(body.id, {
				id: body.id,
				character: { id: character.id },
				body,
				status: STATUS.free,
				until: 0,
				safeUntil: 0,
				cooldowns: {},
				home: { x: body.x, y: body.y },
			});
		},
		forget(id) {
			actors.delete(id);
			asked.delete(id);
			outs.delete(id);
		},
		held: (id) => held(actors.get(id)),
		isOut: (id) => outs.has(id),
		out: () => outs,
		step(stamp) {
			const list = [...actors.values()];
			for (const user of list) {
				if (user.status !== STATUS.free) continue;
				const drive = options.driverOf(user.id);
				const flow = asked.get(user.id);
				useAbilities(user, stamp, specs, {
					...reach,
					pressed: (ability) =>
						!!flow?.has(ability.button as AbilityButton) ||
						(drive === 'controller' && !!options.input?.held(ability.button)) ||
						(drive === 'brain' && abilityTargets(user, ability, list, stamp, reach).length > 0),
					used: (ability) =>
						options.raise(ABILITY_SIGNALS.ability, {
							instance: options.handle(user.body),
							player: user.id,
							character: user.character.id,
							button: ability.button,
							x: user.body.x,
							y: user.body.y,
							mine: drive === 'controller',
							predicted: false,
						}),
					players: () => list,
					hit: (target, ability) => {
						if (target.status === STATUS.out) outs.add(target.id);
						raiseHit(ability.effect === 'catch' ? 'caught' : 'hit', user, target, ability);
					},
					hook: (target, ability) => raiseHit('hit', user, target, ability),
				});
			}
			asked.clear();
			const back: string[] = [];
			endStatuses(list, stamp, grace, (actor) => {
				actor.body.x = actor.home.x;
				actor.body.y = actor.home.y;
				actor.body.vx = 0;
				actor.body.vy = 0;
				outs.delete(actor.id);
				back.push(actor.id);
			});
			return back;
		},
		use(targets, button) {
			for (const body of targets) {
				if (!actors.has(body.id)) continue;
				const set = asked.get(body.id) ?? new Set();
				set.add(button);
				asked.set(body.id, set);
			}
		},
		clear() {
			actors.clear();
			asked.clear();
			outs.clear();
		},
	};

	function raiseHit(name: 'hit' | 'caught', user: Actor, target: Actor, ability: Spec) {
		options.raise(ABILITY_SIGNALS[name], {
			by: user.id,
			target: target.id,
			effect: ability.effect,
			mine: options.driverOf(user.id) === 'controller',
			me: options.driverOf(target.id) === 'controller',
			byInstance: options.handle(user.body),
			targetInstance: options.handle(target.body),
			points: ability.score,
		});
	}
}
