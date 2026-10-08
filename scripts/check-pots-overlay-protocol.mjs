// The POTS OVERLAY mock, proven from its WIRE (docs/reference/hold-and-win-wire.md, "Pots overlay").
// A host with the overlay presets merged in, as the launcher hands it over
// (`potsOverlayMockInputs`), is played the way the facade plays a round, and every answer is
// re-derived from its events alone: where each drop landed, every pot's level across rounds and
// sessions, which bonus a full pot starts and when, the round's money, and replay/resume. Then every
// forced beat is fired, and a project without the block is shown to get the host mock byte for byte,
// as is a tab open across a contract swap that adds the block (until it reloads).
//
// It runs once per HOST — the book mock (default) and the lines mock (`--host lines`, with the
// Book of Thermopylae's expanding special, so its own free spins announce one as the book's do):
//
//   pnpm check:pots-overlay            (both hosts)

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseArgs } from 'node:util';

import {
	holdAndWinBonus,
	HOLD_AND_WIN_PRESETS,
	importBonus,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayPreset,
	resyncBonus,
	setOverlayPotCount,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';
import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { startTestServer } from './current-games/lib/serve.mjs';
import { withPotsOverlay } from './mock-pots-overlay.mjs';
import { carrySession, createMockRgs as createLinesMock } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	if (!ok || process.env.VERBOSE)
		console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
	if (!ok) failed++;
	return ok;
};
const pass = (msg) => console.log(`  ✓ ${msg}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (c) => `${c.reel}:${c.row}`;

// ---------- a Book-of host, and the presets merged in as an "add" does ----------

const { values: argv } = parseArgs({ options: { host: { type: 'string', default: 'book' } } });
/** The Book of Thermopylae's special on the lines mock's default pool (PIC8–PIC10 are not dealt). */
const LINES_SPECIAL = {
	candidates: JSON.parse(
		readFileSync(new URL('./lib/book-of-thermopylae-lines-grid.json', import.meta.url), 'utf8'),
	).expandingSymbol.candidates.filter((c) => !['PIC8', 'PIC9', 'PIC10'].includes(c.symbol)),
};
/**
 * Each host the overlay composes over, in its own server vocabulary: the book mock (`ACE`…`TEN`,
 * a bet-option table, its config re-sent on every heartbeat, `outcome: 'bonus'` on an open feature)
 * and the lines mock (`PIC1`…`PIC7`, a line-config bet `[lines, betPerLine]`, its config sent once).
 */
const HOSTS = {
	book: {
		name: 'book',
		create: (opts = {}) => createBookMock(opts),
		bet: [0, 1],
		lows: ['ACE', 'KING', 'TEN'],
		heartbeatConfig: true,
		bonusOutcome: true,
	},
	lines: {
		name: 'lines',
		create: (opts = {}) =>
			createLinesMock({ quiet: true, expandingSymbol: LINES_SPECIAL, ...opts }),
		bet: [10, 1],
		lows: ['PIC5', 'PIC6', 'PIC7'],
		heartbeatConfig: false,
		bonusOutcome: false,
	},
};
const HOST = HOSTS[argv.host];
if (!HOST) throw new Error(`--host must be one of ${Object.keys(HOSTS).join(', ')}`);
console.log(`pots overlay over the ${HOST.name} host`);
const [LOW_A, LOW_B, LOW_C] = HOST.lows;

const pays = (three, four, five) => ({ paytable: [{ 3: three }, { 4: four }, { 5: five }] });
const STRIP = ['PIC1', LOW_A, 'SCAT', LOW_B, 'PIC2', LOW_C].map((name) => ({ name }));
const BOOK_HOST = {
	providerName: 'invisible_wall',
	gameName: `${HOST.name}_host`,
	gameID: `${HOST.name}_host`,
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0], 3: [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		PIC2: pays(30, 400, 2000),
		[LOW_A]: pays(5, 50, 150),
		[LOW_B]: pays(5, 50, 150),
		[LOW_C]: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () => STRIP),
		freegame: Array.from({ length: 5 }, () => STRIP),
	},
};
const insert = (host, id, change = (doc) => doc) => {
	const preset = potsOverlayPreset(id);
	const bonus =
		preset.holdAndWin && !host.holdAndWin ? holdAndWinBonus(preset.holdAndWin, host) : undefined;
	return normalizeGameConfigDoc(
		change({
			...structuredClone(host),
			symbols: { ...host.symbols, ...bonus?.symbols, ...preset.tokens },
			paddingReels: { ...host.paddingReels, ...bonus?.paddingReels },
			...(bonus && { holdAndWin: bonus.holdAndWin }),
			potsOverlay: preset.potsOverlay,
		}),
	);
};

const THREE = insert(BOOK_HOST, 'threePots');
const FREE = insert(BOOK_HOST, 'potsToFreeSpins');
/** No pots: value coins over the host's symbols, N+ on one spin start the Classic Hold and Win. */
const COINS = insert(BOOK_HOST, 'coinsOnly');
/** A pot routed to a mode of the project's own (a stub until Phase 7). */
const STUB = insert(BOOK_HOST, 'potsToFreeSpins', (doc) => {
	doc.modes = [{ id: 'pickBonus', board: 'none' }];
	doc.potsOverlay.pots[0].bonus = { mode: 'pickBonus' };
	return doc;
});
/** A bonus imported from `hw-classic-sample` (its config is the Classic preset), the pot routed to
 *  it (Phase 7): the mock deals the source feature's own generator. */
const CLASSIC_SAMPLE = normalizeGameConfigDoc(structuredClone(HOLD_AND_WIN_PRESETS.classic));
const imported = (result) => {
	if (!result.ok) throw new Error(`import refused: ${result.reason}`);
	return normalizeGameConfigDoc(result.doc);
};
const IMPORTED = imported(
	importBonus(FREE, CLASSIC_SAMPLE, {
		project: 'hw-classic-sample',
		mode: 'holdAndWin',
		at: '2026-10-03T08:00:00.000Z',
		pots: ['gold'],
	}),
);
const counted = (doc, pots) => {
	const result = setOverlayPotCount(doc, pots);
	if (!result.ok) throw new Error(result.reason);
	return normalizeGameConfigDoc(result.doc);
};
/** No pots: the overlay drops only value coins. */
const COINS_ONLY = counted(THREE, 0);
/** Five pots, the last two new. */
const FIVE = counted(THREE, 5);
/** Another game's free spins imported as a mode of this one (open item 00), the pot routed to
 *  it: its own MUMMY and a re-priced low, the rest shared with the host. */
const FS_STRIP = ['PIC1', 'MUMMY', LOW_A, LOW_B, LOW_C].map((name) => ({ name }));
const BOOK_SOURCE = normalizeGameConfigDoc({
	...structuredClone(BOOK_HOST),
	symbols: {
		...structuredClone(BOOK_HOST.symbols),
		[LOW_A]: pays(10, 60, 200),
		MUMMY: pays(20, 200, 900),
	},
	paddingReels: { ...structuredClone(BOOK_HOST.paddingReels), freegame: [FS_STRIP] },
});
const IMPORTED_FS = imported(
	importBonus(FREE, BOOK_SOURCE, {
		project: 'book-sample',
		mode: 'freeSpins',
		at: '2026-10-03T08:00:00.000Z',
		pots: ['gold'],
	}),
);
/** Drops in free spins too. */
const FREE_DROPS = insert(BOOK_HOST, 'threePots', (doc) => {
	doc.potsOverlay.drops.modes = ['basegame', 'freeSpins'];
	doc.potsOverlay.drops.chance = 1;
	return doc;
});

// ---------- the mock, called the way the test server mounts it ----------

const quiet = console.log;
const silently = async (fn) => {
	console.log = () => {};
	try {
		return await fn();
	} finally {
		console.log = quiet;
	}
};
const call = (mock, path, query, actions) =>
	silently(
		() =>
			new Promise((resolve) => {
				const body = actions === undefined ? '' : JSON.stringify(actions);
				const req = Readable.from([Buffer.from(body)]);
				Object.assign(req, { method: 'POST', url: `${path}?${query}`, headers: {} });
				let status = 200;
				const res = {
					writeHead: (s) => {
						status = s;
						return res;
					},
					setHeader() {},
					end: (text) => resolve({ status, ...JSON.parse(text) }),
				};
				mock.handle(req, res, new URL(`http://mock${path}?${query}`));
			}),
	);
