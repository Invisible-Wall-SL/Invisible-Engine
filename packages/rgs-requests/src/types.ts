import type { requestBet } from './rgs-requests';

type Round = Awaited<ReturnType<typeof requestBet>>['round'];
type NoUndefinedBaseBet = Exclude<Round, undefined>;
type BaseBetWithoutState = Omit<NoUndefinedBaseBet, 'state'>;

export type BetType<TBookEvent extends object> = BaseBetWithoutState & {
	state: TBookEvent[];
};

/** A round whose book events no game-specific type has been put on yet. */
export type BaseBet = BetType<object>;
