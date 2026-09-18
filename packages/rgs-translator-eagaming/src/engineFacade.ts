/**
 * Engine-shaped facade.
 *
 * Re-exports the function surface of `rgs-requests` (`requestAuthenticate`,
 * `requestBet`, `requestEndRound`, `requestEndEvent`, `requestReplay`) but
 * powered internally by the Play4Fun /rgs/engine protocol via this package's
 * own translator + fetcher.
 *
 * All cross-protocol translation lives here so the upstream Play4Fun source
 * (mock or real backend) can stay protocol-faithful:
 *
 *   - Symbol vocabulary: PIC1-PIC7/SCAT (Play4Fun) → H1-H5/L1-L5/S (engine)
 *     via gameMappings.linesMapping
 *   - Amount scaling: integer cents (Play4Fun) ↔ millions (engine API)
 *     via engineToPlay4Fun / play4FunToEngine
 *   - Event vocabulary: bet/play/spinWin/playedSpin/gameEnd → reveal/
 *     winInfo/setTotalWin/finalWin via adaptEventsForEngine
 *
 * Use as a Vite alias drop-in to make any Invisible Engine game speak Play4Fun
 * without touching the game code itself:
 *
 *   resolve.alias['rgs-requests'] = '<absolute path to>/engine-facade.ts'
 *
 * Sessions are kept module-local and keyed by sessionID, so seq/gid lifecycle
 * is preserved across calls within the same playing session.
 */

import { getDeliveryProfile, hostBoolean, hostServicePath } from 'delivery-profile';

import {
	betOptionCostRatios,
	betOptionIndexFor,
	buildBetLadder,
	multiplierForAmount,
	readHostBetSettings,
	readServerBetOptions,
	serverBetOptionEntries,
	type ServerBetOptions,
} from './betOptions';
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
	engineToPlay4Fun,
	play4FunToEngine,
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

/** Per-session bet-option table (`betOptions` / `betOptionsName` / `gameCost`) from the boot config.
 *  Absent for a server that declares none — the gate for the whole config-driven bet path. */
const capturedBetOptions = new Map<string, ServerBetOptions>();

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

/**
 * Publish the server's DECLARED boot config to a global the ENGINE reads
 * (`engine-game`'s `gameConfig.ts` → `serverConfig()`). The SAME decoupled-global rationale as
 * `__IE_WIN_LEVELS__` (below): the facade is a drop-in for `rgs-requests` and cannot import the app,
 * so a global is the only bridge. It makes the RGS's own declaration SERVER-AUTHORITATIVE for the
 * game's derived display data — paylines / line count, the in-play symbol GATE, the cosmetic reel
 * strips, per-line colour indexing, anticipation reach — instead of the compiled/authored template.
 * Only the three fields the engine reads (`availablePayLines`, `symbols`, `window`).
 * Never written when no `config` event arrives ⇒ the global stays undefined ⇒ every engine accessor
 * falls back to the authored doc, byte-identical to before (parity).
 *
 * `symbols` is mapped through `activeMapping` FIRST — the reveal board, wins and the whole engine
 * run in ENGINE client-symbol space (`H1`/`L1`/`S`), never the server's raw vocabulary
 * (`PIC1`/`ACE`/`SCAT`), because `mapSymbol` translates every reveal cell (see the `reveal` push).
 * Publishing the raw names would make the in-play GATE and the auto-generated strips speak a
 * vocabulary the client dictionary and symbol-art map don't know — a blank paytable and undrawable
 * reels. `availablePayLines` (row indices per reel) is symbol-agnostic, so it is NOT mapped. */
type EngineServerConfig = {
	availablePayLines: number[][];
	symbols: string[];
	window?: { reels: number; rows: number };
};

const publishServerConfig = (cfg: Play4FunConfigContext): void => {
	const mapNames = (names: unknown): string[] =>
		Array.isArray(names) ? [...new Set(names.map((n) => mapSymbol(activeMapping, n)))] : [];
	(globalThis as { __IE_SERVER_CONFIG__?: EngineServerConfig }).__IE_SERVER_CONFIG__ = {
		availablePayLines: Array.isArray(cfg.availablePayLines) ? cfg.availablePayLines : [],
		symbols: mapNames(cfg.symbols),
		window: cfg.window,
	};
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
	// Bridge the server's declaration to the engine so paylines/in-play/strips/colours follow it.
	publishServerConfig(cfg);
	// The bet-option table, when the server declares one. Null leaves every bet path on the legacy
	// encoding, which is what both mocks (and every server before this one) need.
	const options = readServerBetOptions(cfg);
	if (options) {
		capturedBetOptions.set(sid, options);
		publishServerBetOptions(options);
	}
	return cfg;
};

/**
 * Publish the server's options to a global the GAME's bet menu reads
 * (`apps/lines/src/game/betModeMeta.ts`). Same decoupled-global bridge as `__IE_SERVER_CONFIG__` —
 * the facade is a drop-in for `rgs-requests` and cannot import the app.
 *
 * This is what makes the menu SERVER-AUTHORITATIVE rather than merely cross-checked: the game
 * offers the options the math declares and no others, so a card can never advertise a price the
 * wallet will refuse. Never written when the server declares no table ⇒ the global stays undefined
 * ⇒ the game keeps its authored menu, byte-identical to before.
 */
const publishServerBetOptions = (options: ServerBetOptions): void => {
	(
		globalThis as { __IE_SERVER_BET_OPTIONS__?: ReturnType<typeof serverBetOptionEntries> }
	).__IE_SERVER_BET_OPTIONS__ = serverBetOptionEntries(options);
};

/** The server's bet-option table for a session, or null on a server that declares none. */
const betOptionsFor = (sid: string): ServerBetOptions | null => capturedBetOptions.get(sid) ?? null;