const engine = (mock, query, actions) => call(mock, '/rgs/engine', query, actions);

const overlayMock = (doc, opts = {}) =>
	withPotsOverlay(HOST.create, potsOverlayMockInputs(doc))({ label: 'pots', ...opts });
/** The boot config a session is told now — asked for, as a reloading facade asks. */
const bootConfig = async (mock, sid) =>
	one(await engine(mock, `sid=${sid}`, [{ action: 'config' }]), 'config');

/** Play a round to its end the way the facade does: `[bet, play]`, context-less plays while the
 *  round is open and has not ended, then `collect`. Returns every answer. */
const playRound = async (mock, sid, { context = '', bet = HOST.bet } = {}) => {
	const answers = [];
	answers.before = (await engine(mock, `sid=${sid}`, [])).platform.balance;
	let a = await engine(mock, `sid=${sid}&seq=0`, [
		{ action: 'bet', context: bet },
		{ action: 'play', context },
	]);
	answers.push(a);
	if (a.error) return answers;
	const gid = a.platform.gameRound?.id;
	let seq = 2;
	let guard = 0;
	while (a.platform.gameRound && !a.events.some((e) => e.event === 'gameEnd') && guard++ < 300) {
		a = await engine(mock, `sid=${sid}&seq=${seq++}&gid=${gid}`, [
			{ action: 'play', context: null },
		]);
		answers.push(a);
		if (a.error) return answers;
	}
	// The lines host names a round on the answer that closed it too; one already over needs no collect.
	if (a.platform.gameRound && !names(a).includes('gameRoundOver')) {
		answers.push(await engine(mock, `sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]));
	}
	return answers;
};
const named = (answer, name) => answer.events.filter((e) => e.event === name);
const one = (answer, name) => named(answer, name)[0]?.context;
const names = (answer) => answer.events.map((e) => e.event);

// ---------- the re-derivation: one round, read from its answers alone ----------

/**
 * Walk a round's answers against `levels` (the pots as the client knows them) and check every
 * overlay rule the wire states. Returns what the round did, for the coverage checks.
 */
const waitingOf = new WeakMap();
const deriveRound = (doc, answers, levels, tag) => {
	const overlay = doc.potsOverlay;
	const potOf = new Map(overlay.pots.map((p) => [p.id, p]));
	const tokenOf = new Map(overlay.pots.map((p) => [p.token, p.id]));
	const reels = overlay.drops.reels ?? [0, 1, 2, 3, 4];
	const coinMin = doc.holdAndWin?.trigger.count?.min;
	const dropModes = overlay.drops.modes ?? ['basegame'];
	const reelsModeIds = new Set(Object.keys(potsOverlayMockInputs(doc).modes ?? {}));
	const did = {
		potBonus: [],
		coinBonus: 0,
		hostFeature: false,
		freeSpinsByPot: 0,
		importedSpins: 0,
		stub: 0,
		drops: 0,
	};
	let ok = true;
	const expect = (cond, msg) => {
		if (!cond) {
			ok = false;
			check(false, `${tag}: ${msg}`);
		}
	};
	let win = 0;
	let stake = 0;
	// Full pots whose bonus has not started yet — kept across rounds, as the mock keeps the pots.
	let waiting = waitingOf.get(levels) ?? [];
	const carried = [...waiting];
	let mode = 'basegame';
	// The coins the round's one Hold and Win will hold: those of the spin that queued it.
	const heldCoins = [];
	let features = 0;
	for (const [index, a] of answers.entries()) {
		const ev = names(a);
		if (a.error) {
			expect(false, `answer ${index} refused: ${a.error}`);
			break;
		}
		const bet = one(a, 'bet');
		if (bet) stake = bet.total;
		for (const w of named(a, 'spinWin')) win += w.context.pay;
		// — drops: right after spinStart, on the board, on an allowed reel, one per cell —
		const drop = one(a, 'overlayDrop');
		const playing = ev.includes('spinStart') ? mode : null;
		if (drop) {
			did.drops++;
			expect(dropModes.includes(playing), `a drop in ${playing ?? 'a respin'}`);
			expect(
				ev[ev.indexOf('spinStart') + 1] === 'overlayDrop',
				'overlayDrop right after spinStart',
			);
			const cells = drop.cells;
			expect(new Set(cells.map(key)).size === cells.length, 'two drops on one cell');
			for (const c of cells) {
				expect(reels.includes(c.reel) && c.row >= 0 && c.row < 3, `a drop off the board ${key(c)}`);
				if (c.pot !== undefined)
					expect(tokenOf.get(c.symbol) === c.pot, `token ${c.symbol} → ${c.pot}`);
				else expect(c.value > 0 || typeof c.jackpot === 'string', `a value coin with no value`);
			}
			const coins = cells.filter((c) => c.pot === undefined);
			// — pots: one meterUpdate per pot that moved, its `from` the token cells —
			const updates = named(a, 'meterUpdate').map((e) => e.context);
			const moved = [...new Set(cells.filter((c) => c.pot).map((c) => c.pot))];
			expect(
				same(
					updates.map((u) => u.meter),
					overlay.pots.map((p) => p.id).filter((id) => moved.includes(id)),
				),
				`meterUpdate for exactly the pots that moved (${moved})`,
			);
			for (const u of updates) {
				const from = cells.filter((c) => c.pot === u.meter);
				const max = potOf.get(u.meter).maxLevel;
				const level = u.forced ? max : Math.min(max, levels[u.meter] + from.length);
				expect(u.level === level, `${u.meter} level ${u.level}, derived ${level}`);
				expect(u.max === max && u.full === level >= max, `${u.meter} max/full`);
				expect(
					same(
						u.from,
						from.map(({ reel, row, symbol }) => ({ reel, row, symbol })),
					),
					'from',
				);
				levels[u.meter] = u.level;
				if (u.full) waiting.push(u.meter);
			}
			const potToHoldAndWin = updates.some(
				(u) => u.full && potOf.get(u.meter).bonus.mode === 'holdAndWin',
			);
			const coinStart = coinMin && coins.length >= coinMin;
			if ((potToHoldAndWin || coinStart) && !features && !heldCoins.length) heldCoins.push(coins);
			const firstUpdate = ev.indexOf('meterUpdate');
			if (firstUpdate >= 0) {
				const before = ev.slice(ev.indexOf('overlayDrop') + 1, firstUpdate);
				expect(
					before.every((n) => ['spinWin', 'bonusWin', 'playedSpin'].includes(n)),
					`meterUpdate after the host's wins and board, before the rest (${before})`,
				);
			}
		} else {
			expect(!ev.includes('meterUpdate'), 'a meterUpdate with no drop');
		}
		// A pot left full by an earlier round starts on this round's first base spin.
		if (index === 0 && !heldCoins.length) {
			const stale = carried.some((id) => potOf.get(id).bonus.mode === 'holdAndWin');
			if (stale) heldCoins.push((drop?.cells ?? []).filter((c) => c.pot === undefined));
		}
		// — a bonus entry —
		const trigger = one(a, 'spinTrigger');
		if (trigger) {
			if (trigger.bonus === 'feature' && trigger.cause === undefined) {
				did.hostFeature = true;
			} else if (trigger.bonus === 'feature' || reelsModeIds.has(trigger.bonus)) {
				// A reels mode of the project's own (an imported free spins) is dealt as free spins
				// under its own key, its mode id.
				const routed = trigger.bonus === 'feature' ? 'freeSpins' : trigger.bonus;
				expect(
					trigger.cause === 'meter' && trigger.occurs === 0,
					'a pot free spin: meter, occurs 0',
				);
				for (const id of trigger.meters ?? []) {
					expect(potOf.get(id).bonus.mode === routed, `${id} routes to ${routed}`);
					expect(waiting.includes(id), `${id} started its bonus without being full`);
					levels[id] = 0;
				}
				waiting = waiting.filter((id) => !(trigger.meters ?? []).includes(id));
				const spins = potOf.get(trigger.meters?.[0])?.bonus.spins ?? 10;
				expect(same(trigger.spins, [{ prob: 1, spins }]), `${spins} free spins`);
				// An imported mode has no expanding special: that is the host book's own mechanic.
				expect(
					ev.includes('enterBonus') && ev.includes('pickRandomly') === (routed === 'freeSpins'),
					'free-spin entry (a special for the host’s own only)',
				);
				if (routed === 'freeSpins') did.freeSpinsByPot++;
				else did.importedSpins++;
			} else {
				expect(trigger.bonus === 'respin', `bonus ${trigger.bonus}`);
				const hw = one(a, 'holdAndWinTrigger');
				expect(hw && hw.cause === trigger.cause, 'holdAndWinTrigger follows, same cause');
				if (trigger.cause === 'meter') {
					expect(
						same(trigger.meters, hw.meters),
						'spinTrigger and holdAndWinTrigger name the pots',
					);
					for (const id of trigger.meters ?? []) {
						const pot = potOf.get(id);
						expect(pot.bonus.mode === 'holdAndWin', `${id} routes to Hold and Win`);
						expect(waiting.includes(id), `${id} started its bonus without being full`);
						if (pot.bonus.activates)
							expect(hw.activeModifiers.includes(pot.bonus.activates), `${id} activates`);
						levels[id] = 0;
					}
					waiting = waiting.filter((id) => !(trigger.meters ?? []).includes(id));
					did.potBonus.push(...(trigger.meters ?? []));
				} else {
					expect(trigger.cause === 'count' && !trigger.meters, 'value coins: cause count');
					did.coinBonus++;
				}
				features++;
				expect(features === 1, `one Hold and Win per round (${features})`);
				const coins = heldCoins.shift() ?? [];
				if (doc.holdAndWin.stickiness === 'allCoins') {
					expect(
						same(hw.cells.map(key).sort(), coins.map(key).sort()),
						'the dropped value coins are what is held',
					);
				}
				mode = 'holdAndWin';
			}
			if (trigger.bonus === 'feature') mode = 'freeSpins';
			if (reelsModeIds.has(trigger.bonus)) mode = trigger.bonus;
			// The bonus replaces the end: nothing closes on this answer.
			expect(!ev.includes('gameEnd') || ev.includes('holdAndWinEnd'), 'an entry with a gameEnd');
		}
		for (const enter of named(a, 'modeEnter')) {
			const { mode: id, cause, meters } = enter.context;
			expect(cause === 'meter' && potOf.get(meters[0]).bonus.mode === id, `modeEnter ${id}`);
			expect(
				same(ev[ev.indexOf('modeEnter') + 1], 'modeExit') &&
					same(one(a, 'modeExit'), { mode: id, total: 0 }),
				'the stub exits at once, with nothing',
			);
			levels[meters[0]] = 0;
			waiting = waiting.filter((m) => m !== meters[0]);
			did.stub++;
		}
		const end = one(a, 'holdAndWinEnd');
		if (end) {
			win += end.total;
			mode = 'basegame';
		}
		if (ev.includes('playedBonusSpins') && !end) mode = 'basegame';
		// — every play restates every pot, last (with no pot there is nothing to restate) —
		if (!overlay.pots.length) {
			expect(!ev.includes('meterLevels'), 'meterLevels with no pot');
		} else if (ev.includes('spinStart') || ev.includes('playedSpin')) {
			expect(ev.at(-1) === 'meterLevels', `meterLevels last (${ev.at(-1)})`);
			const restated = one(a, 'meterLevels').meters;
			expect(
				same(
					restated,
					overlay.pots.map((p) => ({ id: p.id, level: levels[p.id], max: p.maxLevel })),
				),
				`meterLevels ${JSON.stringify(restated)} vs derived ${JSON.stringify(levels)}`,
			);
		}
		const gameEnd = one(a, 'gameEnd');
		if (gameEnd) {
			expect(gameEnd.win === win, `gameEnd.win ${gameEnd.win}, derived ${win}`);
			expect(!heldCoins.length, 'a Hold and Win was queued and never started');
			expect(
				carried.every((id) => !waiting.includes(id)),
				`a pot full since an earlier round did not start (${carried})`,
			);
			expect(
				waiting.every((id) => potOf.get(id).bonus.mode === 'holdAndWin' && features),
				`only a Hold and Win pot filled after the round's feature may wait (${waiting})`,
			);
		}
	}
	const last = answers.at(-1);
	if (!last.error && answers.before !== undefined) {
		const want = answers.before - stake + win;
		expect(
			last.platform.balance === want,
			`the balance moves by win − stake (${last.platform.balance} vs ${want})`,
		);
	}
	waitingOf.set(levels, waiting);
	did.ok = ok;
	did.features = features;
	return did;
};

