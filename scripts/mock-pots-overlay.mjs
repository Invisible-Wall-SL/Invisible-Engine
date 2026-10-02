/**
 * THE POTS OVERLAY, composed over another kind's mock (docs/design/pots-overlay.md §3.5).
 *
 * ⚠️ THE WIRE IS OURS — docs/reference/hold-and-win-wire.md, "Pots overlay". The host mock deals its
 * own game, untouched: its board, its wins, its free spins and its draws from its own RNG. This adds,
 * from the project's `potsOverlay` block (`potsOverlayMockInputs` in game-config):
 *   - DROPS on a spin in a dropping mode: tokens (and value coins) over any cell of the host's board,
 *     from a weighted table and this add-on's own RNG, so the host deals the same board either way;
 *   - per-session POTS (levels in `session.meters`, beside a Hold and Win game's meters, so a contract
 *     swap carries them — `carrySession`);
 *   - the BONUS a full pot starts: the Hold and Win feature (`mock-holdandwin-engine.mjs`, with the
 *     dropped value coins held), the host's own free spins (its `startFreeSpins` hook), or a
 *     `modeEnter`/`modeExit` stub for any other mode until Phase 7 builds it.
 *
 * The host's feature always plays first; a bonus waiting behind it starts instead of its `gameEnd`.
 *
 * A host takes it through its `overlay` option (the book mock today): `withPotsOverlay(createHost,
 * inputs)` returns a factory with the host's own signature, whose mock also answers `…/force`.
 */

import { createHoldAndWinEngine, hashStr } from './mock-holdandwin-engine.mjs';

/** Wire version, sent in the boot config so a facade can refuse a wire it was not written for. */
export const POTS_OVERLAY_WIRE_VERSION = 1;

const FORCE_PREFIX = 'force:';
const list = (v) => (Array.isArray(v) ? v : []);

/** The respin feature's mode id (game-config `HOLD_AND_WIN_MODE`) — the one bonus this deals itself. */
const HOLD_AND_WIN_MODE = 'holdAndWin';

/**
 * @param {{ label: string, seed?: string, reels: number, rows: number,
 *   bonuses: Record<string, string>, freeSpinsMode: string,
 *   startFreeSpins: (events: object[], round: object, opts: object) => void }} host
 * @param {{ pots: object[], drops: object, holdAndWin?: object }} inputs
 * @param {{ allowForce?: boolean }} [opts]
 */