/** Modes already reported as unexpressible, keyed `sid:MODE`, so one bet per spin doesn't spam. */
const warnedModes = new Set<string>();

/**
 * The game asked for a bet mode the server's option table cannot name, so this bet fell back to the
 * legacy encoding. Loud because the two disagree about what the game IS: Book of Borut offers three
 * buy cards against a `["0:base","1:buybonus"]` table, and only the math can settle which is right.
 */
const warnUnexpressibleMode = (sid: string, mode: string): void => {
	const key = `${sid}:${mode.toUpperCase()}`;
	if (warnedModes.has(key)) return;
	warnedModes.add(key);
	console.warn(
		`[engine-facade] bet mode "${mode}" has no matching server bet option — sent the legacy bet ` +
			`encoding for it. The server's table cannot price this mode; either the math needs an ` +
			`option for it or the game should not offer it.`,
	);
};

/**
 * The jurisdiction flags the operator's embed page declared, in the engine's vocabulary.
 *
 * Until now this block was INVENTED — a hardcoded set the client chose for itself, which is wrong
 * twice over against a real operator: turbo, autoplay and the buy feature are things a licence
 * decides, not a game. Their `GameSettings.config` states them, so read them.
 *
 * Only keys the operator actually stated are returned, so a launch outside an embed page (every
 * game we run today) is untouched.
 */
const hostJurisdiction = (): Record<string, boolean> => {
	const out: Record<string, boolean> = {};
	const enableTurbo = hostBoolean('enableTurbo');
	if (enableTurbo !== null) out.disabledTurbo = !enableTurbo;
	const allowOutcomeBuy = hostBoolean('allowOutcomeBuy');
	if (allowOutcomeBuy !== null) out.disabledBuyFeature = !allowOutcomeBuy;
	const showTheoreticalPayback = hostBoolean('showTheoreticalPayback');
	if (showTheoreticalPayback !== null) out.displayRTP = showTheoreticalPayback;
	return out;
};

/** The server's bet options in the engine's `betModes` shape. `feature` marks anything that costs
 *  more than a base spin — an ante and a buy are both "not the plain bet". */
const betModesFromOptions = (
	options: ServerBetOptions,
): Record<string, { mode: string; costMultiplier: number; feature: boolean }> => {
	const out: Record<string, { mode: string; costMultiplier: number; feature: boolean }> = {};
	for (const [key, ratio] of Object.entries(betOptionCostRatios(options))) {
		const mode = key.toUpperCase();
		out[mode] = { mode, costMultiplier: ratio, feature: ratio > 1 };
	}
	return out;
};

/**
 * The payline set the server DECLARED for this session, or null before the boot `config` event lands.
 *
 * The real Play4Fun wire field is `availablePayLines`; our mocks emit `paylines` in the same event.
 * One home for that alias because two call sites need it: the bet's line count (below) and a win's
 * `meta.lineIndex` ordinal (`adaptEventsForEngine`).
 */
const declaredPayLines = (sid: string): number[][] | null => {
	const cfg = capturedConfig.get(sid) as
		| { availablePayLines?: number[][]; paylines?: number[][] }
		| undefined;
	const lines = cfg?.availablePayLines ?? cfg?.paylines;
	return Array.isArray(lines) ? lines : null;
};

/**
 * How many lines this bet buys — the `a` in the wire's `bet` context `[a, betPerLine]`, where the
 * stake is `a × betPerLine`.
 *
 * This USED to be a hardcoded 5, which was right only for Hot Fruits (a 5-line game) and silently
 * wrong everywhere else. The server evaluates and declares its OWN payline set, and both sides then
 * derive the per-line stake from a different number: the shared `lines` config default has 20 lines,
 * so the client bought "5 lines" while the server paid 20 and the facade normalised wins against
 * `betPerLine × 20` — every win displayed at a QUARTER of the multiplier the wallet credited.
 *
 * A model with no lines (cluster, scatter-pays) declares an empty set and buys ONE unit: `betPerLine`
 * is then the whole stake, which is exactly what `payoutDivisor()` returning 1 means on the client.
 *
 * Falls back to 5 only when no config has been captured (a server that sends none) — the legacy
 * behaviour, kept so an unknown server degrades rather than divides by a guess.
 */
const betLineCount = (sid: string): number => {
	const lines = declaredPayLines(sid);
	if (!lines) return 5;
	return Math.max(1, lines.length);
};

/** Warn once per session when integer-cent `betPerLine` rounding makes the charged stake differ from
 *  the level the player picked. LEGACY-ENCODING ONLY: `context[0]` is a line count only there, so
 *  `[0] × [1]` is only the stake there. See the call site in `requestBet` for the ladder problem. */
const warnedStakeRounding = new Set<string>();
const warnOnStakeRounding = (
	sid: string,
	body: { action: string; context?: unknown }[],
	requestedCents: number,
): void => {
	const bet = body.find((a) => a.action === 'bet')?.context;
	if (!Array.isArray(bet)) return;
	const charged = (Number(bet[0]) || 0) * (Number(bet[1]) || 0);
	if (charged === requestedCents || warnedStakeRounding.has(sid)) return;
	warnedStakeRounding.add(sid);
	console.warn(
		`[engine-facade] bet of ${requestedCents} cents does not divide evenly across ${bet[0]} ` +
			`line(s), so this spin costs ${charged} cents. Wins stay correct (they are normalised ` +
			`against the stake the server charged); pick bet levels that are multiples of the line count.`,
	);
};

/** Compare the server's declared symbol vocabulary against what `activeMapping`
 *  knows how to translate, and the declared grid against what the facade emits.
 *  Logs once per session as a console.warn; never throws. */
