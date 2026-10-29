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
 * `at(id)` is a player as drawn (where, which character), if it is. With the device's `predictor`
 * ({@link createAbilityPredictor}), the own player's `ability` that answers a press it already
 * raised on that button is left out; one it did not predict (the device thought it held or on cooldown) is raised
 * now, `predicted: false`. A round's start, or the own player joining, clears its cooldowns, as the
 * room clears them.
 */
export function flowSignalsOf(events, me, at = () => undefined, predictor = undefined) {
	const signals = [];
	for (const event of events) {
		const name = ONLINE_FLOW_EVENTS[event.type];
		if (!name) continue;
		switch (event.type) {
			case 'joined':
				if (event.id === me) predictor?.reset();
			// falls through
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
				predictor?.reset();
				signals.push({ name, payload: { round: event.round } });
				break;
			case 'roundEnd':
				signals.push({
					name,
					payload: { round: event.round, winner: event.winner, won: !!me && event.winner === me },
				});
				break;
			case 'ability':
				if (event.by !== me || !predictor?.echo(event.button))
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
 *
 * It keeps, per button, the inputs (`seq`) whose press it raised and whose room `ability` has not
 * come back ({@link flowSignalsOf} takes the oldest off per echo). The room sends an `ability` just
 * after the state that acknowledges its input, so a press still waiting when a later state comes
 * (one after the state that first acknowledged it) was refused, and is dropped.
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
	/** ability key → { until: the input it is ready again at, seq and button: the press that set
	 *  it }. */
	const ready = new Map();
	/** button → its raised presses, oldest first: { seq, acked: a state acknowledged it }. */
	const pending = new Map();
	let step = 0;
	let lastAck = 0;
	return {
		/** One sent input's buttons; `free` when the round runs and the own player is free; `seq`
		 *  the input's (default: one after the last). */
		step(buttons, free, seq = step + 1) {
			step = seq;
			const used = [];
			if (!free) return used;
			for (const ability of own) {
				if (!(buttons & ability.bit) || step < (ready.get(ability.key)?.until ?? 0)) continue;
				ready.set(ability.key, {
					until: step + ability.cooldown,
					seq: step,
					button: ability.button,
				});
				used.push(ability.button);
				const queue = pending.get(ability.button) ?? [];
				queue.push({ seq: step, acked: false });
				pending.set(ability.button, queue);
			}
			return used;
		},
		/** The room's `ability` on `button` for the own player came: whether it answers a press
		 *  already raised. */
		echo(button) {
			return !!pending.get(button)?.shift();
		},
		/** A state of the room acknowledged the own player's inputs up to `ack`. */
		acked(ack) {
			lastAck = Math.max(lastAck, ack);
			for (const [button, queue] of pending)
				pending.set(
					button,
					queue.filter((press) => {
						if (press.acked) return false;
						press.acked = press.seq <= ack;
						return true;
					}),
				);
		},
		/**
		 * The room cleared the player's cooldowns (a round started, the player joined): those set by
		 * inputs it had taken by then, but not by a press still waiting for its echo — events come in
		 * order, so its echo is after this start and the room took it after the clear. Raised presses
		 * are kept: they wait for their echo or expire.
		 */
		reset() {
			for (const [key, set] of ready) {
				const echoing = pending.get(set.button)?.some((press) => press.seq === set.seq);
				if (set.seq <= lastAck && !echoing) ready.delete(key);
			}
		},
	};
}
