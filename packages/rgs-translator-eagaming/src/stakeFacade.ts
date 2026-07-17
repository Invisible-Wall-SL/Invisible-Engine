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
import { isPlay4FunError } from './types';
import type { Play4FunBookEvent, Play4FunConfigContext, Play4FunResponse } from './types';
import {
	mapSymbol,
	stakeToPlay4Fun,
	play4FunToStake,
	resolveActiveMapping,
	linesMapping,
	bookMapping,
	type GameMapping,
} from './gameMappings';

// ---------- mapping selection ----------

/** Active symbol mapping. Starts from the env hint (`PUBLIC_RGS_GAME`,
 *  defaulting to lines), then auto-corrects from the captured boot `config`
 *  event — the most reliable signal, since env exposure differs across build
 *  setups (SvelteKit routes PUBLIC_* through $env, not import.meta.env). */
let activeMapping: GameMapping = resolveActiveMapping();

/** Detect the right mapping from the server's declared symbol vocabulary.
 *  Book-of games declare royal symbols (ACE/KING/QUEEN); Hot-Fruits-style
 *  lines games declare PIC5-PIC7. Returns null if undecidable. */
const pickMappingForConfig = (cfg: Play4FunConfigContext): GameMapping | null => {
	const syms = new Set(cfg.symbols ?? []);
	if (syms.has('ACE') || syms.has('KING') || syms.has('QUEEN')) return bookMapping;
	if (syms.has('PIC5') || syms.has('PIC6') || syms.has('PIC7')) return linesMapping;
	return null;
};

// ---------- boot-config capture & defence ----------

/** Per-session snapshot of the boot `config` event the server sent. Used as
 *  the runtime source of truth for symbol whitelist + grid bounds, so that
 *  later events can be filtered/clamped instead of crashing the engine on
 *  malformed input. Only the first config event per session is retained. */
const capturedConfig = new Map<string, Play4FunConfigContext>();

/** One-shot guard so we only log the cross-check report once per session. */
const reportedSessions = new Set<string>();

/** Track unknown symbols we've already warned about, keyed by `sid:symbol`, so
 *  a malformed reveal doesn't spam the console. */
const warnedUnknownSymbols = new Set<string>();

/** Locate the `config` event in a raw Play4Fun response. */
const findConfigEvent = (events: Play4FunBookEvent[] | undefined): Play4FunConfigContext | null => {
	if (!events) return null;
	for (const e of events) {
		if (e.event === 'config') return e.context as Play4FunConfigContext;
	}
	return null;
};

/** Capture the boot config (first one wins). Returns the captured config so
 *  callers can immediately run the cross-check on the same data. */
const captureConfig = (
	sid: string,
	events: Play4FunBookEvent[] | undefined,
): Play4FunConfigContext | null => {
	if (capturedConfig.has(sid)) return capturedConfig.get(sid)!;
	const cfg = findConfigEvent(events);
	if (!cfg) return null;
	capturedConfig.set(sid, cfg);
	// Auto-select the symbol mapping from the declared vocabulary.
	const detected = pickMappingForConfig(cfg);
	if (detected) activeMapping = detected;
	return cfg;
};

/** Compare the server's declared symbol vocabulary against what `activeMapping`
 *  knows how to translate, and the declared grid against what the facade emits.
 *  Logs once per session as a console.warn; never throws. */
