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

import { publishRgsConnection } from 'constants-shared/rgsConnection';
import {
	getDeliveryProfile,
	hostBoolean,
	hostServicePath,
	readPageOperatorSettings,
} from 'delivery-profile';

import {
	betOptionCostRatios,
	betOptionIndexFor,
	buildBetLadder,
	clampBetLadder,
	multiplierForAmount,
	readHostBetSettings,
	readServerBetOptions,
	serverBetOptionEntries,
	type BetLadder,
	type ServerBetOptions,
} from './betOptions';
import { readMappedPaytable, type DeclaredPayEntry } from './paytable';
import { createPlay4FunSessionState, type Play4FunSessionState } from './sessionState';
import {
	createPlay4FunFetcher,
	isSessionIdle,
	type Play4FunPostResult,
	type Play4FunResendPolicy,
} from './eagamingFetcher';
import {
	buildBetActions,
	buildHeartbeat,
	buildCollectAction,
	translateBetResponse,
	responseClosedRound,
} from './translator';
import { isPlay4FunError } from './types';
import type {
	Play4FunActionEnvelope,
	Play4FunBookEvent,
	Play4FunConfigContext,
	Play4FunRequestBody,
	Play4FunResponse,
} from './types';
import {
	linesMapping,
	mapSymbol,
	resolveActiveMapping,
	pickMappingForConfig,
	type GameMapping,
} from './gameMappings';
import { engineToPlay4Fun, play4FunAmountMultiplier, play4FunToEngine } from './amounts';
import {
	applyPools,
	boardCells,
	holdAndWinState,
	meterLevelsEvent,
	meterUpdateEvent,
	modeEnterEvent,
	modeExitEvent,
	parseHoldAndWinCell,
	readBootJackpotLevels,
	readBootMeterLevels,
	isName,
	readHoldAndWinModes,
	respinModesOf,
	readJackpotLevels,
	translateHoldAndWinEvent,
	type HoldAndWinJackpotLevel,
	type HoldAndWinMeterLevel,
	type HoldAndWinModes,
	type HoldAndWinTranslation,
} from './holdAndWin';
import {
	entryCause,
	overlayBootLevels,
	overlayDropEvent,
	readPotsOverlayConfig,
	reelsModes,
	type PotsOverlayWireConfig,
} from './potsOverlay';

// ---------- mapping selection ----------

/** Active symbol mapping. Starts from the env hint (`PUBLIC_RGS_GAME`,
 *  defaulting to lines), then auto-corrects from the captured boot `config`
 *  event — the most reliable signal, since env exposure differs across build
 *  setups (SvelteKit routes PUBLIC_* through $env, not import.meta.env). */
let activeMapping: GameMapping = resolveActiveMapping();

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

/** Per-session Hold and Win respin modes from the boot config (`bonusModes`, or the legacy single
 *  `holdAndWin` block as mode `holdAndWin`) — present only for a server that deals respins, and the
 *  gate for the whole Hold and Win translation (`holdAndWin.ts`). */
const capturedHoldAndWin = new Map<string, HoldAndWinModes>();

/**
 * Per-session pots-overlay block from the boot config (design `pots-overlay.md` §3.3) — the gate for
 * routing each bonus by its `spinTrigger.bonus` key instead of "a captured Hold and Win block takes
 * every bonus". Absent ⇒ every path below is exactly as it was.
 */
const capturedPotsOverlay = new Map<string, PotsOverlayWireConfig>();

/** The wire events of a respin feature without rules that are dropped; its overlay events (drops,
 *  pots) still translate, and its `gameEnd` closes the round as any round's does. */
const RULELESS_SKIPPED = new Set([
	'holdAndWinTrigger',
	'enterBonus',
	'playedSpin',
	'playedBonusSpin',
	'playedBonusSpins',
	'holdAndWinEnd',
]);

/** A respin feature the client has no rules for is warned about once per `sid:mode`. */
const warnedUncapturedModes = new Set<string>();

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
 * Only the fields the engine reads (`availablePayLines`, `symbols`, `window`), plus `paytable` — which
 * is NOT adopted, only compared against the paytable the game shows (`warnOnServerPaytableMismatch`
 * in `engine-game`). Omitted when the server declares none, which leaves that check off.
 * Never written when no `config` event arrives ⇒ the global stays undefined ⇒ every engine accessor
 * falls back to the authored doc, byte-identical to before (parity).
 *
 * `symbols` is mapped through `activeMapping` FIRST — the reveal board, wins and the whole engine
 * run in ENGINE client-symbol space (`H1`/`L1`/`S`), never the server's raw vocabulary
 * (`PIC1`/`ACE`/`SCAT`), because `mapSymbol` translates every reveal cell (see the `reveal` push).
 * Publishing the raw names would make the in-play GATE and the auto-generated strips speak a
 * vocabulary the client dictionary and symbol-art map don't know — a blank paytable and undrawable
 * reels. `availablePayLines` (row indices per reel) is symbol-agnostic, so it is NOT mapped. The
 * paytable's `of` names ARE, for the same reason: it is compared against rows named `H1`, not `PIC1`. */
type EngineServerConfig = {
	availablePayLines: number[][];
	symbols: string[];
	window?: { reels: number; rows: number };
	paytable?: DeclaredPayEntry[];
	/** `maxWinMp`, `symbolsPay.scatter` (mapped) and `maxWays` — compared, never adopted, like the
	 *  paytable (`warnOnServerDeclarationDrift` in `engine-game`). Each only when declared. */
	maxWinMp?: number[];
	scatterSymbols?: string[];
	maxWays?: number;
};

const positiveList = (value: unknown): number[] | null =>
	Array.isArray(value) && value.length && value.every((n) => typeof n === 'number' && n > 0)
		? (value as number[])
		: null;

const publishServerConfig = (cfg: Play4FunConfigContext): void => {
	const mapNames = (names: unknown): string[] =>
		Array.isArray(names) ? [...new Set(names.map((n) => mapSymbol(activeMapping, n)))] : [];
	const paytable = readMappedPaytable(cfg, activeMapping);
	const maxWinMp = positiveList(cfg.maxWinMp);
	const symbolsPay = cfg.symbolsPay as { scatter?: unknown } | undefined;
	const scatterSymbols = mapNames(symbolsPay?.scatter);
	(globalThis as { __IE_SERVER_CONFIG__?: EngineServerConfig }).__IE_SERVER_CONFIG__ = {
		availablePayLines: Array.isArray(cfg.availablePayLines) ? cfg.availablePayLines : [],
		symbols: mapNames(cfg.symbols),
		window: cfg.window,
		...(paytable ? { paytable } : {}),
		...(maxWinMp ? { maxWinMp } : {}),
		...(scatterSymbols.length ? { scatterSymbols } : {}),
		...(typeof cfg.maxWays === 'number' && cfg.maxWays > 0 ? { maxWays: cfg.maxWays } : {}),
	};
};

/**
 * Publish the persistent meters' BOOT levels to a global the GAME reads (`apps/lines`
 * `seedHoldAndWinMeters`) — the same decoupled-global bridge as `__IE_SERVER_CONFIG__`. A meter level
 * is server state that changes only by `meterUpdate` and is restated by `meterLevels` after every
 * `play`; before the first play the boot `config` is the only place it travels, so without this the
 * pots read empty until the player spins. Written only for a Hold and Win server that declares
 * meters, so every other server leaves the global undefined and the game seeds nothing.
 */
const publishHoldAndWinMeters = (meters: HoldAndWinMeterLevel[]): void => {
	if (meters.length === 0) return;
	(
		globalThis as { __IE_HOLD_AND_WIN_METERS__?: HoldAndWinMeterLevel[] }
	).__IE_HOLD_AND_WIN_METERS__ = meters;
};

/**
 * Publish the progressive pools to the GAME (`apps/lines` `holdAndWinJackpots.svelte.ts`): the boot
 * levels, and every refresh a balance heartbeat brings between rounds — the same decoupled-global
 * bridge as the meters, plus an `ie:holdAndWinJackpots` event so a jackpot bar already on screen
 * moves. Inside a round the pools travel as the `jackpotLevels` book event instead. A server with no
 * progressive tier never calls it, so every other game leaves the global undefined.
 */
