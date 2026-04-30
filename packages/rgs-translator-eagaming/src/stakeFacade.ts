/**
 * Stake-shaped facade.
 *
 * Re-exports the function surface of `rgs-requests` (`requestAuthenticate`,
 * `requestBet`, `requestEndRound`, `requestEndEvent`, `requestReplay`) but
 * powered internally by the Play4Fun /rgs/engine protocol via this package's
 * own translator + fetcher.
 *
 * Use as a Vite alias drop-in to make any Stake Engine game speak Play4Fun
 * without touching the game code itself:
 *
 *   resolve.alias['rgs-requests'] = 'rgs-translator-eagaming/stake-facade'
 *
 * Sessions are kept module-local and keyed by sessionID, so seq/gid lifecycle
 * is preserved across calls within the same playing session.
 */

import { createPlay4FunSessionState, type Play4FunSessionState } from './sessionState';
import { createPlay4FunFetcher } from './eagamingFetcher';
import {
	buildBetActions,
	buildHeartbeat,
	buildCollectAction,
	translateBetResponse,
	responseClosedRound,
} from './translator';
import type { Play4FunBookEvent } from './types';

// ---------- event-vocabulary adapter ----------

/** Minimal mapping from Play4Fun events to a Stake-engine-style book-event
 *  shape (`{ index, type, ...payload }`).
 *
 *  Reordering note: Play4Fun emits `spinWin` events BEFORE `playedSpin`,
 *  but Stake renderers expect `reveal` (the board) before `winInfo` (the
 *  wins on that board). So we collect events into buckets by kind and
 *  emit them in Stake-friendly order:
 *
 *    [_bet, _gameStart, _spinStart, reveal, winInfo×N, setTotalWin, finalWin]
 *
 *  Unknown events pass through with type=`_<name>` for opt-in per-game
 *  handling. Free-spin / scatter / bonus mappings will need per-game
 *  extension when we encounter them in real captures. */
const adaptEventsForStake = (events: Play4FunBookEvent[]): unknown[] => {
	const meta: Record<string, unknown>[] = []; // _bet/_gameStart/_spinStart pass-through
	let revealEvent: Record<string, unknown> | null = null;
	const wins: { context: unknown }[] = [];
	let setTotalWinAmount: number | null = null;
	let finalWinAmount: number | null = null;
	const passthrough: Record<string, unknown>[] = [];

	for (const e of events) {
		switch (e.event) {
			case 'bet':
			case 'gameStart':
			case 'spinStart':
				meta.push({ type: `_${e.event}`, raw: e.context });
				break;
			case 'playedSpin': {
				const reels = (e.context as string[][]) ?? [];
				revealEvent = {
					type: 'reveal',
					board: reels.map((reel) => reel.map((name) => ({ name }))),
					paddingPositions: reels.map(() => 0),
					anticipation: [],
					gameType: 'basegame',
				};
				break;
			}
			case 'spinWin': {
				wins.push({ context: e.context });
				break;
			}
			case 'gameEnd': {
				setTotalWinAmount = (e.context as { win?: number })?.win ?? 0;
				break;
			}
			case 'gameRoundOver': {
				finalWinAmount = (e.context as { win?: number })?.win ?? 0;
				break;
			}
			default:
				passthrough.push({
					type: `_${e.event}`,
					raw: (e as { context?: unknown }).context,
				});
		}
	}

	const ordered: Record<string, unknown>[] = [];
	const push = (ev: Record<string, unknown>) => {
		ordered.push({ index: ordered.length, ...ev });
	};

	meta.forEach(push);
	if (revealEvent) push(revealEvent);

	let runningTotal = 0;
	for (const w of wins) {
		const c = w.context as {
			what: string; occurs: number; pay: number;
			context?: { paylineId?: number; payline?: number[] };
		};
		runningTotal += c.pay ?? 0;
		push({
			type: 'winInfo',
			totalWin: runningTotal,
			wins: [
				{
					symbol: c.what,
					kind: c.occurs,
					win: c.pay,
					positions: c.context?.payline?.map((row, reel) => ({ reel, row })) ?? [],
					meta: {
						lineIndex: c.context?.paylineId ?? -1,
						multiplier: 1,
						winWithoutMult: c.pay,
						globalMult: 1,
						lineMultiplier: 1,
					},
				},
			],
		});
	}

	if (setTotalWinAmount !== null) push({ type: 'setTotalWin', amount: setTotalWinAmount });
	if (finalWinAmount !== null) push({ type: 'finalWin', amount: finalWinAmount });
	passthrough.forEach(push);

	return ordered;
};

// ---------- session registry ----------

const sessions = new Map<string, Play4FunSessionState>();
const sessionFor = (sid: string) => {
	let s = sessions.get(sid);
	if (!s) {
		s = createPlay4FunSessionState(sid);
		sessions.set(sid, s);
	}
	return s;
};

// ---------- url helpers ----------

/** Accept either bare hosts (e.g. 'engine.stake.com') or full URLs.
 *  When bare, default to https. Localhost is allowed for the mock. */
const buildBaseUrl = (rgsUrl: string): string => {
	if (!rgsUrl) return '';
	if (rgsUrl.startsWith('http://') || rgsUrl.startsWith('https://')) return rgsUrl;
	if (rgsUrl.startsWith('localhost') || rgsUrl.startsWith('127.0.0.1')) {
		return `http://${rgsUrl}`;
	}
	return `https://${rgsUrl}`;
};

const fetcherFor = (sid: string, rgsUrl: string) =>
	createPlay4FunFetcher({ baseUrl: buildBaseUrl(rgsUrl), sid }, sessionFor(sid));

// ---------- public API (matches rgs-requests) ----------