const runConfigCrossCheck = (sid: string, cfg: Play4FunConfigContext): void => {
	if (reportedSessions.has(sid)) return;
	reportedSessions.add(sid);

	const declared = new Set(cfg.symbols ?? []);
	const known = new Set(Object.keys(activeMapping.symbols));

	const unmapped: string[] = [];
	for (const s of declared) if (!known.has(s)) unmapped.push(s);

	const orphaned: string[] = [];
	for (const s of known) if (!declared.has(s)) orphaned.push(s);

	const gridReels = cfg.window?.reels;
	const gridRows = cfg.window?.rows;
	const gridOk = gridReels === 5 && gridRows === 3;

	const wildCount = cfg.wildSymbols?.length ?? 0;

	const lines: string[] = [];
	lines.push(`[stake-facade] config cross-check for sid=${sid}`);
	lines.push(`  grid: ${gridReels}×${gridRows}${gridOk ? ' ✓' : ' ✗ (expected 5×3)'}`);
	lines.push(`  paylines: ${cfg.paylines?.length ?? '?'} declared`);
	lines.push(
		`  wilds: ${wildCount === 0 ? 'none ✓ (no wild substitution active)' : cfg.wildSymbols!.join(', ')}`,
	);
	if (unmapped.length)
		lines.push(`  unmapped server symbols (will pass through): ${unmapped.join(', ')}`);
	if (orphaned.length)
		lines.push(`  mapping entries the server never declared: ${orphaned.join(', ')}`);

	console.warn(lines.join('\n'));
};

/** Whitelist check + warn-once for a symbol coming back in a reveal/winInfo
 *  event. Returns true if the symbol is in the server's declared vocabulary
 *  (or no config has been captured yet — fail open). */
const isKnownSymbol = (sid: string, name: string): boolean => {
	const cfg = capturedConfig.get(sid);
	if (!cfg) return true;
	if (cfg.symbols.includes(name)) return true;
	const key = `${sid}:${name}`;
	if (!warnedUnknownSymbols.has(key)) {
		warnedUnknownSymbols.add(key);
		console.warn(
			`[stake-facade] reveal contained symbol "${name}" not declared in server config — passing through`,
		);
	}
	return false;
};

/** Clamp a reveal board to the captured grid dimensions. Out-of-grid cells are
 *  dropped with a one-time log. Returns the (possibly trimmed) board. */
const clampBoardToGrid = (sid: string, board: string[][]): string[][] => {
	const cfg = capturedConfig.get(sid);
	if (!cfg?.window) return board;
	const { reels, rows } = cfg.window;
	let trimmed = false;
	const out = board.slice(0, reels).map((reel) => {
		if (reel.length > rows) {
			trimmed = true;
			return reel.slice(0, rows);
		}
		return reel;
	});
	if (board.length > reels) trimmed = true;
	if (trimmed) {
		const key = `${sid}:grid`;
		if (!warnedUnknownSymbols.has(key)) {
			warnedUnknownSymbols.add(key);
			console.warn(`[stake-facade] reveal exceeded declared grid ${reels}×${rows}, trimmed`);
		}
	}
	return out;
};

// ---------- event-vocabulary adapter ----------

/** Stake's BOOK_AMOUNT_MULTIPLIER (constants-shared/bet.ts). bookEvent amounts
 *  (setTotalWin, finalWin, winInfo wins/totalWin) are NOT absolute money
 *  amounts — they're fixed-point multipliers of the wagered bet. amount=100
 *  means "1× bet", amount=300 means "3× bet". Display = amount/100 × bet. */
const BOOK_AMOUNT_MULTIPLIER = 100;

/** Book-of games declare 10 paylines; the Play4Fun bet total = betPerLine ×
 *  this. Used to derive betPerLine from the Stake bet amount. */
const BOOK_NUM_LINES = 10;

/** Map a win (cents) + bet (cents) to a Stake winLevel (1-10). The engine's
 *  winLevelMap is keyed 1..10 — emitting 0 would yield undefined winLevelData
 *  and stall the win/outro presentation (leaving the UI hidden). 1 = zero win;
 *  6+ are the "big win" tiers. Thresholds are the win-as-bet-multiplier. */
const computeWinLevel = (winCents: number, betCents: number): number => {
	if (!betCents || winCents <= 0) return 1;
	const x = winCents / betCents; // win as a multiple of total bet
	if (x < 1.5) return 2; // standard
	if (x < 3) return 3; // small
	if (x < 6) return 4; // nice
	if (x < 10) return 5; // substantial
	if (x < 20) return 6; // BIG WIN   (lowered: ~10x+)
	if (x < 40) return 7; // SUPER WIN
	if (x < 70) return 8; // MEGA WIN
	if (x < 120) return 9; // EPIC WIN  (lowered: ~70x+)
	return 10; // MAX WIN
};

