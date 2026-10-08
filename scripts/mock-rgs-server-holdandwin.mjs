/**
 * Mock Play4Fun RGS server — HOLD AND WIN variant (docs/design/hold-and-win.md, Phase 3).
 *
 * ⚠️ THE WIRE IS OURS. The partner has not shown us a Hold and Win round, so every Hold and Win
 * event here is invented and documented as a SWAP SEAM in docs/reference/hold-and-win-wire.md. It
 * is rewritten when the partner delivers their format (Phase 10); nothing above the facade may
 * depend on it. What IS the partner's: the transport, `seq` as a position, the stored-action replay,
 * resume through the boot `config`, and the respin feature as partner-shaped free spins — one
 * context-less `play` per respin between `enterBonus` and `gameEnd`, counted by `playedBonusSpin`.
 *
 * The game is decided ONLY by the project's Game Config, as the launcher hands it over
 * (`holdAndWinMockInputs` in packages/game-config): the `holdAndWin` block, the symbol dictionary's
 * roles and line pays, the paylines and the bet modes. The base game pays lines through the lines
 * mock's own evaluator. Draw RATES (how often a coin lands) are this mock's pacing, not math — the
 * config's weights pick WHICH value lands, never how often something does.
 *
 * Symbols travel under the config's own names (`H1`, `BONUS`, `BOOST` …), and a cell that carries a
 * value carries it after a colon: `BONUS:1.5` (× the base total stake), `JACKPOT:MINI`,
 * `JACKPOT:MINI*2` (a jackpot a multiplier doubled), `BOOST:4`, `MULTI:3`, `COLLECT:12.5`, `ADD:2`
 * (an add-respins worth 2 respins), `UPG:0.5` (an upgrade's cash step).
 *
 * Forced outcomes: a force spec (see `parseForce`) arrives as `play.context = "force:<spec>"`, as
 * `POST …/force?sid=<sid>&beat=<spec>` (held for that session's next round — how a playtest reaches
 * it from a live client), or as `opts.force` / `FORCE=<spec>` for every round.
 *
 * CLI (the presets are TypeScript, so through the repo's loader):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/mock-rgs-server-holdandwin.mjs
 *   PORT=7799 · PRESET=pots|classic|collector|pots-progressive|pots-extra (the last two are test
 *   fixtures) · SEED=… · START_BALANCE=10000 · FORCE=<spec>
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createPlatformJackpot } from './mock-platform-jackpot.mjs';
import {
	createHoldAndWinEngine,
	HOLD_AND_WIN_WIRE_VERSION,
	tidy,
} from './mock-holdandwin-engine.mjs';

export { HOLD_AND_WIN_WIRE_VERSION };

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

// ---------- the respin modes ----------

/**
 * One engine per respin mode (`holdAndWin.modes`, primary first), or the one engine of a game whose
 * only respin mode is the default. The PRIMARY deals the base game, and every route of every mode is
 * on its trigger, so a cause is detected exactly where it always was; a cause routed to another mode
 * starts that mode's engine on the dealt board (`setRouter`). Every engine draws from the primary's
 * stream, so the deal stays one seeded sequence.
 */
