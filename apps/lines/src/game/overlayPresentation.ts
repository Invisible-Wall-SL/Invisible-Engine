import { roundSkip } from 'utils-shared/skipToken';

import { playSymbolLandSound } from './soundBindings';
import {
	armTokenBeat,
	completeTokenBeat,
	overlayTokenKey,
	stateOverlayTokens,
} from './stateOverlay.svelte';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import type { BookEventOfType } from './typesBookEvent';

/**
 * `overlayDrop` (`docs/design/pots-overlay.md` §3.4) — the tokens appear OVER the cells the server
 * names, after the board has stopped, and play `coinLand`; the beat waits for them (capped, raced
 * against the slam) and they settle to `coinIdle`. The symbol under each token is untouched: its
 * wins, its book and its anticipation never see the token. The play seam recorded the tokens before
 * this beat started (`stateOverlay`), so a flow that owns the event draws the same picture.
 */
export const presentOverlayDrop = async (event: BookEventOfType<'overlayDrop'>) => {
	const keys = event.cells.map(({ reel, row }) => overlayTokenKey(reel, row));
	for (const key of keys) stateOverlayTokens.state[key] = 'coinLand';
	event.cells.forEach((cell) => playSymbolLandSound(cell.token, 1));
	await roundSkip.race(
		Promise.all(
			keys.map((key) =>
				awaitSymbolBeat((resolve) => armTokenBeat(key, resolve), TRANSIT_BEAT_CAP_MS),
			),
		),
	);
	keys.forEach(completeTokenBeat);
};