/** Opt-in trace logger. Set `localStorage.IE_DEBUG = '1'` (or `globalThis.IE_DEBUG = true`
 *  in Node) to see the cents-↔-bookEvent conversion in the browser console.
 *  Useful when win amounts on screen don't match the expected dollar value. */
const debugEnabled = (): boolean => {
	const g = globalThis as {
		IE_DEBUG?: unknown;
		localStorage?: { getItem?: (k: string) => string | null };
	};
	if (g.IE_DEBUG) return true;
	try {
		return g.localStorage?.getItem?.('IE_DEBUG') === '1';
	} catch {
		return false;
	}
};
const ieLog = (...args: unknown[]) => {
	if (debugEnabled()) console.log('[stake-facade]', ...args);
};

/** Convert a Play4Fun cents win + the round's bet (also in cents) to a Stake
 *  bookEvent amount (the bet-multiplier in fixed-point hundredths). Returns 0
 *  for a zero bet to avoid division by zero.
 *
 *  Stake's display flow (see packages/utils-shared/amount.ts):
 *    bookEventAmount / BOOK_AMOUNT_MULTIPLIER × wageredBetAmount = $-on-screen.
 *  Worked example: $2 bet, win $0.40 → bookEventAmount 20 → display $0.40 ✓.
 *  If the on-screen amount looks off by 100× or shows only decimals, the
 *  most common causes are (a) wageredBetAmount in wrong unit (should be
 *  user-display dollars), (b) betCents here = 0 so the multiplier collapses
 *  to 0 and the engine falls back to a tiny default. Enable IE_DEBUG to
 *  trace. */
const toBookEventAmount = (winCents: number, betCents: number): number => {
	if (!betCents || betCents <= 0) {
		ieLog('toBookEventAmount: betCents is 0/negative → returning 0', { winCents, betCents });
		return 0;
	}
	const result = Math.round((winCents / betCents) * BOOK_AMOUNT_MULTIPLIER);
	ieLog('toBookEventAmount', {
		winCents,
		betCents,
		result,
		displayMultiplier: result / BOOK_AMOUNT_MULTIPLIER,
	});
	return result;
};

/** Pad a 3-row reel to 5 cells (1 above + 1 below) for Stake's spin buffer. */
const padReel = (reel: string[]): string[] => {
	if (reel.length === 0) return [];
	return [reel[0], ...reel, reel[reel.length - 1]];
};

/** Normalise a spinWin's position payload into {reel,row} pairs shifted by the
 *  1-row top padding the reveal adds. Line wins carry `context.payline` (one
 *  row per reel); scatter/expanding wins carry an array of {reel,row}. */
const winPositions = (c: { mode?: string; context?: unknown }): { reel: number; row: number }[] => {
	const ctx = c.context as { payline?: number[] } | { reel: number; row: number }[] | undefined;
	if (Array.isArray(ctx)) return ctx.map((p) => ({ reel: p.reel, row: p.row + 1 }));
	const payline = (ctx as { payline?: number[] })?.payline;
	if (payline) return payline.map((row, reel) => ({ reel, row: row + 1 }));
	return [];
};

/** Translate an ordered Play4Fun event stream — base game OR a full aggregated
 *  free-spin round — into the Stake-engine book-event sequence. Processed
 *  sequentially (not bucketed) so multi-spin bonus rounds keep their order:
 *
 *    base:  reveal → winInfo×N → setTotalWin → finalWin
 *    bonus: reveal → winInfo (scatters) → freeSpinTrigger → setExpandingSymbol
 *           → [reveal → winInfo×N → updateFreeSpin]×spins
 *           → freeSpinEnd → setTotalWin → finalWin
 *
 *  Within each spin, Play4Fun emits spinWin BEFORE playedSpin; we hold the wins
 *  and flush them as winInfo right after the reveal (Stake wants board first). */
