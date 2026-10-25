/**
 * Mock Play4Fun RGS server — MATCH-3 variant (docs/design/game-families.md §2.2, P10.6).
 *
 * ⚠️ THE WIRE IS OURS. No provider has shown us a match-3 round, so the `move` action, the
 * `match3Board` / `match3Move` / `match3End` events and the boot `config.match3` block are invented
 * and documented as a SWAP SEAM in docs/reference/match3-wire.md. They are rewritten when a real
 * provider delivers its format; nothing above the facade may depend on them. What IS the partner's:
 * the transport, `seq` as a position, the stored-action replay at an occupied position, resume
 * through the boot `config`, `bet` + `play` to open a round, `gameEnd {win}` and an explicit
 * `collect` that closes it with `gameRoundOver`.
 *
 * The board rules are `packages/engine-mechanics/src/board.js` — the same module the client runs —
 * never a copy: this mock only decides the refills and the money.
 *
 * THE MATH IS FIXED AT THE BET (the wire doc's "The mock's math"): the round's total is drawn from
 * `MATCH3_TOTAL_TABLE` when it opens, each cascade step pays the paytable's price of its groups
 * capped at what is left, the refills are steered from the column strips so the next match fits,
 * and `match3End.settle` pays the remainder, so `totalWin` is always the total drawn.
 *
 * The game is the project's Game Config as the launcher hands it over (`match3MockInputs` in
 * packages/game-config): board size, one refill strip per column, minRun, moves and the paytable.
 * With no (or malformed) inputs it stands up on a small built-in game, so a match-3 entry whose
 * mock is never asked (a rules-decided game) cannot break the server.
 *
 * Forced outcomes: `play.context = "force:<multiple>"` draws that multiple of the stake instead of
 * the table, only where `allowForce` (the test server allows it on an authoring mock only).
 *
 * Run standalone: node scripts/mock-rgs-server-match3.mjs
 *   PORT=7801 · SEED=… · START_BALANCE=10000 · CONFIG=<raw Game Config .json> (a match-3 doc)
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
	canSwap,
	clear,
	createBoard,
	createRng,
	DEFAULT_MIN_RUN,
	findMatches,
	gravity,
	hasMoves,
	refill,
	swap,
} from '../packages/engine-mechanics/src/board.js';

/** The version of docs/reference/match3-wire.md this mock speaks; the boot block carries it. */
export const MATCH3_WIRE = 1;

/** The round totals, as multiples of the stake, and their weights (they sum to 100; mean 0.96). */
export const MATCH3_TOTAL_TABLE = Object.freeze(
	[
		{ multiple: 0, weight: 49.5 },
		{ multiple: 0.5, weight: 20 },
		{ multiple: 1, weight: 14 },
		{ multiple: 2, weight: 10 },
		{ multiple: 5, weight: 5 },
		{ multiple: 10, weight: 1.2 },
		{ multiple: 50, weight: 0.3 },
	].map((row) => Object.freeze(row)),
);

/** Moves a round allows when the config names none. */
const DEFAULT_MOVES = 10;
/** Candidate refills read from the strips per step. */
const REFILL_CANDIDATES = 16;
/** Past this many steps in one move only a refill that makes no match is taken. */
const MAX_STEPS = 50;

const DEFAULT_GEMS = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2'];
const DEFAULT_PAYTABLE = {
	H1: { 3: 0.5, 4: 1, 5: 2.5 },
	H2: { 3: 0.4, 4: 0.8, 5: 2 },
	H3: { 3: 0.3, 4: 0.6, 5: 1.5 },
	H4: { 3: 0.25, 4: 0.5, 5: 1 },
	L1: { 3: 0.1, 4: 0.2, 5: 0.5 },
	L2: { 3: 0.1, 4: 0.2, 5: 0.5 },
};

/** The built-in game: 7×7, the six gems on strips read from a fixed seed. */
const defaultGame = () => {
	const draw = createRng('match3-default-strips');
	const strips = Array.from({ length: 7 }, () =>
		Array.from({ length: 30 }, () => DEFAULT_GEMS[Math.floor(draw() * DEFAULT_GEMS.length)]),
	);
	return {
		cols: 7,
		rows: 7,
		strips,
		minRun: DEFAULT_MIN_RUN,
		moves: DEFAULT_MOVES,
		paytable: DEFAULT_PAYTABLE,
	};
};

const isCount = (n) => Number.isInteger(n) && n > 0;