/** Stake's `requestAuthenticate` returns balance, round, config, jurisdiction.
 *  Play4Fun has no equivalent endpoint — we send a heartbeat to get the
 *  balance and synthesize a sensible default config so the game UI boots. */
export const requestAuthenticate = async (options: {
	sessionID: string;
	rgsUrl: string;
	language: string;
}) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);
	const result = await fetcher.post({ body: buildHeartbeat() });

	// Surface server errors through the Stake-shaped envelope.
	if (result.response && (result.response as { error?: unknown }).error) {
		const raw = result.response as { error: string; errorCode?: number };
		return {
			status: { statusCode: `ERR_${raw.errorCode ?? 'UE'}`, statusMessage: raw.error },
			error: raw,
		};
	}

	const balance =
		result.response && 'platform' in result.response
			? result.response.platform?.balance
			: undefined;

	return {
		status: { statusCode: 'SUCCESS' as const },
		balance:
			typeof balance === 'number'
				? { amount: balance, currency: 'USD' }
				: undefined,
		// Play4Fun doesn't expose betLevels/betModes via this endpoint. Synthesize
		// a reasonable default so the bet selector renders. Operators can
		// override these via env if a per-game config endpoint is wired later.
		config: {
			betLevels: [50, 100, 200, 400, 1000, 2000, 5000, 10000],
			betModes: { BASE: { mode: 'BASE', costMultiplier: 1, feature: false } },
			defaultBetLevel: 10,
			jurisdiction: {
				socialCasino: false,
				disabledFullscreen: false,
				disabledTurbo: false,
				disabledSuperTurbo: false,
				disabledAutoplay: false,
				disabledSlamstop: false,
				disabledSpacebar: false,
				disabledBuyFeature: true, // Play4Fun lacks feature-buy; safer to disable
				displayNetPosition: false,
				displayRTP: false,
				displaySessionTimer: false,
				minimumRoundDuration: 0,
			},
		},
		// No "in-flight bet to resume" concept on Play4Fun — auto-collect by
		// default. If we later add manual-collect resumption, populate this.
		round: undefined,
		_session: session.snapshot(),
	};
};

/** Stake's `requestBet` debits the player and returns the round events.
 *  We send a Play4Fun bet+play (auto-collect) and translate the response,
 *  then run the events through the Stake-vocabulary adapter so the game's
 *  renderers see `reveal` / `winInfo` / `setTotalWin` / `finalWin`. */
export const requestBet = async (options: {
	sessionID: string;
	currency: string;
	amount: number;
	mode: string;
	rgsUrl: string;
}) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);
	session.startRound();

	const result = await fetcher.post({
		body: buildBetActions({
			amount: options.amount,
			mode: options.mode,
			currency: options.currency,
			betLinesOrConfig: 5,
			playContext: '', // auto-collect — round closes in one round-trip
		}),
	});

	const stake = translateBetResponse(result.response, options.currency);
	if (stake.round?.state) {
		// Replace the raw Play4Fun events with their Stake-vocab equivalents.
		stake.round.state = adaptEventsForStake(stake.round.state) as never;
	}
	return stake;
};

/** Stake's `requestEndRound` closes a round and returns the new balance.
 *  Play4Fun auto-closes rounds with `play.context=''`, so we just heartbeat
 *  to fetch the current balance for the engine's bookkeeping. If the
 *  session somehow has an open round (manual mode), send `collect` first. */
export const requestEndRound = async (options: {
	sessionID: string;
	rgsUrl: string;
}) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);

	if (session.gid) {
		// Open round → close it explicitly.
		const collectResult = await fetcher.post({ body: buildCollectAction() });
		const collectBalance =
			collectResult.response && 'platform' in collectResult.response
				? collectResult.response.platform?.balance
				: undefined;
		if (responseClosedRound(collectResult.response)) session.endRound();
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance:
				typeof collectBalance === 'number'
					? { amount: collectBalance, currency: 'USD' }
					: undefined,
		};
	}

	// No open round → heartbeat for the latest balance.
	const result = await fetcher.post({ body: buildHeartbeat() });
	const balance =
		result.response && 'platform' in result.response
			? result.response.platform?.balance
			: undefined;
	return {
		status: { statusCode: 'SUCCESS' as const },
		balance:
			typeof balance === 'number'
				? { amount: balance, currency: 'USD' }
				: undefined,
	};
};

/** Stake's `requestEndEvent` records progress server-side. Play4Fun has no
 *  equivalent — events are sent in the response, not tracked separately.
 *  No-op that returns SUCCESS so the engine's bookkeeping stays happy. */
export const requestEndEvent = async (options: {
	sessionID: string;
	eventIndex: number;
	rgsUrl: string;
}) => {
	void options; // unused — the call is a no-op against Play4Fun
	return {
		status: { statusCode: 'SUCCESS' as const },
		event: String(options.eventIndex),
	};
};

/** Stake's `requestReplay` returns a historical bet for read-only playback.
 *  Play4Fun doesn't expose replay through `/rgs/engine` — would require a
 *  separate endpoint we haven't observed. Stub for now; throws so the calling
 *  Authenticate.svelte falls through to the empty-state branch. */
export const requestReplay = async (options: {
	game: string;
	version: string;
	mode: string;
	event: string;
	rgsUrl: string;
}): Promise<never> => {
	void options;
	throw new Error(
		'rgs-translator-eagaming: replay not implemented for Play4Fun protocol yet',
	);
};

// ---------- escape hatch ----------

/** Get the underlying session state for a sid (escape hatch for tests + the
 *  demo overlay). Returns undefined if no session has been created yet. */
export const getSessionState = (sid: string): Play4FunSessionState | undefined =>
	sessions.get(sid);
