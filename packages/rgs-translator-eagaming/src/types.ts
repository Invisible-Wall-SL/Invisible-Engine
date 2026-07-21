/**
 * Wire-format types for the Play4Fun RGS protocol.
 *
 * The "EAGaming" brand wrapper proxies through to a Play4Fun RGS host (e.g.
 * www.best00qpin.com). Naming kept as `rgs-translator-eagaming` for now;
 * may rename to `rgs-translator-play4fun` once we've verified the protocol
 * is the same across other Play4Fun-backed brands.
 *
 * Captured from a real Hot Fruits session via in-tab fetch/XHR sniffer
 * (scripts/console-sniffer.js). See bottom of this file for sample payloads.
 */

// ---------- Outbound (request) ----------

/** Bet context: pair of integers. First is observed as 5 (likely a "lines"
 *  config selector or stake multiplier); second is bet-per-line. Total stake
 *  = a * b in the cases observed (5 × 2 = 10). */
export type BetContext = [number, number];

/** play.context controls round flow:
 *   - null: keep round open; client must send a separate `collect` action.
 *   - '':   auto-collect; gameRoundOver event is embedded in the same response.
 */
export type PlayContext = null | '';

export type CollectContext = undefined;

export type Play4FunActionEnvelope =
	| { action: 'bet'; context: BetContext }
	| { action: 'play'; context: PlayContext }
	| { action: 'collect' }
	| { action: string; context?: unknown };

export type Play4FunRequestBody = Play4FunActionEnvelope[];

export interface Play4FunRequestQuery {
	sid: string;
	seq: number;
	gid?: string; // present when continuing an in-flight round
}

// ---------- Inbound (response) ----------

/** Per-symbol paytable entry. Play4Fun expresses payouts as parallel arrays:
 *  `occurs[i]` matches `pay[i]`. Both are typically length 3 ([3,4,5] of-a-kind),
 *  but lower-tier symbols may include `[2,3,4,5]` if they pay on 2-of-a-kind. */
export interface Play4FunPaytableEntry {
	occurs: number[];
	pay: number[];
}

/** Boot-time game declaration. The real Play4Fun server emits this as the first
 *  event of every session — symbols, grid, paylines, paytable, all in one
 *  place. We use it for two purposes in the facade:
 *    (a) build a whitelist to filter unknown symbols / out-of-grid positions
 *    (b) cross-check against the consumer's static config and warn on drift. */
export interface Play4FunConfigContext {
	/** Closed vocabulary of symbols the server will ever emit. */
	symbols: string[];
	/** Visible grid dimensions. */
	window: { reels: number; rows: number };
	/** Active paylines — the real Play4Fun wire field is `availablePayLines`
	 *  (NOT `paylines`, which is the per-round *bet* event's field). Each entry is
	 *  one row-index per reel. */
	availablePayLines: number[][];
	/** Wild-acting symbols. Hot Fruits sends []. */
	wildSymbols: string[];
	/** Per-symbol payout table. */
	paytable: Record<string, Play4FunPaytableEntry>;
	/** Open bag of additional fields the server may include (RTP, jurisdiction,
	 *  freegame structure, etc.). We don't model them — they pass through. */
	[extra: string]: unknown;
}

/** Each event mirrors the Stake Engine book-event shape: a tagged record with
 *  an `event` discriminator and a context payload whose shape depends on the
 *  tag. Listed below are the events we've observed; treat the union as open. */
export type Play4FunBookEvent =
	| { event: 'config'; context: Play4FunConfigContext }
	| { event: 'bet'; context: { total: number; betPerLine: number; paylines: number[][]; maxWinCap: number } }
	| { event: 'gameStart'; context: { totalBet: number; betPerLine: number } }
	| {
			event: 'spinStart';
			context: {
				symbols: string[];
				symbolsPay: { line: string[]; scatter: string[] };
				wildSymbols: string[];
				lineAlign: 'left' | 'right' | string;
				lineCoinciding: boolean;
			};
	  }
	| {
			event: 'spinWin';
			context: {
				what: string;
				occurs: number;
				mode: 'line' | 'scatter' | string;
				pay: number;
				mpInfo?: { mp: number; replacements: number };
				mpBonusInfo?: unknown;
				context?: { paylineId?: number; payline?: number[]; direction?: string };
			};
	  }
	/** Reel result: outer array = reels (5 in Hot Fruits), inner = symbols on that reel top→bottom. */
	| { event: 'playedSpin'; context: string[][] }
	| { event: 'gameEnd'; context: { win: number } }
	| { event: 'gameRoundOver'; context: { win: number } }
	| { event: string; context: unknown };