export function createRespinEngines(opts) {
	const inputs = opts.holdAndWin;
	const modes = Array.isArray(inputs?.modes) && inputs.modes.length ? inputs.modes : null;
	if (!modes) {
		const engine = createHoldAndWinEngine(opts);
		return { engine, engines: [engine], wire: false };
	}
	const list = (v) => (Array.isArray(v) ? v : []);
	const [primary, ...others] = modes;
	const keys = new Set();
	for (const m of modes) {
		if (keys.has(m.gameType))
			throw new Error(`[${opts.label}] two respin modes play on the "${m.gameType}" strips`);
		keys.add(m.gameType);
	}
	/** Which mode each route starts: the first mode (primary first) that has it. */
	const owner = {};
	const buyOwner = new Map();
	const meterOwner = new Map();
	const trigger = {};
	const meters = [];
	for (const m of modes) {
		const t = m.block.trigger ?? {};
		for (const cause of ['count', 'pattern', 'luckySpin', 'randomMetre']) {
			const has = cause === 'pattern' ? list(t.pattern).length > 0 : Boolean(t[cause]);
			if (has && !owner[cause]) {
				owner[cause] = m.mode;
				trigger[cause] = t[cause];
			}
		}
		for (const tier of list(t.buy)) {
			if (buyOwner.has(tier.mode)) continue;
			buyOwner.set(tier.mode, m.mode);
			(trigger.buy ??= []).push(tier);
		}
		for (const meter of list(m.block.meters)) {
			if (meterOwner.has(meter.id)) continue;
			meterOwner.set(meter.id, m.mode);
			meters.push(meter);
		}
	}
	const own = (m, block) => ({
		...opts,
		mode: m.mode,
		bonus: m.gameType,
		blank: m.blank,
		wire: true,
		holdAndWin: { block, lineSymbols: inputs.lineSymbols, symbols: m.symbols },
	});
	const engine = createHoldAndWinEngine(own(primary, { ...primary.block, trigger, meters }));
	const engines = [
		engine,
		...others.map((m) => createHoldAndWinEngine({ ...own(m, m.block), rand: engine.rand })),
	];
	const byMode = new Map(engines.map((e) => [e.mode, e]));
	engine.setRouter((cause, round, meterIds) => {
		const id =
			cause === 'buy'
				? buyOwner.get(round.buyTier?.mode)
				: cause === 'meter'
					? meterOwner.get(meterIds[0])
					: owner[cause];
		const target = byMode.get(id);
		return target === engine ? undefined : target;
	});
	return { engine, engines, wire: true };
}

// ---------- factory ----------

/**
 * @param {{ label?: string, seed?: string, startBalance?: number, quiet?: boolean,
 *   reels?: number, rows?: number, rowsPerReel?: number[], paylines?: number[][],
 *   betModes?: { mode: string, cost: number, kind: 'base' | 'ante' | 'buy' }[],
 *   holdAndWin: { block: object, lineSymbols: string[],
 *     symbols: Record<string, { roles: string[], wild?: true, paytable?: Record<string, number> }>,
 *     modes?: { mode: string, gameType: string, block: object, blank: string, symbols: object }[] },
 *   force?: string }} opts
 */