const runConfigCrossCheck = (sid: string, cfg: Play4FunConfigContext): void => {
	if (reportedSessions.has(sid)) return;
	reportedSessions.add(sid);

	const declared = new Set(cfg.symbols ?? []);
	const known = new Set(Object.keys(activeMapping.symbols));

	const unmapped = [...declared].filter((s) => !known.has(s));
	const orphaned = [...known].filter((s) => !declared.has(s));

	// The declared grid is whatever the game's config says now (Invisible Game Config drives the
	// mock's numReels/numRows), so there is no fixed "expected" size to flag — a 6×4 board is as
	// valid as 5×3. The cross-check is about SYMBOL vocabulary, the one thing the facade must map;
	// the grid dimensions flow through untouched (`padReel` adds ±1 for any row count).

	// Only surface the cross-check when something is actually WRONG. A healthy config
	// previously dumped a full multi-line report (grid/paylines/wilds) to the console
	// EVERY session — pure noise in a shipped game. Stay silent when all checks pass.
	// The server's own buy/ante prices vs the ones the game's config authored. The buy CARD shows
	// `betAmount × costMultiplier` from the authored config while the CHARGE is now the server's
	// `betOptions[x] × M`, so a disagreement is a card advertising a price the wallet will not take.
	// Reported rather than corrected: the math is the server's, but which of the two is wrong is a
	// decision for whoever authored the config.
	const priceDrift: string[] = [];
	const options = betOptionsFor(sid);
	const authoredCosts = (globalThis as { __IE_BET_MODES__?: Record<string, number> })
		.__IE_BET_MODES__;
	if (options && authoredCosts) {
		const serverRatios = betOptionCostRatios(options);
		for (const [mode, authored] of Object.entries(authoredCosts)) {
			const key = mode.replace(/[^a-z0-9]/gi, '').toLowerCase();
			const fromServer = serverRatios[key];
			if (fromServer === undefined) {
				// A paid mode the math never declared. The commoner failure by far, and the one that
				// cannot be fixed by picking a side: the server simply cannot price this card.
				if (authored > 1) priceDrift.push(`  ${mode}: ${authored}× card, no server bet option`);
			} else if (Math.abs(fromServer - authored) > 0.001) {
				priceDrift.push(`  ${mode}: config says ${authored}×, server charges ${fromServer}×`);
			}
		}
	}

	if (!unmapped.length && !orphaned.length && !priceDrift.length) return;

	const lines: string[] = [`[engine-facade] config cross-check for sid=${sid}`];
	if (unmapped.length)
		lines.push(`  unmapped server symbols (will pass through): ${unmapped.join(', ')}`);
	if (orphaned.length)
		lines.push(`  mapping entries the server never declared: ${orphaned.join(', ')}`);
	if (priceDrift.length) lines.push('  bet-mode price drift (card vs charge):', ...priceDrift);

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
			`[engine-facade] reveal contained symbol "${name}" not declared in server config — passing through`,
		);
	}
	return false;
};

/** Clamp a reveal board to the captured grid dimensions. Out-of-grid cells are
 *  dropped with a one-time log. Returns the (possibly trimmed) board. */
const clampBoardToGrid = (sid: string, board: string[][]): string[][] => {
	const cfg = capturedConfig.get(sid);
	if (!cfg?.window) return board;
	const { reels, rows, rowsPerReel } = cfg.window;
	let trimmed = false;
	// A STEPPED board is clamped per COLUMN. Clamping it to the bounding box would let a reel dealt
	// full height survive into a short column, where the client would seat rows the server never
	// scored — the client board silently diverging from the scored board, which is the most
	// expensive class of bug this layer can produce. Absent ⇒ the board-wide clamp, unchanged.
	const limitFor = (reel: number) =>
		rowsPerReel && rowsPerReel[reel] !== undefined ? rowsPerReel[reel] : rows;
	const out = board.slice(0, reels).map((reel, index) => {
		const limit = limitFor(index);
		if (reel.length > limit) {
			trimmed = true;
			return reel.slice(0, limit);
		}
		return reel;
	});
	if (board.length > reels) trimmed = true;
	if (trimmed) {
		const key = `${sid}:grid`;
		if (!warnedUnknownSymbols.has(key)) {
			warnedUnknownSymbols.add(key);
			console.warn(`[engine-facade] reveal exceeded declared grid ${reels}×${rows}, trimmed`);
		}
	}
	return out;
};

// ---------- event-vocabulary adapter ----------

/** The engine's BOOK_AMOUNT_MULTIPLIER (constants-shared/bet.ts). bookEvent amounts
 *  (setTotalWin, finalWin, winInfo wins/totalWin) are NOT absolute money
 *  amounts — they're fixed-point multipliers of the wagered bet. amount=100
 *  means "1× bet", amount=300 means "3× bet". Display = amount/100 × bet. */
const BOOK_AMOUNT_MULTIPLIER = 100;

/** Book-of games declare 10 paylines; the Play4Fun bet total = betPerLine ×
 *  this. Used to derive betPerLine from the engine bet amount. */
const BOOK_NUM_LINES = 10;

/** The resolved win tiers the ENGINE published from the active game config
 *  (`engine-game`'s `gameConfig.ts` → `publishWinLevelsToFacade`, re-exported by
 *  each game's own `game/gameConfig.ts`). Only
 *  the fields the facade needs — level, threshold (win-as-bet-multiplier), type.
 *  The facade can't import the app (it's a drop-in for `rgs-requests`), so a
 *  global is the decoupled bridge. Unset ⇒ un-authored ⇒ the coded ladder. */
type FacadeWinTier = { level: number; threshold: number; type: 'small' | 'medium' | 'big' };

const authoredWinTiers = (): FacadeWinTier[] | undefined => {
	const tiers = (globalThis as { __IE_WIN_LEVELS__?: FacadeWinTier[] }).__IE_WIN_LEVELS__;
	return Array.isArray(tiers) && tiers.length ? tiers : undefined;
};

