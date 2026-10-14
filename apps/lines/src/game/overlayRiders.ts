import {
	BASE_GAME_MODE,
	isCoinDrop,
	overlayDropModes,
	symbolsWithRole,
	type CoinOverlay,
} from 'game-config';

import type { FlightSymbol } from './flights.svelte';
import { getActiveGameConfig } from './gameConfig';
import { armedReelToken, overlayTokenSymbol } from './stateOverlay.svelte';

/**
 * TOKENS THAT ROLL WITH THE REELS (`coinOverlay.timing: 'withReel'`). Each cell of the strip may carry
 * a token drawn riding it (`ReelSymbol`), so a token moves exactly as its reel does:
 *
 * - the board's real drop rides the cells it lands on, rolls in with them and comes to rest with the
 *   reel, where the overlay layer takes it over (`OverlayToken` waits for the reel to settle);
 * - cells that only roll past carry a token now and then — drawn from the drop table, about as often
 *   as the drop chance — and roll on out of the window: tokens seen spinning that never land.
 *
 * Presentation only: the RGS still decides every drop, and a passing token is never recorded.
 */

/** The densest the passing tokens get, whatever the drop chance: a strip of coins reads as a bug. */
const MAX_PASSING_SHARE = 0.25;

let activeModeOf: () => string = () => BASE_GAME_MODE;

/** Bind the reader of the mode on screen — passing tokens roll only in a mode whose spins drop. */
export const bindRiderMode = (read: () => string) => {
	activeModeOf = read;
};

const rolling = (): CoinOverlay | undefined => {
	const overlay = getActiveGameConfig().coinOverlay;
	return overlay?.timing === 'withReel' ? overlay : undefined;
};

const weighted = <T extends { weight: number }>(entries: readonly T[]): T | undefined => {
	const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
	let pick = Math.random() * total;
	return entries.find((entry) => (pick -= Math.max(0, entry.weight)) < 0);
};

const passingToken = (overlay: CoinOverlay, reel: number): FlightSymbol | undefined => {
	const drops = overlay.drops;
	if (!drops || !overlayDropModes(drops).includes(activeModeOf())) return undefined;
	if (drops.reels && !drops.reels.includes(reel)) return undefined;
	if (Math.random() >= Math.min(drops.chance, MAX_PASSING_SHARE)) return undefined;
	const entry = weighted(drops.table);
	if (!entry) return undefined;
	if (!isCoinDrop(entry)) {
		const token = overlay.pots?.find((pot) => pot.id === entry.pot)?.token;
		return token ? { name: token } : undefined;
	}
	const name = symbolsWithRole(getActiveGameConfig(), 'coin')[0];
	if (!name) return undefined;
	const coin = weighted(overlay.coins ?? []);
	if (coin?.kind === 'cash') return { name, value: coin.value };
	if (coin?.kind === 'jackpot') return { name, jackpot: coin.jackpot };
	return { name };
};

/** The reel riders `createGameState` stores on each cell as the strip is built. */
export const overlayReelRiders = {
	target: (reel: number, row: number): FlightSymbol | undefined => {
		if (!rolling()) return undefined;
		const cell = armedReelToken(reel, row);
		return cell && overlayTokenSymbol(cell);
	},
	padding: (reel: number): FlightSymbol | undefined => {
		const overlay = rolling();
		return overlay && passingToken(overlay, reel);
	},
};

/** The token a cell carries, read back off the cell (`ReelSymbol.rider` is the reel's `unknown`). */
export const riderToken = (rider: unknown): FlightSymbol | undefined => {
	if (typeof rider !== 'object' || rider === null || !('name' in rider)) return undefined;
	return typeof rider.name === 'string' ? (rider as FlightSymbol) : undefined;
};