export function createPotsOverlay(host, inputs, opts = {}) {
	const allowForce = opts.allowForce !== false;
	const pots = list(inputs?.pots).filter((p) => p && typeof p.id === 'string' && p.bonus?.mode);
	const potById = new Map(pots.map((p) => [p.id, p]));
	const maxOf = (pot) => Math.max(1, Math.round(Number(pot.maxLevel) || 1));
	const drops = inputs.drops ?? {};
	const chance = Math.min(1, Math.max(0, Number(drops.chance) || 0));
	const maxPerSpin = Math.max(1, Math.round(Number(drops.maxPerSpin) || 1));
	const dropModes = Array.isArray(drops.modes) ? drops.modes : ['basegame'];
	const dropReels = (Array.isArray(drops.reels) ? drops.reels : [...Array(host.reels).keys()])
		.map(Number)
		.filter((reel) => Number.isInteger(reel) && reel >= 0 && reel < host.reels);

	let rngState = host.seed ? hashStr(`${host.seed}:potsOverlay`) : Date.now() >>> 0;
	const rand = () => {
		rngState = (rngState * 1664525 + 1013904223) >>> 0;
		return rngState / 0x100000000;
	};

	// The Hold and Win feature, when the project's block is the overlay's bonus. The base-board
	// options an overlay host refuses are left out, so nothing but a pot or the coins starts it.
	const hw = inputs.holdAndWin?.block
		? createHoldAndWinEngine({
				label: host.label,
				base: false,
				rand,
				reels: host.reels,
				rows: host.rows,
				holdAndWin: {
					...inputs.holdAndWin,
					block: {
						...inputs.holdAndWin.block,
						trigger: inputs.holdAndWin.block.trigger?.count
							? { count: inputs.holdAndWin.block.trigger.count }
							: {},
						meters: [],
					},
				},
			})
		: null;
	const orphan = pots.find((p) => p.bonus.mode === HOLD_AND_WIN_MODE && !hw);
	if (orphan) {
		throw new Error(
			`[${host.label}] pot "${orphan.id}" starts Hold and Win, but the project has no Hold and Win bonus`,
		);
	}
	const coinTrigger = hw?.trigger.count?.min;
	const table = list(drops.table).filter(
		(e) => Number(e?.weight) > 0 && (e.coin === true ? Boolean(hw) : potById.has(e.pot)),
	);
	// Pots and value coins are each optional, not both: a coins-only overlay has no pot to fill.
	if (!pots.length && !table.some((e) => e.coin === true)) {
		throw new Error(
			`[${host.label}] a pots overlay needs at least one pot, or value coins and a Hold and Win bonus`,
		);
	}
	const bonuses = { ...host.bonuses, ...(hw ? { respin: HOLD_AND_WIN_MODE } : {}) };

	// ---- sessions: pots (and a Hold and Win bonus's progressive pools) ----
	const ensure = (session) => {
		const levels = session.meters ?? {};
		session.meters = {
			...levels,
			...Object.fromEntries(
				pots.map((p) => [p.id, Math.min(maxOf(p), Math.max(0, Number(levels[p.id]) || 0))]),
			),
		};
		if (hw?.progressiveTiers.length) {
			const pools = session.jackpots ?? {};
			session.jackpots = Object.fromEntries(
				hw.progressiveTiers.map((t) => {
					const level = Number(pools[t.name]);
					return [t.name, Math.min(t.cap, Number.isFinite(level) && level > 0 ? level : t.seed)];
				}),
			);
		}
		return session;
	};
	const meterLevels = (session) => ({
		event: 'meterLevels',
		context: {
			meters: pots.map((p) => ({ id: p.id, level: session.meters[p.id], max: maxOf(p) })),
		},
	});

	const configContext = (session) => {
		ensure(session);
		return {
			potsOverlay: {
				wire: POTS_OVERLAY_WIRE_VERSION,
				pots: pots.map((p) => ({
					id: p.id,
					token: p.token,
					level: session.meters[p.id],
					max: maxOf(p),
					sizeStages: list(p.sizeStages),
					bonus: p.bonus.mode,
					...(p.bonus.mode === HOLD_AND_WIN_MODE && p.bonus.activates
						? { activates: p.bonus.activates }
						: {}),
				})),
				bonuses,
			},
			...(hw ? { holdAndWin: hw.holdAndWinConfig(session) } : {}),
		};
	};

	// ---- forced beats ----
	/**
	 * A force spec: comma-separated tokens.
	 *
	 *   overlay:drop          at least one drop on this spin
	 *   overlay:coins:<n>     n value coins drop (needs the Hold and Win bonus)
	 *   pot:<id>              that pot is set one short and its token drops: full on this spin
	 *   pot:<id>:<level>      that pot is set to `level` (0 ≤ level < max) before the spin
	 *   feature               the host's own feature triggers too
	 *
	 * Returns `{ force }` or `{ errors }` — a typo is refused, never dealt as a normal round.
	 */
	const cellCount = dropReels.length * host.rows;
	const parseForce = (spec) => {
		const force = { pots: [], levels: {}, coins: 0, drop: false, hostFeature: false };
		const errors = [];
		for (const token of String(spec ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean)) {
			const [name, ...args] = token.split(':');
			if (name === 'overlay' && args[0] === 'drop' && args.length === 1) {
				if (!table.length || !dropReels.length)
					errors.push(`${token}: nothing can drop on this game`);
				force.drop = true;
			} else if (name === 'overlay' && args[0] === 'coins' && args.length === 2) {
				const n = /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
				if (!hw) errors.push(`${token}: this game has no Hold and Win bonus, so no value coins`);
				else if (!(n >= 1 && n <= cellCount))
					errors.push(`${token}: drop between 1 and ${cellCount} coins`);
				force.coins = n;
			} else if (name === 'pot' && (args.length === 1 || args.length === 2)) {
				const pot = potById.get(args[0]);
				if (!pot) {
					errors.push(`${token}: no pot "${args[0]}"`);
				} else if (args.length === 1) {
					force.pots.push(pot.id);
				} else {
					const level = /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
					if (!(level >= 0 && level < maxOf(pot)))
						errors.push(`${token}: a level from 0 to ${maxOf(pot) - 1}`);
					force.levels[pot.id] = level;
				}
			} else if (name === 'feature' && !args.length) {
				force.hostFeature = true;
			} else {
				errors.push(`${token}: unknown force "${token}"`);
			}
		}
		if (force.pots.length + force.coins > cellCount)
			errors.push(`only ${cellCount} cells can take a drop`);
		return errors.length ? { errors } : { force };
	};
	const forceOf = (context) =>
		typeof context === 'string' && context.startsWith(FORCE_PREFIX)
			? parseForce(context.slice(FORCE_PREFIX.length))
			: null;
	/** A batch carrying a force this mock cannot deal is refused before anything in it is dealt. */
	const refuse = (actions) => {
		for (const a of actions) {
			if (a?.action !== 'play') continue;
			const parsed = forceOf(a.context);
			if (!parsed) continue;
			if (!allowForce) return 'forcing is off on this mock';
			if (parsed.errors) return `force: ${parsed.errors.join('; ')}`;
		}
		return null;
	};
	/** Forces held for a session's next base spin (`…/force?sid=&beat=`). */
	const held = new Map();

	// ---- drops ----
	const weighted = (items) => {
		const total = items.reduce((s, i) => s + Number(i.weight), 0);
		let r = rand() * total;
		for (const item of items) if ((r -= Number(item.weight)) <= 0) return item;
		return items[items.length - 1];
	};
	/** Deal this spin's drops: `{ cells, coins, tokens: Map<potId, cells> }`. */
	const dealDrops = (session, force) => {
		const taken = new Set();
		const cells = [];
		const coins = [];
		const tokens = new Map();
		const freeCell = () => {
			const free = [];
			for (const reel of dropReels)
				for (let row = 0; row < host.rows; row++)
					if (!taken.has(`${reel}:${row}`)) free.push({ reel, row });
			if (!free.length) return null;
			const at = free[Math.floor(rand() * free.length)];
			taken.add(`${at.reel}:${at.row}`);
			return at;
		};
		const level = (id) => session.meters[id] + (tokens.get(id)?.length ?? 0);
		const placeToken = (pot) => {
			const at = freeCell();
			if (!at) return false;
			const cell = { reel: at.reel, row: at.row, symbol: pot.token, pot: pot.id };
			cells.push(cell);
			tokens.set(pot.id, [...(tokens.get(pot.id) ?? []), cell]);
			return true;
		};
		const placeCoin = () => {
			const at = freeCell();
			const coin = at && hw.drawCoin(at.reel);
			if (!coin) return false;
			coins.push({ reel: at.reel, row: at.row, cell: coin });
			cells.push(hw.cellInfo(at.reel, at.row, coin));
			return true;
		};
		for (const id of force?.pots ?? []) placeToken(potById.get(id));
		for (let i = 0; i < (force?.coins ?? 0); i++) placeCoin();
		const forced = force && (force.pots.length || force.coins);
		if (force?.drop || (!forced && table.length && rand() < chance)) {
			const n = 1 + Math.floor(rand() * maxPerSpin);
			for (let i = 0; i < n; i++) {
				// A full pot — or one a token on this spin just filled — is dealt no more tokens.
				const live = table.filter(
					(e) => e.coin === true || level(e.pot) < maxOf(potById.get(e.pot)),
				);
				if (!live.length) break;
				const entry = weighted(live);
				if (!(entry.coin === true ? placeCoin() : placeToken(potById.get(entry.pot)))) break;
			}
		}
		return { cells, coins, tokens };
	};

	// ---- bonuses ----
	const queued = (round, id) => (round.potsQueue ?? []).some((q) => q.meters.includes(id));
	/**
	 * Queue what this spin started, behind anything already waiting: Hold and Win first (every pot
	 * routed to it and the coins, as one feature), then each other full pot in config order. A round
	 * plays ONE Hold and Win: what fills while one waits joins it, and a pot that fills after it has
	 * played stays full for the next round (coins then are shown and gone).
	 */
	const queueBonuses = (round, full, coins) => {
		const queue = (round.potsQueue ??= []);
		const played = Boolean(round.potsFeature);
		const toHoldAndWin = played ? [] : full.filter((p) => p.bonus.mode === HOLD_AND_WIN_MODE);
		const coinStart = !played && Boolean(coinTrigger) && coins.length >= coinTrigger;
		if (toHoldAndWin.length || coinStart) {
			const meters = toHoldAndWin.map((p) => p.id);
			const activates = toHoldAndWin.map((p) => p.bonus.activates).filter(Boolean);
			const waiting = queue.find((q) => q.mode === HOLD_AND_WIN_MODE);
			if (waiting) {
				waiting.meters.push(...meters);
				waiting.activates.push(...activates);
				if (meters.length) waiting.cause = 'meter';
			} else {
				queue.push({
					mode: HOLD_AND_WIN_MODE,
					cause: meters.length ? 'meter' : 'count',
					meters,
					activates,
					coins,
				});
			}
		}
		for (const pot of full) {
			if (pot.bonus.mode === HOLD_AND_WIN_MODE) continue;
			queue.push({ mode: pot.bonus.mode, meters: [pot.id], spins: pot.bonus.spins });
		}
	};

	/** Run the Hold and Win engine on the round's bonus state, keeping the round's win in step. */
	const withFeature = (round, session, run) => {
		const sub = round.potsFeature;
		sub.win = round.win;
		hw.setLivePools(session.jackpots ?? null);
		hw.wonProgressive.clear();
		run(sub);
		round.win = sub.win;
		for (const t of hw.progressiveTiers)
			if (hw.wonProgressive.has(t.name)) session.jackpots[t.name] = t.seed;
		hw.wonProgressive.clear();
	};

	/** The feature has ended: whatever waits behind it starts instead of its `gameEnd`. */
	const afterFeature = (events, session, round) => {
		if (!round.potsFeature.feature?.ended || events.at(-1)?.event !== 'gameEnd') return;
		const end = events.pop();
		if (!takeOver(events, session, round)) events.push(end);
	};

	const startHoldAndWin = (events, session, round, next) => {
		const board = hw.emptyBoard();
		for (const { reel, row, cell } of next.coins) board[reel][row] = { ...cell };
		round.potsFeature = { id: round.id, baseTotal: round.baseBet, win: round.win, force: {} };
		const from = events.length;
		withFeature(round, session, (sub) =>
			hw.startFeature(events, sub, session, board, next.cause, next.meters, next.activates),
		);
		if (next.meters.length) {
			const trigger = events.slice(from).find((e) => e.event === 'spinTrigger');
			if (trigger) trigger.context = { ...trigger.context, meters: next.meters };
		}
		afterFeature(events, session, round);
	};

	/**
	 * Start the next waiting bonus on this answer, if any. Returns true when one now owns the round
	 * (the caller sends no `gameEnd`); a mode stub enters and exits on the spot and the next one is
	 * tried.
	 */
	const takeOver = (events, session, round) => {
		const queue = round.potsQueue ?? [];
		while (queue.length) {
			const next = queue.shift();
			if (next.mode === HOLD_AND_WIN_MODE) {
				startHoldAndWin(events, session, round, next);
				return true;
			}
			for (const id of next.meters) session.meters[id] = 0;
			if (next.mode === host.freeSpinsMode) {
				host.startFreeSpins(events, round, {
					occurs: 0,
					...(next.spins > 0 ? { spins: Math.round(next.spins) } : {}),
					extra: { cause: 'meter', meters: next.meters },
				});
				return true;
			}
			events.push({
				event: 'modeEnter',
				context: { mode: next.mode, cause: 'meter', meters: next.meters },
			});
			events.push({ event: 'modeExit', context: { mode: next.mode, total: 0 } });
		}
		return false;
	};

	// ---- the host's hooks ----
	/**
	 * Before the host deals a `play`: an open Hold and Win bonus owns it; otherwise deal this spin's
	 * drops (in a dropping mode), move the pots, and queue whatever they started.
	 */
	const beginPlay = (session, round, context, { mode, sid }) => {
		ensure(session);
		round.potsTurn = null;
		const feature = round.potsFeature?.feature;
		if (feature && !feature.ended) return { owned: true };
		if (feature?.ended && !round.bonus?.active) {
			return { refused: 'unexpected action: play (was expecting: collect)' };
		}
		const base = mode === 'basegame' && !round.potsPlayed;
		let force = null;
		let rest = context;
		if (base) {
			round.potsPlayed = true;
			const parsed = forceOf(context);
			if (parsed?.force) {
				force = parsed.force;
				rest = null;
			} else if (held.has(sid)) {
				force = held.get(sid);
				held.delete(sid);
			}
			for (const [id, level] of Object.entries(force?.levels ?? {})) session.meters[id] = level;
			for (const id of force?.pots ?? []) session.meters[id] = maxOf(potById.get(id)) - 1;
		}
		const dealt = dropModes.includes(mode)
			? dealDrops(session, force)
			: { cells: [], coins: [], tokens: new Map() };
		const updates = [];
		const full = [];
		for (const pot of pots) {
			const from = dealt.tokens.get(pot.id);
			if (!from?.length) continue;
			const level = Math.min(maxOf(pot), session.meters[pot.id] + from.length);
			session.meters[pot.id] = level;
			const isFull = level >= maxOf(pot);
			if (isFull) full.push(pot);
			updates.push({
				event: 'meterUpdate',
				context: {
					meter: pot.id,
					level,
					max: maxOf(pot),
					full: isFull,
					from: from.map(({ reel, row, symbol }) => ({ reel, row, symbol })),
					...(force?.pots.includes(pot.id) ? { forced: true } : {}),
				},
			});
		}
		// A pot left full by a round that could not start it (its Hold and Win had played, the round
		// was abandoned, a contract swap, a lowered max) starts on the next round's first base spin.
		const starting = base
			? pots.filter((p) => session.meters[p.id] >= maxOf(p) && !queued(round, p.id))
			: full;
		queueBonuses(round, starting, dealt.coins);
		round.potsTurn = { cells: dealt.cells, updates };
		return { context: rest, hostFeature: force?.hostFeature === true };
	};

	/** A respin of the Hold and Win bonus. */
	const playOwned = (events, session, round) => {
		withFeature(round, session, (sub) => hw.playRespin(events, sub));
		afterFeature(events, session, round);
	};

	/** The host has dealt the play: place the drops and the pots' moves, then restate every pot. */
	const PLAY_EVENTS = new Set(['overlayDrop', 'spinWin', 'bonusWin', 'playedSpin']);
	const endPlay = (events, from, session, round) => {
		const turn = round.potsTurn;
		round.potsTurn = null;
		if (turn?.cells.length || turn?.updates.length) {
			const start = events.findIndex((e, i) => i >= from && e.event === 'spinStart');
			const at = start < 0 ? from : start + 1;
			if (turn.cells.length)
				events.splice(at, 0, { event: 'overlayDrop', context: { cells: turn.cells } });
			let after = at;
			while (after < events.length && PLAY_EVENTS.has(events[after].event)) after++;
			events.splice(after, 0, ...turn.updates);
		}
		// With no pot there is no level to restate.
		if (pots.length) events.push(meterLevels(session));
	};

	const inBonus = (round) => Boolean(round.potsFeature);

	/** `…/force?sid=&beat=<spec>` — hold a force for that session's next base spin (`beat=` clears). */
	const holdForce = (sid, spec) => {
		if (!allowForce)
			return { status: 403, body: { ok: false, errors: ['forcing is off on this mock'] } };
		if (!spec) {
			held.delete(sid);
			return { status: 200, body: { ok: true, sid, force: null } };
		}
		const parsed = parseForce(spec);
		if (parsed.errors) return { status: 400, body: { ok: false, errors: parsed.errors } };
		held.set(sid, parsed.force);
		return { status: 200, body: { ok: true, sid, force: parsed.force } };
	};

	return {
		configContext,
		refuse,
		beginPlay,
		playOwned,
		takeOver,
		endPlay,
		inBonus,
		holdForce,
	};
}