/**
 * The buy COST MULTIPLIER for a bet mode, from the map the ENGINE published from the active game
 * config (`apps/lines/src/game/betModeMeta.ts` → `syncBetModeMeta` → `globalThis.__IE_BET_MODES__`),
 * keyed by the UPPERCASE wire `mode`. Same decoupled-global bridge as `__IE_WIN_LEVELS__` — the facade
 * is a drop-in for `rgs-requests` and can't import the app.
 *
 * The buy card DISPLAYS `betAmount × costMultiplier` as its price (`registerBuyFeature`), so the CHARGE
 * must use the SAME multiplier or every buy debits a fixed premium regardless of the card tapped. The
 * facade therefore sends this per-mode multiplier in the buy bet context instead of a plain 0/1 flag.
 *
 * Defaults to 1 (a normal spin's cost) when the map is unset or the mode is unknown — unreachable for a
 * real buy, because the buy MENU is built from the SAME `syncBetModeMeta`, so a card can only be tapped
 * once its cost has been published (parity: an un-bridged game never buys).
 */
const betModeCostMultiplier = (mode: string): number => {
	const map = (globalThis as { __IE_BET_MODES__?: Record<string, number> }).__IE_BET_MODES__;
	const cost = map?.[mode.toUpperCase()];
	return typeof cost === 'number' && cost > 0 ? cost : 1;
};

/** Map a win (cents) + bet (cents) to an engine winLevel. When the project has
 *  AUTHORED win tiers (Invisible Game Config), the level is read from that
 *  ladder — the highest tier whose threshold the win reaches. Otherwise the
 *  coded 1..10 ladder is used verbatim (byte-identical for an un-authored game).
 *  The engine looks the level up in the active win-level map — emitting the
 *  first tier for a zero win keeps `winLevelData` defined so the UI never stalls. */
