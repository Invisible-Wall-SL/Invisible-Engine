/**
 * What an online room gives a device's Flow (`docs/design/realtime-multiplayer.md` §4, §6, §10;
 * P11.2): the room's events as Flow signals, its scores and round as the values of the variables it
 * owns, the own player's abilities raised on the press, and which players are drawn. Presentation
 * only: nothing here decides a hit, a score or a place — the room does (`onlineRules.js`).
 *
 * Plain, dependency-free ESM beside `onlineRules.js`, so `scripts/check-online-rules.mjs` and
 * `scripts/check-netcode.mjs` run exactly what `apps/lines` `game/online.ts` runs.
 */

import { BUTTONS } from './online.js';
import { STATUS } from './onlineRules.js';

/** A room event's type → the Flow event it raises (`engine-flow-v2` `ARCADE_ONLINE_EVENTS`). */
export const ONLINE_FLOW_EVENTS = Object.freeze({
	joined: 'playerJoined',
	left: 'playerLeft',
	hit: 'hit',
	caught: 'caught',
	roundStart: 'roundStart',
	roundEnd: 'roundEnd',
	ability: 'ability',
});

/** The room values a server-owned variable mirrors, and their kinds (`engine-flow-v2`
 *  `SERVER_VARIABLE_SOURCES`; the gate holds the two equal). */
export const SERVER_VALUE_KINDS = Object.freeze({
	score: 'number',
	status: 'string',
	round: 'number',
	phase: 'string',
	secondsLeft: 'number',
	winner: 'string',
	won: 'bool',
});

const STATUS_NAMES = ['free', 'stunned', 'out'];

/** An `ability` signal: `at` is its player as drawn (where, and which character). */
export function abilitySignal(by, button, me, at, predicted) {
	return {
		name: ONLINE_FLOW_EVENTS.ability,
		payload: {
			player: by,
			character: at?.character ?? '',
			button,
			x: at?.x ?? 0,
			y: at?.y ?? 0,
			mine: by === me,
			predicted,
		},
	};
}

/**
 * The Flow signals a batch of room events raises, in order, for the device whose player is `me`.
 * The own player's `ability` is left out: the device raised it on the press
 * ({@link createAbilityPredictor}). `at(id)` is a player as drawn (where, which character), if it is.
 */
export function flowSignalsOf(events, me, at = () => undefined) {
	const signals = [];
	for (const event of events) {
		const name = ONLINE_FLOW_EVENTS[event.type];
		if (!name) continue;
		switch (event.type) {
			case 'joined':
			case 'left':
				signals.push({ name, payload: { player: event.id, me: event.id === me } });
				break;
			case 'hit':
			case 'caught':
				signals.push({
					name,
					payload: {
						by: event.by,
						target: event.target,
						effect: event.effect,
						mine: event.by === me,
						me: event.target === me,
					},
				});
				break;
			case 'roundStart':
				signals.push({ name, payload: { round: event.round } });
				break;
			case 'roundEnd':
				signals.push({
					name,
					payload: { round: event.round, winner: event.winner, won: !!me && event.winner === me },
				});
				break;
			case 'ability':
				if (event.by !== me)
					signals.push(abilitySignal(event.by, event.button, me, at(event.by), false));
				break;
		}
	}
	return signals;
}

/** The room values, from its synced state, for the device whose player is `me`. */
export function serverValuesOf(state, me, tickHz) {
	const own = state.players?.get(me);
	const step = state.step ?? 0;
	const endsAt = state.endsAt ?? 0;
	const winner = state.winner ?? '';
	return {
		score: own?.score ?? 0,
		status: STATUS_NAMES[own?.status ?? STATUS.free] ?? 'free',
		round: state.round ?? 0,
		phase: state.phase ?? 'waiting',
		secondsLeft: endsAt > 0 ? Math.max(0, Math.ceil((endsAt - step) / tickHz)) : 0,
		winner,
		won: !!winner && winner === me,
	};
}

/** Whether a player of the room is drawn: one that is out is hidden until it respawns. */
export const shownInRoom = (player) => player.status !== STATUS.out;

const stepsOf = (ms, tickHz) => Math.max(0, Math.round((ms * tickHz) / 1000));

/**
 * The own player's abilities, raised on the press (§6's predicted events): stepped once per input
 * the device sends, it says which of `character`'s abilities that input uses, by the room's own
 * test — the button held, off its cooldown, in a running round, the player free — so a held button
 * raises one each cooldown, as the room acts. A guess the room may still miss (a cooldown the room
 * counted from another step); it decides nothing.
 */
export function createAbilityPredictor(game, character) {
	const { tickHz } = game.online;
	const own = game.online.rules.abilities
		.map((a, i) => ({
			key: i,
			button: a.button,
			bit: BUTTONS[a.button],
			cooldown: Math.max(1, stepsOf(a.cooldownMs, tickHz)),
			character: a.character,
		}))
		.filter((a) => a.character === character);
	const ready = new Map();
	let step = 0;
	return {
		/** One sent input's buttons; `free` when the round runs and the own player is free. */
		step(buttons, free) {
			step += 1;
			const used = [];
			if (!free) return used;
			for (const ability of own) {
				if (!(buttons & ability.bit) || step < (ready.get(ability.key) ?? 0)) continue;
				ready.set(ability.key, step + ability.cooldown);
				used.push(ability.button);
			}
			return used;
		},
	};
}
