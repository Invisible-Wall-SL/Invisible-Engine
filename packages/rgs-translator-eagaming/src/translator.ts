/**
 * Bidirectional translator between the Stake Engine internal request shape
 * and the EAGaming batched-action wire format.
 *
 *   Stake Engine                          EAGaming
 *   ────────────                          ────────
 *   requestBet({ amount, mode, … })  ──►  [{action:'bet', context:[amount,…]},
 *                                           {action:'play', context:null}]
 *
 *   res_play { round: { state: [] } }  ◄──  EAGamingResponse
 *
 * The mappings here are PROVISIONAL — derived from a single observed Hot
 * Fruits payload. Adjust as the probe script captures more variants.
 */

import type {
	EAGamingActionEnvelope,
	EAGamingRequestBody,
	EAGamingResponse,
} from './types';

export interface StakeBetRequest {
	amount: number;
	mode: string;
	currency: string;
	/** Extra fields the server expects in the bet context (e.g. lines/ways). */
	contextExtras?: number[];
}

export interface StakeBetResponse {
	status: { statusCode: 'SUCCESS' | string; statusMessage?: string };
	balance?: { amount: number; currency: string };
	round?: {
		roundID?: string | number;
		amount?: number;
		payout?: number;
		payoutMultiplier?: number;
		active?: boolean;
		mode?: string;
		state?: unknown[];
	};
	error?: unknown;
	/** Raw response retained for debugging while the protocol is under study. */
	_raw?: EAGamingResponse;
}

/**
 * Build the batched action body for a "bet + play" round.
 * Hot Fruits sends both actions in a single request; we mirror that.
 */
export const buildBetActions = (req: StakeBetRequest): EAGamingRequestBody => {
	const betContext = [req.amount, ...(req.contextExtras ?? [])];
	const actions: EAGamingActionEnvelope[] = [
		{ action: 'bet', context: betContext },
		{ action: 'play', context: null },
	];
	return actions;
};

/**
 * Build a single-action body. Useful for authenticate/endRound/event probes
 * before we know which actions the server actually accepts batched.
 */
export const buildSingleAction = <T>(
	action: string,
	context: T | null = null,
): EAGamingRequestBody => [{ action, context } as EAGamingActionEnvelope<T>];

/**
 * Reshape an EAGaming response into the Stake Engine `res_play` shape so the
 * existing book-event pipeline can consume it without modification.
 *
 * NOTE: field mapping is a placeholder. We need real responses to confirm
 * where balance/payout/state actually live in the EAGaming payload.
 */
export const translateBetResponse = (raw: EAGamingResponse): StakeBetResponse => {
	const status: StakeBetResponse['status'] = raw.error
		? {
				statusCode: typeof raw.error === 'object' && raw.error?.code ? raw.error.code : 'ERR_UE',
				statusMessage:
					typeof raw.error === 'object' && raw.error?.message ? raw.error.message : undefined,
			}
		: { statusCode: 'SUCCESS' };

	return {
		status,
		balance:
			typeof raw.balance === 'number'
				? { amount: raw.balance, currency: raw.currency ?? 'USD' }
				: undefined,
		round: raw.round
			? {
					roundID: raw.round.id,
					amount: raw.round.amount,
					payout: raw.round.payout,
					active: raw.round.active,
					state: raw.round.state ?? [],
				}
			: undefined,
		_raw: raw,
	};
};
