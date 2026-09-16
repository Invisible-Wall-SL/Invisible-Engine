import type { Play4FunRequestBody, Play4FunResponse, Play4FunTransportConfig } from './types';
import type { Play4FunSessionState } from './sessionState';
import { responseClosedRound } from './translator';

/** Actions the server does NOT append to the round's stored action array. They must not consume a
 *  position, or every later action would aim past the end of the array. The empty-body balance
 *  probe is the same case, and falls out of the count naturally. */
const NON_STORED_ACTIONS = new Set(['config']);

const storedActionCount = (body: Play4FunRequestBody): number =>
	body.filter((entry) => !NON_STORED_ACTIONS.has(entry.action)).length;

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
 * Low-level HTTP transport for the Play4Fun `/rgs/engine` endpoint. Pairs
 * with a session-state instance to manage seq/gid per round automatically.
 */
export const createPlay4FunFetcher = (
	config: Play4FunTransportConfig,
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

	return {
		post: async (options: Play4FunPostOptions): Promise<Play4FunPostResult> => {
			const seq = options.seqOverride ?? session.takeSeq(storedActionCount(options.body));
			const gid = options.gidOverride === null ? null : (options.gidOverride ?? session.gid);

			const params = new URLSearchParams();
			params.set('sid', session.sid);
			params.set('seq', String(seq));
			if (gid) params.set('gid', gid);

			const url = `${config.baseUrl}${endpoint}?${params.toString()}`;

			const response = await fetchImpl(url, {
				method: 'POST',
				credentials,
				headers: {
					'Content-Type': contentType,
					...options.headers,
				},
				body: JSON.stringify(options.body),
			});

			const rawText = await response.text();
			let parsed: Play4FunResponse | null = null;
			try {
				parsed = rawText ? (JSON.parse(rawText) as Play4FunResponse) : null;
			} catch {
				parsed = null;
			}

			// Auto-bind the gid if the server returned one.
			const returnedGid = parsed?.platform?.gameRound?.id;
			if (returnedGid && returnedGid !== session.gid) {
				session.bindRound(returnedGid);
			}

			// If the response closed the round (gameRoundOver event present),
			// reset the session so the next bet starts cleanly. The server
			// auto-closes zero-win rounds regardless of play.context, so we
			// can't rely on the request intent — only the response is
			// authoritative.
			if (responseClosedRound(parsed)) {
				session.endRound();
			}

			return {
				status: response.status,
				statusText: response.statusText,
				url,
				requestBody: options.body,
				requestSeq: seq,
				requestGid: gid,
				response: parsed,
				rawText,
			};
		},
	};
};

// ---------- Back-compat aliases ----------
export const createEAGamingFetcher = createPlay4FunFetcher;
export type EAGamingPostOptions = Play4FunPostOptions;
export type EAGamingPostResult = Play4FunPostResult;