export interface Play4FunPlatformBlock {
	balance: number;
	gameRound?: {
		updating: boolean;
		id: string;
	};
}

/** Success response: events + platform are present, no error fields. */
export interface Play4FunSuccessResponse {
	events: Play4FunBookEvent[];
	platform: Play4FunPlatformBlock;
}

/** Error response: server returns this shape on a rejected request. Captured
 *  example (errorCode 110): `{result:0, error:"...", errorCode:110, platform:{}}`.
 *  Note: `platform` is present but typically empty, and `events` is omitted. */
export interface Play4FunErrorResponse {
	result: 0;
	error: string;
	errorCode: number;
	platform: Partial<Play4FunPlatformBlock>;
	events?: undefined;
}

export type Play4FunResponse = Play4FunSuccessResponse | Play4FunErrorResponse;

/** Type guard: did the server return an error envelope? */
export const isPlay4FunError = (r: Play4FunResponse | null | undefined): r is Play4FunErrorResponse =>
	!!r && typeof (r as Play4FunErrorResponse).error === 'string' && typeof (r as Play4FunErrorResponse).errorCode === 'number';

/** Known error codes (extend as we discover more). */
export const Play4FunErrorCodes = {
	UNEXPECTED_ACTION: 110, // e.g. "unexpected action: collect (was expecting: play)"
} as const;

// ---------- Transport config ----------

export interface Play4FunTransportConfig {
	/** Origin for the RGS, e.g. 'https://www.best00qpin.com'. Empty string for
	 *  same-origin (recommended when running inside the game iframe). */
	baseUrl: string;
	/** Path of the engine endpoint. Default: '/rgs/engine'. */
	endpoint?: string;
	sid: string;
	fetchImpl?: typeof fetch;
}

// ---------- Back-compat aliases (will remove on rename to play4fun) ----------

export type EAGamingAction = Play4FunActionEnvelope['action'];
export type EAGamingActionEnvelope<TContext = unknown> = { action: string; context: TContext };
export type EAGamingRequestBody = Play4FunRequestBody;
export type EAGamingRequestQuery = Play4FunRequestQuery;
export type EAGamingResponse = Play4FunResponse;
export type EAGamingTransportConfig = Play4FunTransportConfig;

/* ---------- Sample payloads (for reference) ----------

  // heartbeat (no actions, just balance check)
  POST /rgs/engine?sid=S27932&seq=0
  []
  → { events: [], platform: { balance: 1300 } }

  // bet + play (manual-collect mode — round stays open)
  POST /rgs/engine?sid=S27932&seq=0
  [{action:'bet', context:[5,2]}, {action:'play', context:null}]
  → {
      events: [
        {event:'bet',         context:{total:10, betPerLine:2, paylines:[…], maxWinCap:0}},
        {event:'gameStart',   context:{totalBet:10, betPerLine:2}},
        {event:'spinStart',   context:{symbols:[…], …}},
        {event:'spinWin',     context:{what:'PIC4', occurs:3, mode:'line', pay:40, …}},
        {event:'playedSpin',  context:[[…reel0…],[…reel1…],…]},
        {event:'gameEnd',     context:{win:40}},
      ],
      platform: { gameRound:{updating:true, id:'G0001757a4de7'}, balance: 1290 }
    }

  // collect (close the round, credits the win)
  POST /rgs/engine?sid=S27932&seq=2&gid=G0001757a4de7
  [{action:'collect'}]
  → { events: [{event:'gameRoundOver', context:{win:40}}], platform: { balance: 1330, … } }

  // bet + play with auto-collect (single round-trip)
  POST /rgs/engine?sid=S27932&seq=0
  [{action:'bet', context:[5,2]}, {action:'play', context:''}]
  → events include gameRoundOver embedded; balance settles in one request.

---------- end samples ---------- */