/** The inputs as the mock plays them, or null when they cannot stand up a board. */
const readGame = (raw) => {
	if (!raw || typeof raw !== 'object') return null;
	const { cols, rows, strips } = raw;
	if (!isCount(cols) || !isCount(rows)) return null;
	if (
		!Array.isArray(strips) ||
		strips.length !== cols ||
		!strips.every((s) => Array.isArray(s) && s.length && s.every((n) => typeof n === 'string' && n))
	)
		return null;
	const minRun = raw.minRun === undefined ? DEFAULT_MIN_RUN : raw.minRun;
	if (!Number.isInteger(minRun) || minRun < 2) return null;
	const moves = raw.moves === undefined ? DEFAULT_MOVES : raw.moves;
	if (!isCount(moves)) return null;
	const paytable = {};
	if (raw.paytable && typeof raw.paytable === 'object') {
		for (const [symbol, row] of Object.entries(raw.paytable)) {
			if (!row || typeof row !== 'object') continue;
			const clean = {};
			for (const [count, pay] of Object.entries(row)) {
				const n = Number(count);
				if (Number.isInteger(n) && n > 0 && typeof pay === 'number' && pay > 0) clean[n] = pay;
			}
			if (Object.keys(clean).length) paytable[symbol] = clean;
		}
	}
	return { cols, rows, strips: strips.map((s) => [...s]), minRun, moves, paytable };
};

// ---------- pure HTTP plumbing (the book mock's) ----------

const corsHeaders = (req) => {
	const origin = req.headers.origin;
	if (origin) {
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			Vary: 'Origin',
		};
	}
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
};
const sendJson = (req, res, status, body) => {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		...corsHeaders(req),
		'Content-Length': Buffer.byteLength(text),
	});
	res.end(text);
};
const sendCorsPreflight = (req, res) => {
	res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Max-Age': '86400' });
	res.end();
};
const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
const pathEndsWith = (pathname, route) => {
	const p = pathname.replace(/\/+$/, '') || '/';
	return p === route || p.endsWith(route);
};
const makeRoundId = () => 'G' + Math.random().toString(36).slice(2, 14);

const refuse = (req, res, session, error, errorCode = 110) =>
	sendJson(req, res, 200, {
		result: 0,
		error,
		errorCode,
		platform: session ? { balance: session.balance } : {},
	});

/** A request cell `[reel, row]`, or null when it is not two whole numbers. */
const readCell = (raw) =>
	Array.isArray(raw) && raw.length === 2 && raw.every(Number.isInteger)
		? { reel: raw[0], row: raw[1] }
		: null;

const namesOf = (board) => board.cells.map((column) => column.map((cell) => cell.name));

// ---------- factory ----------

/**
 * @param {{ label?: string, allowForce?: boolean, seed?: string | number, startBalance?: number,
 *   quiet?: boolean,
 *   match3?: { cols: number, rows: number, strips: string[][], minRun?: number, moves?: number,
 *     paytable?: Record<string, Record<string, number>> } }} opts
 */
