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
 *   - a respin mode's OTHER routes (bonus-games Phase 7a): a bought option whose bet mode a buy tier
 *     names (the host deals that spin unbought), a Lucky Spin or a random metre drawn from this
 *     add-on's RNG, and a pattern the dropped value coins form — each drawn only when some respin
 *     mode has that route, so a project without one is dealt exactly as before;
 *   - the BONUS a full pot starts: a Hold and Win feature (`mock-holdandwin-engine.mjs`, one engine
 *     per respin mode, the pot's mode's; the dropped value coins held), the host's own free spins
 *     (its `startFreeSpins` hook), a REELS mode of the project's own (an imported free spins: the
 *     same hook, on that mode's strips and pays, under its own bonus key), or a
 *     `modeEnter`/`modeExit` stub for any other mode.
 *
 * The host's feature always plays first; a bonus waiting behind it starts instead of its `gameEnd`.
 *
 * The host calls these hooks only for a session whose config carried the overlay (its pin,
 * `session.potsOverlay`): a tab booted before the overlay was switched on plays the host game until
 * it reloads.
 *
 * A host takes it through its `overlay` option (the book mock and the lines mock):
 * `withPotsOverlay(createHost, inputs)` returns a factory with the host's own signature, whose mock
 * also answers `…/force`.
 */

import {
	createHoldAndWinEngine,
	DEFAULT_RESPIN_MODE,
	hashStr,
	LUCKY_SPIN_RATE,
	RANDOM_METRE_RATE,
	splitPoolNames,
} from './mock-holdandwin-engine.mjs';

/** Wire version, sent in the boot config so a facade can refuse a wire it was not written for. */
export const POTS_OVERLAY_WIRE_VERSION = 1;

const FORCE_PREFIX = 'force:';
/** The routes a `trigger:<route>` force starts. */
const TRIGGER_FORCES = new Set(['luckySpin', 'randomMetre', 'pattern']);
const list = (v) => (Array.isArray(v) ? v : []);

/** The default respin mode's id (game-config `HOLD_AND_WIN_MODE`). */
const HOLD_AND_WIN_MODE = DEFAULT_RESPIN_MODE.mode;

/** The routes of a respin mode's trigger this add-on deals: all but the meters. A block with only a
 *  count (every overlay before Phase 7a) gives exactly `{ count }`, so its boot config is unchanged. */
const overlayTrigger = (t = {}) => ({
	...(t.count ? { count: t.count } : {}),
	...(list(t.pattern).length ? { pattern: t.pattern } : {}),
	...(t.luckySpin ? { luckySpin: t.luckySpin } : {}),
	...(t.randomMetre ? { randomMetre: t.randomMetre } : {}),
	...(list(t.buy).length ? { buy: t.buy } : {}),
});

