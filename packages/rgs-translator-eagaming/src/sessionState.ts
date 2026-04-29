/**
 * EAGaming sessions are stateful: every request must carry an incrementing
 * `seq` value scoped to a single `sid`. The server appears to reject or
 * misorder requests if seq goes backwards or skips, so the counter must be
 * owned by a single source per session.
 */

export interface EAGamingSessionState {
	readonly sid: string;
	readonly seq: number;
	nextSeq(): number;
	reset(seq?: number): void;
	snapshot(): { sid: string; seq: number };
}

export const createEAGamingSessionState = (sid: string, initialSeq = 0): EAGamingSessionState => {
	let seq = initialSeq;

	return {
		get sid() {
			return sid;
		},
		get seq() {
			return seq;
		},
		nextSeq() {
			const current = seq;
			seq = seq + 1;
			return current;
		},
		reset(value = 0) {
			seq = value;
		},
		snapshot() {
			return { sid, seq };
		},
	};
};
