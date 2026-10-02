import { roundSkip } from 'utils-shared/skipToken';

import { playSymbolLandSound } from './soundBindings';
import {
	armTokenBeat,
	completeTokenBeat,
	leavingToken,
	liftToken,
	overlayTokenKey,
	showReelTokens,
	shownWithItsReel,
} from './stateOverlay.svelte';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import type { BookEventOfType } from './typesBookEvent';

/**
 * `overlayDrop` (`docs/design/pots-overlay.md` §3.4) — the tokens appear OVER the cells the server
 * names, after the board has stopped, already playing `coinLand` (set as they are recorded); the
 * beat waits for them (capped, raced
 * against the slam) and they settle to `coinIdle`. The symbol under each token is untouched: its
 * wins, its book and its anticipation never see the token. The play seam recorded the tokens before
 * this beat started (`stateOverlay`), so a flow that owns the event draws the same picture. With
 * per-reel timing a token its reel already showed has played its sound and is settling: the beat
 * waits for it alone.
 */
export const presentOverlayDrop = async (event: BookEventOfType<'overlayDrop'>) => {
	const keys = event.cells.map(({ reel, row }) => overlayTokenKey(reel, row));
	event.cells.forEach((cell, i) => {
		if (!shownWithItsReel(keys[i])) playSymbolLandSound(cell.token, 1);
	});
	await roundSkip.race(
		Promise.all(
			keys.map((key) =>
				awaitSymbolBeat((resolve) => armTokenBeat(key, resolve), TRANSIT_BEAT_CAP_MS),
			),
		),
	);
	keys.forEach(completeTokenBeat);
};

/**
 * A pot's fill takes its tokens off their cells at once, none of them flying — the Flow `liftTokens`
 * beat, for a flow that presents the fill its own way. The coded fill (`presentMeterUpdate`) instead
 * lifts each token as its own flight leaves.
 */
export const presentTokenLift = async (event: BookEventOfType<'meterUpdate'>) => {
	for (const { reel, row } of event.from) {
		const token = leavingToken(reel, row, event.meter);
		if (token) liftToken(token);
	}
};

/** A reel stopped under per-reel timing: its tokens go down with it, each with its land sound. */
export const presentReelTokens = (reel: number) => {
	for (const cell of showReelTokens(reel)) playSymbolLandSound(cell.token, 1);
};
