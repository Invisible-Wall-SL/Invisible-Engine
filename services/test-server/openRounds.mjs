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
 * closes. A request under the round's own `gid` still goes there after it closed, because that is a
 * resend of the request that closed it (a lost `collect` answer), which only the old instance can
 * replay. The first request that is not moves the session over, balance and all, and lets the old
 * instance go — as does the next rebuild.
 *
 * A player who finished a round across a refresh keeps the balance that round left them rather than
 * the refresh's reset: wiping the win they were just paid reads as the win vanishing.
 *
 * A round left open for {@link HOLD_TTL_MS} (a tab closed mid-feature) is dropped at the next rebuild
 * rather than pinning a whole old instance in memory for the life of the process.
 */

import { carrySession } from '../../scripts/mock-rgs-server.mjs';

const HOLD_TTL_MS = Number(process.env.OPEN_ROUND_HOLD_TTL_MS ?? 6 * 60 * 60 * 1000);

/** mock → Map<sid, { owner, roundId, since, keepBetShape }>: sessions another instance answers. */
const held = new WeakMap();

const openRoundOf = (mock, sid) => mock?.sessions?.get(sid)?.round ?? null;

/** Move a held session whose round has closed onto `mock`, with the balance the round left. */
const release = (mock, sid, hold) => {
	const settled = hold.owner.sessions.get(sid);
	if (settled) mock.sessions.set(sid, carrySession(settled, { keepBetShape: hold.keepBetShape }));
};

/**
 * Hand every round still open on `previous` to `next`, including rounds `previous` was itself
 * holding for an older instance; a held round that has closed since is settled onto `next`. Call
 * once per rebuild, AFTER `next`'s sessions have been carried from `previous`.
 */
export const holdOpenRounds = (previous, next, { keepBetShape }) => {
	if (!previous?.sessions || !next?.sessions) return;
	const now = Date.now();
	const holds = new Map();
	for (const [sid, hold] of held.get(previous) ?? []) {
		if (!openRoundOf(hold.owner, sid)) release(next, sid, hold);
		else if (now - hold.since < HOLD_TTL_MS) holds.set(sid, { ...hold, keepBetShape });
	}
	for (const sid of previous.sessions.keys()) {
		const round = openRoundOf(previous, sid);
		if (!holds.has(sid) && round)
			holds.set(sid, { owner: previous, roundId: round.id, since: now, keepBetShape });
	}
	if (holds.size > 0) held.set(next, holds);
};

/**
 * The instance that answers `sid` on `mock`: the one that opened its round while that round is open
 * or the request names it (`gid`), otherwise `mock` itself — releasing the hold, so the session's
 * next round is dealt on the current board.
 */
export const mockForSession = (mock, sid, gid) => {
	const holds = held.get(mock);
	const hold = sid ? holds?.get(sid) : undefined;
	if (!hold) return mock;
	if (openRoundOf(hold.owner, sid) || (gid && gid === hold.roundId)) return hold.owner;
	release(mock, sid, hold);
	holds.delete(sid);
	return mock;
};