/**
 * @param {{ label: string, seed?: string, reels: number, rows: number,
 *   bonuses: Record<string, string>, freeSpinsMode: string, freeSpinsOn?: boolean,
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

	// The Hold and Win features, one per respin mode, when the project's block is the overlay's
	// bonus: the primary first, and with several (`holdAndWin.modes`) each answers with its `mode`.
	// Each keeps the routes this add-on deals (count, pattern, Lucky Spin, random metre, buy); the
	// meters, which fill from a landing symbol on the host's board, are left out.
	const respinInputs = inputs.holdAndWin?.block
		? (inputs.holdAndWin.modes ?? [
				{
					mode: HOLD_AND_WIN_MODE,
					gameType: DEFAULT_RESPIN_MODE.bonus,
					block: inputs.holdAndWin.block,
					symbols: inputs.holdAndWin.symbols,
				},
			])
		: [];
	const wire = Boolean(inputs.holdAndWin?.modes);
	const splitPools = splitPoolNames(respinInputs.map((m) => m.block));
	// A Hold and Win base hands over its own engines (`host.respinEngines`): a pot starts the base's
	// respin mode, and the base deals every route of its own reels — this add-on deals only its pots
	// and its dropped coins there, and the base's boot config already declares the modes.
	const hostEngines = host.respinEngines instanceof Map ? host.respinEngines : null;
	const engines =
		hostEngines ??
		new Map(
			respinInputs.map((m) => [
				m.mode,
				createHoldAndWinEngine({
					label: host.label,
					base: false,
					rand,
					reels: host.reels,
					rows: host.rows,
					splitPools,
					...(wire ? { mode: m.mode, bonus: m.gameType, blank: m.blank, wire } : {}),
					holdAndWin: {
						...inputs.holdAndWin,
						symbols: m.symbols,
						block: {
							...m.block,
							trigger: overlayTrigger(m.block.trigger),
							meters: [],
						},
					},
				}),
			]),
		);
	/** The primary respin mode's engine: the one the legacy boot block and the value coins are. */
	const hw = engines.values().next().value ?? null;
	const isRespin = (mode) => engines.has(mode);
	// A pot that would start free spins on a game whose free spins are OFF is refused, as `/config`
	// refuses to save it: the host has no feature for it to start.
	const offRoute =
		host.freeSpinsOn === false && pots.find((p) => p.bonus.mode === host.freeSpinsMode);
	if (offRoute) {
		throw new Error(
			`[${host.label}] pot "${offRoute.id}" starts free spins, but this game's free spins are off`,
		);
	}
	const orphan = pots.find((p) => p.bonus.mode === HOLD_AND_WIN_MODE && !isRespin(p.bonus.mode));
	if (orphan) {
		throw new Error(
			`[${host.label}] pot "${orphan.id}" starts Hold and Win, but the project has no Hold and Win bonus`,
		);
	}
	/** The first respin mode (the primary first) with `cause` among its routes, or undefined — none
	 *  on a Hold and Win base, whose own engine deals them from its reels. */
	const routeEngine = (cause) =>
		hostEngines
			? undefined
			: [...engines.values()].find((e) =>
					cause === 'pattern' ? e.trigger.pattern.length > 0 : Boolean(e.trigger[cause]),
				);
	/**
	 * The REELS modes of the project's own a route starts besides a pot (`inputs.modes[id].trigger`,
	 * a respin block's trigger shape — bonus-games Phase 8's spins modes): `{ mode, trigger }`, after
	 * every respin mode.
	 */
	const reelsRouted = Object.entries(inputs.modes ?? {}).flatMap(([mode, m]) =>
		m?.trigger && Array.isArray(m.strips) && m.strips.length
			? [{ mode, trigger: { ...m.trigger, buy: list(m.trigger.buy) } }]
			: [],
	);
	const reelsRoute = (cause) =>
		hostEngines ? undefined : reelsRouted.find(({ trigger }) => Boolean(trigger[cause]));
	const luckyEngine = routeEngine('luckySpin') ?? reelsRoute('luckySpin');
	const metreEngine = routeEngine('randomMetre') ?? reelsRoute('randomMetre');
	const patternEngine = routeEngine('pattern');
	/** Bet mode (a `betModes` key) → the bonus mode its buy tier starts, the first that names it. */
	const buyRoutes = new Map();
	for (const owner of hostEngines ? [] : [...engines.values(), ...reelsRouted]) {
		for (const tier of owner.trigger.buy) {
			if (!buyRoutes.has(tier.mode)) buyRoutes.set(tier.mode, { mode: owner.mode, tier });
		}
	}
	/** Can dropped value coins (coin and jackpot cells) ever form `engine`'s pattern? */
	const patternCoins = (engine) =>
		engine === coinEngine &&
		engine.trigger.pattern.every((req) => req.roles.some((r) => r === 'coin' || r === 'jackpot'));
	// Value coins start the first respin mode with a count route, else the one their pattern starts.
	const coinEngine = [...engines.values()].find((e) => e.trigger.count) ?? patternEngine ?? hw;
	const coinTrigger = coinEngine?.trigger.count?.min;
	const table = list(drops.table).filter(
		(e) => Number(e?.weight) > 0 && (e.coin === true ? Boolean(hw) : potById.has(e.pot)),
	);
	// Pots, value coins and the other routes are each optional, not all: a coins-only overlay has no
	// pot to fill, a buy-only one nothing to drop.
	const otherRoutes = Boolean(luckyEngine || metreEngine || buyRoutes.size);
	if (!pots.length && !table.some((e) => e.coin === true) && !otherRoutes) {
		throw new Error(
			`[${host.label}] a pots overlay needs at least one pot, or value coins and a Hold and Win bonus`,
		);
	}
	// The REELS modes of the project's own a pot or another route starts (an imported free spins, or a
	// spins mode with a `game` of its own): dealt as the host's free spins on their own strips, each under its own
	// bonus key (its mode id). A spins mode's `window` is advertised so the client draws its grid, on
	// a host that deals its game (`host.spinsGames`: the lines mock); another host plays it on its own.
	const reelsModes = Object.fromEntries(
		Object.entries(inputs.modes ?? {}).filter(
			([id, m]) =>
				(pots.some((p) => p.bonus.mode === id) || reelsRouted.some((r) => r.mode === id)) &&
				Array.isArray(m?.strips) &&
				m.strips.length,
		),
	);
	const bonuses = {
		...host.bonuses,
		...Object.fromEntries([...engines.values()].map((e) => [e.bonus, e.mode])),
		...Object.fromEntries(Object.keys(reelsModes).map((id) => [id, id])),
	};

	// ---- sessions: pots (and the Hold and Win bonuses' progressive pools, by tier name, or per mode
	// for a name progressive in several modes — `splitPoolNames`) ----
	const poolKeys = new Set();
	const progressiveTiers = [...engines.values()]
		.flatMap((e) => e.progressiveTiers)
		.filter((t) => !poolKeys.has(t.key) && poolKeys.add(t.key));
	const ensure = (session) => {
		const levels = session.meters ?? {};
		session.meters = {
			...levels,
			...Object.fromEntries(
				pots.map((p) => [p.id, Math.min(maxOf(p), Math.max(0, Number(levels[p.id]) || 0))]),
			),
		};
		if (progressiveTiers.length) {
			const pools = session.jackpots ?? {};
			session.jackpots = Object.fromEntries(
				progressiveTiers.map((t) => {
					const level = Number(pools[t.key]);
					return [t.key, Math.min(t.cap, Number.isFinite(level) && level > 0 ? level : t.seed)];
				}),
			);
		}
		return session;
	};
	const potLevels = (session) =>
		pots.map((p) => ({ id: p.id, level: session.meters[p.id], max: maxOf(p) }));
	const meterLevels = (session) => ({
		event: 'meterLevels',
		context: {
			meters: potLevels(session),
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
					...(isRespin(p.bonus.mode) && p.bonus.activates ? { activates: p.bonus.activates } : {}),
				})),
				bonuses,
				...(Object.keys(reelsModes).length
					? {
							modes: Object.fromEntries(
								Object.entries(reelsModes).map(([id, m]) => [
									id,
									{
										gameType: m.gameType,
										...(m.game && host.spinsGames
											? { window: { reels: m.game.reels, rows: m.game.rows } }
											: {}),
									},
								]),
							),
						}
					: {}),
			},
			...(hw && !hostEngines ? { holdAndWin: hw.holdAndWinConfig(session) } : {}),
			...(wire && !hostEngines
				? {
						bonusModes: [...engines.values()].map((e) => ({
							mode: e.mode,
							gameType: e.bonus,
							...e.holdAndWinConfig(session),
						})),
					}
				: {}),
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
	 *   trigger:luckySpin     a Lucky Spin starts the respin mode that has one
	 *   trigger:randomMetre   the random metre starts the respin mode that has one
	 *   trigger:pattern       value coins drop in the pattern that starts its respin mode
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
			} else if (name === 'trigger' && args.length === 1 && TRIGGER_FORCES.has(args[0])) {
				const engine = { luckySpin: luckyEngine, randomMetre: metreEngine, pattern: patternEngine }[
					args[0]
				];
				if (!engine) errors.push(`${token}: no respin mode here has that route`);
				else if (args[0] === 'pattern' && !patternCoins(engine))
					errors.push(`${token}: its pattern needs symbols that never drop`);
				force.trigger = args[0];
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
		const freeCell = (only) => {
			const free = [];
			for (const reel of only === undefined ? dropReels : [only])
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
		const placeCoin = (reel) => {
			const at = freeCell(reel);
			const coin = at && coinEngine.drawBaseCoin(at.reel, rand);
			if (!coin) return false;
			coins.push({ reel: at.reel, row: at.row, cell: coin });
			cells.push(coinEngine.cellInfo(at.reel, at.row, coin));
			return true;
		};
		for (const id of force?.pots ?? []) placeToken(potById.get(id));
		for (let i = 0; i < (force?.coins ?? 0); i++) placeCoin();
		if (force?.trigger === 'pattern') {
			for (const req of patternEngine.trigger.pattern) {
				for (let i = 0; i < req.min; i++) placeCoin(req.reel);
			}
		}
		const forced = force && (force.pots.length || force.coins || force.trigger === 'pattern');
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
	 * Queue what this spin started, behind anything already waiting: each respin mode first, in mode
	 * order (every pot routed to it, and the coins to theirs, as one feature), then each other full
	 * pot in config order. A round plays each respin mode ONCE: what fills while one waits joins it,
	 * and a pot that fills after its mode has played stays full for the next round (coins then are
	 * shown and gone). The dropped coins ride only the feature of the mode they belong to.
	 */
	const queueBonuses = (round, full, coins, routes) => {
		const queue = (round.potsQueue ??= []);
		const played = new Set(round.potsRespins ?? []);
		const coinMode = coinStarts(played, coins) ? coinEngine.mode : null;
		for (const engine of engines.values()) {
			if (played.has(engine.mode)) continue;
			const routed = full.filter((p) => p.bonus.mode === engine.mode);
			const coinStart = coinMode === engine.mode;
			// Another route (a buy, a Lucky Spin, a random metre, a pattern) that starts this mode.
			const route = routes.get(engine.mode);
			if (!routed.length && !coinStart && !route) continue;
			const meters = routed.map((p) => p.id);
			const activates = routed.map((p) => p.bonus.activates).filter(Boolean);
			// A bought feature is the buy's, whatever else filled on the spin: its guarantees apply.
			const cause =
				route?.cause === 'buy'
					? 'buy'
					: meters.length
						? 'meter'
						: coinStart
							? 'count'
							: (route?.cause ?? 'count');
			const waiting = queue.find((q) => q.mode === engine.mode);
			if (waiting) {
				waiting.meters.push(...meters);
				waiting.activates.push(...activates);
				if (meters.length && waiting.cause !== 'buy') waiting.cause = 'meter';
			} else {
				queue.push({
					mode: engine.mode,
					cause,
					meters,
					activates,
					// Coins are their mode's symbols: they ride its feature only, else they are shown and gone.
					coins: engine === coinEngine ? coins : [],
					...(route?.buyTier ? { buyTier: route.buyTier } : {}),
				});
			}
		}
		for (const pot of full) {
			if (isRespin(pot.bonus.mode)) continue;
			queue.push({ mode: pot.bonus.mode, meters: [pot.id], spins: pot.bonus.spins });
		}
		// Another route to a bonus mode that is no respin mode (a reels or spins mode), once a round.
		for (const [mode, route] of routes) {
			if (isRespin(mode) || played.has(mode) || queue.some((q) => q.mode === mode)) continue;
			queue.push({ mode, cause: route.cause, meters: [] });
		}
	};
	const coinStarts = (played, coins) =>
		Boolean(coinTrigger) && !played.has(coinEngine.mode) && coins.length >= coinTrigger;

	/** Run `engine` on the round's bonus state, keeping the round's win in step. */
	const withFeature = (round, session, engine, run) => {
		const sub = round.potsFeature;
		sub.win = round.win;
		engine.setLivePools(session.jackpots ?? null);
		engine.wonProgressive.clear();
		run(sub);
		round.win = sub.win;
		// The pools' rules are the merged ones `ensure` clamps with, whichever mode won one.
		for (const t of progressiveTiers)
			if (engine.wonProgressive.has(t.key)) session.jackpots[t.key] = t.seed;
		engine.wonProgressive.clear();
	};

	/** The feature has ended: whatever waits behind it starts instead of its `gameEnd`. */
	const afterFeature = (events, session, round) => {
		if (!round.potsFeature.feature?.ended || events.at(-1)?.event !== 'gameEnd') return;
		const end = events.pop();
		if (!takeOver(events, session, round)) events.push(end);
	};

	const startHoldAndWin = (events, session, round, next) => {
		const engine = engines.get(next.mode);
		(round.potsRespins ??= []).push(next.mode);
		const board = engine.emptyBoard();
		for (const { reel, row, cell } of next.coins) board[reel][row] = { ...cell };
		// The base stake: the book host's `baseBet`, the lines host's `baseTotal`.
		const baseTotal = round.baseBet ?? round.baseTotal;
		round.potsFeature = {
			id: round.id,
			baseTotal,
			win: round.win,
			force: {},
			...(next.buyTier ? { buyTier: next.buyTier } : {}),
		};
		const from = events.length;
		withFeature(round, session, engine, (sub) =>
			engine.startFeature(events, sub, session, board, next.cause, next.meters, next.activates),
		);
		if (next.meters.length) {
			const trigger = events.slice(from).find((e) => e.event === 'spinTrigger');
			if (trigger) trigger.context = { ...trigger.context, meters: next.meters };
		}
		afterFeature(events, session, round);
	};

	/**
	 * THE ROUTE DISPATCH: start bonus mode `next.mode` on this answer. Returns true when it now owns
	 * the round (the caller sends no `gameEnd`), false when it entered and exited on the spot. In
	 * order: a respin mode (its engine), a mode the host registered (`host.bonusModes[mode].start`,
	 * the host mock's `opts.bonusModes` — spins modes of another game type), the host's free spins or
	 * a reels mode of the project's own (`host.startFreeSpins`), else a `modeEnter`/`modeExit` stub.
	 */
	const startBonus = (events, session, round, next) => {
		if (isRespin(next.mode)) {
			startHoldAndWin(events, session, round, next);
			return true;
		}
		for (const id of next.meters) session.meters[id] = 0;
		const info = {
			cause: next.cause ?? 'meter',
			meters: next.meters,
			...(next.spins > 0 ? { spins: Math.round(next.spins) } : {}),
		};
		const registered = host.bonusModes?.[next.mode];
		if (typeof registered?.start === 'function')
			return registered.start(events, round, info) !== false;
		const reels = Object.hasOwn(reelsModes, next.mode) ? reelsModes[next.mode] : undefined;
		if (next.mode === host.freeSpinsMode || reels) {
			// A spins mode's own game (`reels.game`, bonus-games Phase 8) rides through untouched.
			const spins = next.spins > 0 ? next.spins : reels?.game?.spins;
			host.startFreeSpins(events, round, {
				occurs: 0,
				...(spins > 0 ? { spins: Math.round(spins) } : {}),
				extra: { cause: next.cause ?? 'meter', meters: next.meters },
				...(reels ? { bonus: next.mode, strips: reels.strips, paytable: reels.paytable } : {}),
				...(reels?.game ? { game: reels.game } : {}),
			});
			return true;
		}
		events.push({
			event: 'modeEnter',
			context: { mode: next.mode, cause: 'meter', meters: next.meters },
		});
		events.push({ event: 'modeExit', context: { mode: next.mode, total: 0 } });
		return false;
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
			// A round plays each respin mode once: on a Hold and Win base, a mode its own feature played
			// this round leaves the pots routed to it full, to start on the next round's first spin.
			if (hostEngines && round.feature?.mode === next.mode) continue;
			if (startBonus(events, session, round, next)) return true;
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
		// The routes besides pots and the count, on the round's first base spin: a buy whose bet mode
		// starts a respin mode (the host then deals the spin unbought), else a Lucky Spin or the random
		// metre — drawn only when a respin mode has that route, so no other game's deal moves.
		const routes = new Map();
		const before = [];
		const after = [];
		if (base) {
			const bought = round.isBuy ? buyRoutes.get(round.betMode) : undefined;
			if (bought) {
				// The host deals this spin unbought; `potsBought` keeps it from counting as a natural one.
				round.isBuy = false;
				round.potsBought = true;
				routes.set(bought.mode, { cause: 'buy', buyTier: bought.tier });
			}
			const lucky =
				!bought &&
				Boolean(luckyEngine) &&
				(force?.trigger === 'luckySpin' || (!force && rand() < LUCKY_SPIN_RATE));
			const metre =
				!bought &&
				!lucky &&
				Boolean(metreEngine) &&
				(force?.trigger === 'randomMetre' || (!force && rand() < RANDOM_METRE_RATE));
			if (lucky) {
				before.push({ event: 'luckySpin', context: {} });
				routes.set(luckyEngine.mode, { cause: 'luckySpin' });
			} else if (metre) {
				after.push({
					event: 'randomMetreTrigger',
					context: { name: metreEngine.trigger.randomMetre.name, cells: [] },
				});
				if (!routes.has(metreEngine.mode)) routes.set(metreEngine.mode, { cause: 'randomMetre' });
			}
		}
		const dealt = dropModes.includes(mode)
			? dealDrops(session, force)
			: { cells: [], coins: [], tokens: new Map() };
		if (patternEngine && dealt.coins.length && !routes.has(patternEngine.mode)) {
			const board = patternEngine.emptyBoard();
			for (const { reel, row, cell } of dealt.coins) board[reel][row] = cell;
			if (patternCoins(patternEngine) && patternEngine.patternTriggered(board))
				routes.set(patternEngine.mode, { cause: 'pattern' });
		}
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
		queueBonuses(round, starting, dealt.coins, routes);
		round.potsTurn = { cells: dealt.cells, updates: [...updates, ...after], before };
		return { context: rest, hostFeature: force?.hostFeature === true };
	};

	/** A respin of the Hold and Win bonus. */
	const playOwned = (events, session, round) => {
		const engine = engines.get(round.potsFeature.feature.mode) ?? hw;
		withFeature(round, session, engine, (sub) => engine.playRespin(events, sub));
		afterFeature(events, session, round);
	};

	/** The host has dealt the play: place the drops and the pots' moves, then restate every pot. */
	const PLAY_EVENTS = new Set(['luckySpin', 'overlayDrop', 'spinWin', 'bonusWin', 'playedSpin']);
	const endPlay = (events, from, session, round) => {
		const turn = round.potsTurn;
		round.potsTurn = null;
		if (turn?.cells.length || turn?.updates.length || turn?.before.length) {
			const start = events.findIndex((e, i) => i >= from && e.event === 'spinStart');
			const at = start < 0 ? from : start + 1;
			if (turn.cells.length)
				events.splice(at, 0, { event: 'overlayDrop', context: { cells: turn.cells } });
			events.splice(at, 0, ...turn.before);
			let after = at;
			while (after < events.length && PLAY_EVENTS.has(events[after].event)) after++;
			events.splice(after, 0, ...turn.updates);
		}
		// With no pot there is no level to restate; a host that reports its own meters lists the pots
		// beside them (`potLevels`).
		if (pots.length && !host.reportsMeters) events.push(meterLevels(session));
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

	/** Does a buy tier of a respin mode sell `betMode`? The host then sells it even with its own
	 *  free spins off. */
	const sellsBuy = (betMode) => buyRoutes.has(betMode);

	return {
		configContext,
		refuse,
		sellsBuy,
		potLevels,
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