// ---------- 1. the contract ----------

console.log('1. the contract: inputs only with the block, the Hold and Win bonus only as a bonus');
{
	const host = normalizeGameConfigDoc(structuredClone(BOOK_HOST));
	check(potsOverlayMockInputs(host) === undefined, 'a project without the block: no inputs');
	for (const [name, doc] of Object.entries({
		THREE,
		FREE,
		STUB,
		FREE_DROPS,
		COINS,
		IMPORTED,
		IMPORTED_FS,
	})) {
		check(
			!validateGameConfigDoc(doc).some((i) => i.severity === 'error'),
			`${name} validates`,
			JSON.stringify(validateGameConfigDoc(doc).filter((i) => i.severity === 'error')),
		);
	}
	const three = potsOverlayMockInputs(THREE);
	check(
		three.pots.length === 3 && same(three.drops.modes, ['basegame']) && Boolean(three.holdAndWin),
		'3 Pots: three pots, the base game drops, its Hold and Win bonus rides along',
	);
	check(!potsOverlayMockInputs(FREE).holdAndWin, 'pots to free spins: no Hold and Win');
	const coins = potsOverlayMockInputs(COINS);
	check(
		same(coins.pots, []) &&
			same(coins.drops.table, [{ coin: true, weight: 1 }]) &&
			coins.holdAndWin?.block.trigger.count.min === 6,
		'coins only: no pots, a coin row, the Classic Hold and Win bonus with its 6+ count trigger',
	);
	const game = insert(HOLD_AND_WIN_PRESETS.pots, 'potsToFreeSpins');
	check(
		!potsOverlayMockInputs(game).holdAndWin,
		'a Hold and Win GAME with an overlay: its block is the base game, not the overlay’s bonus',
	);
	pass('the inputs follow the block and holdAndWinIsOverlayBonus');
}

// ---------- 2. parity ----------

