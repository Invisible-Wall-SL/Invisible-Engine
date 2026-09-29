import {
	isPlay4FunError,
	type Play4FunRequestBody,
	type Play4FunResponse,
	type Play4FunTransportConfig,
} from './types';
import type { Play4FunSessionState } from './sessionState';
import { responseClosedRound } from './translator';

/** Actions the server does NOT append to the round's stored action array. They must not consume a
 *  position, or every later action would aim past the end of the array. The empty-body balance
 *  probe is the same case, and falls out of the count naturally. */
const NON_STORED_ACTIONS = new Set(['config']);

const storedActionCount = (body: Play4FunRequestBody): number =>
	body.filter((entry) => !NON_STORED_ACTIONS.has(entry.action)).length;

/**
 * How long to wait for an answer, and how to resend when none comes.
 *
 * The partner's own client resends every `1 s`, for ever, on a network error or an empty 200 body,
 * and gives an attempt `30 s`. We keep the pause and bound the rest: an attempt that has not answered
 * in `attemptTimeoutMs` is abandoned and resent (theirs fails the request on a timeout instead), and
 * after `giveUpAfterMs` the player is asked to reload — a reload resumes whatever the server holds.
 */
export interface Play4FunResendPolicy {
	attemptTimeoutMs: number;
	resendDelayMs: number;
	giveUpAfterMs: number;
}

export const DEFAULT_RESEND_POLICY: Play4FunResendPolicy = {
	attemptTimeoutMs: 15_000,
	resendDelayMs: 1_000,
	giveUpAfterMs: 90_000,
};

export type Play4FunConnectionState =
	| { state: 'connected' }
	| { state: 'reconnecting'; attempt: number; reason: string }
	| { state: 'failed'; reason: string };

/**
 * The transport gave up. `unreachable`: no answer inside the budget. `unresolved`: a request that
 * opens a round went unanswered and the server could not show whether it was taken — resending it
 * could charge the stake twice, so the player reloads instead and the boot resumes what the server
 * holds.
 */
export class Play4FunConnectionError extends Error {
	readonly reason: 'unreachable' | 'unresolved';
	constructor(message: string, reason: 'unreachable' | 'unresolved') {
		super(message);
		this.name = 'Play4FunConnectionError';
		this.reason = reason;
	}
}

export interface Play4FunPostOptions {
	body: Play4FunRequestBody;
	/** Write at an explicit position instead of the next free one. An ALREADY-OCCUPIED position is
	 *  how the engine replays: re-posting `play` at the slot of an earlier free spin shows that spin
	 *  again rather than advancing the round. */
	seqOverride?: number;
	/** Override gid (defaults to whatever the session state holds). Pass null
	 *  to explicitly omit gid even when the session has one bound. */
	gidOverride?: string | null;
	/** Extra headers — usually unnecessary because cookies travel with
	 *  same-origin fetches. */
	headers?: Record<string, string>;
	/** `false`: one attempt, reported to nobody, and skipped outright while anything else is in
	 *  flight on the session — for a background balance poll, which must never queue behind a spin
	 *  or put a reconnect screen in front of an idle player. Throws on failure. */
	resend?: boolean;
}

export interface Play4FunPostResult {
	status: number;
	statusText: string;
	url: string;
	requestBody: Play4FunRequestBody;
	requestSeq: number;
	requestGid: string | null;
	response: Play4FunResponse | null;
	rawText: string;
}

/**
 * What a session's requests share, whichever fetcher sends them — the facade builds a fetcher per
 * call. Requests are sent ONE AT A TIME: `seq` is a position, so a retry storm that let a later action
 * overtake an earlier one would store them in the wrong slots. The partner's client holds every
 * request behind a reconnecting one for the same reason.
 */
interface Lane {
	tail: Promise<unknown>;
	/** Requests sent or queued. */
	pending: number;
	failed: boolean;
	/** The last round an answer closed. The partner keeps naming a round on `platform.gameRound`
	 *  after it closed, so a probe naming THIS one is not a round the lost bet opened. */
	lastClosedGid?: string;
}

const lanes = new WeakMap<Play4FunSessionState, Lane>();
const laneFor = (session: Play4FunSessionState): Lane => {
	let lane = lanes.get(session);
	if (!lane) {
		lane = { tail: Promise.resolve(), pending: 0, failed: false };
		lanes.set(session, lane);
	}
	return lane;
};

/** A background poll asks this first: nothing in flight, and the connection not given up on. */
export const isSessionIdle = (session: Play4FunSessionState): boolean => {
	const lane = laneFor(session);
	return lane.pending === 0 && !lane.failed;
};

type Attempt =
	| { kind: 'answer'; status: number; statusText: string; rawText: string }
	| { kind: 'lost'; why: string };

