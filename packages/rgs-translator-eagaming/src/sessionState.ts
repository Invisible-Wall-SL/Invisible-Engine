/**
 * Session state for the Play4Fun protocol.
 *
 *   - `seq` is **the 0-based POSITION in the round's stored action array at which the action(s)
 *     you are posting should be placed** — not a request counter. The server appends every stored
 *     action it receives, so a request carrying `[bet, play]` advances the array by TWO, and the
 *     next action goes at `seq=2`. Omitting `seq` appends.
 *
 *     This matters because writing to an ALREADY-OCCUPIED position is how the engine exposes
 *     REPLAY: re-posting `play` at `seq=2` of `[bet,play,play,play,play]` replays the first free
 *     spin instead of advancing the round. So a counter that advanced once per REQUEST (what this
 *     file assumed before) does not merely mis-number — after a two-action `bet+play` it aims every
 *     subsequent action one slot short, and the round silently replays itself instead of moving on.
 *     The captured Hot Fruits `collect` in `types.ts` carries `seq=2` after a `bet+play`, which is
 *     the same rule; the capture was right and the counter was wrong.
 *
 *     `config` and the empty-body balance probe are NOT stored and must not consume a position.
 *
 *   - `gid` (game round id) is returned by the server in `platform.gameRound.id` after a `bet+play`
 *     call and must be echoed back as a query param on subsequent in-round actions (e.g. `collect`).
 *
 * This state object owns both pieces. Call `startRound()` when a `bet+play` is fired (the round's
 * action array starts empty again). Call `bindRound(gid)` when the server returns a gameRound id.
 * Call `endRound()` after a successful collect.
 */

export interface Play4FunSessionState {
	readonly sid: string;
	readonly seq: number;
	readonly gid: string | null;

	/** Reserve `storedActions` slots in the round's action array and return the position the new
	 *  action(s) go at. Pass 0 for a call the server does not store (balance / config): it reports
	 *  the current position without consuming one. */
	takeSeq(storedActions: number): number;
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
		takeSeq(storedActions: number) {
			const position = seq;
			if (storedActions > 0) seq = seq + storedActions;
			return position;
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