const computeWinLevel = (winCents: number, betCents: number): number => {
	const tiers = authoredWinTiers();
	if (tiers) {
		if (!betCents || winCents <= 0) return tiers[0].level;
		const x = winCents / betCents;
		let level = tiers[0].level;
		for (const tier of tiers) if (x >= tier.threshold) level = tier.level;
		return level;
	}
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

/** Whether a computed winLevel is a BIG-WIN tier — the gate for the base-game
 *  and mid-free-spin big-win overlay (`setWin`). Keys off the AUTHORED tier's
 *  `type === 'big'` when tiers are published, so a 3-tier config triggers big
 *  win on its own big tier; else the coded `level >= 6` (the old winLevelMap
 *  boundary), byte-identical for an un-authored game. */
const isBigWinLevel = (level: number): boolean => {
	const tiers = authoredWinTiers();
	if (tiers) return tiers.find((tier) => tier.level === level)?.type === 'big';
	return level >= 6;
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
	if (debugEnabled()) console.log('[engine-facade]', ...args);
};

/** Convert a Play4Fun cents win + the round's bet (also in cents) to an engine
 *  bookEvent amount (the bet-multiplier in fixed-point hundredths). Returns 0
 *  for a zero bet to avoid division by zero.
 *
 *  the engine's display flow (see packages/utils-shared/amount.ts):
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

/** Rows `padReel` adds ABOVE the visible grid — the offset any server-side row index needs to
 *  become an engine row index. */
const BOARD_PADDING_ROWS = 1;

/**
 * Split a board cell into its symbol name and the value it carries.
 *
 * A plain cell is just a name. A cell dealt by the multiplier-collect fixture reads
 * `MULT:<value>` — the value has to travel WITH the cell because the board is a `string[][]`
 * and a refill can move any row (see the mock).
 *
 * ⚠️ Like `tumbleStep`, this encoding is OURS and not a captured Play4Fun shape. It is inert
 * for every cell without a colon, which is every cell any real session has ever sent.
 */
const parseCell = (cell: string): { name: string; multiplier?: number } => {
	const colon = cell.indexOf(':');
	if (colon === -1) return { name: cell };
	const multiplier = Number(cell.slice(colon + 1));
	if (!Number.isFinite(multiplier) || multiplier <= 0) return { name: cell };
	return { name: cell.slice(0, colon), multiplier };
};

/** A board cell as the engine wants it: the MAPPED symbol name, plus any value it carries. */
const toRawSymbol = (mapping: GameMapping, cell: string): { name: string; multiplier?: number } => {
	const { name, multiplier } = parseCell(cell);
	const mapped = mapSymbol(mapping, name);
	return multiplier === undefined ? { name: mapped } : { name: mapped, multiplier };
};

/** Pad a 3-row reel to 5 cells (1 above + 1 below) for the engine's spin buffer. */
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
 *  free-spin round — into the Invisible Engine book-event sequence. Processed
 *  sequentially (not bucketed) so multi-spin bonus rounds keep their order:
 *
 *    base:  reveal → winInfo×N → setTotalWin → finalWin
 *    bonus: reveal → winInfo (scatters) → freeSpinTrigger → setExpandingSymbol
 *           → [reveal → winInfo×N → updateFreeSpin]×spins
 *           → freeSpinEnd → setTotalWin → finalWin
 *
 *  Within each spin, Play4Fun emits spinWin BEFORE playedSpin; we hold the wins
 *  and flush them as winInfo right after the reveal (the engine wants board first). */
const adaptEventsForEngine = (sid: string, events: Play4FunBookEvent[]): unknown[] => {
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

	// A free-spin response carries its per-spin counter (`playedBonusSpin`) AFTER the board
	// reveal (`playedSpin`). Translated in that order, the counter TICKS A BEAT LATE: it shows
	// the PREVIOUS spin's number for the whole of the current spin's board (which is awaited, ~1s),
	// then flicks forward as the board settles — so a 10-spin bonus visibly plays its last board
	// reading "9 OF 10" and only reaches "10 OF 10" as the outro hides it. Capture the counter up
	// front and emit its `updateFreeSpin` BEFORE the reveal instead, so "N OF total" is on screen
	// while spin N actually plays. `played`/`left` are read from `playedBonusSpin`, so any
	// retrigger that already grew `left` this response is reflected in the total. Non-free-spin
	// responses (no `playedBonusSpin`) leave the list empty ⇒ nothing changes.
	//
	// ONE COUNTER PER SPIN, consumed in order. A response is NOT guaranteed to carry a single free
	// spin — a whole feature can arrive in one batch, with a `playedBonusSpin` per spin. Reading
	// only the FIRST and latching after one emit collapsed the entire feature to a single tick, so
	// the panel sat on "1 OF 10" for all ten spins.
	const bonusSpins = events
		.filter((e) => e.event === 'playedBonusSpin')
		.map((e) => e.context as { played?: number; left?: number } | undefined);
	let bonusCursor = 0;
	let bonusSeen = 0;
	const emitBonusCounter = () => {
		const spin = bonusSpins[bonusCursor];
		if (!spin) return;
		bonusCursor += 1;
		const played = spin.played ?? 0;
		const left = spin.left ?? 0;
		push({ type: 'updateFreeSpin', amount: Math.max(0, played - 1), total: played + left });
	};

	// A win's `meta.lineIndex` must be a 0-based ORDINAL into the server's payline list — that is what
	// the engine's `paylineColor()` and the info page index by. The raw `paylineId` cannot be trusted
	// for that: the BOOK protocol numbers its lines 1-based (`p + 1`) while the LINES protocol is
	// 0-based (`p`), so passing `paylineId` straight through shifted every Book win's authored colour by
	// one line (it fell through to the Symbols-tool default). Resolve the index from the win's actual
	// payline SHAPE against the captured server config instead — base-agnostic and exact. Falls back to
	// the raw `paylineId` when there's no shape (scatter/special wins) or no captured config (parity).
	const serverPaylines = declaredPayLines(sid);
	const lineIndexFor = (c: { context?: unknown }): number => {
		const shape = (c.context as { payline?: number[] })?.payline;
		if (serverPaylines && Array.isArray(shape)) {
			const i = serverPaylines.findIndex(
				(pl) => pl.length === shape.length && pl.every((r, k) => r === shape[k]),
			);
			if (i >= 0) return i;
		}
		return (c.context as { paylineId?: number })?.paylineId ?? -1;
	};

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
							lineIndex: lineIndexFor(c),
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
				//
				// The line count floors at 1 so a PAYLINES-LESS model (cluster / scatter-pays declare
				// no lines at all) still derives its base from `betPerLine` rather than falling through
				// to `total` — the fall-through is the buy-inflated number this comment exists to avoid.
				// `requestBet` sends `a = 1` for those games, so `betPerLine` IS the base stake.
				const ctx = e.context as { total?: number; betPerLine?: number; paylines?: unknown[] };
				const betPerLine = typeof ctx.betPerLine === 'number' ? ctx.betPerLine : 0;
				const numLines = Math.max(1, Array.isArray(ctx.paylines) ? ctx.paylines.length : 0);
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
					reel.map((cell) => {
						// The WHITELIST check reads the base name, so a `MULT:5` cell is judged as `MULT`
						// — otherwise every distinct value would warn as its own unknown symbol.
						isKnownSymbol(sid, parseCell(cell).name);
						return cell;
					}),
				);
				// Book-of mechanic (Book of Thermopylae): during free spins the
				// reels STOP on the NATURAL board — the special symbol sits in its
				// own single positions, NOT pre-filled columns. The reveal therefore
				// always carries the natural board (base game and free spins alike).
				// Tick the free-spin counter to THIS spin's number FIRST (see `bonusSpin`
				// above), so it leads the board rather than trailing it by a spin.
				//
				// ONLY on FREE-SPIN reveals. The response also carries the TRIGGER (base)
				// reveal that landed the scatters — its `playedSpin` runs this same case
				// while `gameType` is still 'basegame' (it flips to 'freegame' on the later
				// `enterBonus`). There are exactly N `playedBonusSpin` counters for N free
				// spins, but N+1 reveals (trigger + N). Ticking on the trigger reveal
				// consumed counter[0] one reveal early, so free spin 1 read "2 OF N", every
				// spin was off by one, and the last two both sat on "N OF N" (the +1th
				// reveal found no counter left). Gate on freegame so the N free reveals
				// consume exactly the N counters, 1:1.
				if (gameType === 'freegame') emitBonusCounter();
				push({
					type: 'reveal',
					board: reels.map((reel) => padReel(reel).map((cell) => toRawSymbol(activeMapping, cell))),
					paddingPositions: reels.map(() => 0),
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
				// This spin's OWN win (cents), captured BEFORE flushWins drains the
				// buffer — used to fire a mid-feature big-win overlay on a single big
				// free spin (below). flushWins itself only draws the win LINES.
				const spinWinCents = pendingWins.reduce((sum, c) => sum + (c.pay ?? 0), 0);
				flushWins();
				// A single FREE SPIN whose OWN win reaches the BIG tier gets the big-win
				// overlay (setWin → Win.svelte bigwin spine), exactly as a base-game big
				// win does at `gameEnd`. The RGS only sends per-spin `winInfo` + one
				// aggregate `freeSpinEnd` for the whole feature, so without this a huge
				// single-spin Book expansion celebrated only its win line and the big-win
				// overlay never played during free spins. Emitted AFTER the win lines and
				// BEFORE the meter bank, mirroring the base-game order (setWin → setTotalWin).
				if (gameType === 'freegame') {
					const spinWinLevel = computeWinLevel(spinWinCents, betBaseCents);
					if (isBigWinLevel(spinWinLevel)) {
						push({
							type: 'setWin',
							amount: toBookEventAmount(spinWinCents, betBaseCents),
							winLevel: spinWinLevel,
						});
					}
				}
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
			/**
			 * Cascade PRESENTATION FIXTURE (`CASCADE=1` on the mock) → the engine's `tumbleBoard`
			 * book event.
			 *
			 * ⚠️ `tumbleStep` is NOT a captured Play4Fun event. Every other case in this switch was
			 * verified against a real session; this one translates a shape the mock invents, so that
			 * the cascade overlay has something to play. It is inert unless the mock is explicitly
			 * asked to emit it, and a real provider's cascade should REPLACE this rather than be bent
			 * to fit it.
			 */
			case 'tumbleStep': {
				const ctx = e.context as {
					exploding?: { reel: number; row: number }[];
					newSymbols?: string[][];
					wins?: typeof pendingWins;
				};
				push({
					type: 'tumbleBoard',
					// The engine pads the board one row top+bottom, and the mock's positions index the
					// VISIBLE grid — so shift by the same padding the reveal applies, or the wrong cells
					// explode.
					explodingSymbols: (ctx.exploding ?? []).map((p) => ({
						reel: p.reel,
						row: p.row + BOARD_PADDING_ROWS,
					})),
					// A refilled cell may CARRY a multiplier (`MULT:5`). It has to arrive on the board as
					// `{name, multiplier}`, because the collect beat below re-reads the settled board to
					// find them — mapping the name alone would land a multiplier the client cannot see.
					newSymbols: (ctx.newSymbols ?? []).map((reel) =>
						reel.map((cell) => toRawSymbol(activeMapping, cell)),
					),
				});
				// A cascading board pays AGAIN, and each step carries the wins of the board it just
				// revealed — so they are narrated here, right after the tumble that produced them,
				// rather than with the dealt board's wins. Flushing them at the reveal instead would
				// draw step 3's win frame over the board step 1 was still showing.
				//
				// Reuses the ordinary win flush, which is the point: `runningTotal` keeps accumulating
				// through the chain, so the meter climbs across the whole cascade instead of resetting
				// to each step's own figure.
				if (ctx.wins?.length) {
					pendingWins = ctx.wins;
					flushWins();
				}
				break;
			}
			/**
			 * Multiplier-COLLECT fixture → the engine's `boardMultiplierInfo`.
			 *
			 * ⚠️ `multiplierCollect` is NOT a captured Play4Fun event, for the same reason
			 * `tumbleStep` is not: no capture of a scatter game exists, so its shape is ours. It is
			 * inert unless the mock is asked for it (a scatter project that declares a multiplier
			 * symbol), and a real provider should REPLACE it rather than have this bent to fit.
			 *
			 * Amounts convert like every other payout here — the engine wants bet-multiplier fixed
			 * point, not cents. `boardMult` is a bare multiplier and is passed through untouched.
			 */
			case 'multiplierCollect': {
				const ctx = e.context as {
					positions?: { reel: number; row: number; multiplier: number }[];
					tumbleWin?: number;
					boardMult?: number;
					totalWin?: number;
				};
				const tumbleWinCents = ctx.tumbleWin ?? 0;
				const totalWinCents = ctx.totalWin ?? tumbleWinCents;
				const totalWinAmount = toBookEventAmount(totalWinCents, betBaseCents);
				push({
					type: 'boardMultiplierInfo',
					multInfo: {
						// Same padding shift the reveal applies, or the collect lights the wrong cells.
						positions: (ctx.positions ?? []).map((p) => ({
							reel: p.reel,
							row: p.row + BOARD_PADDING_ROWS,
							multiplier: p.multiplier,
						})),
					},
					winInfo: {
						tumbleWin: toBookEventAmount(tumbleWinCents, betBaseCents),
						boardMult: ctx.boardMult ?? 1,
						totalWin: totalWinAmount,
					},
				});
				// The round now pays the MULTIPLIED total, so `runningTotal` — the meter figure every
				// later `setTotalWin` is built from — has to move with it, or the win meter would end
				// the round on the PRE-multiplier number the collect just animated away from.
				// In book-event units, not cents: this counter is fixed-point bet-multipliers.
				runningTotal = totalWinAmount;
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
				// Normally the reveal above already emitted this spin's counter (leading the board).
				// This is the fallback for a malformed response that carries the counter but no
				// `playedSpin` — emit it here so the count is never simply dropped. Gated on the
				// cursor still trailing this spin, so a response WITH reveals doesn't emit the NEXT
				// spin's number early.
				bonusSeen += 1;
				if (bonusCursor < bonusSeen) emitBonusCounter();
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
				} else if (isBigWinLevel(winLevel)) {
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

/** The engine's createPrimaryMachines runs a two-step balance update on a winning
 *  spin: requestBet returns the bet-debited (interim) balance, then
 *  requestEndRound returns the final balance with the win credited.
 *  The dramatic count-up animation rides between them.
 *
 *  Play4Fun auto-collects atomically in one round-trip, so the response
 *  already contains the post-win balance. We synthesise the engine flow by
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

/** The delivery profile supplies the endpoint path and the credentials mode. It is imported rather
 *  than bridged through a global (the pattern this file uses for engine-owned data) because
 *  `delivery-profile` is a zero-dependency leaf describing the TRANSPORT, not the engine — so it
 *  costs none of the portability the no-engine-deps rule in `gameMappings.ts` is protecting, and a
 *  real import cannot be read before it is written the way a global can. */
/**
 * Where to POST, when the operator's page is the RGS's own origin (`rgs.source: 'host'`).
 *
 * Their wrapper resolves this server-side and hands it over as `GameSettings.service`, then builds
 * a RELATIVE request URL from it — so the game reaches the RGS without ever naming a host, and
 * without CORS. An empty base here is exactly that: fetch against the page.
 *
 * The profile's `endpoint` stays as the fallback for a page that states no `service`, which is what
 * keeps our own QA links working against a delivery build.
 */
const rgsLocation = (rgsUrl: string): { baseUrl: string; endpoint: string } => {
	const profile = getDeliveryProfile();
	if (profile.rgs.source === 'host') {
		return { baseUrl: '', endpoint: hostServicePath() ?? profile.rgs.endpoint };
	}
	return { baseUrl: buildBaseUrl(rgsUrl), endpoint: profile.rgs.endpoint };
};

const fetcherFor = (sid: string, rgsUrl: string) => {
	const profile = getDeliveryProfile();
	return createPlay4FunFetcher(
		{
			...rgsLocation(rgsUrl),
			withCredentials: profile.rgs.withCredentials,
			...(profile.rgs.simpleRequest ? { contentType: 'text/plain;charset=UTF-8' } : {}),
			sid,
		},
		sessionFor(sid),
	);
};

// ---------- balance helpers ----------

/** Pull the Play4Fun balance from a response and scale up to engine units. */
const balanceOf = (response: unknown): number | undefined => {
	if (!response || typeof response !== 'object') return undefined;
	const p4f = (response as { platform?: { balance?: number } }).platform?.balance;
	return typeof p4f === 'number' ? play4FunToEngine(p4f) : undefined;
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
	let cfg = captureConfig(
		options.sessionID,
		(result.response as { events?: Play4FunBookEvent[] } | undefined)?.events,
	);

	// Some servers answer the balance probe WITHOUT the boot config and expose it as its own
	// (non-stored) `config` action instead. Ask explicitly, but only as a FALLBACK: our mocks reject
	// unknown actions, and the lines mock emits its config on the session's first call only — so
	// probing first would burn that call on an error and lose the config for the whole session.
	if (!cfg) {
		const probe = await fetcher.post({ body: [{ action: 'config' }] });
		cfg = captureConfig(
			options.sessionID,
			(probe.response as { events?: Play4FunBookEvent[] } | undefined)?.events,
		);
	}
	if (cfg) runConfigCrossCheck(options.sessionID, cfg);

	const balance = balanceOf(result.response);

	// The REAL ladder when the server declared a bet-option table and the operator's embed page
	// declared its multipliers; otherwise the invented placeholder below, which is all a mock can
	// offer. `buildBetLadder` returns null when either half is missing, so a server that declares
	// options but is opened outside an embed page still falls back rather than shipping one rung.
	const serverOptions = betOptionsFor(options.sessionID);
	const ladder = serverOptions ? buildBetLadder(serverOptions, readHostBetSettings()) : null;

	return {
		status: { statusCode: 'SUCCESS' as const },
		balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		// Synthesised config so the bet UI boots. Levels in engine API units.
		config: {
			betLevels: ladder?.betLevels ?? [
				// PLACEHOLDER ladder — the client inventing limits the RGS never agreed to. Only
				// reachable against a server that declares no `betOptions` (both our mocks).
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
			betModes: serverOptions
				? betModesFromOptions(serverOptions)
				: { BASE: { mode: 'BASE', costMultiplier: 1, feature: false } },
			defaultBetLevel: ladder?.defaultBetLevel ?? 1_000_000,
			jurisdiction: {
				// The operator's embed page states what this launch may do; anything it does NOT state
				// keeps the value below. `hostBoolean` returns null for an absent key precisely so
				// "the operator said no" can be told from "the operator said nothing" — overriding a
				// default on silence is how a game ends up disabling turbo nobody disabled.
				...hostJurisdiction(),
				socialCasino: false,
				disabledFullscreen: false,
				disabledTurbo: false,
				disabledSuperTurbo: false,
				disabledAutoplay: false,
				disabledSlamstop: false,
				disabledSpacebar: false,
				// A server declaring two or more bet options is declaring a buy/ante exists. With no
				// table (every server before this one) the flag stays true, as it always was.
				disabledBuyFeature: !serverOptions || serverOptions.betOptions.length < 2,
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
 *  IMPORTANT: amount is in user-display units, NOT engine API millions.
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
	// as [buyCost, betPerLine], where buyCost is the SELECTED mode's cost multiplier
	// (0 = normal spin) so the debit matches that card's displayed price instead of a
	// fixed premium; the lines/Hot-Fruits path keeps the legacy [5, betPerLine] encoding.
	const isBuy = !!options.mode && options.mode.toUpperCase() !== 'BASE';
	const buyCost = isBuy ? betModeCostMultiplier(options.mode) : 0;

	// CONFIG-DRIVEN encoding, when the server declared a bet-option table: `context[0]` selects the
	// option (0 base · 1 ante · 2 buy, per `betOptionsName` — the order is NOT a contract) and
	// `context[1]` is the multiplier M. The server charges `betOptions[x] × M`, so the option index
	// carries the buy premium and M stays the BASE multiplier.
	//
	// It is a separate branch rather than a rewrite of the two below because `context[0]` means
	// something different in each: a cost multiplier for the book mock, a line count for the legacy
	// lines encoding. Reusing either would send a garbage option index to a server that reads it as
	// an enum — the exact failure the partner's third game (where `x` IS the line count) shows can
	// go both ways.
	const serverOptions = betOptionsFor(options.sessionID);
	const optionIndex = serverOptions ? betOptionIndexFor(options.mode, serverOptions) : null;
	if (serverOptions && optionIndex === null) warnUnexpressibleMode(options.sessionID, options.mode);

	// Which of the three encodings below this bet used. Only the last one puts a LINE COUNT in
	// `context[0]`, which is what makes the stake `[0] × [1]` and the rounding warning meaningful.
	const legacyLinesEncoding =
		!(serverOptions && optionIndex !== null) && activeMapping !== bookMapping;

	const betBody: ReturnType<typeof buildBetActions> =
		serverOptions && optionIndex !== null
			? [
					{
						action: 'bet',
						context: [optionIndex, multiplierForAmount(options.amount, serverOptions)],
					},
					{ action: 'play', context: '' },
				]
			: activeMapping === bookMapping
				? [
						{
							action: 'bet',
							context: [buyCost, Math.max(1, Math.round(play4FunAmount / BOOK_NUM_LINES))],
						},
						{ action: 'play', context: '' },
					]
				: buildBetActions({
						amount: play4FunAmount,
						mode: options.mode,
						currency: options.currency,
						betLinesOrConfig: betLineCount(options.sessionID),
						playContext: '',
					});

	// `betPerLine` is integer cents, so `a × betPerLine` cannot always hit the requested amount — a
	// $0.10 bet across 20 lines wants half a cent per line and floors at one, charging $0.20. The
	// stake stays SELF-CONSISTENT either way (the server echoes what it charged and every win is
	// normalised against it), so this is a bet-LADDER problem, not a scaling one: our synthesised
	// betLevels are Stake-shaped and a real Play4Fun game quotes levels that divide by its line count.
	// Surface it once rather than let a level quietly cost more than it says.
	if (legacyLinesEncoding) warnOnStakeRounding(options.sessionID, betBody, play4FunAmount);

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
					? { amount: play4FunToEngine(balanceCents), currency: options.currency }
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

	// Aggregate the whole round into one event stream. The engine consumes
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
	const translated = translateBetResponse(aggregated, options.currency);

	// Two-step balance: interim (bet debited, win NOT yet credited) now; final
	// stashed for requestEndRound to return after the count-up animation.
	const finalCents =
		(lastResponse as { platform?: { balance?: number } } | null)?.platform?.balance ?? 0;
	const winCents =
		(allEvents.find((e) => e.event === 'gameEnd')?.context as { win?: number } | undefined)?.win ??
		0;
	// Whether the reported balance ALREADY includes the win depends on whether the round closed.
	//
	// Auto-collecting server: `gameRoundOver` is in the events, the balance is final, and the interim
	// the engine wants (bet debited, win not yet credited) is that minus the win.
	// Partner server: the round is still open, so the reported balance IS the interim — subtracting
	// the win again would show a balance lower than the player ever had, and stashing it as "final"
	// would credit a win that the missing `collect` never paid.
	const roundClosed = allEvents.some((e) => e.event === 'gameRoundOver');
	const interimCents = roundClosed ? finalCents - winCents : finalCents;
	if (roundClosed) pendingFinalBalance.set(options.sessionID, finalCents);

	if (translated.balance) {
		translated.balance = { ...translated.balance, amount: play4FunToEngine(interimCents) };
	}
	if (translated.round) {
		if (typeof translated.round.amount === 'number') {
			translated.round.amount = play4FunToEngine(translated.round.amount);
		}
		if (typeof translated.round.payout === 'number') {
			translated.round.payout = play4FunToEngine(translated.round.payout);
		}
		if (translated.round.state) {
			translated.round.state = adaptEventsForEngine(
				options.sessionID,
				translated.round.state,
			) as never;
		}
	}

	return translated;
};

/**
 * The player's balance, without touching the round.
 *
 * Posts the empty-body probe — the one call the server does not store — so a cashier deposit made
 * while the game is open can reach the HUD. Returns undefined rather than a number in the two cases
 * where asking is wrong:
 *
 *  - A round is OPEN (`session.gid`). The partner answers `not authorized` (code 118) to an
 *    out-of-band call mid-round, and a poll has no business interrupting a spin anyway.
 *  - The request failed. A poll that cannot reach the server must leave the last known balance
 *    alone; blanking the HUD on a dropped packet is worse than a slightly stale number.
 */
export const requestBalance = async (options: { sessionID: string; rgsUrl: string }) => {
	const session = sessionFor(options.sessionID);
	if (session.gid) return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };

	try {
		const result = await fetcherFor(options.sessionID, options.rgsUrl).post({
			body: buildHeartbeat(),
		});
		if (isPlay4FunError(result.response)) {
			return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };
		}
		const balance = balanceOf(result.response);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		};
	} catch {
		return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };
	}
};

export const requestEndRound = async (options: { sessionID: string; rgsUrl: string }) => {
	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);

	// An OPEN round is closed FIRST, and its `collect` is what credits the win.
	//
	// This ordering is load-bearing, and it used to be the other way round. Our mock auto-collects on
	// `play.context: ''`, so a bet's response already carried `gameRoundOver` and a stashed balance
	// was the whole answer. The partner RGS does NOT: the round stays `updating` and the win is
	// credited only by an explicit `collect`. Measured first (balance 999760 after bet+play, 999780
	// after collect, win 20) and then CONFIRMED by the RGS author as the intended flow, with no case
	// in which the collect should be withheld — worth recording, because this is a money path and a
	// later reader should not have to re-derive it from two captures.
	// With the stash checked first, that collect was unreachable, so every round
	// was left open and every win went uncredited while the HUD showed one anyway, computed by us.
	if (session.gid) {
		const collectResult = await fetcher.post({ body: buildCollectAction() });
		if (responseClosedRound(collectResult.response)) session.endRound();
		pendingFinalBalance.delete(options.sessionID);
		const balance = balanceOf(collectResult.response);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		};
	}

	// No open round ⇒ the bet's own response already closed it (an auto-collecting server), and the
	// balance it reported is the final one. This is the moment the engine credits the win on screen,
	// after the count-up.
	const stashed = pendingFinalBalance.get(options.sessionID);
	if (stashed !== undefined) {
		pendingFinalBalance.delete(options.sessionID);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: { amount: play4FunToEngine(stashed), currency: 'USD' },
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