export function createMockRgs(opts = {}) {
	const label = opts.label ?? 'mock-match3';
	/** Whether a client may force a round's total (`play.context`). */
	const allowForce = opts.allowForce !== false;
	const quiet = opts.quiet === true;
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;
	const rand = createRng(seed ?? Math.floor(Math.random() * 2 ** 32));

	const game = (() => {
		const read = readGame(opts.match3);
		try {
			// The strips must deal a playable board, or every bet would throw: fail over now instead.
			if (read) createBoard({ ...read, pool: read.strips, rng: createRng('match3-probe') });
			if (read) return read;
		} catch {
			// Falls through to the built-in game below.
		}
		if (opts.match3 !== undefined && !quiet) {
			console.warn(`[${label}] match3 inputs that deal no board — dealing the built-in 7×7 game`);
		}
		return defaultGame();
	})();
	const { cols, rows, strips, minRun, moves, paytable } = game;
	const symbols = [...new Set(strips.flat())];

	/** A board value over plain cells — the round keeps names only, so it clones and stores. */
	const boardOf = (names) =>
		createBoard({ cols, rows, minRun, cells: names.map((c) => c.map((name) => ({ name }))) });

	const configContext = () => ({
		symbols,
		window: { reels: cols, rows },
		paylines: [],
		wildSymbols: [],
		paytable: Object.fromEntries(
			Object.entries(paytable).map(([symbol, row]) => {
				const counts = Object.keys(row)
					.map(Number)
					.sort((a, b) => a - b);
				return [symbol, { occurs: counts, pay: counts.map((c) => row[c]) }];
			}),
		),
		match3: { wire: MATCH3_WIRE, minRun, moves },
	});

	const drawMultiple = () => {
		let x = rand() * 100;
		for (const row of MATCH3_TOTAL_TABLE) {
			x -= row.weight;
			if (x < 0) return row.multiple;
		}
		return MATCH3_TOTAL_TABLE[0].multiple;
	};

	/** One group's price, in cents: `pay` at the largest `occurs` ≤ its size, × the whole stake. */
	const priceOf = (groups, stake) => {
		let sum = 0;
		for (const group of groups) {
			const row = paytable[group.symbol];
			if (!row) continue;
			let best = 0;
			let bestCount = 0;
			for (const [count, pay] of Object.entries(row)) {
				const n = Number(count);
				if (n <= group.cells.length && n > bestCount) {
					bestCount = n;
					best = pay;
				}
			}
			sum += best * stake;
		}
		return Math.round(sum);
	};

	/** A refill read from each column's strip at a random stop, exactly filling its holes. */
	const readRefill = (holes) =>
		holes.map((count, reel) => {
			if (!count) return [];
			const strip = strips[reel];
			const from = Math.floor(rand() * strip.length);
			return Array.from({ length: count }, (_, i) => ({ name: strip[(from + i) % strip.length] }));
		});

	/**
	 * Choose the refill after a cleared, fallen board. In order of preference: (when something is
	 * left) one whose next match fits what is left; one that makes no match and leaves a move; (only
	 * while the chain is short) any match, capped like every step; one that makes no match at all —
	 * the round then ends `noMoves`.
	 */
	const steerRefill = (fallen, left, stake, steps) => {
		const holes = fallen.cells.map((column) => column.filter((cell) => !cell).length);
		let settles = null;
		let matches = null;
		let stuck = null;
		for (let i = 0; i < REFILL_CANDIDATES; i++) {
			const filled = refill(fallen, readRefill(holes));
			const groups = findMatches(filled.board);
			if (groups.length) {
				if (steps >= MAX_STEPS) continue;
				if (left > 0 && priceOf(groups, stake) <= left) return filled;
				matches ??= filled;
			} else if (hasMoves(filled.board)) {
				if (left === 0) return filled;
				settles ??= filled;
			} else {
				stuck ??= filled;
			}
		}
		return settles ?? matches ?? stuck ?? refill(fallen, readRefill(holes));
	};

	/** Play an accepted swap through its cascade; returns the steps and the settled board. */
	const playMove = (round, from, to) => {
		let board = swap(boardOf(round.board), from, to);
		const steps = [];
		for (;;) {
			const groups = findMatches(board);
			if (!groups.length) break;
			const left = round.total - round.roundWin;
			const win = Math.min(priceOf(groups, round.stake), left);
			round.roundWin += win;
			const exploding = groups
				.flatMap((g) => g.cells)
				.sort((a, b) => a.reel - b.reel || a.row - b.row);
			const fallen = gravity(clear(board, groups)).board;
			const filled = steerRefill(fallen, round.total - round.roundWin, round.stake, steps.length);
			steps.push({
				exploding,
				newSymbols: filled.newSymbols.map((column) => column.map((cell) => cell.name)),
				win,
				roundWin: round.roundWin,
			});
			board = filled.board;
		}
		round.board = namesOf(board);
		return { steps, board };
	};

	// ---- sessions ----
	const sessions = new Map();
	const settledRounds = new Map();
	const settle = (sid, round) => {
		settledRounds.set(`${sid}:${round.id}`, round);
		if (settledRounds.size > 500) settledRounds.delete(settledRounds.keys().next().value);
	};
	const getSession = (sid) => {
		if (!sessions.has(sid))
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		return sessions.get(sid);
	};

	// ---- the engine endpoint ----
	const handleEngine = async (req, res, url) => {
		const sid = url.searchParams.get('sid');
		const seq = Number(url.searchParams.get('seq') ?? 0);
		const gid = url.searchParams.get('gid');
		if (!sid)
			return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'missing sid' } });
		const session = getSession(sid);
		let actions;
		try {
			const text = await readBody(req);
			actions = text ? JSON.parse(text) : [];
		} catch {
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be JSON array' },
			});
		}
		if (!Array.isArray(actions)) {
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be an array' },
			});
		}
		if (!quiet) {
			console.log(
				`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a?.action))}`,
			);
		}

		const events = [];
		const openRound = (round) => ({ updating: true, id: round.id });
		const sendConfig = () => {
			session.configSent = true;
			const config = { event: 'config', context: configContext() };
			if (session.round) {
				config.actions = session.round.stored.map((s) => s.action);
				config.resume = true;
			}
			events.push(config);
		};
		if (!session.configSent) sendConfig();
		if (actions.length === 0) {
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = openRound(session.round);
			return sendJson(req, res, 200, { events, platform });
		}

		// A batch is ATOMIC: a refusal anywhere in it stores nothing, charges nothing and consumes
		// nothing — the partner's rule, and the only one under which a resend is safe.
		const saved = {
			balance: session.balance,
			round: session.round ? structuredClone(session.round) : session.round,
		};
		const settledBefore = new Set(settledRounds.keys());
		const rollback = () => {
			session.balance = saved.balance;
			session.round = saved.round;
			for (const k of settledRounds.keys()) if (!settledBefore.has(k)) settledRounds.delete(k);
		};
		const fail = (error, code = 110) => {
			rollback();
			return refuse(req, res, session, error, code);
		};

		let round = session.round;
		// `config` is never stored, so it takes no position — only stored actions advance this.
		let position = seq;
		try {
			for (const a of actions) {
				if (a?.action === 'config') {
					if (!events.some((e) => e.event === 'config')) sendConfig();
					continue;
				}
				const target = !gid
					? undefined
					: round?.id === gid
						? round
						: settledRounds.get(`${sid}:${gid}`);
				const stored = target?.stored[position];
				if (stored) {
					if (stored.action.action !== a?.action) {
						return fail(
							`replay mismatch at ${position}: stored ${stored.action.action}, got ${a?.action}`,
						);
					}
					events.push(...stored.events);
					position += 1;
					continue;
				}
				const open = round && !round.closed;
				// While a round is open only its own actions are taken: a `move` until it ends, then the
				// `collect` that closes it (`play` belongs to the request that opened it).
				if (open && round.played && a?.action !== 'move' && a?.action !== 'collect') {
					return fail(`a match-3 round is open (${round.id}): only move or collect`, 102);
				}
				if (open && a?.action === 'bet') {
					return fail(`a match-3 round is open (${round.id}): only move or collect`, 102);
				}
				if ((a?.action === 'move' || a?.action === 'collect') && (!open || !round.played)) {
					return fail(`error executing requested actions: ${a.action} with no open round`, 102);
				}
				if (a?.action === 'move' && round.ended) {
					return fail('error executing requested actions: move after the round ended', 102);
				}
				// A fresh action goes to the NEXT free position of its round, and nowhere else.
				const next = a?.action === 'bet' ? 0 : (round?.stored.length ?? 0);
				if (position !== next) return fail(`seq ${position} is not the next position (${next})`);
				if (a?.action !== 'bet' && round?.played && gid !== round.id) {
					return fail(`${a?.action} under gid ${gid ?? '-'}, but the open round is ${round.id}`);
				}
				const dealtFrom = events.length;
				switch (a?.action) {
					case 'bet': {
						const ctx = Array.isArray(a.context) ? a.context : [1, 1];
						const lines = Number(ctx[0] ?? 1);
						const betPerLine = Number(ctx[1] ?? 1);
						if (!(lines > 0) || !(betPerLine > 0) || !Number.isFinite(lines * betPerLine)) {
							return fail(`invalid bet [${ctx[0]}, ${ctx[1]}]`, 101);
						}
						const total = Math.max(1, Math.round(lines * betPerLine));
						if (session.balance < total) return fail('insufficient balance', 200);
						session.balance -= total;
						round = {
							id: makeRoundId(),
							stake: total,
							betPerLine,
							total: 0,
							roundWin: 0,
							win: 0,
							movesLeft: moves,
							board: null,
							played: false,
							ended: null,
							closed: false,
							stored: [],
						};
						events.push({
							event: 'bet',
							context: { total, betPerLine, paylines: [], maxWinCap: 0 },
						});
						events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
						break;
					}
					case 'play': {
						if (!round || round.closed) {
							return fail('error executing requested actions: play without bet');
						}
						let multiple;
						if (typeof a.context === 'string' && a.context.startsWith('force:')) {
							if (!allowForce) return fail('forcing is off on this mock', 101);
							multiple = Number(a.context.slice('force:'.length));
							if (!Number.isFinite(multiple) || multiple < 0) {
								return fail(`force: "${a.context}" is not a multiple of the stake`, 101);
							}
						} else {
							multiple = drawMultiple();
						}
						round.total = Math.round(multiple * round.stake);
						const board = createBoard({ cols, rows, minRun, pool: strips, rng: rand });
						round.board = namesOf(board);
						round.played = true;
						events.push({
							event: 'match3Board',
							context: { board: round.board, movesLeft: round.movesLeft },
						});
						break;
					}
					case 'move': {
						const from = readCell(a.context?.from);
						const to = readCell(a.context?.to);
						if (!from || !to) {
							return fail('move: from and to must each be [reel, row]', 101);
						}
						const accepted = canSwap(boardOf(round.board), from, to);
						if (!accepted) {
							events.push({
								event: 'match3Move',
								context: {
									from,
									to,
									accepted: false,
									steps: [],
									movesLeft: round.movesLeft,
									roundWin: round.roundWin,
									board: round.board,
								},
							});
							break;
						}
						const { steps, board } = playMove(round, from, to);
						round.movesLeft -= 1;
						events.push({
							event: 'match3Move',
							context: {
								from,
								to,
								accepted: true,
								steps,
								movesLeft: round.movesLeft,
								roundWin: round.roundWin,
								board: round.board,
							},
						});
						const reason = round.movesLeft <= 0 ? 'movesUsed' : !hasMoves(board) ? 'noMoves' : null;
						if (reason) {
							round.ended = reason;
							round.win = round.total;
							events.push({
								event: 'match3End',
								context: {
									totalWin: round.total,
									reason,
									settle: round.total - round.roundWin,
								},
							});
							events.push({ event: 'gameEnd', context: { win: round.total } });
						}
						break;
					}
					case 'collect': {
						if (!round.ended) {
							return fail(
								'error executing requested actions: unexpected action: collect (the round has moves left)',
							);
						}
						session.balance += round.win;
						round.closed = true;
						events.push({ event: 'gameRoundOver', context: { win: round.win } });
						break;
					}
					default:
						return fail(`error executing requested actions: unknown action: ${a?.action}`);
				}
				round.stored[position] = { action: a, events: events.slice(dealtFrom) };
				position += 1;
			}
		} catch (err) {
			rollback();
			throw err;
		}

		if (round?.closed) settle(sid, round);
		session.round = round && !round.closed ? round : null;
		const platform = { balance: session.balance };
		if (session.round) platform.gameRound = openRound(session.round);
		return sendJson(req, res, 200, { events, platform });
	};

	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz')) {
			return sendJson(req, res, 200, { ok: true, sessions: sessions.size, protocol: 'match3' });
		}
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/state')) {
			const sid = url.searchParams.get('sid');
			if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
			const { round, ...session } = getSession(sid);
			return sendJson(req, res, 200, {
				...session,
				round: round && {
					id: round.id,
					stored: round.stored.length,
					movesLeft: round.movesLeft,
					roundWin: round.roundWin,
					ended: round.ended,
				},
			});
		}
		if (req.method === 'POST' && pathEndsWith(url.pathname, '/rgs/engine')) {
			try {
				return await handleEngine(req, res, url);
			} catch (err) {
				console.error(`[${label}] handler error:`, err);
				return sendJson(req, res, 500, { error: { code: 'ERR_UE', message: String(err) } });
			}
		}
		return sendJson(req, res, 404, { error: 'not found' });
	};

	return { handle, sessions, startBalance, seed };
}

// ---------- standalone CLI entry (local dev) ----------

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
	let match3;
	if (process.env.CONFIG) {
		const gameConfig = await import('../packages/game-config/index.ts');
		const doc = gameConfig.normalizeGameConfigDoc(
			JSON.parse(readFileSync(process.env.CONFIG, 'utf8')),
		);
		match3 = doc ? gameConfig.match3MockInputs(doc) : undefined;
		if (!match3) {
			console.error(`[mock-match3] CONFIG=${process.env.CONFIG} is not a match-3 Game Config`);
			process.exit(1);
		}
	}
	const PORT = Number(process.env.PORT ?? 7801);
	const mock = createMockRgs({ label: 'mock-match3', match3 });
	createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, `http://${req.headers.host}`)),
	).listen(PORT, () => {
		console.log(
			`[mock-match3] match-3 on http://localhost:${PORT}  balance=${mock.startBalance} seed=${mock.seed ?? '(time)'}`,
		);
	});
}
