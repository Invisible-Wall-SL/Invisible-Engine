/**
 * EAGaming wire-format types.
 *
 * Observed from a live Hot Fruits session on eagaming.com:
 *   POST /game/engine?sid={sid}&seq={n}
 *   Body: [{action: 'bet', context: [5, 2]}, {action: 'play', context: null}]
 *
 * The exact set of actions, context shapes, and response fields is still being
 * reverse-engineered. Treat these types as a working draft — extend them as
 * the probe script reveals more.
 */

export type EAGamingAction =
	| 'bet'
	| 'play'
	// Speculative — confirm/discard via probe:
	| 'authenticate'
	| 'endRound'
	| 'event'
	| 'replay'
	| (string & {}); // keep open for unknown actions

export interface EAGamingActionEnvelope<TContext = unknown> {
	action: EAGamingAction;
	context: TContext | null;
}

export type EAGamingRequestBody = EAGamingActionEnvelope[];

export interface EAGamingRequestQuery {
	sid: string;
	seq: number;
}

/**
 * Best-guess response shape — to be refined once we capture real payloads.
 * Keeping it loose so the probe can dump arbitrary JSON without type errors.
 */
export interface EAGamingResponse {
	balance?: number;
	currency?: string;
	round?: {
		id?: string | number;
		amount?: number;
		payout?: number;
		state?: unknown[];
		active?: boolean;
	};
	error?: { code?: string; message?: string };
	[k: string]: unknown;
}

export interface EAGamingTransportConfig {
	baseUrl: string; // e.g. 'https://eagaming.com'
	endpoint?: string; // default '/game/engine'
	sid: string;
	fetchImpl?: typeof fetch;
}
