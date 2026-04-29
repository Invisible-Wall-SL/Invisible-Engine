import type {
	Play4FunRequestBody,
	Play4FunResponse,
	Play4FunTransportConfig,
} from './types';
import type { Play4FunSessionState } from './sessionState';

export interface Play4FunPostOptions {
	body: Play4FunRequestBody;
	/** Override seq instead of pulling from the session counter. */
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

	return {
		post: async (options: Play4FunPostOptions): Promise<Play4FunPostResult> => {
			const seq = options.seqOverride ?? session.nextSeq();
			const gid = options.gidOverride === null
				? null
				: options.gidOverride ?? session.gid;

			const params = new URLSearchParams();
			params.set('sid', session.sid);
			params.set('seq', String(seq));
			if (gid) params.set('gid', gid);

			const url = `${config.baseUrl}${endpoint}?${params.toString()}`;

			const response = await fetchImpl(url, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
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