console.log('2. parity: no block, the host byte for byte; with it, the host deals the same game');
{
	// The book mock's answers, hashed by `digest` below, as `main` dealt them before the overlay
	// seam existed (`git show e4a78f1:scripts/mock-rgs-server-book.mjs`, 2026-10-02).
	const MAIN_DIGESTS = {
		plain: '0d724397a1a76c3b',
		trigger: '6bb55df574755de0',
		paytable: 'c2447ad6adca7af4',
	};
	const digest = async (opts, rounds) => {
		const mock = createBookMock({ seed: 'book-parity', ...opts });
		const hash = createHash('sha256');
		const add = (a) => hash.update(JSON.stringify(a));
		const boot = await engine(mock, 'sid=s1', []);
		delete boot.status;
		add(boot);
		for (let r = 0; r < rounds; r++) {
			const context = r % 3 === 0 ? null : '';
			const bet = [r % 17 === 5 ? 1 : 0, 1 + (r % 4)];
			let a = await engine(mock, 'sid=s1&seq=0', [
				{ action: 'bet', context: bet },
				{ action: 'play', context },
			]);
			add(a.events);
			add(a.platform.balance);
			let seq = 2;
			const gid = a.platform.gameRound?.id;
			let guard = 0;
			while (
				a.platform.gameRound &&
				!a.events.some((e) => e.event === 'gameEnd') &&
				guard++ < 200
			) {
				a = await engine(mock, `sid=s1&seq=${seq++}&gid=${gid}`, [
					{ action: 'play', context: null },
				]);
				add(a.events);
				add(a.platform.balance);
			}
			if (a.platform.gameRound) {
				a = await engine(mock, `sid=s1&seq=${seq++}&gid=${gid}`, [{ action: 'collect' }]);
				add(a.events);
				add(a.platform.balance);
			}
		}
		return hash.digest('hex').slice(0, 16);
	};
	// The lines host's own parity is `check:lines-parity` (ten configurations against main's digests).
	if (HOST.name === 'book') {
		const got = {
			plain: await digest({}, 300),
			trigger: await digest({ forceTrigger: true }, 40),
			paytable: await digest({ symbolPaytable: { PIC1: { 2: 20, 3: 200 } } }, 200),
		};
		for (const [name, want] of Object.entries(MAIN_DIGESTS)) {
			check(got[name] === want, `book mock (${name}): dealt as main dealt`, `digest ${got[name]}`);
		}
		check(
			(await digest({ seed: 'parity-other' }, 50)) !== MAIN_DIGESTS.plain,
			'the parity digest moves with the deal',
		);
	}

	// With the overlay — pots too deep to ever fill — the host's own events are the plain mock's.
	const deep = insert(BOOK_HOST, 'threePots', (doc) => {
		for (const pot of doc.potsOverlay.pots) pot.maxLevel = 100_000;
		doc.potsOverlay.drops.chance = 1;
		return doc;
	});
	const plain = HOST.create({ seed: 'host-same', label: 'plain' });
	const wrapped = overlayMock(deep, { seed: 'host-same' });
	const OVERLAY = new Set(['overlayDrop', 'meterUpdate', 'meterLevels']);
	let differ = 0;
	let rounds = 0;
	for (let r = 0; r < 150; r++) {
		const a = await playRound(plain, 'p');
		const b = await playRound(wrapped, 'p');
		rounds++;
		const strip = (answers) =>
			answers.map(({ events, platform }) => [
				events
					.filter((e) => !OVERLAY.has(e.event))
					.map((e) =>
						e.event === 'config'
							? { ...e, context: { ...e.context, potsOverlay: 0, holdAndWin: 0 } }
							: e,
					),
				platform.balance,
			]);
		if (!same(strip(a), strip(b))) differ++;
	}
	check(
		differ === 0,
		`${rounds} rounds: the host's events and balances are the plain mock's`,
		`${differ} differ`,
	);
	pass('no block deals main’s host; the block adds events and never changes the host’s');
}

// ---------- 3. seeded rounds ----------

console.log(`3. seeded rounds re-derived from the wire (3 Pots on a ${HOST.name} host)`);
{
	const mock = overlayMock(THREE, { seed: 'pots-seeded' });
	const boot = await engine(mock, 'sid=r', []);
	const config = boot.events[0].context;
	check(
		same(config.potsOverlay, {
			wire: 1,
			pots: THREE.potsOverlay.pots.map((p) => ({
				id: p.id,
				token: p.token,
				level: 0,
				max: p.maxLevel,
				sizeStages: p.sizeStages,
				bonus: 'holdAndWin',
				activates: p.bonus.activates,
			})),
			bonuses: { feature: 'freeSpins', respin: 'holdAndWin' },
		}),
		'boot: potsOverlay {wire, pots, bonuses}',
		JSON.stringify(config.potsOverlay),
	);
	check(
		config.holdAndWin?.wire === 1 &&
			same(config.holdAndWin.meters, []) &&
			config.holdAndWin.luckySpin === false,
		'boot: the Hold and Win bonus’s block beside it, its meters the pots’',
	);
	check(
		same(config.symbols, (await engine(HOST.create(), 'sid=x', [])).events[0].context.symbols),
		'boot: the host’s config, unchanged',
	);
	const levels = Object.fromEntries(THREE.potsOverlay.pots.map((p) => [p.id, 0]));
	const seen = { potBonus: new Set(), hostFeature: 0, drops: 0, rounds: 0 };
	let ok = true;
	for (let r = 0; r < 500; r++) {
		const did = deriveRound(
			THREE,
			await playRound(mock, 'r', { context: r % 2 ? '' : null }),
			levels,
			`round ${r}`,
		);
		ok &&= did.ok;
		did.potBonus.forEach((id) => seen.potBonus.add(id));
		seen.hostFeature += did.hostFeature ? 1 : 0;
		seen.drops += did.drops;
		seen.rounds++;
	}
	check(ok, `${seen.rounds} rounds: drops, pots, entries, money and every meterLevels re-derived`);
	check(seen.drops > 40, `drops land (${seen.drops} spins)`);
	check(
		seen.potBonus.size === 3,
		`every pot filled and started its Hold and Win (${[...seen.potBonus]})`,
	);
	check(seen.hostFeature > 0, `the host’s own free spins still come (${seen.hostFeature})`);
	pass('seeded rounds hold every overlay rule');
}

// ---------- 4. routes ----------

