/**
 * Session state for the Play4Fun protocol.
 *
 * Observed behaviour (from real Hot Fruits captures):
 *   - `seq` is sent on every request but is NOT a monotonic counter scoped
 *     to the session. New rounds start with seq=0; seq increments only
 *     within the action sequence of a single in-flight round, and resets
 *     when the next round starts.
 *   - `gid` (game round id) is returned by the server in
 *     `platform.gameRound.id` after a `bet+play` call and must be echoed
 *     back as a query param on subsequent in-round actions (e.g. `collect`).
 *
 * This state object owns both pieces. Call `startRound()` when a `bet+play`
 * is fired (resets seq, clears gid). Call `bindRound(gid)` when the server
 * returns a gameRound id. Call `endRound()` after a successful collect.
 */

export interface Play4FunSessionState {
	readonly sid: string;
	readonly seq: number;
	readonly gid: string | null;

	/** Pull the current seq and increment for the next request. */
	nextSeq(): number;
	/** Reset seq to 0 and clear gid (call when starting a fresh round). */
	startRound(): void;
	/** Record the gid returned by the server on the bet+play response. */
	bindRound(gid: string): void;
	/** Clear gid (call after a successful collect). */
	endRound(): void;
	snapshot(): { sid: string; seq: number; gid: string | null };
}

export const createPlay4FunSessionState = (sid: string): Play4FunSessionState => {
	let seq = 0;
	let gid: string | null = null;

	return {
		get sid() {
			return sid;
		},
		get seq() {
			return seq;
		},
		get gid() {
			return gid;
		},
		nextSeq() {
			const current = seq;
			seq = seq + 1;
			return current;
		},
		startRound() {
			seq = 0;
			gid = null;
		},
		bindRound(value: string) {
			gid = value;
		},
		endRound() {
			gid = null;
		},
		snapshot() {
			return { sid, seq, gid };
		},
	};
};

// ---------- Back-compat alias (will remove on rename) ----------
export const createEAGamingSessionState = createPlay4FunSessionState;
export type EAGamingSessionState = Play4FunSessionState;
