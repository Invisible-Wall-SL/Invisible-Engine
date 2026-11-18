/**
 * What a Crash room gives a 3D device's Flow (`docs/design/3d/gameplay-evaluation.md` §4): the
 * room's events as Flow signals, and its round, scores and the own player's state as the values of
 * the variables the room owns. `onlineFlow.js` `flowSignalsOf` / `serverValuesOf` for the 3D room:
 * the events a 2D room also raises keep their names and payloads (`playerJoined`, `playerLeft`,
 * `hit`, `roundStart`, `roundEnd`), and a server variable mirrors the same names
 * (`SERVER_VALUE_KINDS`: `score` is the own TEAM's, `winner` a team, `won` the own team's win). The
 * Crash ones are `pieceScored`, `kill`, `respawn`, `pitRise`, `picked`, `thrown`, `attack`.
 *
 * Presentation only. Not in `index.ts`: only the `arcade3d` runtime imports it, so no 2D bundle
 * changes. `scripts/check-crash-rules.mjs` runs it on the room's own events.
 */

import { STATUS3D } from './online3d.js';

/** Team index → name (`crashRules.js` `TEAMS`). */
const TEAMS = ['red', 'blue'];

/** A Crash room event's type → the Flow event it raises. */
export const CRASH_FLOW_EVENTS = Object.freeze({
	joined: 'playerJoined',
	left: 'playerLeft',
	hit: 'hit',
	roundStart: 'roundStart',
	roundEnd: 'roundEnd',
	pieceScored: 'pieceScored',
	kill: 'kill',
	respawn: 'respawn',
	pitRise: 'pitRise',
	picked: 'picked',
	thrown: 'thrown',
	attack: 'attack',
});

/**
 * The Flow signals a batch of Crash room events raises, in order, for the device whose player is
 * `me` on team `team` (0 red, 1 blue; -1 before it is known).
 */
export function crashFlowSignalsOf(events, me, team = -1) {
	const mine = TEAMS[team] ?? '';
	const signals = [];
	for (const event of events) {
		const name = CRASH_FLOW_EVENTS[event.type];
		if (!name) continue;
		switch (event.type) {
			case 'joined':
			case 'left':
			case 'respawn':
				signals.push({ name, payload: { player: event.id, me: event.id === me } });
				break;
			case 'picked':
			case 'thrown':
				signals.push({
					name,
					payload: { player: event.id, entity: event.entity, me: event.id === me },
				});
				break;
			case 'attack':
				signals.push({
					name,
					payload: { player: event.id, weapon: event.weapon, me: event.id === me },
				});
				break;
			case 'hit':
				signals.push({
					name,
					payload: {
						by: event.by,
						target: event.target,
						effect: 'damage',
						damage: event.damage,
						hp: event.hp,
						mine: event.by === me,
						me: event.target === me,
					},
				});
				break;
			case 'kill':
				signals.push({
					name,
					payload: {
						by: event.by,
						target: event.target,
						cause: event.cause,
						mine: !!me && event.by === me,
						me: event.target === me,
					},
				});
				break;
			case 'pieceScored':
				signals.push({
					name,
					payload: {
						player: event.by,
						team: event.team,
						kind: event.kind,
						points: event.points,
						red: event.red,
						blue: event.blue,
						me: !!me && event.by === me,
						ours: !!mine && event.team === mine,
					},
				});
				break;
			case 'pitRise':
				signals.push({ name, payload: { level: event.level } });
				break;
			case 'roundStart':
				signals.push({ name, payload: { round: event.round } });
				break;
			case 'roundEnd':
				signals.push({
					name,
					payload: {
						round: event.round,
						winner: event.winner,
						won: !!mine && event.winner === mine,
						red: event.red,
						blue: event.blue,
					},
				});
				break;
		}
	}
	return signals;
}

/**
 * The room values (`SERVER_VALUE_KINDS`' names) from a Crash room's synced state, for the device
 * whose player is `me`: `score` its team's, `status` `free` or `dead`, `winner` the winning team,
 * `won` whether it is the own team.
 */
export function crashServerValuesOf(state, me, tickHz) {
	const own = state.players?.get(me);
	const team = own?.team ?? -1;
	const step = state.step ?? 0;
	const endsAt = state.endsAt ?? 0;
	const winner = state.winner ?? '';
	return {
		score: team >= 0 ? (state.scores?.[team] ?? 0) : 0,
		status: own?.status === STATUS3D.dead ? 'dead' : 'free',
		round: state.round ?? 0,
		phase: state.phase ?? 'waiting',
		secondsLeft: endsAt > 0 ? Math.max(0, Math.ceil((endsAt - step) / tickHz)) : 0,
		winner,
		won: !!winner && winner === TEAMS[team],
	};
}