console.log('4. routes: Hold and Win (pots, coins), the host’s free spins, another mode');
{
	const routes = [
		['pot → Hold and Win', THREE, 'force:pot:green', (d) => same(d.potBonus, ['green'])],
		['value coins → Hold and Win', THREE, 'force:overlay:coins:6', (d) => d.coinBonus === 1],
		['pot → free spins', FREE, 'force:pot:gold', (d) => d.freeSpinsByPot === 1],
		['pot → another mode (a stub)', STUB, 'force:pot:gold', (d) => d.stub === 1],
		[
			'pot → an imported Hold and Win',
			IMPORTED,
			'force:pot:gold',
			(d) => same(d.potBonus, ['gold']),
		],
		[
			'pot → imported free spins (a reels mode)',
			IMPORTED_FS,
			'force:pot:gold',
			(d) => d.importedSpins === 1 && d.freeSpinsByPot === 0,
		],
		[
			'no pots: value coins → Hold and Win',
			COINS_ONLY,
			'force:overlay:coins:6',
			(d) => d.coinBonus === 1,
		],
		['a fifth pot → Hold and Win', FIVE, 'force:pot:purple', (d) => same(d.potBonus, ['purple'])],
	];
	for (const [what, doc, context, did] of routes) {
		const mock = overlayMock(doc, { seed: `route-${what}` });
		const levels = Object.fromEntries(doc.potsOverlay.pots.map((p) => [p.id, 0]));
		// Two seeds' worth, so a host trigger on the forced spin is not what decides it.
		const answers = await playRound(mock, 'r', { context });
		const result = deriveRound(doc, answers, levels, what);
		check(result.ok && did(result), `${what}: started and played out`, JSON.stringify(result));
	}
	// The coins are held as the feature starts, and the pot's special is active.
	const mock = overlayMock(THREE, { seed: 'route-held' });
	const [entry] = await playRound(mock, 'h', { context: 'force:pot:red,overlay:coins:3' });
	const hw = one(entry, 'holdAndWinTrigger');
	const coins = one(entry, 'overlayDrop').cells.filter((c) => c.pot === undefined);
	check(
		hw?.cause === 'meter' &&
			same(hw.meters, ['red']) &&
			hw.activeModifiers.includes('payer') &&
			same(hw.cells.map(key).sort(), coins.map(key).sort()) &&
			coins.length === 3,
		'a pot and coins on one spin: ONE feature, cause meter, the coins held, the payer active',
	);
	// The imported feature is the source's: its boot block, and a re-synced edit reaches the mock.
	const bootHoldAndWin = async (doc) =>
		(await engine(overlayMock(doc, { seed: 'import-boot' }), 'sid=i', [])).events[0].context
			.holdAndWin;
	const before = await bootHoldAndWin(IMPORTED);
	const edited = structuredClone(CLASSIC_SAMPLE);
	edited.holdAndWin.respins.start = 5;
	const resynced = imported(
		resyncBonus(IMPORTED, edited, 'holdAndWin', '2026-10-04T09:00:00.000Z'),
	);
	const after = await bootHoldAndWin(resynced);
	check(
		JSON.stringify(before).includes('GRAND') && before.respins === 3 && after.respins === 5,
		'an imported bonus boots as the source feature (GRAND letters), and a re-sync reaches the mock',
		JSON.stringify({ before: before.respins, after: after.respins }),
	);
	// The imported free spins are dealt from THEIR strips, pay THEIR symbols, and boot announce the mode.
	{
		const mock = overlayMock(IMPORTED_FS, { seed: 'import-fs' });
		const boot = (await engine(mock, 'sid=f', [])).events[0].context.potsOverlay;
		const fs = await playRound(mock, 'f', { context: 'force:pot:gold' });
		const boards = fs.slice(1).flatMap((a) => named(a, 'playedSpin').map((e) => e.context));
		const repriced = `${LOW_A}_2`;
		const onStrip = new Set(FS_STRIP.map((c) => (c.name === LOW_A ? repriced : c.name)));
		const paid = fs.flatMap((a) => named(a, 'spinWin').map((e) => e.context.what));
		check(
			same(boot.modes, { freeSpins_2: { gameType: 'freegame_2' } }) &&
				boot.bonuses.freeSpins_2 === 'freeSpins_2' &&
				one(fs[0], 'spinTrigger')?.bonus === 'freeSpins_2' &&
				boards.length === 10 &&
				boards.every((b) => b.flat().every((name) => onStrip.has(name))),
			'imported free spins: boot names the mode, its key enters it, 10 spins drawn only from its strips',
			JSON.stringify({ modes: boot.modes, boards: boards.length, paid }),
		);
		const sample = await (async () => {
			const seen = new Set();
			for (let r = 0; r < 30; r++) {
				const round = await playRound(overlayMock(IMPORTED_FS, { seed: `import-fs-${r}` }), 'p', {
					context: 'force:pot:gold',
				});
				for (const a of round) for (const w of named(a, 'spinWin')) seen.add(w.context.what);
			}
			return seen;
		})();
		check(
			sample.has('MUMMY') && sample.has(repriced),
			`…and its own symbols pay at their own prices (MUMMY, ${repriced})`,
			JSON.stringify([...sample]),
		);
		// A cosmetic strip can land a scatter on every reel of every spin: its retriggers stop at the cap
		// and the round still ends.
		const dense = imported(
			importBonus(
				FREE,
				normalizeGameConfigDoc({
					...structuredClone(BOOK_SOURCE),
					paddingReels: {
						...structuredClone(BOOK_SOURCE.paddingReels),
						freegame: [['SCAT', LOW_C, LOW_B].map((name) => ({ name }))],
					},
				}),
				{
					project: 'book-dense',
					mode: 'freeSpins',
					at: '2026-10-03T08:00:00.000Z',
					pots: ['gold'],
				},
			),
		);
		const capped = await playRound(overlayMock(dense, { seed: 'import-dense' }), 'd', {
			context: 'force:pot:gold',
		});
		const freeSpins = capped.flatMap((a) => named(a, 'playedBonusSpin')).length;
		check(
			capped.some((a) => named(a, 'gameEnd').length) && freeSpins > 10 && freeSpins <= 50,
			'…a scatter on every reel retriggers up to the 50-spin cap, then the round ends',
			JSON.stringify({ freeSpins }),
		);
	}
	const stub = await playRound(overlayMock(STUB, { seed: 'stub-close' }), 's', {
		context: 'force:pot:gold',
	});
	const ev = names(stub[0]);
	check(
		ev.indexOf('modeExit') === ev.indexOf('modeEnter') + 1 &&
			ev.indexOf('gameEnd') > ev.indexOf('modeExit'),
		'a stub mode enters and exits, then the round ends as the host ends it',
	);
}

// ---------- 5. persistence ----------

console.log('5. pots persist per session, across rounds and a contract swap');
{
	const mock = overlayMock(THREE, { seed: 'persist' });
	const levelsOf = async (sid) =>
		Object.fromEntries((await bootConfig(mock, sid)).potsOverlay.pots.map((p) => [p.id, p.level]));
	await playRound(mock, 'a', { context: 'force:pot:red:7' });
	const after = await levelsOf('a');
	check(after.red >= 7, `a level set in one round is there at the next boot (${after.red})`);
	const next = await playRound(mock, 'a');
	check(
		one(next[0], 'meterLevels').meters.find((m) => m.id === 'red').level >= after.red,
		'…and the next round starts from it',
	);
	check(same(Object.values(await levelsOf('b')), [0, 0, 0]), 'another session starts empty');
	const swapped = overlayMock(THREE, { seed: 'persist-2' });
	for (const [sid, session] of mock.sessions)
		swapped.sessions.set(sid, carrySession(session, { keepBetShape: true }));
	const carried = (await bootConfig(swapped, 'a')).potsOverlay.pots.find((p) => p.id === 'red');
	const before = (await levelsOf('a')).red;
	check(carried.level === before, `a contract swap carries the pots (${carried.level})`);
}

// ---------- 5b. a swap under an open tab ----------

