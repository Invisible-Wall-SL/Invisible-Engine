// BONUS MODES on the mock RGS (docs/design/bonus-games.md §2.2, Phase 2): one Hold and Win engine
// per respin mode, each route starting the mode it names, and the per-mode wire.
//
//   pnpm check:bonus-modes
//
// 1. A host (book mock and lines mock) with the 3 Pots overlay and TWO respin modes with different
//    rules — its own Hold and Win and the Collector preset imported as `holdAndWin_2` (its symbols
//    renamed `_2`, on its own `respin_2` strip) — and two pots routed to them. Each pot deals its own
//    mode's rules on its own symbols, and the boot config and every Hold and Win context carry the
//    right `mode`, the primary's included.
// 2. The Hold and Win GAME mock (the classic preset): a lone default mode answers exactly what it
//    did (no `bonusModes`, no `mode` key: `check:holdandwin`'s MAIN_DIGESTS pin the bytes); a lone
//    NON-default mode emits the new shape; a second mode reached by a buy route plays its own rules.
// 3. Two respin modes on one strip key: `/config` refuses it, and so does the mock.

import { createHash } from 'node:crypto';

import {
	HOLD_AND_WIN_PRESETS,
	holdAndWinBonus,
	holdAndWinMockInputs,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayPreset,
	symbolHoldAndWinRoles,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';
import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from './mock-rgs-server-holdandwin.mjs';
import { withPotsOverlay } from './mock-pots-overlay.mjs';
import { createMockRgs as createLinesMock } from './mock-rgs-server.mjs';

// The book mock logs every request; this gate reads answers, not logs.
const log = console.log;
console.log = (...args) => {
	if (!String(args[0]).startsWith('[mock-')) log(...args);
};

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
	if (!ok) failed++;
	return ok;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the docs ----------

/** The Collector preset's respin game, as an import brings it in as a second mode: its Hold and Win
 *  symbols renamed `_2`, its respin strip as `respin_2`, its blank named. */
const COLLECTOR = normalizeGameConfigDoc(structuredClone(HOLD_AND_WIN_PRESETS.collector));
const COLLECTOR_RULES = COLLECTOR.modes.find((m) => m.id === 'holdAndWin').holdAndWin;
const isRole = (name) => symbolHoldAndWinRoles(COLLECTOR.symbols[name]).length > 0;
const as2 = (name) => (isRole(name) ? `${name}_2` : name);
const withSecondMode = (doc, { id = 'holdAndWin_2', gameType = 'respin_2' } = {}) => {
	const out = structuredClone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	for (const [name, symbol] of Object.entries(COLLECTOR.symbols)) {
		if (isRole(name)) out.symbols[as2(name)] = structuredClone(symbol);
	}
	// One strip per reel of THIS board (the Collector preset is narrower).
	const strips = COLLECTOR.paddingReels.respin;
	out.paddingReels[gameType] = Array.from({ length: out.numReels }, (_u, reel) =>
		strips[reel % strips.length].map((cell) => ({ ...cell, name: as2(cell.name) })),
	);
	out.modes = [
		...(out.modes ?? []),
		{
			...holdAndWinModeDecl(),
			id,
			gameType,
			label: 'Collector',
			holdAndWin: { ...structuredClone(COLLECTOR_RULES), blank: 'BLANK_2' },
		},
	];
	return out;
};
const normalized = (raw) => {
	const doc = normalizeGameConfigDoc(raw);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};
const errorsOf = (doc) =>
	validateGameConfigDoc(doc)
		.filter((i) => i.severity === 'error')
		.map((i) => `${i.path}: ${i.message}`);

// ---------- playing ----------

/** One mock, called the way the facade calls it. */
const driver = (mock) => {
	const call = (query, body) =>
		new Promise((resolve) => {
			const text = JSON.stringify(body);
			const req = {
				method: 'POST',
				headers: {},
				on(ev, fn) {
					if (ev === 'data') fn(Buffer.from(text));
					if (ev === 'end') fn();
				},
			};
			const res = { writeHead() {}, end: (t) => resolve(JSON.parse(t)) };
			mock.handle(req, res, new URL(`http://x/rgs/engine?${query}`));
		});
	const config = async (sid) =>
		(await call(`sid=${sid}`, [{ action: 'config' }])).events.find((e) => e.event === 'config')
			.context;
	/** A whole round: every answer's events, in order. */
	const round = async (sid, bet, context) => {
		let a = await call(`sid=${sid}&seq=0`, [
			{ action: 'bet', context: bet },
			{ action: 'play', context },
		]);
		if (a.error) throw new Error(`${sid}: ${a.error}`);
		const events = [...a.events];
		const gid = a.platform?.gameRound?.id;
		let seq = 2;
		let guard = 0;
		while (gid && a.platform?.gameRound && !a.events.some((e) => e.event === 'gameEnd')) {
			if (guard++ > 300) throw new Error(`${sid}: the feature never ended`);
			a = await call(`sid=${sid}&seq=${seq++}&gid=${gid}`, [{ action: 'play', context: null }]);
			events.push(...a.events);
		}
		if (gid && a.platform?.gameRound) {
			a = await call(`sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
			events.push(...a.events);
		}
		return events;
	};
	return { config, round };
};

const TAGGED = [
	'spinTrigger',
	'holdAndWinTrigger',
	'enterBonus',
	'playedBonusSpin',
	'playedBonusSpins',
	'holdAndWinEnd',
];
/** The respin features a round played: per feature, its mode, bonus key, rules and cells dealt. */
const featuresOf = (events) => {
	const out = [];
	for (const e of events) {
		if (e.event === 'spinTrigger' && e.context.trigger?.mode?.startsWith('holdAndWin')) {
			out.push({
				mode: e.context.mode,
				triggerMode: e.context.trigger.mode,
				bonus: e.context.bonus,
				tags: [],
				symbols: new Set(),
			});
		}
		const f = out.at(-1);
		if (!f) continue;
		if (TAGGED.includes(e.event)) f.tags.push([e.event, e.context.mode]);
		if (e.event === 'holdAndWinTrigger') {
			f.stickiness = e.context.stickiness;
			f.respins = e.context.respins;
		}
		if (e.event === 'enterBonus') f.playing = e.context.playing;
		for (const c of e.context?.cells ?? []) if (c.symbol) f.symbols.add(c.symbol);
		for (const c of e.context?.holdAndWin?.cells ?? []) if (c.symbol) f.symbols.add(c.symbol);
	}
	return out;
};
const everyTagged = (f, mode) =>
	TAGGED.filter((name) => name !== 'playedBonusSpin').every((name) =>
		f.tags.some(([event]) => event === name),
	) && f.tags.every(([, tag]) => tag === mode);
const noModeKey = (events) =>
	events.every((e) => !TAGGED.includes(e.event) || !Object.hasOwn(e.context, 'mode'));

// ---------- 1. a host with two respin modes, two pots routed to them ----------

const pays = (three, four, five) => ({ paytable: [{ 3: three }, { 4: four }, { 5: five }] });
const HOSTS = {
	book: { create: createBookMock, bet: [0, 1], lows: ['ACE', 'KING', 'TEN'] },
	lines: {
		create: (opts) => createLinesMock({ quiet: true, ...opts }),
		bet: [3, 1],
		lows: ['PIC5', 'PIC6', 'PIC7'],
	},
};
for (const [hostName, host] of Object.entries(HOSTS)) {
	console.log(
		`1. two respin modes over the ${hostName} host, red → holdAndWin, green → holdAndWin_2`,
	);
	const strip = ['PIC1', host.lows[0], 'SCAT', host.lows[1], 'PIC2', host.lows[2]].map((name) => ({
		name,
	}));
	const raw = {
		providerName: 'invisible_wall',
		gameName: 'two_modes',
		gameID: 'two_modes',
		rtp: 0.96,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
		paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0], 3: [2, 2, 2, 2, 2] },
		symbols: {
			PIC1: pays(100, 1000, 5000),
			PIC2: pays(30, 400, 2000),
			[host.lows[0]]: pays(5, 50, 150),
			[host.lows[1]]: pays(5, 50, 150),
			[host.lows[2]]: pays(5, 20, 100),
			SCAT: { special_properties: ['scatter'] },
		},
		paddingReels: {
			basegame: Array.from({ length: 5 }, () => strip),
			freegame: Array.from({ length: 5 }, () => strip),
		},
	};
	const preset = potsOverlayPreset('threePots');
	const bonus = holdAndWinBonus(preset.holdAndWin, raw);
	const three = normalized({
		...raw,
		symbols: { ...raw.symbols, ...bonus.symbols, ...preset.tokens },
		paddingReels: { ...raw.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: preset.potsOverlay,
	});
	const twoRaw = withSecondMode(three);
	twoRaw.coinOverlay.pots = twoRaw.coinOverlay.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: 'holdAndWin_2' } } : p,
	);
	const two = normalized(twoRaw);
	check(
		!errorsOf(two).length,
		'the two-mode host saves without an error',
		errorsOf(two).join('; '),
	);

	const inputs = potsOverlayMockInputs(two);
	const modes = inputs.holdAndWin?.modes ?? [];
	check(
		same(
			modes.map((m) => [m.mode, m.gameType, m.blank]),
			[
				['holdAndWin', 'respin', modes[0]?.blank],
				['holdAndWin_2', 'respin_2', 'BLANK_2'],
			],
		),
		'the inputs carry each respin mode, primary first, on its own strip',
		JSON.stringify(modes.map((m) => [m.mode, m.gameType, m.blank])),
	);
	const roleNames = (m) => Object.keys(m.symbols).filter((n) => m.symbols[n].roles.length);
	check(
		roleNames(modes[1] ?? { symbols: {} }).every((n) => n.endsWith('_2')) &&
			roleNames(modes[0] ?? { symbols: {} }).every((n) => !n.endsWith('_2')),
		"each mode deals only its own Hold and Win symbols — two modes' coins never mix",
		JSON.stringify(modes.map(roleNames)),
	);
	check(
		modes[1]?.block.stickiness === COLLECTOR_RULES.stickiness &&
			modes[0]?.block.stickiness !== COLLECTOR_RULES.stickiness,
		'their rules differ (stickiness)',
		`${modes[0]?.block.stickiness} / ${modes[1]?.block.stickiness}`,
	);

	const mock = withPotsOverlay(host.create, inputs)({ seed: `two-${hostName}`, allowForce: true });
	const play = driver(mock);
	const config = await play.config('boot');
	check(
		same(
			config.bonusModes?.map((m) => [m.mode, m.gameType, m.bonus]),
			[
				['holdAndWin', 'respin', 'respin'],
				['holdAndWin_2', 'respin_2', 'respin_2'],
			],
		),
		'the boot config lists both modes, primary first, each with its strip key',
		JSON.stringify(config.bonusModes?.map((m) => [m.mode, m.gameType])),
	);
	check(
		same({ mode: 'holdAndWin', gameType: 'respin', ...config.holdAndWin }, config.bonusModes?.[0]),
		'…and keeps the legacy holdAndWin, the primary mode exactly',
	);
	check(
		config.potsOverlay.bonuses.respin === 'holdAndWin' &&
			config.potsOverlay.bonuses.respin_2 === 'holdAndWin_2',
		'the bonus route maps each strip key to its mode',
		JSON.stringify(config.potsOverlay.bonuses),
	);
	check(
		same(
			config.potsOverlay.pots.map((p) => [p.id, p.bonus]),
			[
				['red', 'holdAndWin'],
				['blue', 'holdAndWin'],
				['green', 'holdAndWin_2'],
			],
		),
		'each pot names the mode it starts',
	);

	const expect = {
		red: {
			mode: 'holdAndWin',
			bonus: 'respin',
			rules: modes[0]?.block,
			own: (n) => !n.endsWith('_2'),
		},
		green: {
			mode: 'holdAndWin_2',
			bonus: 'respin_2',
			rules: modes[1]?.block,
			own: (n) => n.endsWith('_2') || !roleNames(modes[1]).length,
		},
	};
	for (const [pot, want] of Object.entries(expect)) {
		const runs = [];
		for (let i = 0; i < 6; i++) {
			const events = await play.round(`${pot}-${i}`, host.bet, `force:pot:${pot}`);
			runs.push(...featuresOf(events));
		}
		const respinSymbols = (f) =>
			[...f.symbols].filter((n) => two.symbols[n] && symbolHoldAndWinRoles(two.symbols[n]).length);
		check(
			runs.length === 6 && runs.every((f) => f.mode === want.mode && f.triggerMode === want.mode),
			`pot ${pot} starts ${want.mode}, every time`,
			JSON.stringify(runs.map((f) => f.mode)),
		);
		check(
			runs.every((f) => everyTagged(f, want.mode)),
			`…and every Hold and Win context of it carries mode ${want.mode}`,
			JSON.stringify(runs[0]?.tags),
		);
		check(
			runs.every((f) => f.bonus === want.bonus && f.playing === want.bonus),
			`…played under its own bonus key ${want.bonus}`,
		);
		check(
			runs.every(
				(f) => f.stickiness === want.rules?.stickiness && f.respins === want.rules?.respins.start,
			),
			`…by its own rules (${want.rules?.stickiness}, ${want.rules?.respins.start} respins)`,
			JSON.stringify(runs.map((f) => [f.stickiness, f.respins])),
		);
		check(
			runs.every((f) => respinSymbols(f).every(want.own)) &&
				runs.some((f) => respinSymbols(f).length),
			'…on its own symbols',
			JSON.stringify(runs.map(respinSymbols)),
		);
	}

	// Both pots full on one spin: the round plays both features, one after the other.
	const both = featuresOf(await play.round('both', host.bet, 'force:pot:red,pot:green'));
	check(
		same(
			both.map((f) => f.mode),
			['holdAndWin', 'holdAndWin_2'],
		) && both.every((f) => everyTagged(f, f.mode)),
		'two full pots on one spin play both modes in turn, each tagged with its own',
		JSON.stringify(both.map((f) => f.mode)),
	);
}

// ---------- 2. the Hold and Win GAME mock ----------

console.log('2. the Hold and Win game mock (the classic preset)');
const contractOf = (doc, seed) => {
	const modes = Object.entries(doc.betModes);
	return {
		quiet: true,
		seed,
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		paylines: Object.values(doc.paylines),
		...(modes.length > 1
			? {
					betModes: modes.map(([mode, m]) => ({
						mode,
						cost: m.cost,
						kind: m.buyBonus ? 'buy' : 'base',
					})),
				}
			: {}),
		holdAndWin: holdAndWinMockInputs(doc),
	};
};
const CLASSIC = normalized(structuredClone(HOLD_AND_WIN_PRESETS.classic));
{
	const play = driver(createHoldAndWinMock(contractOf(CLASSIC, 'lone')));
	const config = await play.config('lone');
	const events = await play.round('lone', [0, 1], 'force:trigger');
	check(
		!('modes' in holdAndWinMockInputs(CLASSIC)) &&
			!('bonusModes' in config) &&
			noModeKey(events) &&
			featuresOf(events)[0]?.triggerMode === 'holdAndWin',
		'a lone default mode: no per-mode inputs, no bonusModes, no mode key (the bytes are main’s)',
	);
}
{
	// The same game, its one respin mode renamed: a lone NON-default mode.
	const raw = structuredClone(CLASSIC);
	delete raw.holdAndWin;
	delete raw.potsOverlay;
	raw.modes = raw.modes.map((m) =>
		m.id === 'holdAndWin' ? { ...m, id: 'holdAndWin_2', gameType: 'respin_2' } : m,
	);
	raw.paddingReels.respin_2 = raw.paddingReels.respin;
	delete raw.paddingReels.respin;
	raw.coinOverlay = JSON.parse(
		JSON.stringify(raw.coinOverlay).replaceAll('"mode":"holdAndWin"', '"mode":"holdAndWin_2"'),
	);
	const lone = normalized(raw);
	check(!errorsOf(lone).length, 'a lone non-default mode saves', errorsOf(lone).join('; '));
	const play = driver(createHoldAndWinMock(contractOf(lone, 'lone-2')));
	const config = await play.config('lone2');
	const [feature] = featuresOf(await play.round('lone2', [0, 1], 'force:trigger'));
	check(
		same(
			config.bonusModes?.map((m) => [m.mode, m.gameType]),
			[['holdAndWin_2', 'respin_2']],
		) && config.holdAndWin?.bonus === 'respin_2',
		'a lone NON-default mode emits bonusModes, and the legacy block plays under its strip key',
	);
	check(
		feature?.bonus === 'respin_2' && everyTagged(feature, 'holdAndWin_2'),
		'…and every Hold and Win context of its feature carries mode holdAndWin_2',
		JSON.stringify(feature?.tags),
	);
}
{
	// A second mode routed from the classic game's super buy.
	const raw = withSecondMode(CLASSIC);
	raw.coinOverlay.trigger.buy = raw.coinOverlay.trigger.buy.map((tier) =>
		tier.betMode === 'superBuy' ? { ...tier, mode: 'holdAndWin_2' } : tier,
	);
	const two = normalized(raw);
	check(!errorsOf(two).length, 'a buy route to a second mode saves', errorsOf(two).join('; '));
	const option = Object.keys(two.betModes).indexOf('superBuy');
	const play = driver(createHoldAndWinMock(contractOf(two, 'buy-2')));
	const config = await play.config('b');
	check(
		same(
			config.bonusModes?.map((m) => m.mode),
			['holdAndWin', 'holdAndWin_2'],
		),
		'the game mock lists both modes',
	);
	const bought = featuresOf(await play.round('b', [option, 1], null));
	await play.config('c');
	const counted = featuresOf(await play.round('c', [0, 1], 'force:trigger:count'));
	check(
		bought[0]?.mode === 'holdAndWin_2' &&
			bought[0].stickiness === COLLECTOR_RULES.stickiness &&
			everyTagged(bought[0], 'holdAndWin_2'),
		'the super buy starts holdAndWin_2, by its own rules, every context tagged',
		JSON.stringify(bought.map((f) => [f.mode, f.stickiness])),
	);
	check(
		counted[0]?.mode === 'holdAndWin' &&
			counted[0].stickiness === CLASSIC.holdAndWin.stickiness &&
			everyTagged(counted[0], 'holdAndWin'),
		'the coin count still starts the primary, now tagged holdAndWin',
		JSON.stringify(counted.map((f) => [f.mode, f.stickiness])),
	);
	// Deterministic: the same seed deals the same rounds.
	const digest = async () => {
		const p = driver(createHoldAndWinMock(contractOf(two, 'buy-2')));
		const h = createHash('sha256');
		await p.config('d');
		for (let i = 0; i < 20; i++) h.update(JSON.stringify(await p.round('d', [i % 3, 1], null)));
		return h.digest('hex');
	};
	check((await digest()) === (await digest()), 'one seed, one deal');
}

// ---------- 3. one strip key, two respin modes ----------

console.log('3. two respin modes on one strip key');
{
	const shared = normalized(withSecondMode(CLASSIC, { gameType: 'respin' }));
	check(
		errorsOf(shared).some((e) => e.startsWith('modes.holdAndWin_2.gameType:')),
		'/config refuses it, naming the second mode',
		errorsOf(shared).join('; '),
	);
	let refused = '';
	try {
		createHoldAndWinMock(contractOf(shared, 'x'));
	} catch (e) {
		refused = e.message;
	}
	check(/two respin modes play on the "respin" strips/.test(refused), 'the mock refuses it loudly');
}

console.log(failed ? `\n✗ ${failed} bonus-modes check(s) failed` : '\n✓ bonus-modes checks passed');
process.exit(failed ? 1 : 0);