export function createMockRgs(opts = {}) {
	const label = opts.label ?? 'mock-hnw';
	/** Whether a client may force outcomes (`play.context` / `…/force`). The test server allows it on
	 *  a runtime game's AUTHORING mock only, never on the one its players use. */
	const allowForce = opts.allowForce !== false;
	const quiet = opts.quiet === true;
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;

	const { engine, engines, wire } = createRespinEngines({ ...opts, label, seed });
	const { list, trigger, meters, paylines, betTable, parseForce, playBase } = engine;
	/** The engine playing a round's feature — the respin mode that started it. */
	const engineOf = (round) => engines.find((e) => e.mode === round.feature?.mode) ?? engine;
	const playRespin = (events, round) => engineOf(round).playRespin(events, round);
	const featureState = (f) => engineOf({ feature: f }).featureState(f);
	/** Every respin mode's progressive tiers, by name (a name two modes share is one pool). */
	const tierNames = new Set();
	const progressiveTiers = engines
		.flatMap((e) => e.progressiveTiers)
		.filter((t) => !tierNames.has(t.name) && tierNames.add(t.name));
	const setLivePools = (pools) => engines.forEach((e) => e.setLivePools(pools));
	const wonProgressive = {
		has: (name) => engines.some((e) => e.wonProgressive.has(name)),
		clear: () => engines.forEach((e) => e.wonProgressive.clear()),
	};
	// One respin mode: the boot config is the engine's, byte for byte. Several: it lists each beside
	// the legacy `holdAndWin` (the primary's) — the shared wire contract, docs/design/bonus-games.md §2.2.
	const configContext = (session) =>
		!wire
			? engine.configContext(session)
			: {
					...engine.configContext(session),
					bonusModes: engines.map((e) => ({
						mode: e.mode,
						gameType: e.bonus,
						...e.holdAndWinConfig(session),
					})),
				};
	const tableFor = (session) => ('betTable' in session ? session.betTable : betTable);

	const defaultForce = (() => {
		const spec = opts.force ?? process.env.FORCE;
		if (!spec) return null;
		const parsed = parseForce(spec);
		if (parsed.errors) throw new Error(`[${label}] FORCE: ${parsed.errors.join('; ')}`);
		return parsed.force;
	})();

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
		const session = sessions.get(sid);
		// Persistent meters: per session, across rounds — and across a contract swap, which carries
		// `meters` over (`carrySession`). A meter the contract no longer has is dropped; a new one
		// starts empty; a level above a lowered max is clamped.
		const levels = session.meters ?? {};
		session.meters = Object.fromEntries(
			meters.map((m) => [m.id, Math.min(m.maxLevel, Math.max(0, Number(levels[m.id]) || 0))]),
		);
		// Progressive pools: per session, across rounds and contract swaps like the meters. A tier
		// that became progressive starts at its seed; a pool above a lowered cap is clamped.
		const pools = session.jackpots ?? {};
		session.jackpots = Object.fromEntries(
			progressiveTiers.map((t) => {
				const level = Number(pools[t.name]);
				return [t.name, Math.min(t.cap, Number.isFinite(level) && level > 0 ? level : t.seed)];
			}),
		);
		return session;
	};
	const meterList = (session) =>
		meters.map((m) => ({ id: m.id, level: session.meters[m.id], max: m.maxLevel }));
	/** `jackpotLevels` — every progressive pool as it stands, × base total bet. Null without one. */
	const jackpotLevels = (session) =>
		progressiveTiers.length
			? {
					event: 'jackpotLevels',
					context: {
						jackpots: progressiveTiers.map((t) => ({
							name: t.name,
							value: tidy(session.jackpots[t.name]),
						})),
					},
				}
			: null;
	const growPools = (session) => {
		for (const t of progressiveTiers) {
			session.jackpots[t.name] = tidy(Math.min(t.cap, session.jackpots[t.name] + t.contribution));
		}
	};
	const resetWonPools = (session) => {
		for (const t of progressiveTiers)
			if (wonProgressive.has(t.name)) session.jackpots[t.name] = t.seed;
		wonProgressive.clear();
	};

	/**
	 * A `bet` with no `gid` opens a NEW round even while one is open — the partner's behaviour
	 * ("a fresh boot against an open round does not replay"). The one left behind is settled the way
	 * the server settles a round nobody finishes: its feature played out and its win credited.
	 */
	const settleAbandoned = (sid, session, round) => {
		while (round.feature && !round.feature.ended) playRespin([], round);
		session.balance += round.win;
		round.closed = true;
		settle(sid, round);
		session.round = null;
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
				`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a.action))}`,
			);
		}

		const events = [];
		const openRound = (round) => ({ updating: true, id: round.id });
		const sendConfig = () => {
			session.configSent = true;
			session.betTable = betTable;
			const config = { event: 'config', context: configContext(session) };
			if (session.round) {
				config.actions = session.round.stored.map((s) => s.action);
				config.resume = true;
			}
			events.push(config);
		};
		// A line-config game volunteers its config on first contact; a table game only when asked,
		// so a stale tab is never pinned to a table it did not see (the lines mock's rule).
		// From here to the answer nothing awaits, so this request alone reads the pools it points at —
		// set after the body read, the request's only await, or another player's request in between
		// would leave it dealing their pools.
		setLivePools(session.jackpots);
		wonProgressive.clear();
		if (!session.configSent && !betTable) sendConfig();
		if (actions.length === 0) {
			// The heartbeat restates the progressive pools, so a bar open between rounds stays current.
			const levels = jackpotLevels(session);
			if (levels) events.push(levels);
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = openRound(session.round);
			return sendJson(req, res, 200, { events, platform });
		}

		// A batch is ATOMIC: a refusal (or a throw) anywhere in it stores nothing, charges nothing and
		// consumes nothing — the partner's rule, and the only one under which a resend is safe.
		const saved = {
			balance: session.balance,
			meters: { ...session.meters },
			jackpots: { ...session.jackpots },
			force: session.force,
			round: session.round ? structuredClone(session.round) : session.round,
		};
		const settledBefore = new Set(settledRounds.keys());
		const rollback = () => {
			session.balance = saved.balance;
			session.meters = saved.meters;
			session.jackpots = saved.jackpots;
			setLivePools(session.jackpots);
			wonProgressive.clear();
			session.force = saved.force;
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
				if (a.action === 'config') {
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
					if (stored.action.action !== a.action) {
						return fail(
							`replay mismatch at ${position}: stored ${stored.action.action}, got ${a.action}`,
						);
					}
					events.push(...stored.events);
					position += 1;
					continue;
				}
				// A fresh action goes to the NEXT free position of its round, and nowhere else: a gap
				// would put holes in the resume list, and a stale position is another client's.
				const next = a.action === 'bet' ? 0 : (round?.stored.length ?? 0);
				if (position !== next) return fail(`seq ${position} is not the next position (${next})`);
				if (a.action !== 'bet' && round?.played && gid !== round.id) {
					return fail(`${a.action} under gid ${gid ?? '-'}, but the open round is ${round.id}`);
				}
				const dealtFrom = events.length;
				switch (a.action) {
					case 'bet': {
						if (betTable && !('betTable' in session)) {
							return fail('this session never asked for the game config — reload the game');
						}
						const table = tableFor(session);
						const ctx = Array.isArray(a.context)
							? a.context
							: table
								? [0, 1]
								: [paylines.length, 1];
						const option = table ? Number(ctx[0] ?? 0) : 0;
						const multiplier = Number(ctx[1] ?? 1);
						const lines = table ? 1 : Number(ctx[0] ?? paylines.length);
						if (
							!(multiplier > 0) ||
							!(lines > 0) ||
							(table && (!Number.isInteger(option) || option < 0 || option >= table.options.length))
						) {
							return fail(`invalid bet [${ctx[0]}, ${ctx[1]}]`, 101);
						}
						const betPerLine = multiplier;
						const baseTotal = table ? table.options[0] * betPerLine : lines * betPerLine;
						const total = table
							? Math.max(1, Math.round(table.options[option] * betPerLine))
							: baseTotal;
						const isBuy = table ? Boolean(table.buys[option]) : false;
						// A table pinned by another mock (a contract swap) may not name its modes; the
						// option index means the same mode in both.
						const modeName = (table?.modes ?? betTable?.modes)?.[option];
						if (round && !round.closed) {
							settleAbandoned(sid, session, round);
							resetWonPools(session);
						}
						if (session.balance < total) return fail('insufficient balance', 200);
						session.balance -= total;
						growPools(session);
						round = {
							id: makeRoundId(),
							betPerLine,
							total,
							baseTotal,
							isBuy,
							buyTier: isBuy ? list(trigger.buy).find((t) => t.mode === modeName) : undefined,
							win: 0,
							feature: null,
							closed: false,
							stored: [],
						};
						events.push({ event: 'bet', context: { total, betPerLine, paylines, maxWinCap: 0 } });
						events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
						break;
					}
					case 'play': {
						if (!round || round.closed) {
							return fail('error executing requested actions: play without bet');
						}
						if (round.feature) {
							if (round.feature.ended) {
								return fail('unexpected action: play (was expecting: collect)');
							}
							playRespin(events, round);
							break;
						}
						if (round.played) return fail('unexpected action: play (was expecting: collect)');
						let context = a.context;
						if (typeof context === 'string' && context.startsWith('force:')) {
							if (!allowForce) return fail('forcing is off on this mock', 101);
							const parsed = parseForce(context.slice('force:'.length));
							if (parsed.errors) return fail(`force: ${parsed.errors.join('; ')}`, 101);
							round.force = parsed.force;
							context = null;
						} else if (session.force) {
							round.force = session.force;
							session.force = null;
						} else if (defaultForce) {
							round.force = defaultForce;
						}
						if (round.force?.instant && round.isBuy) {
							return fail('force: instant cannot ride a bought feature', 101);
						}
						round.played = true;
						playBase(events, round, session, context);
						break;
					}
					case 'collect': {
						if (
							!round ||
							round.id !== gid ||
							(round.feature && !round.feature.ended) ||
							!round.played
						) {
							return fail('error executing requested actions: unexpected action: collect');
						}
						if (!round.closed) {
							session.balance += round.win;
							round.closed = true;
						}
						events.push({ event: 'gameRoundOver', context: { win: round.win } });
						break;
					}
					default:
						return fail(`error executing requested actions: unknown action: ${a.action}`);
				}
				round.stored[position] = { action: a, events: events.slice(dealtFrom) };
				resetWonPools(session);
				// A bet grows the pools before its play is dealt, so it reports them too: every jackpot
				// worth in the play's answer is read against the pools it was dealt at.
				const grown = a.action === 'bet' ? jackpotLevels(session) : null;
				if (grown) {
					events.push(grown);
					round.stored[position].events.push(grown);
				}
				if (a.action === 'play' && meters.length) {
					// Every play answer reports the meters as they stand — the client never computes one.
					const levels = { event: 'meterLevels', context: { meters: meterList(session) } };
					events.push(levels);
					round.stored[position].events.push(levels);
				}
				// …and the progressive pools, after any this play won went back to their seed.
				const pools = a.action === 'play' ? jackpotLevels(session) : null;
				if (pools) {
					events.push(pools);
					round.stored[position].events.push(pools);
				}
				position += 1;
			}
		} catch (err) {
			rollback();
			throw err;
		}

		if (round?.closed) settle(sid, round);
		session.round = round && !round.closed ? round : null;
		const platform = { balance: session.balance };
		if (round && !round.closed) platform.gameRound = openRound(round);
		return sendJson(req, res, 200, { events, platform });
	};

	/** `…/force?sid=&beat=<spec>` — hold a force for that session's next round (`beat=` clears it). */
	const handleForce = (req, res, url) => {
		const sid = url.searchParams.get('sid');
		if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
		if (!allowForce) {
			return sendJson(req, res, 403, { ok: false, errors: ['forcing is off on this mock'] });
		}
		const spec = url.searchParams.get('beat') ?? '';
		const session = getSession(sid);
		if (!spec) {
			session.force = null;
			return sendJson(req, res, 200, { ok: true, sid, force: null });
		}
		const parsed = parseForce(spec);
		if (parsed.errors) return sendJson(req, res, 400, { ok: false, errors: parsed.errors });
		session.force = parsed.force;
		return sendJson(req, res, 200, { ok: true, sid, force: parsed.force });
	};

	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz')) {
			return sendJson(req, res, 200, { ok: true, sessions: sessions.size, protocol: 'holdAndWin' });
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
					feature: round.feature && featureState(round.feature),
				},
			});
		}
		if ((req.method === 'POST' || req.method === 'GET') && pathEndsWith(url.pathname, '/force')) {
			return handleForce(req, res, url);
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

	return { handle, sessions, startBalance, seed, parseForce };
}

