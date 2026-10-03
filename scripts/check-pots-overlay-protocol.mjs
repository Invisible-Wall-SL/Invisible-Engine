// The POTS OVERLAY mock, proven from its WIRE (docs/reference/hold-and-win-wire.md, "Pots overlay").
// A Book-of host with the overlay presets merged in, as the launcher hands it over
// (`potsOverlayMockInputs`), is played the way the facade plays a round, and every answer is
// re-derived from its events alone: where each drop landed, every pot's level across rounds and
// sessions, which bonus a full pot starts and when, the round's money, and replay/resume. Then every
// forced beat is fired, and a project without the block is shown to get the host mock byte for byte.
//
//   pnpm check:pots-overlay

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import {
	holdAndWinBonus,
	HOLD_AND_WIN_PRESETS,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayPreset,
	setOverlayPotCount,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';
import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { withPotsOverlay } from './mock-pots-overlay.mjs';
import { carrySession } from './mock-rgs-server.mjs';

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

const pays = (three, four, five) => ({ paytable: [{ 3: three }, { 4: four }, { 5: five }] });
const STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'PIC2', 'TEN'].map((name) => ({ name }));
const BOOK_HOST = {
	providerName: 'invisible_wall',
	gameName: 'book_host',
	gameID: 'book_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0], 3: [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		PIC2: pays(30, 400, 2000),
		ACE: pays(5, 50, 150),
		KING: pays(5, 50, 150),
		TEN: pays(5, 20, 100),
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
/** A pot routed to a mode of the project's own (a stub until Phase 7). */
const STUB = insert(BOOK_HOST, 'potsToFreeSpins', (doc) => {
	doc.modes = [{ id: 'pickBonus', board: 'none' }];
	doc.potsOverlay.pots[0].bonus = { mode: 'pickBonus' };
	return doc;
});
const counted = (doc, pots) => {
	const result = setOverlayPotCount(doc, pots);
	if (!result.ok) throw new Error(result.reason);
	return normalizeGameConfigDoc(result.doc);
};
/** No pots: the overlay drops only value coins. */
const COINS_ONLY = counted(THREE, 0);
/** Five pots, the last two new. */
const FIVE = counted(THREE, 5);
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
	withPotsOverlay(createBookMock, potsOverlayMockInputs(doc))({ label: 'pots', ...opts });

/** Play a round to its end the way the facade does: `[bet, play]`, context-less plays while the
 *  round is open and has not ended, then `collect`. Returns every answer. */
const playRound = async (mock, sid, { context = '', bet = [0, 1] } = {}) => {
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
	if (a.platform.gameRound) {
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
	const did = {
		potBonus: [],
		coinBonus: 0,
		hostFeature: false,
		freeSpinsByPot: 0,
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
			} else if (trigger.bonus === 'feature') {
				expect(
					trigger.cause === 'meter' && trigger.occurs === 0,
					'a pot free spin: meter, occurs 0',
				);
				for (const id of trigger.meters ?? []) {
					expect(potOf.get(id).bonus.mode === 'freeSpins', `${id} routes to free spins`);
					expect(waiting.includes(id), `${id} started its bonus without being full`);
					levels[id] = 0;
				}
				waiting = waiting.filter((id) => !(trigger.meters ?? []).includes(id));
				const spins = potOf.get(trigger.meters?.[0])?.bonus.spins ?? 10;
				expect(same(trigger.spins, [{ prob: 1, spins }]), `${spins} free spins`);
				expect(ev.includes('enterBonus') && ev.includes('pickRandomly'), 'free-spin entry');
				did.freeSpinsByPot++;
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
		// — every play restates every pot, last —
		if (ev.includes('spinStart') || ev.includes('playedSpin')) {
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
	for (const [name, doc] of Object.entries({ THREE, FREE, STUB, FREE_DROPS })) {
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

	// With the overlay — pots too deep to ever fill — the host's own events are the plain mock's.
	const deep = insert(BOOK_HOST, 'threePots', (doc) => {
		for (const pot of doc.potsOverlay.pots) pot.maxLevel = 100_000;
		doc.potsOverlay.drops.chance = 1;
		return doc;
	});
	const plain = createBookMock({ seed: 'host-same', label: 'plain' });
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
	pass('no block deals main’s book; the block adds events and never changes the host’s');
}

// ---------- 3. seeded rounds ----------

console.log('3. seeded rounds re-derived from the wire (3 Pots on a book host)');
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
		same(config.symbols, (await engine(createBookMock(), 'sid=x', [])).events[0].context.symbols),
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
		Object.fromEntries(
			(await engine(mock, `sid=${sid}`, [])).events[0].context.potsOverlay.pots.map((p) => [
				p.id,
				p.level,
			]),
		);
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
	const carried = (await engine(swapped, 'sid=a', [])).events[0].context.potsOverlay.pots.find(
		(p) => p.id === 'red',
	);
	const before = (await levelsOf('a')).red;
	check(carried.level === before, `a contract swap carries the pots (${carried.level})`);
}

// ---------- 6. both on one spin ----------

console.log('6. the host’s feature and a full pot on one spin: one round, the host first');
{
	for (const [doc, spec, route] of [
		[THREE, 'force:feature,pot:blue', 'respin'],
		[FREE, 'force:feature,pot:gold', 'feature'],
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
			did.ok && answers.at(-1).events.some((e) => e.event === 'gameRoundOver'),
			`${route}: one round, played out and collected`,
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
			{ action: 'bet', context: [0, 1] },
			{ action: 'play', context: `force:${spec}` },
		]);
		check(
			a.errorCode === 101 && a.platform.balance === before && !a.events,
			`refused: ${why} (${spec}) — nothing dealt, nothing charged`,
			a.error,
		);
	}
	const free = await engine(overlayMock(FREE), 'sid=x&seq=0', [
		{ action: 'bet', context: [0, 1] },
		{ action: 'play', context: 'force:overlay:coins:6' },
	]);
	check(free.errorCode === 101, 'refused: value coins with no Hold and Win bonus');
	const locked = overlayMock(THREE, { allowForce: false });
	const off = await engine(locked, 'sid=x&seq=0', [
		{ action: 'bet', context: [0, 1] },
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
		{ action: 'bet', context: [0, 1] },
		{ action: 'play', context: 'force:pot:red' },
	]);
	const gid = entry.platform.gameRound.id;
	const respin = await engine(mock, `sid=z&seq=2&gid=${gid}`, [{ action: 'play', context: null }]);
	const again = await engine(mock, `sid=z&seq=2&gid=${gid}`, [{ action: 'play', context: null }]);
	check(same(again.events, respin.events), 'a resent position replays what was dealt');
	const first = await engine(mock, `sid=z&seq=0&gid=${gid}`, [
		{ action: 'bet', context: [0, 1] },
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
			boot.platform.gameRound.outcome === 'bonus',
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
		{ action: 'bet', context: [0, 1] },
		{ action: 'play', context: 'force:feature,pot:blue' },
	]);
	check(
		startsFrom(await firstAnswer(abandon, 'a'), 'blue'),
		'an abandoned round: its full pot starts on the next round’s first spin, with no meterUpdate',
	);
	// A contract swap drops the open round and keeps the pots.
	const before = overlayMock(THREE, { seed: 'swap' });
	await engine(before, 'sid=s&seq=0', [
		{ action: 'bet', context: [0, 1] },
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
}

// ---------- 10. the test-server image ----------

console.log('10. the test server ships it');
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
}

console.log(
	failed ? `\n✗ ${failed} pots overlay check(s) failed` : '\n✓ pots overlay protocol checks passed',
);
process.exit(failed ? 1 : 0);
