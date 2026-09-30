/**
 * Amount conversion between the engine's units and Play4Fun CREDITS.
 *
 * Its own module, apart from `gameMappings.ts`, because it reads the operator's page (`denom`) and
 * the launcher imports the symbol mappings server-side: keeping the mappings a dependency-free leaf
 * keeps `delivery-profile` out of the launcher's graph.
 */

import { DEFAULT_DENOM, readHostGameSettings, validDenom } from 'delivery-profile';

export { DEFAULT_DENOM };

/** The engine's API_AMOUNT_MULTIPLIER (constants-shared/bet.ts). Any amount the
 *  engine sends or receives is in millionths-of-a-dollar (1,000,000 = $1.00).
 *  Restated rather than imported to keep this package free of internal engine deps. */
export const ENGINE_AMOUNT_MULTIPLIER = 1_000_000;

/**
 * Engine units per Play4Fun credit: `ENGINE_AMOUNT_MULTIPLIER × denom` — 10,000 at the protocol's
 * 0.01. Every amount on the wire is in CREDITS and the operator's page states what one is worth
 * (`denom`), so a brand whose credit is 10 cents must not be shown a tenth of its money. Read per
 * call because the page is there before any amount is converted and never changes after.
 */
export const amountScale = (): number =>
	Math.round(
		ENGINE_AMOUNT_MULTIPLIER * (validDenom(readHostGameSettings()?.config.denom) ?? DEFAULT_DENOM),
	);

/** Credits per unit of money — the inverse of `denom`, 100 at the protocol's 0.01. */
export const play4FunAmountMultiplier = (): number => ENGINE_AMOUNT_MULTIPLIER / amountScale();

/** Convert an engine API amount (millions) to Play4Fun credits. Used when sending
 *  bet contexts to a Play4Fun backend. Rounds to whole credits. */
export const engineToPlay4Fun = (engineAmount: number): number =>
	Math.round(engineAmount / amountScale());

/** Convert a Play4Fun credit amount to engine API millions. Used when adapting
 *  responses (balance, win, etc.) for engine consumption. */
export const play4FunToEngine = (play4FunAmount: number): number =>
	Math.round(play4FunAmount * amountScale());