/** A background poll must never hold a spin queued behind it for long. */
const POLL_TIMEOUT_MS = 5_000;

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Sleep, cut short when the browser reports the network is back. */
const pause = (ms: number) =>
	new Promise<void>((resolve) => {
		const target = globalThis as { addEventListener?: EventTarget['addEventListener'] } & {
			removeEventListener?: EventTarget['removeEventListener'];
		};
		const done = () => {
			clearTimeout(timer);
			target.removeEventListener?.('online', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		target.addEventListener?.('online', done);
	});

const parse = (rawText: string): Play4FunResponse | null => {
	try {
		return rawText ? (JSON.parse(rawText) as Play4FunResponse) : null;
	} catch {
		return null;
	}
};

/**
 * Low-level HTTP transport for the Play4Fun `/rgs/engine` endpoint. Pairs
 * with a session-state instance to manage seq/gid per round automatically.
 *
 * An unanswered request is resent at the SAME `seq` and `gid`. The position only moves once the
 * server answers, so a request it had already stored comes back as a replay of what it dealt — never
 * a second outcome, never a second stake. The one request with no `gid` to aim at is the `bet` that
 * opens a round; that one is resent only once the server shows it was not taken (see `settleOpening`).
 */
export const createPlay4FunFetcher = (
	config: Play4FunTransportConfig & {
		resendPolicy?: Partial<Play4FunResendPolicy>;
		onConnection?: (state: Play4FunConnectionState) => void;
	},
	session: Play4FunSessionState,
) => {
	const fetchImpl = config.fetchImpl ?? fetch;
	const endpoint = config.endpoint ?? '/rgs/engine';
	// Uncredentialed by default for a DELIVERED build, where the sid in the query string is the
	// credential and a wildcard `Access-Control-Allow-Origin` is the only CORS answer that scales to
	// an open-ended set of client/aggregator hosts. `true` restores the same-origin-iframe behaviour
	// this protocol was captured under. See `DeliveryProfileRgs.withCredentials`.
	const credentials: RequestCredentials = config.withCredentials === false ? 'omit' : 'include';
	const contentType = config.contentType ?? 'application/json';
	const policy = { ...DEFAULT_RESEND_POLICY, ...config.resendPolicy };
	const lane = laneFor(session);
	const report = (state: Play4FunConnectionState) => config.onConnection?.(state);

	const urlFor = (seq: number, gid: string | null) => {
		const params = new URLSearchParams();
		params.set('sid', session.sid);
		params.set('seq', String(seq));
		if (gid) params.set('gid', gid);
		return `${config.baseUrl}${endpoint}?${params.toString()}`;
	};

	const attempt = async (
		url: string,
		body: Play4FunRequestBody,
		headers?: Record<string, string>,
		quick = false,
	): Promise<Attempt> => {
		const controller = new AbortController();
		const timeoutMs = quick
			? Math.min(POLL_TIMEOUT_MS, policy.attemptTimeoutMs)
			: policy.attemptTimeoutMs;
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(url, {
				method: 'POST',
				credentials,
				headers: { 'Content-Type': contentType, ...headers },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			const rawText = await response.text();
			if (response.status >= 500 || response.status === 408 || response.status === 429) {
				return { kind: 'lost', why: `HTTP ${response.status}` };
			}
			// The partner's client resends an empty 200 too: the server has not answered.
			if (response.ok && rawText.trim() === '') return { kind: 'lost', why: 'empty response' };
			return { kind: 'answer', status: response.status, statusText: response.statusText, rawText };
		} catch (err) {
			return {
				kind: 'lost',
				why: controller.signal.aborted
					? `no answer in ${timeoutMs} ms`
					: err instanceof Error
						? err.message
						: String(err),
			};
		} finally {
			clearTimeout(timer);
		}
	};

	/**
	 * Ask the server, without touching the round, what it holds — `[]` first, then `config` for a
	 * server that refuses the empty probe. Resent like anything else, since neither is stored.
	 */
	const probe = async (deadline: number): Promise<Play4FunResponse | null> => {
		for (;;) {
			for (const body of [[], [{ action: 'config' }]] as Play4FunRequestBody[]) {
				const a = await attempt(urlFor(session.seq, null), body);
				if (a.kind === 'lost') break;
				const response = parse(a.rawText);
				if (response && !isPlay4FunError(response)) return response;
				if (body.length) return null;
			}
			if (Date.now() + policy.resendDelayMs > deadline) return null;
			await pause(policy.resendDelayMs);
		}
	};

	/**
	 * A round-opening `bet` went unanswered. If the server names an OPEN round, the bet was taken (or
	 * an older round of the player's is open — one they paid for either way): resend under its `gid`,
	 * which replays it. Anything else stops, and the reload's boot resumes what the server holds.
	 */
	const settleOpening = async (
		deadline: number,
	): Promise<{ resend: 'replay'; gid: string } | { stop: string }> => {
		const held = await probe(deadline);
		if (!held) return { stop: 'the server could not be asked whether the bet was taken' };
		const round = held.platform?.gameRound;
		// Only a round the server calls `updating` is open; the partner keeps naming a round after it
		// closed, and one closed before this boot is not in `lastClosedGid`.
		if (round?.id && round.updating === true && round.id !== lane.lastClosedGid) {
			return { resend: 'replay', gid: round.id };
		}
		// No open round proves nothing: after a timeout or a 5xx the server may still be working on
		// the bet, and a zero-win round closes itself. Resending here is how a stake is taken twice.
		return { stop: 'the bet may have been taken without an answer reaching the game' };
	};

	const fail = (message: string, reason: Play4FunConnectionError['reason']): never => {
		lane.failed = true;
		report({ state: 'failed', reason: message });
		throw new Play4FunConnectionError(message, reason);
	};

	const send = async (options: Play4FunPostOptions): Promise<Play4FunPostResult> => {
		const { body } = options;
		const resend = options.resend !== false;
		if (resend && lane.failed) {
			throw new Play4FunConnectionError('the connection was lost earlier', 'unreachable');
		}
		const seq = options.seqOverride ?? session.seq;
		let gid = options.gidOverride === null ? null : (options.gidOverride ?? session.gid);
		let opensRound = !gid && body.some((a) => a.action === 'bet');
		const deadline = Date.now() + policy.giveUpAfterMs;
		let attempts = 0;
		let reconnecting = false;
		const reconnect = (why: string) => {
			reconnecting = true;
			report({ state: 'reconnecting', attempt: attempts, reason: why });
		};

		for (;;) {
			// A request sent while the browser knows it is offline cannot arrive, and is the one kind
			// of failure that certainly left nothing behind — so wait for the network rather than
			// spend attempts, and leave a round-opening bet out of the "was it taken?" question.
			while (resend && isOffline()) {
				reconnect('offline');
				if (Date.now() + policy.resendDelayMs > deadline) fail('offline', 'unreachable');
				await pause(policy.resendDelayMs);
			}

			const url = urlFor(seq, gid);
			const a = await attempt(url, body, options.headers, !resend);
			attempts += 1;

			if (a.kind === 'answer') {
				if (reconnecting) report({ state: 'connected' });
				const response = parse(a.rawText);
				const accepted = a.status < 300 && !!response && !isPlay4FunError(response);
				if (accepted && options.seqOverride === undefined) session.advance(storedActionCount(body));

				// Only an answer to STORED actions speaks for the round: a balance poll answered while a
				// spin waits behind it would otherwise bind the round it names to the new bet.
				const stored = storedActionCount(body) > 0;
				const returnedGid = response?.platform?.gameRound?.id;
				if (stored && returnedGid && returnedGid !== session.gid) session.bindRound(returnedGid);
				// The response is authoritative for whether the round closed: the server auto-closes a
				// zero-win round whatever `play.context` asked for.
				if (stored && responseClosedRound(response)) {
					lane.lastClosedGid = session.gid ?? undefined;
					session.endRound();
				}

				return {
					status: a.status,
					statusText: a.statusText,
					url,
					requestBody: body,
					requestSeq: seq,
					requestGid: gid,
					response,
					rawText: a.rawText,
				};
			}

			if (!resend) throw new Play4FunConnectionError(a.why, 'unreachable');
			reconnect(a.why);
			if (Date.now() + policy.resendDelayMs > deadline) fail(a.why, 'unreachable');
			await pause(policy.resendDelayMs);

			if (opensRound) {
				const verdict = await settleOpening(deadline);
				if ('stop' in verdict) fail(verdict.stop, 'unresolved');
				else {
					gid = verdict.gid;
					session.bindRound(gid);
					opensRound = false;
				}
			}
		}
	};

	return {
		post: (options: Play4FunPostOptions): Promise<Play4FunPostResult> => {
			if (options.resend === false && lane.pending > 0) {
				return Promise.reject(new Play4FunConnectionError('busy', 'unreachable'));
			}
			lane.pending += 1;
			const run = async () => {
				try {
					return await send(options);
				} finally {
					lane.pending -= 1;
				}
			};
			const result = lane.tail.then(run, run);
			lane.tail = result.catch(() => undefined);
			return result;
		},
	};
};

// ---------- Back-compat aliases ----------
export const createEAGamingFetcher = createPlay4FunFetcher;
export type EAGamingPostOptions = Play4FunPostOptions;
export type EAGamingPostResult = Play4FunPostResult;