const publishHoldAndWinJackpots = (levels: HoldAndWinJackpotLevel[]): void => {
	if (levels.length === 0) return;
	(
		globalThis as { __IE_HOLD_AND_WIN_JACKPOTS__?: HoldAndWinJackpotLevel[] }
	).__IE_HOLD_AND_WIN_JACKPOTS__ = levels;
	globalThis.dispatchEvent?.(new CustomEvent('ie:holdAndWinJackpots', { detail: levels }));
};

/** A heartbeat's progressive pools: moved into the captured tiers and handed to the game. */
const refreshHoldAndWinJackpots = (sid: string, response: unknown): void => {
	const respin = capturedHoldAndWin.get(sid);
	if (!respin) return;
	const events = (response as { events?: Play4FunBookEvent[] } | null)?.events ?? [];
	const event = [...events].reverse().find((e) => e.event === 'jackpotLevels');
	if (!event) return;
	const levels = readJackpotLevels(event.context);
	applyPools(respin, levels);
	publishHoldAndWinJackpots(levels);
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
	const holdAndWin = readHoldAndWinModes(cfg);
	const overlay = readPotsOverlayConfig(cfg);
	if (holdAndWin) {
		capturedHoldAndWin.set(sid, holdAndWin);
		if (!overlay) publishHoldAndWinMeters(readBootMeterLevels(cfg));
		publishHoldAndWinJackpots(readBootJackpotLevels(cfg));
	}
	// An overlay host's pots seed at boot like Hold and Win meters, whatever its kind — in
	// `resolveMeters` order, the Hold and Win block's own meters first.
	if (overlay) {
		capturedPotsOverlay.set(sid, overlay);
		publishHoldAndWinMeters([...readBootMeterLevels(cfg), ...overlayBootLevels(overlay)]);
	}
	// Bridge the server's declaration to the engine so paylines/in-play/strips/colours follow it.
	publishServerConfig(cfg);
	// The bet-option table, when the server declares one. Null leaves every bet on the legacy lines
	// encoding, which is what a lines-family game that sells nothing (and every server before the
	// 2-complex node) needs.
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

/**
 * The answer to a bet in a mode the server's option table cannot name: refused HERE, before anything
 * is sent, so no request reaches the wallet.
 *
 * There is no second encoding to fall back to. `context[0]` is an option index to a server with a
 * table, so any other number is either refused by it or — worse — read as a DIFFERENT option and
 * charged that option's price. Book of Borut offers three buy cards against a `["0:base","1:buybonus"]`
 * table, and only the math can settle which is right. Unreachable from a game whose menu is built from
 * the table (`betModeMeta.ts`), since every key that menu offers resolves by construction; this is
 * for a menu that was not.
 */
const refuseUnexpressibleMode = (mode: string) => {
	const text = `bet mode "${mode}" is not one of the server's bet options, so it was not placed`;
	return { status: { statusCode: 'ERR_GE', statusMessage: text }, error: text, message: text };
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
 *
 * Autoplay has two spellings — `allowAutoplay: false` and the partner client's own
 * `autoplayDisabled: true` — and EITHER forbidding it forbids it: a page that states both, one each
 * way, is read as the stricter. It is stated-allowed only when some statement allows and none
 * forbids; neither stated is silence.
 */
const hostJurisdiction = (): Record<string, boolean> => {
	const out: Record<string, boolean> = {};
	const enableTurbo = hostBoolean('enableTurbo');
	if (enableTurbo !== null) out.disabledTurbo = !enableTurbo;
	const allowAutoplay = hostBoolean('allowAutoplay');
	const autoplayDisabled = hostBoolean('autoplayDisabled');
	if (allowAutoplay === false || autoplayDisabled === true) out.disabledAutoplay = true;
	else if (allowAutoplay !== null || autoplayDisabled !== null) out.disabledAutoplay = false;
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
		{ availablePayLines?: number[][]; paylines?: number[][] } | undefined;
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
	// Bet-mode PRICES are not compared here: this normally runs at authenticate, before the game has
	// built its menu, so it has no authored prices. `betModeMeta.ts` reports that drift instead.
	if (!unmapped.length && !orphaned.length) return;

	const lines: string[] = [`[engine-facade] config cross-check for sid=${sid}`];
	if (unmapped.length)
		lines.push(`  unmapped server symbols (will pass through): ${unmapped.join(', ')}`);
	if (orphaned.length)
		lines.push(`  mapping entries the server never declared: ${orphaned.join(', ')}`);

	console.warn(lines.join('\n'));
};

/**
 * The names an overlay host deals beyond its own vocabulary: its pots' tokens, and — when Hold and
 * Win is the overlay's bonus — every respin mode's symbols (its `roles`, its blank), which its boot
 * `symbols` (the host's) does not list.
 */
const overlaySymbols = (sid: string): Set<string> => {
	const overlay = capturedPotsOverlay.get(sid);
	if (!overlay) return new Set();
	const modes = [...(capturedHoldAndWin.get(sid)?.modes.values() ?? [])];
	return new Set([
		...overlay.pots.map((pot) => pot.token),
		...modes.flatMap((hw) => [...Object.keys(hw.roles), ...(hw.blank ? [hw.blank] : [])]),
	]);
};

/** Whitelist check + warn-once for a symbol coming back in a reveal/winInfo
 *  event. Returns true if the symbol is in the server's declared vocabulary
 *  (or no config has been captured yet — fail open). */
const isKnownSymbol = (sid: string, name: string): boolean => {
	const cfg = capturedConfig.get(sid);
	if (!cfg) return true;
	if (cfg.symbols.includes(name)) return true;
	if (overlaySymbols(sid).has(name)) return true;
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
const clampBoardToGrid = (sid: string, board: string[][], tallestRows?: number): string[][] => {
	const cfg = capturedConfig.get(sid);
	if (!cfg?.window) return board;
	const { reels, rowsPerReel } = cfg.window;
	// An expanding respin board grows past the base grid, up to its declared `maxRows`.
	const rows = Math.max(cfg.window.rows, tallestRows ?? 0);
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

/** The resolved win tiers the ENGINE published from the active game config
 *  (`engine-game`'s `gameConfig.ts` → `publishWinLevelsToFacade`, re-exported by
 *  each game's own `game/gameConfig.ts`). Only
 *  the fields the facade needs — level, threshold (win-as-bet-multiplier), type.
 *  The facade can't import the app (it's a drop-in for `rgs-requests`), so a
 *  global is the decoupled bridge. Unset ⇒ un-authored ⇒ the coded ladder.
 *  Read at translation time, so it must be published before the first book is
 *  translated — which is a resumed round, inside `requestAuthenticate`. */
type FacadeWinTier = { level: number; threshold: number; type: 'small' | 'medium' | 'big' };

/** The fewest reels the free-spin special must cover to expand. On a LINES-vocabulary server (our
 *  lines mock, which deals the project's authored thresholds) it is read from what the ENGINE
 *  published from the project's `freeSpins.expandingSymbol` (`engine-game`'s `gameConfig.ts` →
 *  `publishExpandMinReelsToFacade`), keyed by CLIENT symbol — the same bridge as the win tiers above.
 *  A BOOK-vocabulary server (the partner's, the book mock) pays by its own captured rule whatever the
 *  config says, so it never reads the bridge; nor does a lines server without one, or a special the
 *  bridge does not name. Those keep the captured Book of Thermopylae rule: `PIC1` from 2 reels,
 *  every other from 3. */
const expandMinReels = (special: string, client: string): number => {
	const authored =
		activeMapping === linesMapping
			? (globalThis as { __IE_EXPAND_MIN_REELS__?: Record<string, number> }).__IE_EXPAND_MIN_REELS__
			: undefined;
	const minReels = authored?.[client];
	if (typeof minReels === 'number' && Number.isInteger(minReels) && minReels >= 1) return minReels;
	return special === 'PIC1' ? 2 : 3;
};

const authoredWinTiers = (): FacadeWinTier[] | undefined => {
	const tiers = (globalThis as { __IE_WIN_LEVELS__?: FacadeWinTier[] }).__IE_WIN_LEVELS__;
	return Array.isArray(tiers) && tiers.length ? tiers : undefined;
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

type BetEventContext = { total?: number; betPerLine?: number; paylines?: unknown[] };

/**
 * The BASE stake of a round, from its `bet` event: betPerLine × paylines, not the debited `total`.
 *
 * Win `pay` amounts are denominated against the base bet, and the two diverge when the feature is
 * BOUGHT — `total` then includes the buy premium (×100 in the book-of mock), which would shrink every
 * win display ~100×. `total` is only the fallback for a server that sends neither field.
 *
 * The line count floors at 1 so a PAYLINES-LESS model (cluster / scatter-pays declare no lines at
 * all) still derives its base from `betPerLine` rather than falling through to `total` — the
 * fall-through is the buy-inflated number this exists to avoid. `requestBet` sends `a = 1` for those
 * games, so `betPerLine` IS the base stake.
 */
const baseStakeCents = (ctx: BetEventContext): number => {
	const betPerLine = typeof ctx.betPerLine === 'number' ? ctx.betPerLine : 0;
	const numLines = Math.max(1, Array.isArray(ctx.paylines) ? ctx.paylines.length : 0);
	const baseBet = betPerLine * numLines;
	return baseBet > 0 ? baseBet : (ctx.total ?? 0);
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
const parseCell = (cell: string, holdAndWin = false): { name: string; multiplier?: number } => {
	if (holdAndWin) return parseHoldAndWinCell(cell);
	const colon = cell.indexOf(':');
	if (colon === -1) return { name: cell };
	const multiplier = Number(cell.slice(colon + 1));
	if (!Number.isFinite(multiplier) || multiplier <= 0) return { name: cell };
	return { name: cell.slice(0, colon), multiplier };
};

/** A board cell as the engine wants it: the MAPPED symbol name, plus any value it carries. A Hold
 *  and Win cell carries a coin value, a jackpot label and its factor instead of a multiplier. */
const toRawSymbol = (
	mapping: GameMapping,
	cell: string,
	holdAndWin = false,
): { name: string; multiplier?: number; value?: number; jackpot?: string; factor?: number } => {
	if (holdAndWin) {
		const symbol = parseHoldAndWinCell(cell);
		return { ...symbol, name: mapSymbol(mapping, symbol.name) };
	}
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

	// The bet-multiplier denominator — the BASE stake, see `baseStakeCents`. Set from the `bet` event.
	let betBaseCents = 0;
	let pendingWins: {
		what: string;
		occurs: number;
		mode?: string;
		pay: number;
		context?: unknown;
	}[] = [];
	let runningTotal = 0;
	// `freegame` in the host's own free spins; a reels mode of the project's own plays on its own.
	let gameType = 'basegame';
	// The reels mode of the project's own the free spins play in (an imported free spins), if any.
	let freeSpinsMode: string | undefined;
	const inFreeSpins = (): boolean => gameType !== 'basegame';
	let totalFs = 0;
	let scatterTriggerPositions: { reel: number; row: number }[] = [];
	// The symbol a `spinTrigger` says opened the feature (`trigger.of`), and the board it landed on.
	// A project's own trigger symbol pays no scatter win, so its cells are read off that board.
	let triggerOf: string | undefined;
	let triggerBoard: string[][] = [];
	let specialRaw: string | undefined; // the free-spin expanding symbol (raw Play4Fun name)

	// A Hold and Win server: its feature is NOT free spins. Each respin's board becomes a
	// `respinReveal`, its bonus snapshots `holdAndWinState`, and its own events go through
	// `holdAndWin.ts` under the rules of the respin mode it plays in; the base spin, its line wins and
	// the round close stay on the paths below.
	const respin = capturedHoldAndWin.get(sid);
	const holdAndWin = Boolean(respin);
	const translations = new Map<string, HoldAndWinTranslation>();
	const translationOf = (mode: string): HoldAndWinTranslation | null => {
		const hw = respin?.modes.get(mode);
		if (!hw) return null;
		let t = translations.get(mode);
		if (!t) {
			t = { mode, hw, toAmount: (credits) => toBookEventAmount(credits, betBaseCents) };
			translations.set(mode, t);
		}
		return t;
	};
	// The respin mode playing on the respin board, or null on the reels.
	let inHoldAndWin: HoldAndWinTranslation | null = null;

	// A POTS-OVERLAY host (design `pots-overlay.md` §3.3) can hold two bonuses — its own free spins
	// and a pot's Hold and Win — so each bonus is routed by the key its `spinTrigger` names, not by
	// whether a Hold and Win block was captured. Without the block, a captured Hold and Win block
	// takes every bonus — in the respin mode the wire names (`respinModesOf`).
	const overlay = capturedPotsOverlay.get(sid) ?? null;
	const modesAt = overlay ? reelsModes(overlay, events) : null;
	const respinModeAt = respin ? respinModesOf(respin, overlay, events) : null;
	const modeAt = (i: number): string | undefined => {
		const mode = respinModeAt?.[i];
		return typeof mode === 'string' ? mode : undefined;
	};
	// The rules event `i` translates under: its respin mode's, else (a reels bonus's, or the base
	// game's, own Hold and Win events — a meter, an instant collect) the primary's.
	const translationAt = (i: number): HoldAndWinTranslation | null =>
		respin ? translationOf(modeAt(i) ?? respin.primary) : null;
	const respinsAt = (i: number): boolean => modeAt(i) !== undefined;
	// FAIL CLOSED: a respin feature of a mode the boot declared no rules for (a named mode not
	// captured, or an overlay route to one) is not shown at all — neither under another mode's rules
	// nor as free spins — from its entry to its end, and warned about once.
	let inRuleless = false;
	let bonusKey: string | undefined;
	const opensRuleless = (i: number, e: Play4FunBookEvent): string | undefined => {
		if (!respin || (e.event !== 'holdAndWinTrigger' && e.event !== 'enterBonus')) return undefined;
		const named = respinModeAt?.[i];
		if (typeof named === 'object') return named.uncaptured;
		const respinFeature =
			e.event === 'holdAndWinTrigger' ||
			typeof (e.context as { holdAndWin?: unknown } | undefined)?.holdAndWin === 'object';
		if (!overlay || respinsAt(i) || !respinFeature) return undefined;
		return (bonusKey !== undefined ? overlay.bonuses[bonusKey] : undefined) ?? bonusKey ?? '?';
	};
	// The overlay's trigger fields for the next free-spin entry (`spinTrigger {cause, meters}`).
	let pendingCause: { cause?: string; meters?: string[] } = {};
	// The base spin's wins were banked at its reveal (a scatter trigger arrives before `playedSpin`;
	// a pot's after it, so its free spins bank them at entry instead).
	let bankedAtReveal = false;
	// What the wire dealt AHEAD of a spin's board, by the index of its `playedSpin`: its overlay drop
	// (sent right after `spinStart`) and any pot fills sent before the board (a spin that also enters
	// the host's own feature). Both are presented with that board — the drop right after its
	// `reveal`, the fills once it has paid (§3.2: reveal → drop → wins → fills).
	const ahead = new Map<number, { drop?: number; meters: number[] }>();
	if (overlay) {
		let drop: number | undefined;
		let meters: number[] = [];
		let inSpin = false;
		events.forEach((d, at) => {
			// A new spin: whatever came before it belongs to the board before (a server may send its
			// drop after its `playedSpin`, which the two-pass rule allows).
			if (d.event === 'spinStart') {
				drop = undefined;
				meters = [];
				inSpin = true;
			}
			if (d.event === 'overlayDrop') drop = at;
			if (d.event === 'meterUpdate' && inSpin) meters.push(at);
			if (d.event === 'playedSpin') {
				if (drop !== undefined || meters.length) ahead.set(at, { drop, meters });
				drop = undefined;
				meters = [];
				inSpin = false;
			}
		});
	}
	const presentedAhead = new Set(
		[...ahead.values()].flatMap(({ drop, meters }) => [
			...(drop === undefined ? [] : [drop]),
			...meters,
		]),
	);
	const pushDropOf = (spin: number) => {
		const drop = ahead.get(spin)?.drop;
		if (drop !== undefined)
			push(overlayDropEvent(events[drop].context, (n) => mapSymbol(activeMapping, n)));
	};
	const pushFillsOf = (spin: number) => {
		for (const at of ahead.get(spin)?.meters ?? [])
			push(meterUpdateEvent((events[at].context ?? {}) as Record<string, unknown>));
	};

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
		.filter((e, i) => e.event === 'playedBonusSpin' && !respinsAt(i))
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

	/** The overlay's own translation: drops, the pots' meter events and a stub mode's pair. A drop or
	 *  fill its board already presented ⇒ `undefined`; not an overlay event ⇒ `null`. */
	const translateOverlayEvent = (
		name: string,
		context: unknown,
		at: number,
	): Record<string, unknown> | null | undefined => {
		const ctx = (context ?? {}) as Record<string, unknown>;
		if (presentedAhead.has(at)) return undefined;
		if (name === 'overlayDrop')
			return overlayDropEvent(context, (n) => mapSymbol(activeMapping, n));
		if (name === 'meterUpdate') return meterUpdateEvent(ctx);
		if (name === 'meterLevels') return meterLevelsEvent(ctx);
		// A bonus routed to a mode the client does not play yet arrives as this pair (Phase 7).
		if (name === 'modeEnter') return modeEnterEvent(ctx, true);
		if (name === 'modeExit')
			return modeExitEvent(ctx, (credits) => toBookEventAmount(credits, betBaseCents));
		return null;
	};

	/**
	 * A later bonus in the round ENTERS (the server's book order rules): free spins playing before it
	 * are over. Closed at the entry itself — `holdAndWinTrigger`, `enterBonus`, or a pot's stub
	 * `modeEnter` — never at a `spinTrigger`, which a partner may send for a retrigger. Free spins end
	 * as `gameEnd` would have ended them, on the round's win so far. (A Hold and Win feature closes
	 * itself: its `holdAndWinEnd` leaves the respin board.)
	 */
	const closeFreeSpinsBefore = (e: Play4FunBookEvent) => {
		const ctx = (e as { context?: { cause?: unknown } }).context;
		const potMode = e.event === 'modeEnter' && ctx?.cause === 'meter';
		const entry = e.event === 'holdAndWinTrigger' || e.event === 'enterBonus' || potMode;
		if (!entry || !inFreeSpins()) return;
		push({
			type: 'freeSpinEnd',
			amount: runningTotal,
			winLevel: computeWinLevel(
				Math.round((runningTotal / BOOK_AMOUNT_MULTIPLIER) * betBaseCents),
				betBaseCents,
			),
			...(freeSpinsMode ? { mode: freeSpinsMode } : {}),
		});
		gameType = 'basegame';
		freeSpinsMode = undefined;
		// The next free-spin feature draws its own special (an imported one draws none).
		specialRaw = undefined;
	};

	for (const [i, e] of events.entries()) {
		if (overlay) closeFreeSpinsBefore(e);
		const ruleless = !inRuleless ? opensRuleless(i, e) : undefined;
		if (ruleless !== undefined) {
			inRuleless = true;
			const key = `${sid}:${ruleless}`;
			if (!warnedUncapturedModes.has(key)) {
				warnedUncapturedModes.add(key);
				console.warn(
					`[engine-facade] a respin feature of mode "${ruleless}", which the boot config declares no rules for — not shown`,
				);
			}
		}
		if (inRuleless && RULELESS_SKIPPED.has(e.event)) {
			if (e.event === 'holdAndWinEnd') inRuleless = false;
			continue;
		}
		switch (e.event) {
			case 'config':
			case 'gameStart':
			case 'spinStart':
			case 'bonusWin': // wrapper around the following spinWin — pay comes from spinWin
				break;
			case 'bet':
				betBaseCents = baseStakeCents(e.context as BetEventContext);
				break;
			case 'spinWin': {
				const c = e.context as { what: string; occurs: number; mode?: string; pay: number };
				pendingWins.push(c);
				if (c.mode === 'scatter' && c.what === 'SCAT') scatterTriggerPositions = winPositions(c);
				break;
			}
			case 'spinTrigger': {
				const spins = (e.context as { spins?: { spins?: number }[] | number })?.spins;
				totalFs = Array.isArray(spins) ? (spins[0]?.spins ?? 0) : (spins ?? 0);
				triggerOf = (e.context as { trigger?: { of?: string } })?.trigger?.of;
				const key = (e.context as { bonus?: unknown } | undefined)?.bonus;
				bonusKey = isName(key) ? key : undefined;
				if (overlay) pendingCause = entryCause(e.context);
				break;
			}
			case 'playedSpin': {
				const raw = (e.context as string[][]) ?? [];
				const reels = clampBoardToGrid(sid, raw, inHoldAndWin?.hw.expansion?.maxRows).map((reel) =>
					reel.map((cell) => {
						// The WHITELIST check reads the base name, so a `MULT:5` cell is judged as `MULT`
						// — otherwise every distinct value would warn as its own unknown symbol.
						isKnownSymbol(sid, parseCell(cell, holdAndWin).name);
						return cell;
					}),
				);
				if (!inFreeSpins()) triggerBoard = reels;
				// A respin lands cell by cell on the respin board, never on the reels.
				if (inHoldAndWin) {
					push({ type: 'respinReveal', cells: boardCells(reels), mode: inHoldAndWin.mode });
					pushDropOf(i);
					break;
				}
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
				if (inFreeSpins()) emitBonusCounter();
				push({
					type: 'reveal',
					board: reels.map((reel) =>
						padReel(reel).map((cell) => toRawSymbol(activeMapping, cell, holdAndWin)),
					),
					paddingPositions: reels.map(() => 0),
					gameType,
				});
				// The tokens dropped on this board appear with it, before anything it pays (§3.2).
				pushDropOf(i);
				// AFTER the natural board lands, if this is a free spin and 3+ of the
				// special symbol are on the board, tell the client which reels to
				// morph (every non-special cell in those reels becomes the special,
				// one cell at a time). Emitted AFTER the reveal and BEFORE the wins
				// (flushWins), so the column transform plays before any payout. Below
				// 3 specials: emit nothing — natural board, normal line pays.
				if (inFreeSpins() && specialRaw) {
					const specialReels: number[] = [];
					reels.forEach((reel, reelIndex) => {
						if (reel.some((name) => name === specialRaw)) specialReels.push(reelIndex);
					});
					// The special expands, and pays, on the COUNT OF REELS it covers — not
					// the raw symbol count, from the project's authored threshold
					// (`expandMinReels`). This gate MUST match the RGS gate (the lines mock's
					// candidate `minReels`, the book mock's `specialExpandsAt`) so the reels
					// that morph are exactly the reels that pay.
					const symbol = mapSymbol(activeMapping, specialRaw);
					if (specialReels.length >= expandMinReels(specialRaw, symbol)) {
						push({ type: 'expandBookColumns', reels: specialReels, symbol });
					}
				}
				// This spin's OWN win (cents), captured BEFORE flushWins drains the
				// buffer — used to fire a mid-feature big-win overlay on a single big
				// free spin (below). flushWins itself only draws the win LINES.
				const spinWinCents = pendingWins.reduce((sum, c) => sum + (c.pay ?? 0), 0);
				flushWins();
				// A single FREE SPIN whose OWN win reaches the BIG tier gets the big-win
				// overlay (setWin → Win.svelte bigwin rig), exactly as a base-game big
				// win does at `gameEnd`. The RGS only sends per-spin `winInfo` + one
				// aggregate `freeSpinEnd` for the whole feature, so without this a huge
				// single-spin Book expansion celebrated only its win line and the big-win
				// overlay never played during free spins. Emitted AFTER the win lines and
				// BEFORE the meter bank, mirroring the base-game order (setWin → setTotalWin).
				if (inFreeSpins()) {
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
				if (inFreeSpins() || totalFs > 0) {
					push({ type: 'setTotalWin', amount: runningTotal });
					bankedAtReveal = true;
				}
				pushFillsOf(i);
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
				const entered = respinsAt(i) ? translationAt(i) : null;
				if (entered) {
					inHoldAndWin = entered;
					const snapshot = (e.context as { holdAndWin?: object } | undefined)?.holdAndWin;
					if (snapshot) push(holdAndWinState(entered, snapshot));
					break;
				}
				// A pot's free spins: the base spin's wins were not banked at its reveal (the trigger
				// came after it), so they reach the meter now, before the intro takes over.
				if (overlay && !bankedAtReveal && runningTotal > 0) {
					push({ type: 'setTotalWin', amount: runningTotal });
				}
				freeSpinsMode = modesAt?.[i];
				gameType = (freeSpinsMode && overlay?.modes[freeSpinsMode]?.gameType) || 'freegame';
				push({
					type: 'freeSpinTrigger',
					totalFs: totalFs || (e.context as { left?: number })?.left || 0,
					// A full pot is the cause, not the scatters (none need have landed). A trigger symbol
					// other than the scatter is lit where it landed (padded one row, as `winPositions`).
					positions:
						pendingCause.cause === 'meter'
							? []
							: triggerOf && triggerOf !== 'SCAT'
								? triggerBoard.flatMap((reel, r) =>
										reel.flatMap((cell, row) =>
											cell === triggerOf ? [{ reel: r, row: row + 1 }] : [],
										),
									)
								: scatterTriggerPositions,
					...pendingCause,
					...(freeSpinsMode ? { mode: freeSpinsMode } : {}),
				});
				pendingCause = {};
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
				const playing = respinsAt(i) ? translationAt(i) : null;
				if (playing) {
					const snapshot = (e.context as { holdAndWin?: object } | undefined)?.holdAndWin;
					if (snapshot) push(holdAndWinState(playing, snapshot));
					break;
				}
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
				inHoldAndWin = null;
				inRuleless = false;
				if (inFreeSpins()) {
					push({
						type: 'freeSpinEnd',
						amount,
						winLevel,
						...(freeSpinsMode ? { mode: freeSpinsMode } : {}),
					});
					gameType = 'basegame';
					freeSpinsMode = undefined;
					specialRaw = undefined;
				} else if (isBigWinLevel(winLevel)) {
					// Base-game big win (≥ BIG tier): trigger the big/mega/… win
					// presentation (setWin → Win.svelte → bigwin rig).
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
			// Not a wire event: `settleRound` places it, from `platform.gameRound.jackpot`.
			case PLATFORM_JACKPOT_WIN: {
				const { tier, win } = e.context as PlatformJackpotWin;
				push({ type: 'platformJackpotWin', tier, amount: toBookEventAmount(win, betBaseCents) });
				break;
			}
			default: {
				const context = (e as { context?: unknown }).context;
				const rules = translationAt(i);
				if (respin && e.event === 'jackpotLevels') applyPools(respin, readJackpotLevels(context));
				// Under an overlay its own translation goes first: a stub mode's `modeEnter` keeps the
				// pots that started it, which the Hold and Win wire's never carries.
				const overlaid = overlay ? translateOverlayEvent(e.event, context, i) : null;
				const translated =
					overlaid !== null
						? overlaid
						: inRuleless
							? undefined
							: rules &&
								translateHoldAndWinEvent(
									rules,
									e.event,
									(context ?? {}) as Record<string, unknown>,
								);
				// An overlay host's Hold and Win feature is over at its end, whatever follows: the next
				// board (another bonus's trigger spin) lands on the reels, and the feature's total joins
				// the round's win so the meter never steps back.
				if (overlay && translated && translated.type === 'holdAndWinEnd') {
					inHoldAndWin = null;
					runningTotal += translated.total as number;
				}
				if (translated !== undefined) push(translated || { type: `_${e.event}`, raw: context });
			}
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

// ---------- the operator platform jackpot (kind-independent) ----------

/**
 * THE OPERATOR PLATFORM JACKPOT — `docs/reference/play4fun-protocol.md` § "The operator platform
 * jackpot" (read off the partner's client; owed a live confirmation). The platform, not the game,
 * runs it: every answer may carry `platform.jackpots[] {id, name, value, minValue, maxValue}` (the
 * balance heartbeat included), and a hit arrives as `platform.gameRound.jackpot {winJackpotId, win}`
 * with the win ALREADY inside `platform.balance`. Their client holds that win back from the shown
 * balance (`lockedPoint`) until its celebration has played, then adds it. A server that sends none of
 * it leaves everything here empty, and every balance is passed through untouched.
 */
type PlatformJackpotWin = { tier: string; win: number };

/** A platform tier as the engine reads it — values in engine money units, like a balance. */
export type PlatformJackpotLevel = { name: string; value: number; min?: number; max?: number };

/** The aggregated round's marker for a hit, placed by `settleRound` — never a wire event. */
const PLATFORM_JACKPOT_WIN = '_platformJackpotWin';

/** Tier names by id, from the last `platform.jackpots` — a hit names its tier by id. */
const platformTierNames = new Map<string, Map<string, string>>();
/** A hit this round has carried, until `settleRound` places it in the book. */
const platformWins = new Map<string, PlatformJackpotWin>();
/** Credits held back from every balance shown until the engine releases them (`lockedPoint`). */
const platformLocks = new Map<string, number>();
/** Every hit already taken, by round — the partner keeps naming a round after it closes, so the same
 *  `gameRound.jackpot` can come back on a later answer and must not be held or celebrated twice. */
const platformHitsSeen = new Map<string, Set<string>>();

const readPlatformJackpots = (raw: unknown) =>
	Array.isArray(raw)
		? raw.flatMap((entry: unknown) => {
				const { id, name, value, minValue, maxValue } = (entry ?? {}) as Record<string, unknown>;
				if (typeof name !== 'string' || !name || typeof value !== 'number' || value < 0) return [];
				return [
					{
						id: String(id ?? name),
						level: {
							name,
							value: play4FunToEngine(value),
							...(typeof minValue === 'number' ? { min: play4FunToEngine(minValue) } : {}),
							...(typeof maxValue === 'number' ? { max: play4FunToEngine(maxValue) } : {}),
						},
					},
				];
			})
		: [];

/**
 * Hand the platform tiers to the GAME (`apps/lines` `platformJackpot.svelte.ts`): a global it seeds
 * from at mount, and an `ie:platformJackpots` event for every later answer. Never called for a server
 * that sends no `platform.jackpots`, so the global stays undefined there.
 */
const publishPlatformJackpots = (levels: PlatformJackpotLevel[]): void => {
	(globalThis as { __IE_PLATFORM_JACKPOTS__?: PlatformJackpotLevel[] }).__IE_PLATFORM_JACKPOTS__ =
		levels;
	globalThis.dispatchEvent?.(new CustomEvent('ie:platformJackpots', { detail: levels }));
};

/**
 * Every answer: the platform tiers' values; and, on an answer to a `play`, a hit — which starts
 * holding its win back. Only a `play` deals one, so a heartbeat, a `config` or a `collect` that names
 * the round's jackpot again is never taken for a new hit; nor is a hit already taken for its round.
 */
const notePlatform = (sid: string, response: unknown, plays: boolean): void => {
	const platform = (response as { platform?: Record<string, unknown> } | null)?.platform;
	if (!platform || isPlay4FunError(response as Play4FunResponse)) return;
	const tiers = readPlatformJackpots(platform.jackpots);
	if (tiers.length) {
		platformTierNames.set(sid, new Map(tiers.map(({ id, level }) => [id, level.name])));
		publishPlatformJackpots(tiers.map(({ level }) => level));
	}
	const hit = (
		platform.gameRound as { jackpot?: { winJackpotId?: unknown; win?: unknown } } | undefined
	)?.jackpot;
	if (plays && hit && typeof hit.win === 'number' && hit.win > 0) {
		const id = String(hit.winJackpotId);
		const round = (platform.gameRound as { id?: unknown }).id;
		const key = typeof round === 'string' && round ? round : `${id}:${hit.win}`;
		const seen = platformHitsSeen.get(sid) ?? new Set<string>();
		platformHitsSeen.set(sid, seen);
		if (seen.has(key)) return;
		seen.add(key);
		const tier = platformTierNames.get(sid)?.get(id) ?? id;
		platformWins.set(sid, { tier, win: hit.win });
		platformLocks.set(sid, hit.win);
	}
};

/** A balance as the player may see it: the platform's, less any jackpot win still held back. */
const shownCents = (sid: string, cents: number): number => cents - (platformLocks.get(sid) ?? 0);

/**
 * A round's events with its platform jackpot hit placed for the engine: after everything the round
 * itself won — just before its `gameRoundOver` (the book's `finalWin`), or last when the round is
 * still open — so the celebration plays outside any feature. No hit ⇒ the events as they came.
 */
const withPlatformWin = (sid: string, events: Play4FunBookEvent[]): Play4FunBookEvent[] => {
	const hit = platformWins.get(sid);
	if (!hit) return events;
	platformWins.delete(sid);
	const marker = { event: PLATFORM_JACKPOT_WIN, context: hit } as unknown as Play4FunBookEvent;
	const close = events.map((e) => e.event).lastIndexOf('gameRoundOver');
	return close === -1
		? [...events, marker]
		: [...events.slice(0, close), marker, ...events.slice(close)];
};

/**
 * Release a held platform jackpot win — the engine calls it once the win's celebration has played
 * (`__IE_PLATFORM_JACKPOT_RELEASE__`) and adds what it answers (engine units) to the shown balance.
 * From then on every balance is the platform's own. Nothing held ⇒ 0.
 */
export const releasePlatformJackpot = (): number => {
	const held = [...platformLocks.values()].reduce((sum, cents) => sum + cents, 0);
	platformLocks.clear();
	return play4FunToEngine(held);
};
(globalThis as { __IE_PLATFORM_JACKPOT_RELEASE__?: () => number }).__IE_PLATFORM_JACKPOT_RELEASE__ =
	releasePlatformJackpot;

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

let resendPolicy: Partial<Play4FunResendPolicy> = {};
/** Tune how long the transport waits and resends before asking the player to reload. The defaults
 *  are `DEFAULT_RESEND_POLICY`; a fixture shortens them to walk the give-up path in milliseconds. */
export const setResendPolicy = (policy: Partial<Play4FunResendPolicy>): void => {
	resendPolicy = policy;
};

const fetcherFor = (sid: string, rgsUrl: string) => {
	const profile = getDeliveryProfile();
	const fetcher = createPlay4FunFetcher(
		{
			...rgsLocation(rgsUrl),
			resendPolicy,
			onConnection: publishRgsConnection,
			withCredentials: profile.rgs.withCredentials,
			...(profile.rgs.simpleRequest ? { contentType: 'text/plain;charset=UTF-8' } : {}),
			sid,
		},
		sessionFor(sid),
	);
	return {
		...fetcher,
		post: async (options: Parameters<typeof fetcher.post>[0]) => {
			const result = await fetcher.post(options);
			notePlatform(
				sid,
				result.response,
				options.body.some((a) => a.action === 'play'),
			);
			return result;
		},
	};
};

// ---------- balance helpers ----------

/** Pull the Play4Fun balance from a response and scale up to engine units. */
const balanceOf = (response: unknown): number | undefined => {
	if (!response || typeof response !== 'object') return undefined;
	const p4f = (response as { platform?: { balance?: number } }).platform?.balance;
	return typeof p4f === 'number' ? play4FunToEngine(p4f) : undefined;
};

/**
 * A request answered with an HTTP failure and no protocol body — a proxy's 502 page, an edge's 403.
 * Returned in the engine's error shape so it reaches the error modal, and the error report, as the
 * status it was rather than as the "empty round" or "empty balance" it would otherwise leave behind.
 */
const httpFailure = (result: Play4FunPostResult) =>
	result.response === null && (result.status < 200 || result.status >= 300)
		? {
				status: { statusCode: `ERR_HTTP_${result.status}`, statusMessage: result.statusText },
				error: `HTTP ${result.status}`,
				message: `The game server answered HTTP ${result.status} ${result.statusText}`.trim(),
			}
		: null;

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
	let configResponse = result.response;
	let cfg = captureConfig(options.sessionID, eventsOf(configResponse));

	// Some servers answer the balance probe WITHOUT the boot config and expose it as its own
	// (non-stored) `config` action instead — among them our lines mock for a game that sells an ante
	// or a buy, which sends its config ONLY when asked, so a session is pinned to its bet table only
	// by a client that asked. Ask explicitly, but only as a FALLBACK: a server that predates the
	// action answers it with an error.
	if (!cfg) {
		const probe = await fetcher.post({ body: [{ action: 'config' }] });
		configResponse = probe.response;
		cfg = captureConfig(options.sessionID, eventsOf(configResponse));
	}
	if (cfg) runConfigCrossCheck(options.sessionID, cfg);

	// A resume is up to a dozen requests in a row where a boot used to be one. A refused one costs the
	// resume, not the boot; one the transport gives up on leaves the player at the reload prompt.
	const open = findOpenRound(configResponse);
	const resumed = open
		? await resumeOpenRound(options.sessionID, fetcher, open).catch((err: unknown) =>
				abandonResume(options.sessionID, open, String(err)),
			)
		: null;
	// An ABANDONED resume may have moved the wallet on its way out — a server that did not replay took
	// the re-posted `bet` as a new stake — so the pre-resume figure is re-read rather than trusted.
	const rereadBalance = () =>
		fetcher
			.post({ body: buildHeartbeat() })
			.then((r) => (isPlay4FunError(r.response) ? undefined : balanceOf(r.response)))
			.catch(() => undefined);
	const balance = resumed
		? resumed.balance?.amount
		: ((open ? await rereadBalance() : undefined) ?? balanceOf(result.response));
	// Nothing resumed ⇒ no round of ours is open. The fetcher binds any `gameRound` a response names
	// (the re-read above included), and a `gid` left bound makes `requestBalance` stand down until the
	// next spin. So this comes LAST.
	if (!resumed) session.startRound();

	// The REAL ladder when the server declared a bet-option table and the operator's embed page
	// declared its multipliers; otherwise the invented placeholder below, which is all a mock can
	// offer. `buildBetLadder` returns null when either half is missing, so a server that declares
	// options but is opened outside an embed page still falls back rather than shipping one rung.
	// Either one is then held to the operator's `minNormalBet` / `maxNormalBet`, which bound the
	// stake whichever side priced the ladder; with neither declared it passes through untouched.
	const serverOptions = betOptionsFor(options.sessionID);
	const ladder = clampBetLadder(
		(serverOptions ? buildBetLadder(serverOptions, readHostBetSettings()) : null) ??
			wholeCreditLadder({
				betLevels: [
					// PLACEHOLDER ladder — the client inventing limits the RGS never agreed to. Reached
					// against a server that declares no `betOptions` (a lines-family game that sells
					// nothing), and against one that does when no operator embed page declares
					// `betMultipliers` (both our mocks' table games).
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
				defaultBetLevel: 1_000_000,
			}),
		readPageOperatorSettings(),
	);

	return {
		status: { statusCode: 'SUCCESS' as const },
		balance: balance !== undefined ? { amount: balance, currency: 'USD' } : undefined,
		// Synthesised config so the bet UI boots. Levels in engine API units.
		config: {
			betLevels: ladder.betLevels,
			betModes: serverOptions
				? betModesFromOptions(serverOptions)
				: { BASE: { mode: 'BASE', costMultiplier: 1, feature: false } },
			defaultBetLevel: ladder.defaultBetLevel,
			jurisdiction: {
				socialCasino: false,
				disabledFullscreen: false,
				disabledTurbo: false,
				disabledSuperTurbo: false,
				disabledAutoplay: false,
				disabledSlamstop: false,
				disabledSpacebar: false,
				// A table of ONE option declares there is nothing to buy. No table at all declares
				// nothing, so the game's own authored menu stands — which is what every server before
				// the 2-complex node, and a lines-family game that sells nothing, has always had.
				disabledBuyFeature: serverOptions?.betOptions.length === 1,
				displayNetPosition: false,
				displayRTP: false,
				displaySessionTimer: false,
				minimumRoundDuration: 0,
				// LAST, so it wins. The operator's embed page states what this launch may do; anything it
				// does NOT state keeps the value above. `hostBoolean` returns null for an absent key
				// precisely so "the operator said no" can be told from "the operator said nothing" —
				// overriding a default on silence is how a game ends up disabling turbo nobody disabled.
				...hostJurisdiction(),
			},
		},
		round: resumed?.round,
		_session: session.snapshot(),
	};
};

/**
 * A ladder priced in money, snapped to whole CREDITS — what the wire can actually stake. At the
 * protocol's 0.01 every placeholder rung is a whole number of cents already, so nothing moves; under a
 * declared `denom` a "$1.00" rung the credit cannot express (0.03 ⇒ 33.3 credits) would otherwise be
 * shown as $1.00 and charged as $0.99. The rung becomes what is charged, duplicates collapse, and the
 * opening rung follows its own snap.
 */
const wholeCreditLadder = (ladder: BetLadder): BetLadder => {
	const snap = (level: number) => play4FunToEngine(Math.max(1, engineToPlay4Fun(level)));
	return {
		betLevels: [...new Set(ladder.betLevels.map(snap))].sort((a, b) => a - b),
		defaultBetLevel: snap(ladder.defaultBetLevel),
	};
};

// ---------- resume: a round the session left open ----------

interface OpenRound {
	roundId: string;
	actions: Play4FunActionEnvelope[];
}

type ConfigEvent = Extract<Play4FunBookEvent, { event: 'config' }>;
type BetEvent = Extract<Play4FunBookEvent, { event: 'bet' }>;

/**
 * The round the boot `config` says this session left OPEN, or null.
 *
 * All three halves are needed: `resume: true`, the round's stored `actions`, and its id on
 * `platform.gameRound`. `replay` alone is the partner's HISTORY viewer, not a round owed to anyone.
 */
const findOpenRound = (response: Play4FunResponse | null): OpenRound | null => {
	if (!response || isPlay4FunError(response)) return null;
	const config = eventsOf(response).find((e): e is ConfigEvent => e.event === 'config');
	if (config?.resume !== true || !config.actions?.length) return null;
	const roundId = response.platform?.gameRound?.id;
	if (!roundId) {
		console.warn('[engine-facade] the server reports an open round but names no gameRound id');
		return null;
	}
	return { roundId, actions: config.actions };
};

/**
 * Split a round's stored actions back into the requests that wrote them: each ends at an action the
 * player drove (`play`, `collect`, a pick, a gamble), with a `bet` riding ahead of its `play`. The
 * partner's own client re-posts them in exactly these groups. It also steps over entries with an
 * EMPTY action name when looking for the next one, so those ride along with the action after them.
 */
const replayRequests = (actions: Play4FunActionEnvelope[]): Play4FunRequestBody[] => {
	const requests: Play4FunRequestBody[] = [];
	let pending: Play4FunRequestBody = [];
	for (const action of actions) {
		pending.push(action);
		if (action.action !== 'bet' && action.action !== '') {
			requests.push(pending);
			pending = [];
		}
	}
	if (pending.length) requests.push(pending);
	return requests;
};

const abandonResume = (sid: string, open: OpenRound, why: string) => {
	console.warn(
		`[engine-facade] could not finish round ${open.roundId}, left open by an earlier session (${why}) — booting without it`,
	);
	sessionFor(sid).startRound();
	pendingFinalBalance.delete(sid);
	return null;
};

/**
 * Where the engine picks a resumed round up (`round.event`, the index of the first book event it
 * PRESENTS; everything before it is folded into `createBonusSnapshot`).
 *
 * A Hold and Win feature that was mid-respin resumes at the end of what the server had already
 * stored: the snapshot keeps the last `holdAndWinState` (and the mode events), so the respin board is
 * rebuilt where the player left it, without the trigger, and only the respins still to come play.
 * Its translation is per event and in order, so the replayed actions alone translate to exactly the
 * book's first N events. Every other round — a Hold and Win round whose feature had already ended,
 * and an overlay host's round whose open bonus is its free spins — keeps `0`: the whole book plays
 * again, as it always has.
 */
const holdAndWinResumePoint = (sid: string, replayed: Play4FunBookEvent[]): number => {
	const respin = capturedHoldAndWin.get(sid);
	if (!respin) return 0;
	// An overlay host's open bonus may be its free spins, which resume as every free-spin round does.
	if (
		typeof respinModesOf(respin, capturedPotsOverlay.get(sid) ?? null, replayed).at(-1) !== 'string'
	)
		return 0;
	const names = replayed.map((e) => e.event);
	if (!names.includes('enterBonus') || names.includes('gameEnd')) return 0;
	return adaptEventsForEngine(sid, replayed).length;
};

/**
 * Finish a round a previous session left open, and hand it to the engine as the round to present.
 *
 * The protocol's resume is REPLAY: re-post the round's stored actions at the positions they were
 * stored at, under its `gid`, and the server answers each with the result it already dealt — that is
 * what an occupied `seq` means. Then the round continues live exactly as `requestBet` would have
 * carried it, so a feature interrupted between two free spins is played out and collected here.
 *
 * The engine already knows what to do with the answer: an `active` round from `authenticate` is
 * Stake's resumed bet, which the game presents from its first event and then ends through
 * `requestEndRound` — which is where a base win's `collect` happens, as for any spin. So the player
 * sees the outcome they paid for, and the balance they are left with is the one the server holds.
 *
 * Always resumed as the BASE mode. The stake was debited when the round began, so presenting it needs
 * no mode, and the resume machine — unlike a fresh bet — never drops a bought mode back to base: a
 * resumed buy would leave the NEXT spin buying again at the buy price.
 */
const resumeOpenRound = async (
	sid: string,
	fetcher: ReturnType<typeof fetcherFor>,
	open: OpenRound,
) => {
	const session = sessionFor(sid);
	session.startRound();
	session.bindRound(open.roundId);

	const replayed: Play4FunBookEvent[] = [];
	let last: Play4FunResponse | null = null;
	for (const body of replayRequests(open.actions)) {
		const r = await fetcher.post({ body });
		if (!r.response || isPlay4FunError(r.response)) {
			return abandonResume(
				sid,
				open,
				isPlay4FunError(r.response)
					? `${r.response.error} (code ${r.response.errorCode})`
					: `HTTP ${r.status}`,
			);
		}
		// The replay must land in THIS round. A server that ignored the `gid` would take the re-posted
		// `bet` as a new one — charging it again and opening a second round — and the fetcher would
		// bind that round's id without a word. Stop at the first sign of it, and say so loudly.
		const landedIn = r.response.platform?.gameRound?.id;
		if (landedIn !== open.roundId && !responseClosedRound(r.response)) {
			console.error(
				`[engine-facade] replaying round ${open.roundId} landed in ${landedIn ?? 'no round'} — the server did not replay it`,
			);
			return abandonResume(sid, open, 'the server did not replay it');
		}
		replayed.push(...eventsOf(r.response));
		last = r.response;
	}

	const round = await playOutRound(fetcher, replayed, last);
	if (round.refused) return abandonResume(sid, open, 'the server refused a step of it');

	const settled = settleRound(sid, round, 'USD');
	if (!settled.round?.state?.length) return abandonResume(sid, open, 'it replayed no events');

	const stake = replayed.find((e): e is BetEvent => e.event === 'bet')?.context;
	const serverOptions = betOptionsFor(sid);
	return {
		balance: settled.balance,
		round: {
			...settled.round,
			amount: stake ? play4FunToEngine(baseStakeCents(stake)) : undefined,
			active: true,
			mode: serverOptions ? serverBetOptionEntries(serverOptions)[0].key : 'BASE',
			event: String(holdAndWinResumePoint(sid, replayed)),
		},
	};
};

/** `requestBet`: receive a user-display amount (e.g. 2 for $2.00) — same as
 *  the original rgs-requests does. Convert to Play4Fun credits, send
 *  bet+play (auto-collect), translate + adapt the response.
 *
 *  IMPORTANT: amount is in user-display units, NOT engine API millions.
 *  The engine's createPrimaryMachines.ts passes stateBet.betAmount directly
 *  (e.g. 2), and the original rgs-requests multiplies by API_AMOUNT_MULTIPLIER
 *  internally before sending. Our facade does the equivalent: user-amount ×
 *  `play4FunAmountMultiplier()` (100 at the protocol's denom) → credits. */
export const requestBet = async (options: {
	sessionID: string;
	currency: string;
	amount: number;
	mode: string;
	rgsUrl: string;
}) => {
	// CONFIG-DRIVEN encoding, when the server declared a bet-option table: `context[0]` selects the
	// option (0 base · 1 ante · 2 buy, per `betOptionsName` — the order is NOT a contract) and
	// `context[1]` is the multiplier M. The server charges `betOptions[x] × M`, so the option index
	// carries the buy premium and M stays the BASE multiplier. A mode the table cannot name is refused
	// here, before the round starts or anything is sent.
	//
	// Without a table, the legacy lines encoding `[lineCount, betPerLine]`. The two stay apart because
	// `context[0]` means something different in each — an option index, a line count — and a line
	// count read as an option index is a garbage enum: the exact failure the partner's third game
	// (where `x` IS the line count) shows can go both ways.
	const serverOptions = betOptionsFor(options.sessionID);
	const optionIndex = serverOptions ? betOptionIndexFor(options.mode, serverOptions) : null;
	if (serverOptions && optionIndex === null) return refuseUnexpressibleMode(options.mode);

	const session = sessionFor(options.sessionID);
	const fetcher = fetcherFor(options.sessionID, options.rgsUrl);
	session.startRound();
	// A new round holds nothing back: their client zeroes `lockedPoint` on every spin, so a win whose
	// celebration never released it stops being held here at the latest.
	platformLocks.delete(options.sessionID);
	platformWins.delete(options.sessionID);

	// User-display dollars → Play4Fun cents.
	const play4FunAmount = Math.max(1, Math.round(options.amount * play4FunAmountMultiplier()));

	const betBody: ReturnType<typeof buildBetActions> =
		serverOptions && optionIndex !== null
			? [
					{
						action: 'bet',
						context: [optionIndex, multiplierForAmount(options.amount, serverOptions)],
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
	if (!serverOptions) warnOnStakeRounding(options.sessionID, betBody, play4FunAmount);

	const first = await fetcher.post({ body: betBody });
	const failed = httpFailure(first);
	if (failed) return failed;

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
	const cfg = captureConfig(options.sessionID, eventsOf(first.response));
	if (cfg) runConfigCrossCheck(options.sessionID, cfg);

	const round = await playOutRound(fetcher, eventsOf(first.response), first.response);
	// A feature cut short has no `gameEnd`, so presenting it parks the player inside it for good. The
	// reload this asks for boots on the server's truth: the round resumed where it stands, or — if the
	// server no longer holds it — its balance. A feature played to its end whose `collect` alone was
	// refused is presented as before, and `requestEndRound` collects it.
	if (round.refused && !featureEnded(round.events)) {
		console.error(
			`[engine-facade] the server refused a step of round ${session.gid ?? '(unbound)'} mid-feature: ${round.refusal} — asking the player to reload`,
		);
		fetcher.abandon(`the server refused a step of the feature: ${round.refusal}`);
	}
	return settleRound(options.sessionID, round, options.currency);
};

const eventsOf = (response: Play4FunResponse | null): Play4FunBookEvent[] =>
	(response as { events?: Play4FunBookEvent[] } | null)?.events ?? [];

interface PlayedRound {
	events: Play4FunBookEvent[];
	last: Play4FunResponse | null;
	/** A request inside the feature was refused (its error, when the server gave one). Driving stops
	 *  there: `requestBet` gives the session up for a reload, a resume boots without the round. */
	refused: boolean;
	refusal?: string;
}

/** The FEATURE's `gameEnd` — one after the bonus began, so a base-spin `gameEnd` ahead of it
 *  cannot end the free spins before they are played. */
const featureEnded = (events: Play4FunBookEvent[]) => {
	const names = events.map((e) => e.event);
	return names.slice(names.lastIndexOf('enterBonus')).includes('gameEnd');
};

/**
 * Drive a round to the end of what the player sees, and aggregate it into one event stream.
 *
 * The engine consumes a round as a single book; Play4Fun delivers free spins as separate `play`
 * requests, so a round that entered the bonus has its remaining spins and its closing `collect`
 * driven here. A base round is left as it is: its `collect`, when the server does not auto-collect,
 * is `requestEndRound`'s, after the count-up.
 *
 * Idempotent over a round that is already further along — a resume can arrive with some free spins,
 * the `gameEnd`, or even the `collect` already replayed, and must not post any of them twice.
 */
const playOutRound = async (
	fetcher: ReturnType<typeof fetcherFor>,
	events: Play4FunBookEvent[],
	last: Play4FunResponse | null,
): Promise<PlayedRound> => {
	const round: PlayedRound = { events: [...events], last, refused: false };
	const names = () => round.events.map((e) => e.event);
	const post = async (body: Play4FunRequestBody) => {
		const r = await fetcher.post({ body });
		// An error envelope carries an empty `platform`, so keeping it as `last` would settle the
		// round on a balance of 0.
		if (!r.response || isPlay4FunError(r.response)) {
			round.refused = true;
			round.refusal = isPlay4FunError(r.response)
				? `${r.response.error} (code ${r.response.errorCode})`
				: `HTTP ${r.status}`;
			return;
		}
		round.events.push(...eventsOf(r.response));
		round.last = r.response;
	};

	if (!names().includes('enterBonus')) return round;
	let guard = 0;
	while (!featureEnded(round.events) && !round.refused && guard++ < 200)
		await post([{ action: 'play' }]);
	if (!round.refused && !names().includes('gameRoundOver')) await post(buildCollectAction());
	return round;
};

/**
 * Translate a played round for the engine, and split its balance into the two steps the engine
 * shows: the interim now (stake debited, win NOT yet credited) and the final stashed for
 * `requestEndRound` to return after the count-up animation.
 */
const settleRound = (sid: string, round: PlayedRound, currency: string) => {
	const allEvents = withPlatformWin(sid, round.events);
	const lastResponse = round.last;
	const aggregated = {
		events: allEvents,
		platform: (lastResponse as { platform?: unknown } | null)?.platform,
	} as Play4FunResponse;
	const translated = translateBetResponse(aggregated, currency);

	const finalCents =
		(lastResponse as { platform?: { balance?: number } } | null)?.platform?.balance ?? 0;
	// The LAST `gameEnd` is the round's — the one `translateBetResponse` pays out on too.
	const winCents =
		(
			[...allEvents].reverse().find((e) => e.event === 'gameEnd')?.context as
				{ win?: number } | undefined
		)?.win ?? 0;
	// Whether the reported balance ALREADY includes the win depends on whether the round closed.
	//
	// Auto-collecting server: `gameRoundOver` is in the events, the balance is final, and the interim
	// the engine wants (bet debited, win not yet credited) is that minus the win.
	// Partner server: the round is still open, so the reported balance IS the interim — subtracting
	// the win again would show a balance lower than the player ever had, and stashing it as "final"
	// would credit a win that the missing `collect` never paid.
	const roundClosed = allEvents.some((e) => e.event === 'gameRoundOver');
	// A platform jackpot win is inside the reported balance too; it is shown only once its celebration
	// releases it. The stashed final stays whole: the engine applies it after the round has played.
	const interimCents = shownCents(sid, roundClosed ? finalCents - winCents : finalCents);
	if (roundClosed) pendingFinalBalance.set(sid, finalCents);

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
			translated.round.state = adaptEventsForEngine(sid, translated.round.state) as never;
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
 *  - The request failed, or the session is busy — a spin in flight, a resend under way, or the
 *    connection given up on. A poll is one attempt, never queued behind a spin and never the reason
 *    a reconnect screen appears: the player's next action finds out, with its own resends. A poll
 *    that cannot reach the server leaves the last known balance alone; blanking the HUD on a
 *    dropped packet is worse than a slightly stale number.
 */
export const requestBalance = async (options: { sessionID: string; rgsUrl: string }) => {
	const session = sessionFor(options.sessionID);
	if (session.gid || !isSessionIdle(session)) {
		return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };
	}

	try {
		const result = await fetcherFor(options.sessionID, options.rgsUrl).post({
			body: buildHeartbeat(),
			resend: false,
		});
		if (isPlay4FunError(result.response)) {
			return { status: { statusCode: 'SKIPPED' as const }, balance: undefined };
		}
		refreshHoldAndWinJackpots(options.sessionID, result.response);
		const balance = balanceOf(result.response);
		const held = play4FunToEngine(platformLocks.get(options.sessionID) ?? 0);
		return {
			status: { statusCode: 'SUCCESS' as const },
			balance: balance !== undefined ? { amount: balance - held, currency: 'USD' } : undefined,
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
		const failed = httpFailure(collectResult);
		if (failed) return failed;
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
	const failed = httpFailure(result);
	if (failed) return failed;
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