/**
 * Compose the overlay over a host mock factory: the result has the host's own signature (plus
 * `allowForce`), deals through the host's `overlay` seam, and answers `…/force` for the overlay's
 * beats. A host without the seam is refused rather than dealt without its pots.
 */
export const withPotsOverlay =
	(createHost, inputs) =>
	(opts = {}) => {
		let overlay = null;
		const mock = createHost({
			...opts,
			overlay: (host) => (overlay = createPotsOverlay(host, inputs, opts)),
		});
		if (!overlay) throw new Error(`[${opts.label ?? 'mock'}] this mock takes no overlay`);
		const json = (req, res, status, body) => {
			const text = JSON.stringify(body);
			const origin = req.headers.origin;
			res.writeHead(status, {
				'Content-Type': 'application/json',
				...(origin
					? {
							'Access-Control-Allow-Origin': origin,
							'Access-Control-Allow-Credentials': 'true',
							Vary: 'Origin',
						}
					: { 'Access-Control-Allow-Origin': '*' }),
				'Content-Length': Buffer.byteLength(text),
			});
			res.end(text);
		};
		const handle = (req, res, url) => {
			if ((req.method === 'POST' || req.method === 'GET') && /\/force\/?$/.test(url.pathname)) {
				const sid = url.searchParams.get('sid');
				if (!sid) return json(req, res, 400, { error: 'missing sid' });
				const { status, body } = overlay.holdForce(sid, url.searchParams.get('beat') ?? '');
				return json(req, res, status, body);
			}
			return mock.handle(req, res, url);
		};
		return { ...mock, handle };
	};