console.log(
	'5b. a contract swap: an open tab is dealt the add-on its config carried, until it reloads',
);
{
	// Dropping on every spin, so a session the overlay is dealt to cannot miss it.
	const always = insert(BOOK_HOST, 'threePots', (doc) => {
		doc.potsOverlay.drops.chance = 1;
		return doc;
	});
	const OVERLAY_EVENTS = [
		'overlayDrop',
		'meterUpdate',
		'meterLevels',
		'holdAndWinTrigger',
		'respinUpdate',
	];
	const overlaid = (answers) => answers.flatMap(names).filter((n) => OVERLAY_EVENTS.includes(n));
	const dealt = (answers) => answers.map(({ events, platform }) => [events, platform.balance]);
	const carried = (from, to, keepBetShape = true) => {
		for (const [sid, session] of from.sessions)
			to.sessions.set(sid, carrySession(session, { keepBetShape }));
		return to;
	};
	/** Boot as the facade does: the balance probe, then `config` only if the probe carried none. */
	const boot = async (mock, sid) => {
		const probe = await engine(mock, `sid=${sid}`, []);
		if (names(probe).includes('config')) return { probe, config: one(probe, 'config') };
		const asked = await engine(mock, `sid=${sid}`, [{ action: 'config' }]);
		return { probe, config: one(asked, 'config') };
	};
	/** Plain, collected, auto-collected and bought rounds, and one a pot beat is forced on. */
	const rounds = async (mock, sid, n) => {
		const answers = [];
		for (let r = 0; r < n; r++) {
			const opts =
				r % 7 === 5
					? { bet: [1, 1] }
					: { context: r % 7 === 3 ? 'force:pot:red' : r % 2 ? '' : null };
			answers.push(...(await playRound(mock, sid, opts)));
		}
		return answers;
	};

	// (a) Booted on the plain host game; the overlay is switched on under the open tab.
	const tab = HOST.create({ seed: 'stale-tab', label: 'before' });
	const booted = (await boot(tab, 't')).config;
	const on = carried(tab, overlayMock(always, { seed: 'stale-tab' }));
	const reference = HOST.create({ seed: 'stale-tab', label: 'reference' });
	await boot(reference, 't');
	const probe = await engine(on, 'sid=t', []);
	const stale = await rounds(on, 't', 30);
	const plain = await rounds(reference, 't', 30);
	check(
		!booted.potsOverlay && !names(probe).includes('config'),
		'a tab booted without the overlay: after the swap its balance probe carries no config',
	);
	check(
		overlaid(stale).length === 0 && !on.sessions.get('t').meters,
		'30 rounds after the swap (a forced pot beat among them): no overlay event, no pots',
		`${overlaid(stale).length} overlay events`,
	);
	check(
		stale.some((a) => names(a).includes('enterBonus')) && same(dealt(stale), dealt(plain)),
		'…every answer, the host’s free spins included, is the plain host game’s on the same seed',
	);

	// (b) The tab reloads: its probe finds no config, it asks for one, and is dealt the overlay.
	const reload = await boot(on, 't');
	const next = new Set(overlaid(await playRound(on, 't', { context: 'force:pot:red' })));
	check(
		!names(reload.probe).includes('config') &&
			reload.config?.potsOverlay?.wire === 1 &&
			reload.config.holdAndWin?.wire === 1,
		'a reload asks for config and is told the overlay',
	);
	check(
		OVERLAY_EVENTS.every((n) => next.has(n)),
		'…and its next round is dealt it: the drop, the pots, the full pot’s Hold and Win',
		[...next].join(' '),
	);
	// The book host re-sends its config on every heartbeat; the lines host sends it once.
	check(
		names(await engine(on, 'sid=t', [])).includes('config') === HOST.heartbeatConfig,
		HOST.heartbeatConfig
			? '…and its balance probe carries the config again'
			: '…and its balance probe carries none (the lines host sends it once)',
	);

	// (c) The reverse: booted with the overlay, which is switched off under the open tab.
	const withIt = overlayMock(always, { seed: 'reverse' });
	await boot(withIt, 'r');
	await playRound(withIt, 'r', { context: 'force:pot:red:5' });
	const pots = structuredClone(withIt.sessions.get('r').meters);
	const off = carried(withIt, HOST.create({ seed: 'reverse-2', label: 'after' }));
	// The same session, told the plain game: its wallet, on the same seed.
	const offReference = carried(withIt, HOST.create({ seed: 'reverse-2', label: 'reference' }));
	await engine(offReference, 'sid=r', [{ action: 'config' }]);
	let threw = '';
	let dealtOff = [];
	try {
		dealtOff = await rounds(off, 'r', 20);
	} catch (e) {
		threw = String(e);
	}
	check(
		!threw && dealtOff.length > 0 && dealtOff.every((a) => a.status === 200 && !a.error),
		'the overlay switched off under a tab booted with it: nothing throws or is refused',
		threw,
	);
	check(
		overlaid(dealtOff).length === 0 &&
			same(dealt(dealtOff), dealt(await rounds(offReference, 'r', 20))) &&
			same(off.sessions.get('r').meters, pots),
		'…it is dealt the plain host game, its pots kept for a swap back',
	);
	const reloadOff = await boot(off, 'r');
	check(
		!names(reloadOff.probe).includes('config') &&
			reloadOff.config &&
			!reloadOff.config.potsOverlay &&
			names(await engine(off, 'sid=r', [])).includes('config') === HOST.heartbeatConfig,
		'…and a reload asks for config and is told the plain game',
	);

	// A desktop build's session is re-told on its next heartbeat, as before.
	const desktop = HOST.create({ seed: 'desktop', label: 'desktop' });
	await boot(desktop, 'd');
	const built = carried(desktop, overlayMock(always, { seed: 'desktop' }), false);
	const heartbeat = await engine(built, 'sid=d', []);
	check(
		one(heartbeat, 'config')?.potsOverlay?.wire === 1 &&
			overlaid(await playRound(built, 'd')).includes('overlayDrop'),
		'a desktop build’s session: re-sent the config on its next heartbeat and dealt the overlay',
	);
}

// ---------- 6. both on one spin ----------

console.log('6. the host’s feature and a full pot on one spin: one round, the host first');
{
	for (const [doc, spec, route] of [
		[THREE, 'force:feature,pot:blue', 'respin'],
		[FREE, 'force:feature,pot:gold', 'feature'],
		// Two free-spin-shaped features back to back: the host's, then the imported reels mode.
		[IMPORTED_FS, 'force:feature,pot:gold', 'freeSpins_2'],
	]) {
		const mock = overlayMock(doc, { seed: `both-${route}` });
		const levels = Object.fromEntries(doc.potsOverlay.pots.map((p) => [p.id, 0]));
		const answers = await playRound(mock, 'b', { context: spec });
		const did = deriveRound(doc, answers, levels, `both (${route})`);
		const opening = answers[0];
		const firstTrigger = one(opening, 'spinTrigger');
		const pot = doc.potsOverlay.pots.find((p) => spec.includes(`pot:${p.id}`));
		check(
			firstTrigger?.bonus === 'feature' &&
				firstTrigger.cause === undefined &&
				one(opening, 'meterUpdate')?.full === true &&
				!names(opening).includes('holdAndWinTrigger') &&
				one(opening, 'meterLevels').meters.find((m) => m.id === pot.id).level === pot.maxLevel,
			`${route}: the opening answer enters the host’s free spins; the pot shows full and waits`,
		);
		const handOver = answers.findIndex(
			(a, i) => i > 0 && named(a, 'spinTrigger').some((t) => t.context.cause === 'meter'),
		);
		const hand = answers[handOver];
		const ev = hand ? names(hand) : [];
		check(
			handOver > 0 &&
				ev.includes('playedBonusSpins') &&
				ev.indexOf('spinTrigger') > ev.indexOf('playedBonusSpins') &&
				!ev.slice(0, ev.indexOf('spinTrigger')).includes('gameEnd') &&
				same(one(hand, 'spinTrigger').meters, [pot.id]) &&
				one(hand, 'spinTrigger').bonus === route,
			`${route}: the last free spin carries the pot bonus’s spinTrigger + entry instead of gameEnd`,
			ev.join(' '),
		);
		check(
			did.ok &&
				answers.at(-1).events.some((e) => e.event === 'gameRoundOver') &&
				answers.flatMap(names).filter((n) => n === 'gameEnd').length === 1,
			`${route}: one round, played out and collected, one gameEnd`,
		);
	}
	// Drops in free spins: a pot that fills there starts its bonus once they end.
	const mock = overlayMock(FREE_DROPS, { seed: 'free-drops' });
	const levels = Object.fromEntries(FREE_DROPS.potsOverlay.pots.map((p) => [p.id, 0]));
	let freeDrops = 0;
	let ok = true;
	for (let r = 0; r < 40; r++) {
		const answers = await playRound(mock, 'f', { context: r % 4 ? '' : 'force:feature' });
		ok &&= deriveRound(FREE_DROPS, answers, levels, `free-drops ${r}`).ok;
		freeDrops += answers.filter(
			(a) =>
				names(a).includes('playedBonusSpin') &&
				names(a).includes('overlayDrop') &&
				!names(a).includes('respinUpdate'),
		).length;
	}
	check(
		ok && freeDrops > 0,
		`drops in free spins (${freeDrops}) re-derive, their bonuses wait for the free spins`,
	);
}

