/**
 * Dedicated entry that re-exports the Stake-shaped facade only.
 *
 * Aliased by apps via Vite resolve.alias when they want to swap their
 * `rgs-requests` import for the Play4Fun-backed implementation:
 *
 *   resolve.alias['rgs-requests'] = 'rgs-translator-eagaming/stake-facade'
 */

export {
	requestAuthenticate,
	requestBet,
	requestEndRound,
	requestEndEvent,
	requestReplay,
	getSessionState,
} from './src/stakeFacade';

/** Re-export of `BetType` from the original rgs-requests, kept identical so
 *  game code that does `import type { BetType } from 'rgs-requests'` continues
 *  to compile under the alias. */
export type BetType<TBookEvent extends object> = {
	roundID?: string | number;
	amount?: number;
	payout?: number;
	payoutMultiplier?: number;
	active?: boolean;
	mode?: string;
	event?: string | null;
	state: TBookEvent[];
};
