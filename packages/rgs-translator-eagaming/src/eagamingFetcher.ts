import type {
	EAGamingRequestBody,
	EAGamingResponse,
	EAGamingTransportConfig,
} from './types';
import type { EAGamingSessionState } from './sessionState';

export interface EAGamingPostOptions {
	body: EAGamingRequestBody;
	/** Override seq instead of pulling from the session counter. Probe-only. */
	seqOverride?: number;
	/** Extra headers (cookies, csrf, etc.) when reproducing a live session. */
	headers?: Record<string, string>;
}

export interface EAGamingPostResult {
	status: number;
	statusText: string;
	url: string;
	requestBody: EAGamingRequestBody;
	requestSeq: number;
	response: EAGamingResponse | null;
	rawText: string;
}

/**
 * Low-level fetcher that handles the EAGaming POST shape. Pairs with a
 * session-state instance so seq always increments correctly.
 */
export const createEAGamingFetcher = (
	config: EAGamingTransportConfig,
	session: EAGamingSessionState,
) => {
	const fetchImpl = config.fetchImpl ?? fetch;
	const endpoint = config.endpoint ?? '/game/engine';

	return {
		post: async (options: EAGamingPostOptions): Promise<EAGamingPostResult> => {
			const seq = options.seqOverride ?? session.nextSeq();
			const url = `${config.baseUrl}${endpoint}?sid=${encodeURIComponent(session.sid)}&seq=${seq}`;

			const response = await fetchImpl(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
				body: JSON.stringify(options.body),
			});

			const rawText = await response.text();
			let parsed: EAGamingResponse | null = null;
			try {
				parsed = rawText ? (JSON.parse(rawText) as EAGamingResponse) : null;
			} catch {
				parsed = null;
			}

			return {
				status: response.status,
				statusText: response.statusText,
				url,
				requestBody: options.body,
				requestSeq: seq,
				response: parsed,
				rawText,
			};
		},
	};
};
