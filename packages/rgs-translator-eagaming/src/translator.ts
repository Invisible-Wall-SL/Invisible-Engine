/**
 * Bidirectional translator between the Stake Engine internal request shape
 * and the Play4Fun batched-action `/rgs/engine` protocol.
 *
 *   Stake Engine                        Play4Fun
 *   ────────────                        ────────
 *   requestBet({amount, mode, …}) ──►   [{action:'bet', context:[a,b]},
 *                                        {action:'play', context:''|null}]
 *
 *   res_play { round: { state: [] } } ◄── { events:[], platform:{balance,…} }
 *
 * The Play4Fun `events` array IS already a sequence of book events in the
 * shape Stake Engine consumes — translation mostly relays them through and
 * reshapes the platform/balance envelope.
 */

import type {
	BetContext,
	PlayContext,
	Play4FunActionEnvelope,
	Play4FunBookEvent,
	Play4FunRequestBody,
	Play4FunResponse,
} from './types';

/** API_AMOUNT_MULTIPLIER from constants-shared/bet — Stake Engine multiplies
 *  the human bet by this when sending. We don't import it here to keep this
 *  package free of internal-engine deps; the caller scales bet/payout as needed. */

export interface StakeBetRequest {
	/** Bet amount in Stake Engine's integer units (already multiplied). */
	amount: number;
	mode: string;
	currency: string;
	/** First element of the bet context tuple. Defaults to 5 (matches the only
	 *  observed Hot Fruits config). The second element is derived from
	 *  `amount` divided by this value, but most games will want to pass the
	 *  exact pair as observed in their network capture. */
	betLinesOrConfig?: number;
	/** Override `play.context`. Default '' (auto-collect). Pass null to keep
	 *  the round open and explicitly call buildCollectAction next. */
	playContext?: PlayContext;
}

export interface StakeBetResponse {
	status: { statusCode: 'SUCCESS' | string; statusMessage?: string };
	balance?: { amount: number; currency: string };
	round?: {
		roundID?: string;
		amount?: number;
		payout?: number;
		payoutMultiplier?: number;
		active?: boolean;
		mode?: string;
		state?: Play4FunBookEvent[];
	};
	error?: unknown;
	/** Raw response retained for debugging. */
	_raw?: Play4FunResponse;
}

const buildBetContext = (req: StakeBetRequest): BetContext => {
	const linesOrConfig = req.betLinesOrConfig ?? 5;
	const betPerLine = Math.max(1, Math.round(req.amount / linesOrConfig));
	return [linesOrConfig, betPerLine];
};

/** Build the request body for a bet+play round. Default is auto-collect mode
 *  (`play.context = ''`) which closes the round in a single round-trip. */
export const buildBetActions = (req: StakeBetRequest): Play4FunRequestBody => {
	const playContext: PlayContext = req.playContext === undefined ? '' : req.playContext;
	return [
		{ action: 'bet', context: buildBetContext(req) },
		{ action: 'play', context: playContext },
	];
};

/** Heartbeat: empty body returns `{events:[], platform:{balance}}`. */
export const buildHeartbeat = (): Play4FunRequestBody => [];

/** Close an in-flight round when bet+play was sent with `play.context = null`. */
export const buildCollectAction = (): Play4FunRequestBody => [{ action: 'collect' }];

/** Build a single arbitrary action — used by the probe story. */
export const buildSingleAction = <T>(
	action: string,
	context?: T,
): Play4FunRequestBody => [{ action, context } as Play4FunActionEnvelope];

const computeRoundFinancials = (events: Play4FunBookEvent[]): { amount?: number; payout?: number; payoutMultiplier?: number; active: boolean } => {
	let amount: number | undefined;
	let payout: number | undefined;
	let active = true;
	for (const e of events) {
		if (e.event === 'bet' && typeof (e.context as { total?: number })?.total === 'number') {
			amount = (e.context as { total: number }).total;
		}
		if (e.event === 'gameEnd' && typeof (e.context as { win?: number })?.win === 'number') {
			payout = (e.context as { win: number }).win;
		}
		if (e.event === 'gameRoundOver') {
			active = false;
		}
	}
	const payoutMultiplier = amount && amount > 0 && payout !== undefined ? payout / amount : undefined;
	return { amount, payout, payoutMultiplier, active };
};

/** Reshape a Play4Fun response into the Stake Engine `res_play` shape so the
 *  existing book-event pipeline can consume it. */
export const translateBetResponse = (raw: Play4FunResponse, currency = 'USD'): StakeBetResponse => {
	if (raw.error) {
		return {
			status: {
				statusCode: raw.error.code ?? 'ERR_UE',
				statusMessage: raw.error.message,
			},
			_raw: raw,
		};
	}

	const fin = computeRoundFinancials(raw.events ?? []);

	return {
		status: { statusCode: 'SUCCESS' },
		balance: { amount: raw.platform.balance, currency },
		round: {
			roundID: raw.platform.gameRound?.id,
			amount: fin.amount,
			payout: fin.payout,
			payoutMultiplier: fin.payoutMultiplier,
			active: raw.platform.gameRound?.updating === true && fin.active,
			state: raw.events ?? [],
		},
		_raw: raw,
	};
};
