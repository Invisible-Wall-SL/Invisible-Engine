/**
 * Stake-shaped facade.
 *
 * Re-exports the function surface of `rgs-requests` (`requestAuthenticate`,
 * `requestBet`, `requestEndRound`, `requestEndEvent`, `requestReplay`) but
 * powered internally by the Play4Fun /rgs/engine protocol via this package's
 * own translator + fetcher.
 *
 * All cross-protocol translation lives here so the upstream Play4Fun source
 * (mock or real backend) can stay protocol-faithful:
 *
 *   - Symbol vocabulary: PIC1-PIC7/SCAT (Play4Fun) → H1-H5/L1-L5/S (Stake)
 *     via gameMappings.linesMapping
 *   - Amount scaling: integer cents (Play4Fun) ↔ millions (Stake API)
 *     via stakeToPlay4Fun / play4FunToStake
 *   - Event vocabulary: bet/play/spinWin/playedSpin/gameEnd → reveal/
 *     winInfo/setTotalWin/finalWin via adaptEventsForStake
 *
 * Use as a Vite alias drop-in to make any Stake Engine game speak Play4Fun
 * without touching the game code itself:
 *
 *   resolve.alias['rgs-requests'] = '<absolute path to>/stake-facade.ts'
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
import {
	linesMapping,
	mapSymbol,
	stakeToPlay4Fun,
	play4FunToStake,
	type GameMapping,
} from './gameMappings';

// ---------- mapping selection ----------

/** Currently hard-coded to the lines mapping. To target a different Stake
 *  Engine game, swap this for a different mapping (or read from env). */
const activeMapping: GameMapping = linesMapping;

// ---------- event-vocabulary adapter ----------

/** Mapping from Play4Fun events to a Stake-engine-style book-event shape
 *  (`{ index, type, ...payload }`).
 *
 *  Reordering: Play4Fun emits `spinWin` events BEFORE `playedSpin`, but
 *  Stake renderers expect `reveal` (the board) before `winInfo` (the wins
 *  on that board). Collect into buckets, emit in Stake-friendly order:
 *
 *    [reveal, winInfo×N, setTotalWin, finalWin, _<unknown>×N]
 *
 *  Symbols on the board and inside winInfo are passed through the active
 *  mapping (Play4Fun → game-specific names). Win amounts are scaled from
 *  Play4Fun cents to Stake API millions. */