// ---------- standalone CLI entry (local dev) ----------

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
	const gameConfig = await import('../packages/game-config/index.ts');
	const preset = process.env.PRESET ?? gameConfig.DEFAULT_HOLD_AND_WIN_PRESET;
	const raw =
		gameConfig.HOLD_AND_WIN_PRESETS[preset] ?? gameConfig.HOLD_AND_WIN_TEST_FIXTURES[preset];
	if (!raw) {
		const ids = [
			...gameConfig.HOLD_AND_WIN_PRESET_IDS,
			...Object.keys(gameConfig.HOLD_AND_WIN_TEST_FIXTURES),
		];
		console.error(`[mock-hnw] PRESET="${preset}" — use ${ids.join(' | ')}`);
		process.exit(1);
	}
	const doc = gameConfig.normalizeGameConfigDoc(raw);
	const modes = Object.entries(doc.betModes);
	const PORT = Number(process.env.PORT ?? 7799);
	const mock = createMockRgs({
		label: 'mock-hnw',
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		rowsPerReel: doc.numRows,
		paylines: Object.values(doc.paylines),
		betModes:
			modes.length > 1
				? modes.map(([mode, m]) => ({ mode, cost: m.cost, kind: m.buyBonus ? 'buy' : 'base' }))
				: undefined,
		holdAndWin: gameConfig.holdAndWinMockInputs(doc),
	});
	// PLATFORM_JACKPOT=1 adds the operator platform jackpot on top (`mock-platform-jackpot.mjs`).
	const platform = process.env.PLATFORM_JACKPOT === '1' ? createPlatformJackpot() : null;
	const serve = (req, res, url) =>
		platform ? platform.handle(req, res, url, mock.handle) : mock.handle(req, res, url);
	createServer((req, res) =>
		serve(req, res, new URL(req.url, `http://${req.headers.host}`)),
	).listen(PORT, () => {
		console.log(
			`[mock-hnw] Hold and Win (${preset}) on http://localhost:${PORT}  balance=${mock.startBalance} seed=${mock.seed ?? '(time)'}`,
		);
		console.log(
			`[mock-hnw] force a beat: curl "http://localhost:${PORT}/force?sid=<sid>&beat=trigger:count"`,
		);
	});
}