// ---------- 7. forced beats ----------

console.log('7. forced beats, refusals and the …/force route');
{
	const mock = overlayMock(THREE, { seed: 'forced' });
	const opening = async (context, sid = 'f') => (await playRound(mock, sid, { context }))[0];
	const dropped = await opening('force:overlay:drop');
	check(one(dropped, 'overlayDrop')?.cells.length >= 1, 'overlay:drop: something drops');
	const two = await opening('force:overlay:coins:2');
	check(
		one(two, 'overlayDrop').cells.filter((c) => c.pot === undefined).length === 2 &&
			!one(two, 'holdAndWinTrigger'),
		'overlay:coins:2: two coins, below the trigger — no feature',
	);
	const red = await opening('force:pot:red');
	check(
		one(red, 'meterUpdate')?.forced === true && one(red, 'meterUpdate').full === true,
		'pot:red: full on this spin, flagged forced',
	);
	const set = await opening('force:pot:green:9');
	const green = one(set, 'meterLevels').meters.find((m) => m.id === 'green').level;
	check(green >= 9 && green < 12, `pot:green:9: the level is set before the spin (${green})`);
	for (const [spec, why] of [
		['pot:nope', 'an unknown pot'],
		['pot:red:12', 'a level at max'],
		['pot:red:x', 'a level that is no number'],
		['overlay:coins:0', 'no coins'],
		['overlay:coins:99', 'more coins than cells'],
		['overlay:rain', 'an unknown overlay beat'],
		['trigger', 'a Hold and Win token'],
	]) {
		const before = (await engine(mock, 'sid=refused', [])).platform.balance;
		const a = await engine(mock, 'sid=refused&seq=0', [
			{ action: 'bet', context: HOST.bet },
			{ action: 'play', context: `force:${spec}` },
		]);
		check(
			a.errorCode === 101 && a.platform.balance === before && !a.events,
			`refused: ${why} (${spec}) — nothing dealt, nothing charged`,
			a.error,
		);
	}
	const free = await engine(overlayMock(FREE), 'sid=x&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:overlay:coins:6' },
	]);
	check(free.errorCode === 101, 'refused: value coins with no Hold and Win bonus');
	const locked = overlayMock(THREE, { allowForce: false });
	const off = await engine(locked, 'sid=x&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:pot:red' },
	]);
	const route = await call(locked, '/force', 'sid=x&beat=pot:red');
	check(off.errorCode === 101 && route.status === 403, 'forcing off: both routes refuse');
	const held = await call(mock, '/force', 'sid=held&beat=pot:blue');
	const bad = await call(mock, '/force', 'sid=held2&beat=pot:nope');
	check(held.ok && bad.status === 400, '…/force holds a valid beat and refuses a bad one');
	const heldRound = await opening('', 'held');
	check(
		one(heldRound, 'meterUpdate')?.meter === 'blue' && one(heldRound, 'meterUpdate').forced,
		'the held beat plays on the session’s next spin',
	);
	const after = await opening('', 'held');
	check(!named(after, 'meterUpdate').some((u) => u.context.forced), '…once');
	await call(mock, '/force', 'sid=held&beat=pot:red');
	await call(mock, '/force', 'sid=held&beat=');
	const cleared = await opening('', 'held');
	check(!named(cleared, 'meterUpdate').some((u) => u.context.forced), '`beat=` clears it');
}

// ---------- 8. replay and resume ----------

console.log('8. replay and resume inside a pot bonus');
{
	const mock = overlayMock(THREE, { seed: 'replay' });
	const entry = await engine(mock, 'sid=z&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:pot:red' },
	]);
	const gid = entry.platform.gameRound.id;
	const respin = await engine(mock, `sid=z&seq=2&gid=${gid}`, [{ action: 'play', context: null }]);
	const again = await engine(mock, `sid=z&seq=2&gid=${gid}`, [{ action: 'play', context: null }]);
	check(same(again.events, respin.events), 'a resent position replays what was dealt');
	const first = await engine(mock, `sid=z&seq=0&gid=${gid}`, [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:pot:red' },
	]);
	check(
		same(
			first.events,
			entry.events.filter((e) => e.event !== 'config'),
		),
		'the opening batch replays, drops and entry included',
	);
	const boot = await engine(mock, 'sid=z', [{ action: 'config' }]);
	const config = boot.events[0];
	check(
		config.resume === true &&
			config.actions.length === 3 &&
			config.context.potsOverlay.pots.find((p) => p.id === 'red').level === 0 &&
			boot.platform.gameRound?.id === gid &&
			(boot.platform.gameRound.outcome === 'bonus') === HOST.bonusOutcome,
		'a boot mid-feature resumes: the actions, the pots, the open bonus round',
	);
}

// ---------- 9. a full pot always starts ----------

console.log('9. one Hold and Win per round, and a full pot never stays stuck');
{
	// Drops in free spins every spin: several Hold and Win starts in one round join into one.
	const mock = overlayMock(FREE_DROPS, { seed: 'one-feature' });
	const levels = Object.fromEntries(FREE_DROPS.potsOverlay.pots.map((p) => [p.id, 0]));
	let ok = true;
	let most = 0;
	for (let r = 0; r < 60; r++) {
		const did = deriveRound(
			FREE_DROPS,
			await playRound(mock, 'o', { context: 'force:feature' }),
			levels,
			`one ${r}`,
		);
		ok &&= did.ok;
		most = Math.max(most, did.features);
	}
	check(ok && most === 1, `60 free-spin rounds dropping every spin: never more than one feature`);

	const firstAnswer = async (m, sid) => (await playRound(m, sid))[0];
	const startsFrom = (answer, id) =>
		same(one(answer, 'spinTrigger')?.meters, [id]) &&
		!named(answer, 'meterUpdate').some((u) => u.context.meter === id);
	// An abandoned round: its pot shows full, the next bet opens a new round.
	const abandon = overlayMock(THREE, { seed: 'abandon' });
	await engine(abandon, 'sid=a&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:feature,pot:blue' },
	]);
	check(
		startsFrom(await firstAnswer(abandon, 'a'), 'blue'),
		'an abandoned round: its full pot starts on the next round’s first spin, with no meterUpdate',
	);
	// A contract swap drops the open round and keeps the pots.
	const before = overlayMock(THREE, { seed: 'swap' });
	await engine(before, 'sid=s&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:feature,pot:green' },
	]);
	const after = overlayMock(THREE, { seed: 'swap-2' });
	for (const [sid, session] of before.sessions)
		after.sessions.set(sid, carrySession(session, { keepBetShape: true }));
	check(
		startsFrom(await firstAnswer(after, 's'), 'green'),
		'a contract swap: the waiting pot starts on the next round',
	);
	// A max lowered under a pot's level makes it full; it starts too.
	const tall = overlayMock(FREE, { seed: 'lower' });
	await playRound(tall, 'l', { context: 'force:pot:gold:10' });
	const lowered = insert(BOOK_HOST, 'potsToFreeSpins', (doc) => {
		doc.potsOverlay.pots[0].maxLevel = 8;
		return doc;
	});
	const short = overlayMock(lowered, { seed: 'lower-2' });
	for (const [sid, session] of tall.sessions)
		short.sessions.set(sid, carrySession(session, { keepBetShape: true }));
	check(
		startsFrom(await firstAnswer(short, 'l'), 'gold'),
		'a lowered max: the pot it leaves full starts',
	);
	// A pot routed to Hold and Win with no Hold and Win bonus cannot be dealt: the mock refuses to build.
	const orphan = insert(BOOK_HOST, 'potsToFreeSpins', (doc) => {
		doc.potsOverlay.pots[0].bonus = { mode: 'holdAndWin' };
		return doc;
	});
	let refused = '';
	try {
		overlayMock(orphan);
	} catch (e) {
		refused = e.message;
	}
	check(
		/no Hold and Win bonus/.test(refused),
		'a Hold and Win pot with no Hold and Win bonus: refused at build',
		refused,
	);
	// A pot routed to the host's free spins on a game whose free spins are off: refused at build (and
	// by `/config`, which will not save it), so the test server deals the plain host and says so.
	let offRefused = '';
	try {
		overlayMock(FREE, { freeSpins: false });
	} catch (e) {
		offRefused = e.message;
	}
	check(
		/free spins are off/.test(offRefused),
		'a pot to free spins on a game with free spins off: refused at build',
		offRefused,
	);
	check(
		Boolean(overlayMock(THREE, { freeSpins: false })),
		'…while a pot to Hold and Win still builds',
	);
}