const adaptEventsForStake = (events: Play4FunBookEvent[]): unknown[] => {
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
				// Server-side bookkeeping events with no Stake renderer
				// equivalent — drop silently. Raw data is still in the
				// response if a custom handler ever needs it.
				break;
			case 'playedSpin': {
				const reels = (e.context as string[][]) ?? [];
				revealEvent = {
					type: 'reveal',
					board: reels.map((reel) =>
						reel.map((name) => ({ name: mapSymbol(activeMapping, name) })),
					),
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
				setTotalWinAmount = play4FunToStake((e.context as { win?: number })?.win ?? 0);
				break;
			}
			case 'gameRoundOver': {
				finalWinAmount = play4FunToStake((e.context as { win?: number })?.win ?? 0);
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

	if (revealEvent) push(revealEvent);

	let runningTotal = 0;
	for (const w of wins) {
		const c = w.context as {
			what: string;
			occurs: number;
			pay: number;
			context?: { paylineId?: number; payline?: number[] };
		};
		const winAmount = play4FunToStake(c.pay ?? 0);
		runningTotal += winAmount;
		push({
			type: 'winInfo',
			totalWin: runningTotal,
			wins: [
				{
					symbol: mapSymbol(activeMapping, c.what),
					kind: c.occurs,
					win: winAmount,
					positions: c.context?.payline?.map((row, reel) => ({ reel, row })) ?? [],
					meta: {
						lineIndex: c.context?.paylineId ?? -1,
						multiplier: 1,
						winWithoutMult: winAmount,
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

// ---------- balance helpers ----------

/** Pull the Play4Fun balance from a response and scale up to Stake units. */
const balanceOf = (response: unknown): number | undefined => {
	if (!response || typeof response !== 'object') return undefined;
	const p4f = (response as { platform?: { balance?: number } }).platform?.balance;
	return typeof p4f === 'number' ? play4FunToStake(p4f) : undefined;
};

// ---------- public API (matches rgs-requests) ----------

export const requestAuthenticate = async (options: {
	sessionID: string;
	rgsUrl: string;
	language: string;
}) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);
	const result = await fetcher.post({ body: buildHeartbeat() });

	if (result.response && (result.response as { error?: unknown }).error) {
		const raw = result.response as { error: string; errorCode?: number };
		return {
			status: { statusCode: `ERR_${raw.errorCode ?? 'UE'}`, statusMessage: raw.error },
			error: raw,
		};
	}

	const balance = balanceOf(result.response);

	return {
		status: { statusCode: 'SUCCESS' as const },
		balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		// Synthesised config so the bet UI boots. Levels in Stake API units.
		config: {
			betLevels: [
				100_000,    // $0.10
				200_000,    // $0.20
				500_000,    // $0.50
				1_000_000,  // $1.00
				2_000_000,  // $2.00
				5_000_000,  // $5.00
				10_000_000, // $10.00
				50_000_000, // $50.00
				100_000_000, // $100.00
			],
			betModes: { BASE: { mode: 'BASE', costMultiplier: 1, feature: false } },
			defaultBetLevel: 1_000_000,
			jurisdiction: {
				socialCasino: false,
				disabledFullscreen: false,
				disabledTurbo: false,
				disabledSuperTurbo: false,
				disabledAutoplay: false,
				disabledSlamstop: false,
				disabledSpacebar: false,
				disabledBuyFeature: true,
				displayNetPosition: false,
				displayRTP: false,
				displaySessionTimer: false,
				minimumRoundDuration: 0,
			},
		},
		round: undefined,
		_session: session.snapshot(),
	};
};

/** `requestBet`: receive a Stake-units amount, convert to Play4Fun cents,
 *  send bet+play (auto-collect), translate + adapt the response. */
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

	const play4FunAmount = stakeToPlay4Fun(options.amount);
	const result = await fetcher.post({
		body: buildBetActions({
			amount: play4FunAmount,
			mode: options.mode,
			currency: options.currency,
			betLinesOrConfig: 5,
			playContext: '',
		}),
	});

	const stake = translateBetResponse(result.response, options.currency);

	// Scale balance + round amounts from Play4Fun cents to Stake API units.
	if (stake.balance) {
		stake.balance = { ...stake.balance, amount: play4FunToStake(stake.balance.amount) };
	}
	if (stake.round) {
		if (typeof stake.round.amount === 'number') {
			stake.round.amount = play4FunToStake(stake.round.amount);
		}
		if (typeof stake.round.payout === 'number') {
			stake.round.payout = play4FunToStake(stake.round.payout);
		}
		// payoutMultiplier is a ratio — unaffected by amount scaling.
		if (stake.round.state) {
			stake.round.state = adaptEventsForStake(stake.round.state) as never;
		}
	}

	return stake;
};

export const requestEndRound = async (options: { sessionID: string; rgsUrl: string }) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);

	if (session.gid) {
		const collectResult = await fetcher.post({ body: buildCollectAction() });
		if (responseClosedRound(collectResult.response)) session.endRound();
		const balance = balanceOf(collectResult.response);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		};
	}

	const result = await fetcher.post({ body: buildHeartbeat() });
	const balance = balanceOf(result.response);
	return {
		status: { statusCode: 'SUCCESS' as const },
		balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
	};
};

export const requestEndEvent = async (options: {
	sessionID: string;
	eventIndex: number;
	rgsUrl: string;
}) => {
	void options;
	return {
		status: { statusCode: 'SUCCESS' as const },
		event: String(options.eventIndex),
	};
};

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

export const getSessionState = (sid: string): Play4FunSessionState | undefined =>
	sessions.get(sid);