const adaptEventsForStake = (sid: string, events: Play4FunBookEvent[]): unknown[] => {
	const ordered: Record<string, unknown>[] = [];
	const push = (ev: Record<string, unknown>) => ordered.push({ index: ordered.length, ...ev });

	// The bet-multiplier denominator: win `pay` amounts are denominated against the
	// BASE bet (betPerLine × number of paylines), NOT the debited round `total`.
	// They diverge when the feature is BOUGHT — Play4Fun's `total` then includes the
	// buy premium (×100 in the book-of mock) — so dividing by `total` shrinks every
	// win display by that premium factor (a $12.50 line win reads $0.25; small base
	// wins collapse toward $0.01). Set from the `bet` event below.
	let betBaseCents = 0;
	let pendingWins: {
		what: string;
		occurs: number;
		mode?: string;
		pay: number;
		context?: unknown;
	}[] = [];
	let runningTotal = 0;
	let gameType: 'basegame' | 'freegame' = 'basegame';
	let totalFs = 0;
	let scatterTriggerPositions: { reel: number; row: number }[] = [];
	let specialRaw: string | undefined; // the free-spin expanding symbol (raw Play4Fun name)

	const flushWins = () => {
		for (const c of pendingWins) {
			const winAmount = toBookEventAmount(c.pay ?? 0, betBaseCents);
			runningTotal += winAmount;
			push({
				type: 'winInfo',
				totalWin: runningTotal,
				wins: [
					{
						symbol: mapSymbol(activeMapping, c.what),
						kind: c.occurs,
						win: winAmount,
						positions: winPositions(c),
						meta: {
							lineIndex: (c.context as { paylineId?: number })?.paylineId ?? -1,
							multiplier: 1,
							winWithoutMult: winAmount,
							globalMult: 1,
							lineMultiplier: 1,
						},
					},
				],
			});
		}
		pendingWins = [];
	};

	for (const e of events) {
		switch (e.event) {
			case 'config':
			case 'gameStart':
			case 'spinStart':
			case 'bonusWin': // wrapper around the following spinWin — pay comes from spinWin
				break;
			case 'bet': {
				// Use the BASE bet (betPerLine × paylines), not the debited `total`, so
				// win displays stay correct when the feature is BOUGHT (a premium-inflated
				// `total` would shrink every win ~100×). Both fields ship in the Play4Fun
				// `bet` event (and the book-of mock); fall back to `total` only if absent.
				const ctx = e.context as { total?: number; betPerLine?: number; paylines?: unknown[] };
				const betPerLine = typeof ctx.betPerLine === 'number' ? ctx.betPerLine : 0;
				const numLines = Array.isArray(ctx.paylines) ? ctx.paylines.length : 0;
				const baseBet = betPerLine * numLines;
				betBaseCents = baseBet > 0 ? baseBet : (ctx.total ?? 0);
				break;
			}
			case 'spinWin': {
				const c = e.context as { what: string; occurs: number; mode?: string; pay: number };
				pendingWins.push(c);
				if (c.mode === 'scatter' && c.what === 'SCAT') scatterTriggerPositions = winPositions(c);
				break;
			}
			case 'spinTrigger': {
				const spins = (e.context as { spins?: { spins?: number }[] | number })?.spins;
				totalFs = Array.isArray(spins) ? (spins[0]?.spins ?? 0) : (spins ?? 0);
				break;
			}
			case 'playedSpin': {
				const raw = (e.context as string[][]) ?? [];
				const reels = clampBoardToGrid(sid, raw).map((reel) =>
					reel.map((name) => {
						isKnownSymbol(sid, name);
						return name;
					}),
				);
				// Book-of mechanic (Book of Thermopylae): during free spins the
				// reels STOP on the NATURAL board — the special symbol sits in its
				// own single positions, NOT pre-filled columns. The reveal therefore
				// always carries the natural board (base game and free spins alike).
				push({
					type: 'reveal',
					board: reels.map((reel) =>
						padReel(reel).map((name) => ({ name: mapSymbol(activeMapping, name) })),
					),
					paddingPositions: reels.map(() => 0),
					anticipation: reels.map(() => 0),
					gameType,
				});
				// AFTER the natural board lands, if this is a free spin and 3+ of the
				// special symbol are on the board, tell the client which reels to
				// morph (every non-special cell in those reels becomes the special,
				// one cell at a time). Emitted AFTER the reveal and BEFORE the wins
				// (flushWins), so the column transform plays before any payout. Below
				// 3 specials: emit nothing — natural board, normal line pays.
				if (gameType === 'freegame' && specialRaw) {
					const specialReels: number[] = [];
					reels.forEach((reel, reelIndex) => {
						if (reel.some((name) => name === specialRaw)) specialReels.push(reelIndex);
					});
					// The special expands, and pays, on the COUNT OF REELS it covers —
					// not the raw symbol count. PIC1 (the top symbol) expands from 2
					// reels, everything else from 3. This gate MUST match the RGS gate
					// (`specialExpandsAt` in mock-rgs-server-book.mjs) so the reels that
					// morph are exactly the reels that pay.
					const minReels = specialRaw === 'PIC1' ? 2 : 3;
					if (specialReels.length >= minReels) {
						push({
							type: 'expandBookColumns',
							reels: specialReels,
							symbol: mapSymbol(activeMapping, specialRaw),
						});
					}
				}
				flushWins();
				// Bank the running total into the WIN meter after EACH free spin
				// AND on the trigger spin — a base spin that pays its own line/
				// scatter wins and then enters the bonus (spinTrigger seen, so
				// totalFs > 0, but gameType is still 'basegame' here). Without this
				// the trigger-spin payout glows via winInfo but never reaches the
				// meter: it would silently roll into the round total only at the
				// very end, reading as "shown but never paid". Emitting it now
				// credits it visibly before the free-spin intro (freeSpinTrigger)
				// takes over. runningTotal only grows, so the meter never steps back.
				if (gameType === 'freegame' || totalFs > 0) {
					push({ type: 'setTotalWin', amount: runningTotal });
				}
				break;
			}
			case 'enterBonus': {
				gameType = 'freegame';
				push({
					type: 'freeSpinTrigger',
					totalFs: totalFs || (e.context as { left?: number })?.left || 0,
					positions: scatterTriggerPositions,
				});
				break;
			}
			case 'pickRandomly': {
				const special = (e.context as { item?: { state?: string } })?.item?.state;
				if (special) {
					specialRaw = special;
					push({ type: 'setExpandingSymbol', symbol: mapSymbol(activeMapping, special) });
				}
				break;
			}
			case 'retrigger': {
				// 3+ scatters landed during a free spin → +N more spins. Emitted before
				// the spin's playedBonusSpin (→ updateFreeSpin), so the celebration shows
				// the new total before the per-spin counter tick. `total` = new played+left.
				const ctx = e.context as { spins?: number; total?: number };
				push({ type: 'freeSpinRetrigger', extraFs: ctx.spins ?? 0, total: ctx.total ?? 0 });
				break;
			}
			case 'playedBonusSpin': {
				const played = (e.context as { played?: number })?.played ?? 0;
				const left = (e.context as { left?: number })?.left ?? 0;
				push({ type: 'updateFreeSpin', amount: Math.max(0, played - 1), total: played + left });
				break;
			}
			case 'playedBonusSpins':
				break;
			case 'gameEnd': {
				const winCents = (e.context as { win?: number })?.win ?? 0;
				const amount = toBookEventAmount(winCents, betBaseCents);
				const winLevel = computeWinLevel(winCents, betBaseCents);
				if (gameType === 'freegame') {
					push({ type: 'freeSpinEnd', amount, winLevel });
					gameType = 'basegame';
				} else if (winLevel >= 6) {
					// Base-game big win (≥ BIG tier): trigger the big/mega/… win
					// presentation (setWin → Win.svelte → bigwin spine).
					push({ type: 'setWin', amount, winLevel });
				}
				push({ type: 'setTotalWin', amount });
				break;
			}
			case 'gameRoundOver':
				push({
					type: 'finalWin',
					amount: toBookEventAmount((e.context as { win?: number })?.win ?? 0, betBaseCents),
				});
				break;
			default:
				push({ type: `_${e.event}`, raw: (e as { context?: unknown }).context });
		}
	}

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

/** Stake's createPrimaryMachines runs a two-step balance update on a winning
 *  spin: requestBet returns the bet-debited (interim) balance, then
 *  requestEndRound returns the final balance with the win credited.
 *  The dramatic count-up animation rides between them.
 *
 *  Play4Fun auto-collects atomically in one round-trip, so the response
 *  already contains the post-win balance. We synthesise the Stake flow by
 *  stashing the final balance per-session and returning the interim
 *  (= final − win) from requestBet. */
const pendingFinalBalance = new Map<string, number>();

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

	// If the server sent its config as part of the boot response, capture it
	// once and run the cross-check against linesMapping + expected grid.
	const cfg = captureConfig(
		options.sessionID,
		(result.response as { events?: Play4FunBookEvent[] } | undefined)?.events,
	);
	if (cfg) runConfigCrossCheck(options.sessionID, cfg);

	const balance = balanceOf(result.response);

	return {
		status: { statusCode: 'SUCCESS' as const },
		balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		// Synthesised config so the bet UI boots. Levels in Stake API units.
		config: {
			betLevels: [
				100_000, // $0.10
				200_000, // $0.20
				500_000, // $0.50
				1_000_000, // $1.00
				2_000_000, // $2.00
				5_000_000, // $5.00
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

/** `requestBet`: receive a user-display amount (e.g. 2 for $2.00) — same as
 *  the original rgs-requests does. Convert to Play4Fun cents (×100), send
 *  bet+play (auto-collect), translate + adapt the response.
 *
 *  IMPORTANT: amount is in user-display units, NOT Stake API millions.
 *  The engine's createPrimaryMachines.ts passes stateBet.betAmount directly
 *  (e.g. 2), and the original rgs-requests multiplies by API_AMOUNT_MULTIPLIER
 *  internally before sending. Our facade does the equivalent: user-amount ×
 *  PLAY4FUN_AMOUNT_MULTIPLIER (100) → cents. */
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

	// User-display dollars → Play4Fun cents.
	const play4FunAmount = Math.max(1, Math.round(options.amount * 100));
	// A non-BASE bet mode means "buy the feature". Book-of games encode the bet
	// as [buyFlag, betPerLine] (buyFlag 1 = buy); the lines/Hot-Fruits path
	// keeps the legacy [5, betPerLine] encoding.
	const isBuy = !!options.mode && options.mode.toUpperCase() !== 'BASE';
	const betBody: ReturnType<typeof buildBetActions> =
		activeMapping === bookMapping
			? [
					{
						action: 'bet',
						context: [isBuy ? 1 : 0, Math.max(1, Math.round(play4FunAmount / BOOK_NUM_LINES))],
					},
					{ action: 'play', context: '' },
				]
			: buildBetActions({
					amount: play4FunAmount,
					mode: options.mode,
					currency: options.currency,
					betLinesOrConfig: 5,
					playContext: '',
				});

	const first = await fetcher.post({ body: betBody });

	// A bet the RGS rejects (insufficient balance, bad round state, …) comes back
	// error-shaped with NO events array. Surface the real reason: the engine
	// (createPrimaryMachines.handleRequestBet) throws when `data.error` is truthy,
	// and ModalError renders `error.error` + `error.message`. Without this the
	// empty event stream below yields a SUCCESS round with state:[] and the engine
	// throws the misleading generic "Empty state in data.round".
	if (isPlay4FunError(first.response)) {
		const raw = first.response;
		const balanceCents = raw.platform?.balance;
		return {
			status: { statusCode: `ERR_${raw.errorCode}`, statusMessage: raw.error },
			balance:
				typeof balanceCents === 'number'
					? { amount: play4FunToStake(balanceCents), currency: options.currency }
					: undefined,
			error: raw.error,
			message: `${raw.error} (code ${raw.errorCode})`,
		};
	}

	// If the server emits config on first bet (rather than at auth), capture it
	// here so subsequent reveal/win events are validated against the right
	// vocabulary + grid.
	const cfg = captureConfig(
		options.sessionID,
		(first.response as { events?: Play4FunBookEvent[] } | undefined)?.events,
	);
	if (cfg) runConfigCrossCheck(options.sessionID, cfg);

	// Aggregate the whole round into one event stream. The Stake engine consumes
	// a round as a single book; Play4Fun delivers free spins as separate `play`
	// requests, so when a bet enters the bonus we drive the remaining spins +
	// the closing `collect` here and concatenate every event.
	const allEvents: Play4FunBookEvent[] = [
		...((first.response as { events?: Play4FunBookEvent[] } | undefined)?.events ?? []),
	];
	let lastResponse: Play4FunResponse | null = first.response;

	if (allEvents.some((e) => e.event === 'enterBonus')) {
		let guard = 0;
		while (guard++ < 200) {
			const r = await fetcher.post({ body: [{ action: 'play' }] });
			const evs = (r.response as { events?: Play4FunBookEvent[] } | undefined)?.events ?? [];
			allEvents.push(...evs);
			lastResponse = r.response ?? lastResponse;
			if (evs.some((e) => e.event === 'gameEnd')) break;
		}
		const collect = await fetcher.post({ body: buildCollectAction() });
		allEvents.push(
			...((collect.response as { events?: Play4FunBookEvent[] } | undefined)?.events ?? []),
		);
		lastResponse = collect.response ?? lastResponse;
	}

	const aggregated = {
		events: allEvents,
		platform: (lastResponse as { platform?: unknown } | null)?.platform,
	} as Play4FunResponse;
	const stake = translateBetResponse(aggregated, options.currency);

	// Two-step balance: interim (bet debited, win NOT yet credited) now; final
	// stashed for requestEndRound to return after the count-up animation.
	const finalCents =
		(lastResponse as { platform?: { balance?: number } } | null)?.platform?.balance ?? 0;
	const winCents =
		(allEvents.find((e) => e.event === 'gameEnd')?.context as { win?: number } | undefined)?.win ??
		0;
	const interimCents = finalCents - winCents;
	pendingFinalBalance.set(options.sessionID, finalCents);

	if (stake.balance) {
		stake.balance = { ...stake.balance, amount: play4FunToStake(interimCents) };
	}
	if (stake.round) {
		if (typeof stake.round.amount === 'number') {
			stake.round.amount = play4FunToStake(stake.round.amount);
		}
		if (typeof stake.round.payout === 'number') {
			stake.round.payout = play4FunToStake(stake.round.payout);
		}
		if (stake.round.state) {
			stake.round.state = adaptEventsForStake(options.sessionID, stake.round.state) as never;
		}
	}

	return stake;
};

export const requestEndRound = async (options: { sessionID: string; rgsUrl: string }) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);

	// If we have a stashed final balance from the most recent winning bet,
	// return it now (this is the moment the engine wants to credit the win
	// to the player's displayed balance, after the count-up animation).
	const stashed = pendingFinalBalance.get(options.sessionID);
	if (stashed !== undefined) {
		pendingFinalBalance.delete(options.sessionID);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: { amount: play4FunToStake(stashed), currency: 'USD' },
		};
	}

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
	throw new Error('rgs-translator-eagaming: replay not implemented for Play4Fun protocol yet');
};

export const getSessionState = (sid: string): Play4FunSessionState | undefined => sessions.get(sid);