// ---------- 10. coins only ----------

console.log('10. coins only: no pots, 6+ value coins start the Classic Hold and Win, fewer clear');
{
	const mock = overlayMock(COINS, { seed: 'coins-seeded' });
	const boot = await engine(mock, 'sid=c', []);
	const config = boot.events[0].context;
	check(
		same(config.potsOverlay, {
			wire: 1,
			pots: [],
			bonuses: { feature: 'freeSpins', respin: 'holdAndWin' },
		}) &&
			config.holdAndWin?.wire === 1 &&
			same(config.holdAndWin.meters, []),
		'boot: potsOverlay {wire, pots: [], bonuses} with the Hold and Win bonus beside it',
		JSON.stringify(config.potsOverlay),
	);
	const min = COINS.holdAndWin.trigger.count.min;
	const levels = {};
	const seen = { coinBonus: 0, drops: 0, below: 0, hostFeature: 0 };
	let ok = true;
	for (let r = 0; r < 600; r++) {
		const answers = await playRound(mock, 'c', { context: r % 2 ? '' : null });
		const did = deriveRound(COINS, answers, levels, `coins ${r}`);
		ok &&= did.ok;
		seen.coinBonus += did.coinBonus;
		seen.drops += did.drops;
		seen.hostFeature += did.hostFeature ? 1 : 0;
		const drop = one(answers[0], 'overlayDrop');
		if (drop && drop.cells.length < min && !one(answers[0], 'holdAndWinTrigger')) seen.below++;
		ok &&= answers.every((a) => !names(a).some((n) => ['meterUpdate', 'meterLevels'].includes(n)));
	}
	check(
		ok,
		'600 rounds: drops, held coins, entries and money re-derived; no meterUpdate or meterLevels',
	);
	check(
		seen.drops > 30 && seen.below > 0 && seen.coinBonus > 0 && seen.hostFeature > 0,
		'coins drop, fewer than the trigger start nothing, enough start Hold and Win, the host’s free spins still come',
		JSON.stringify(seen),
	);
	const forced = async (spec) =>
		playRound(overlayMock(COINS, { seed: `coins-${spec}` }), 'f', { context: `force:${spec}` });
	const six = await forced(`overlay:coins:${min}`);
	const sixDrop = one(six[0], 'overlayDrop').cells;
	const sixTrigger = one(six[0], 'holdAndWinTrigger');
	check(
		sixDrop.length === min &&
			sixTrigger?.cause === 'count' &&
			!sixTrigger.meters &&
			same(sixTrigger.cells.map(key).sort(), sixDrop.map(key).sort()) &&
			deriveRound(COINS, six, {}, 'coins forced').ok,
		`overlay:coins:${min}: Hold and Win, cause count, those ${min} coins held, played out`,
	);
	const five = await forced(`overlay:coins:${min - 1}`);
	check(
		one(five[0], 'overlayDrop').cells.length === min - 1 &&
			!one(five[0], 'holdAndWinTrigger') &&
			names(five[0]).includes('gameEnd'),
		`overlay:coins:${min - 1}: shown, no feature, the round ends`,
	);
	const refused = await engine(overlayMock(COINS), 'sid=x&seq=0', [
		{ action: 'bet', context: HOST.bet },
		{ action: 'play', context: 'force:pot:gold' },
	]);
	check(refused.errorCode === 101, 'refused: a pot beat with no pots');
	const buildError = (doc) => {
		try {
			overlayMock(doc);
			return '';
		} catch (e) {
			return e.message;
		}
	};
	const noBonus = insert(BOOK_HOST, 'potsToFreeSpins', (doc) => {
		doc.potsOverlay.pots = [];
		doc.potsOverlay.drops.table = [{ coin: true, weight: 1 }];
		return doc;
	});
	const nothing = insert(BOOK_HOST, 'coinsOnly', (doc) => {
		doc.potsOverlay.drops.table = [{ pot: 'gold', weight: 1 }];
		return doc;
	});
	check(
		[noBonus, nothing].every((doc) => /at least one pot/.test(buildError(doc))),
		'neither a pot nor a coin it can deal (no Hold and Win bonus, or no coin row): refused at build',
	);
}

// ---------- 11. the test-server image ----------

console.log('11. the test server ships it');
{
	const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
	const copied = new Set(
		read('services/test-server/Dockerfile')
			.split('\n')
			.filter((line) => line.startsWith('COPY scripts/'))
			.flatMap((line) => line.split(/\s+/).slice(1, -1)),
	);
	const imports = (rel) =>
		[...read(rel).matchAll(/^import [\s\S]*? from '\.\/([^']+)'/gm)].map((m) => `scripts/${m[1]}`);
	const needed = [
		'scripts/mock-pots-overlay.mjs',
		...imports('scripts/mock-pots-overlay.mjs'),
		...imports('scripts/mock-holdandwin-engine.mjs'),
	];
	const missing = needed.filter((rel) => !copied.has(rel));
	check(
		read('services/test-server/server.mjs').includes("'../../scripts/mock-pots-overlay.mjs'"),
		'server.mjs imports the overlay',
	);
	check(
		!missing.length,
		'the Dockerfile copies the overlay and everything it imports',
		missing.join(', '),
	);
	// …and deals it: a manifest entry on this host's protocol, a pot forced full.
	const tree = mkdtempSync(join(tmpdir(), 'pots-overlay-'));
	const grid = {
		reels: 5,
		rows: 3,
		paylines: [[1, 1, 1, 1, 1]],
		potsOverlay: potsOverlayMockInputs(THREE),
	};
	writeFileSync(join(tree, 'games.json'), JSON.stringify({ games: { pots: { name: 'pots', protocol: HOST.name, grid } } })); // prettier-ignore
	const server = await startTestServer(tree, { SEED: 'pots-overlay' });
	try {
		const post = async (body) =>
			(
				await fetch(`${server.origin}/api/pots/rgs/engine?sid=t&seq=0`, {
					method: 'POST',
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(15_000),
				})
			).json();
		const boot = await post([{ action: 'config' }]);
		const entry = await post([
			{ action: 'bet', context: HOST.bet },
			{ action: 'play', context: 'force:pot:red' },
		]);
		check(
			one(boot, 'config')?.potsOverlay?.wire === 1 && Boolean(one(entry, 'holdAndWinTrigger')),
			`the test server composes it over a ${HOST.name} game: boot names it, a full pot starts its bonus`,
		);
	} finally {
		server.stop();
		rmSync(tree, { recursive: true, force: true });
	}
}

console.log(
	failed ? `\n✗ ${failed} pots overlay check(s) failed` : '\n✓ pots overlay protocol checks passed',
);
process.exit(failed ? 1 : 0);
