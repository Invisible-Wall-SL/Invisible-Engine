/**
 * A mock rebuilt while a player is mid-round must not take that round with it.
 *
 * Every publish of ANY game, every runtime release and every contract change rebuilds a game's mock
 * (`hydrate`, `swapMock`). The rebuilt instance starts each session with no round, so a player inside
 * a free-spin feature had their next pre-fetched `play` refused ("play without bet") and their
 * `collect` refused after it — the client parked inside the feature with the win never credited.
 * Measured on bookofborutremake (2026-10-02): seq 2–8 dealt, a refresh landed, seq 9 refused.
 *
 * The round is not carried INTO the new instance: it was dealt on the old one's board, and a grid or
 * paytable change between the two would settle it on terms it was never dealt on. Instead the new
 * instance HOLDS that session for the old one: every request for it — plays, a resend, the boot
 * `config` that resumes it — is answered by the instance that opened the round, until the round
 * closes. Then the session moves over, balance and all, and the old instance is let go.
 *
 * A player who finished a round across a refresh keeps the balance that round left them rather than
 * the refresh's reset: wiping the win they were just paid reads as the win vanishing.
 */

import { carrySession } from '../../scripts/mock-rgs-server.mjs';

/** mock → Map<sid, { owner, keepBetShape }>: sessions whose open round another instance answers. */
const held = new WeakMap();

const hasOpenRound = (mock, sid) => Boolean(mock?.sessions?.get(sid)?.round);

/**
 * Hand every round still open on `previous` to `next`, including rounds `previous` was itself
 * holding for an older instance. Call once per rebuild, after `next` is created.
 */
export const holdOpenRounds = (previous, next, { keepBetShape }) => {
	if (!previous?.sessions || !next?.sessions) return;
	const holds = new Map();
	for (const [sid, hold] of held.get(previous) ?? []) {
		if (hasOpenRound(hold.owner, sid)) holds.set(sid, { owner: hold.owner, keepBetShape });
	}
	for (const sid of previous.sessions.keys()) {
		if (!holds.has(sid) && hasOpenRound(previous, sid))
			holds.set(sid, { owner: previous, keepBetShape });
	}
	if (holds.size > 0) held.set(next, holds);
};

/**
 * The instance that answers `sid` on `mock`: the one that opened its round while that round is open,
 * otherwise `mock` itself. A hold whose round has closed is released here — its session moves onto
 * `mock` — so the request that follows the closing one is already answered by the current board.
 */
export const mockForSession = (mock, sid) => {
	const holds = held.get(mock);
	const hold = sid ? holds?.get(sid) : undefined;
	if (!hold) return mock;
	if (hasOpenRound(hold.owner, sid)) return hold.owner;
	const settled = hold.owner.sessions.get(sid);
	if (settled) mock.sessions.set(sid, carrySession(settled, { keepBetShape: hold.keepBetShape }));
	holds.delete(sid);
	return mock;
};
