// The LINES mock deals the Book-of expanding special when a project's Game Config carries
// `freeSpins.expandingSymbol` (`docs/design/book-feature.md` §4, Phase 3), and the facade presents
// what it deals exactly as it presents the book mock's.
//
//   pnpm check:expanding-symbol            (part of check:rgs)
//
// The mock is fed the contract the launcher derives from the Book of Thermopylae preset
// (`lib/book-of-thermopylae-lines-grid.json`, which `check:mock-contract` holds equal to
// `mockContractOfBundle` of the preset), so this is the game a migrated Book-of project is dealt.
// Every configuration WITHOUT the block is held byte-identical by `check:lines-parity`.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startTestServer } from './current-games/lib/serve.mjs';

import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { createMockRgs as createLinesMock, evaluatePaylines } from './mock-rgs-server.mjs';

const facade = await import('../packages/rgs-translator-eagaming/engine-facade.ts');

const PRESET = JSON.parse(
	readFileSync(new URL('./lib/book-of-thermopylae-lines-grid.json', import.meta.url), 'utf8'),
);
const CANDIDATES = PRESET.expandingSymbol.candidates;
const WEIGHT_TOTAL = CANDIDATES.reduce((sum, c) => sum + c.weight, 0);

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};
const silently = async (run) => {
	const [log, warn] = [console.log, console.warn];
	console.log = console.warn = () => {};
	try {
		return await run();
	} finally {
		[console.log, console.warn] = [log, warn];
	}
};

/** One in-process request: the mock's own `handle` with a minimal request and response. */
const call = (mock, body, url) =>
	new Promise((done) => {
		const req = {
			method: 'POST',
			headers: {},
			on(event, cb) {
				if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
				if (event === 'end') cb();
				return this;
			},
		};
		const res = { writeHead() {}, end: (text) => done(JSON.parse(text)) };
		mock.handle(req, res, new URL(url, 'http://mock'));
	});

/**
 * Play one round the way the facade plays it and return each response's events — the base play
 * first, then every free spin. `option` is the bet option (both mocks here sell a table).
 */
const playRound = async (mock, sid, option = 0) => {
	const first = await call(
		mock,
		[
			{ action: 'bet', context: [option, 1] },
			{ action: 'play', context: null },
		],
		`/rgs/engine?sid=${sid}&seq=0`,
	);
	const plays = [first.events];
	const gid = first.platform?.gameRound?.id;
	let last = first;
	for (let seq = 2; gid && !last.events.some((e) => e.event === 'gameEnd'); seq++) {
		last = await call(mock, [{ action: 'play' }], `/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`);
		plays.push(last.events);
	}
	if (gid && !last.events.some((e) => e.event === 'gameRoundOver'))
		await call(mock, [{ action: 'collect' }], `/rgs/engine?sid=${sid}&seq=99&gid=${gid}`);
	return plays;
};
const ev = (events, name) => events.find((e) => e.event === name);
const linesMock = (opts = {}) =>
	createLinesMock({ label: 'expanding', quiet: true, startBalance: 1e12, ...PRESET, ...opts });
const bookMock = (opts = {}) => createBookMock({ label: 'book', startBalance: 1e12, ...opts });
/** A session a table game will price: it asked for the config first. */
const booted = async (mock, sid) => {
	await call(mock, [{ action: 'config' }], `/rgs/engine?sid=${sid}&seq=0`);
	return sid;
};
const binomial = (n, k) => (k === 0 ? 1 : (binomial(n - 1, k - 1) * n) / k);
const coveredReels = (board, symbol) =>
	board.flatMap((reel, index) => (reel.includes(symbol) ? [index] : []));

// ---------------------------------------------------------------------------------------------
console.log('\n1. pickRandomly: the book mock’s shape, right after enterBonus');
{
	const mock = linesMock({ seed: 'pick', forceTrigger: true });
	const [base] = await playRound(mock, await booted(mock, 'pick'));
	const names = base.map((e) => e.event);
	const at = names.indexOf('pickRandomly');
	check(at > 0 && names[at - 1] === 'enterBonus', 'emitted straight after enterBonus', ` (${names.join(' ')})`); // prettier-ignore
	const pick = base[at]?.context;
	const book = await silently(async () => {
		const own = bookMock({ seed: 'pick', forceTrigger: true });
		const [events] = await playRound(own, 'pick');
		return ev(events, 'pickRandomly').context;
	});
	check(
		JSON.stringify(Object.keys(pick ?? {})) === JSON.stringify(Object.keys(book)),
		'the same fields as the book mock’s',
		` (${Object.keys(pick ?? {})})`,
	);
	check(
		JSON.stringify(Object.keys(pick.state)) === JSON.stringify(Object.keys(book.state)),
		'…its `state` the same bonus snapshot',
	);
	check(pick.scope === 'enterState', 'scope enterState');
	check(
		JSON.stringify(pick.items) ===
			JSON.stringify(CANDIDATES.map((c) => ({ state: c.symbol, prob: c.weight }))),
		'items: every candidate with its authored weight, in dictionary order',
	);
	check(
		CANDIDATES.some((c) => c.symbol === pick.item.state && c.weight === pick.item.prob),
		`the pick is a candidate (${pick.item.state})`,
	);
	check(
		JSON.stringify(book.items.map((i) => i.prob).sort()) ===
			JSON.stringify(pick.items.map((i) => i.prob).sort()),
		'…and the weights are the book mock’s, symbol for symbol',
	);
}

// ---------------------------------------------------------------------------------------------
console.log('\n2. the expansion pay, the line pass without the special, no retrigger from it');
const featureStats = async (mock, sid, rounds, option = 0, scatterWild = true) => {
	const stats = {
		features: 0,
		picks: {},
		freeSpins: 0,
		expansions: 0,
		occurs: 0,
		expansionPay: 0,
		retriggers: 0,
		bad: [],
		twoReelExpansions: 0,
		linePayAfterExpansion: 0,
	};
	for (let r = 0; r < rounds; r++) {
		const [base, ...spins] = await playRound(mock, sid, option);
		const stake = ev(base, 'bet').context;
		const pick = ev(base, 'pickRandomly')?.context.item.state;
		if (!pick) continue;
		stats.features++;
		stats.picks[pick] = (stats.picks[pick] ?? 0) + 1;
		const special = CANDIDATES.find((c) => c.symbol === pick);
		const baseStake = stake.betPerLine * PRESET.paylines.length;
		for (const events of spins) {
			const board = ev(events, 'playedSpin').context;
			stats.freeSpins++;
			const wins = events.filter((e) => e.event === 'spinWin').map((e) => e.context);
			const covered = coveredReels(board, pick);
			const row = PRESET.symbolPaytable[pick];
			const expands = covered.length >= special.minReels && row[covered.length] > 0;
			const specialWins = wins.filter((w) => w.what === pick && w.mode === 'scatter');
			const evalOpts = {
				pool: PRESET.symbols.filter((s) => s !== 'SCAT'),
				symbolPaytable: PRESET.symbolPaytable,
				...(scatterWild ? { scatterWild } : {}),
			};
			const paidBoard = expands
				? board.map((reel, i) => (covered.includes(i) ? reel.map(() => pick) : reel))
				: board;
			const lines = evaluatePaylines(paidBoard, stake.betPerLine, PRESET.paylines, null, evalOpts)
				.filter((w) => !expands || w.what !== pick)
				.map((w) => ({ ...w, pay: Math.max(1, Math.round(w.pay)) }));
			const lineWins = wins.filter((w) => w.mode === 'line');
			if (expands) {
				stats.expansions++;
				stats.occurs += covered.length;
				if (covered.length === 2) stats.twoReelExpansions++;
				const w = specialWins[0];
				const pay = Math.max(1, Math.round(row[covered.length] * baseStake));
				const cells = covered.flatMap((reel) => board[reel].map((_c, row) => `${reel}:${row}`));
				const ok =
					specialWins.length === 1 &&
					wins[0] === w &&
					w.occurs === covered.length &&
					w.pay === pay &&
					JSON.stringify(w.context.map((p) => `${p.reel}:${p.row}`)) === JSON.stringify(cells);
				if (!ok) stats.bad.push(`expansion on ${JSON.stringify(board)}: ${JSON.stringify(w)}`);
				stats.expansionPay += pay / baseStake;
				if (lineWins.length) stats.linePayAfterExpansion++;
			} else if (specialWins.length) {
				stats.bad.push(`a special pay below the gate on ${JSON.stringify(board)}`);
			}
			if (JSON.stringify(lineWins) !== JSON.stringify(lines))
				stats.bad.push(`line pass on ${JSON.stringify(board)} (expanded: ${expands})`);
			const books = board.flat().filter((cell) => cell === 'SCAT').length;
			const retrigger = ev(events, 'retrigger');
			if (retrigger) stats.retriggers++;
			if (retrigger && retrigger.context.occurs !== books)
				stats.bad.push(`a retrigger on ${books} books`);
		}
	}
	return stats;
};
{
	const mock = linesMock({ seed: 'expansion', forceTrigger: true });
	const s = await featureStats(mock, await booted(mock, 'exp'), 300);
	check(s.bad.length === 0, 'every free spin pays exactly what the rule says', s.bad.length ? `\n      ${s.bad.slice(0, 3).join('\n      ')}` : ` (${s.freeSpins} free spins)`); // prettier-ignore
	check(s.expansions > 50, 'the special expands and pays', ` (${s.expansions} expansions)`);
	check(s.twoReelExpansions > 0, '…PIC1 from 2 reels (its authored minReels)', ` (${s.twoReelExpansions})`); // prettier-ignore
	check(s.linePayAfterExpansion > 0, '…and the other symbols pay their lines on the expanded board', ` (${s.linePayAfterExpansion})`); // prettier-ignore
	check(s.retriggers > 0, 'retriggers come from books alone', ` (${s.retriggers})`);
}

// ---------------------------------------------------------------------------------------------
console.log('\n3. the buy and the forced trigger');
{
	const mock = linesMock({ seed: 'buy' });
	const sid = await booted(mock, 'buy');
	const before = mock.sessions.get(sid).balance;
	const [base, ...spins] = await playRound(mock, sid, 1);
	check(before - ev(base, 'bet').context.total === before - 1000, 'the buy charges 100× (10 lines × 1 × 100)'); // prettier-ignore
	check(Boolean(ev(base, 'pickRandomly')), 'a bought round draws the special');
	const paid = spins.flatMap((e) => e.filter((x) => x.event === 'spinWin')).map((x) => x.context);
	const specialPays = paid.filter((w) => w.mode === 'scatter' && w.what !== 'SCAT');
	check(
		specialPays.every((w) => w.pay === Math.max(1, Math.round(PRESET.symbolPaytable[w.what][w.occurs] * 10))),
		'…and prices the special on the BASE stake, not the buy',
		` (${specialPays.length} special pays)`,
	); // prettier-ignore
	// A line-config game staked on fewer lines than it pays (`[5, 1]` on ten): the special pays its
	// row on EVERY payline, at the per-line stake, as the line pass beside it does.
	const lineConfig = linesMock({ seed: 'line-config', forceTrigger: true, betModes: undefined });
	const lineConfigPays = [];
	for (let r = 0; r < 20; r++) {
		const [, ...fs] = await playRound(lineConfig, 'lc');
		for (const e of fs.flat())
			if (e.event === 'spinWin' && e.context.mode === 'scatter' && e.context.what !== 'SCAT')
				lineConfigPays.push(e.context);
	}
	check(
		lineConfigPays.length > 0 &&
			lineConfigPays.every((w) => w.pay === Math.max(1, Math.round(PRESET.symbolPaytable[w.what][w.occurs] * 1 * PRESET.paylines.length))),
		'a line-config game prices the special per line × every payline, not on the staked lines',
		` (${lineConfigPays.length} special pays)`,
	); // prettier-ignore
	const forced = linesMock({ seed: 'forced', forceTrigger: true });
	const [forcedBase] = await playRound(forced, await booted(forced, 'forced'));
	check(Boolean(ev(forcedBase, 'pickRandomly')), 'a forced trigger draws it');
	const books = ev(forcedBase, 'playedSpin')
		.context.flat()
		.filter((c) => c === 'SCAT').length;
	check(books >= 4, 'the forced board carries four books or more, as the book mock forces', ` (${books})`); // prettier-ignore
}

// ---------------------------------------------------------------------------------------------
console.log('\n4. the special is drawn only from candidates the game deals');
{
	const pool = PRESET.symbols.filter((s) => s !== 'PIC7');
	const mock = linesMock({ seed: 'pool', forceTrigger: true, symbols: pool });
	const sid = await booted(mock, 'pool');
	const picks = new Set();
	let items = null;
	for (let r = 0; r < 200; r++) {
		const [base] = await playRound(mock, sid);
		const pick = ev(base, 'pickRandomly')?.context;
		items ??= pick?.items;
		if (pick) picks.add(pick.item.state);
	}
	check(!picks.has('PIC7') && picks.size === CANDIDATES.length - 1, 'PIC7 off the strips is never drawn', ` (${[...picks]})`); // prettier-ignore
	check(!items.some((i) => i.state === 'PIC7'), '…nor listed');
	const none = await silently(async () => {
		const own = linesMock({ seed: 'none', forceTrigger: true, symbols: ['PIC8', 'SCAT'] });
		const [base] = await playRound(own, await booted(own, 'none'));
		return base.map((e) => e.event);
	});
	check(none.includes('enterBonus') && !none.includes('pickRandomly'), 'no candidate in play ⇒ free spins with no special'); // prettier-ignore
	const ways = await silently(async () => {
		const own = linesMock({ seed: 'ways', forceTrigger: true, winModel: 'ways', paylines: [] });
		const [base] = await playRound(own, await booted(own, 'ways'));
		return base.map((e) => e.event);
	});
	check(
		!ways.includes('pickRandomly'),
		'a ways game ignores the block (an expanded reel pays lines)',
	);
}

// ---------------------------------------------------------------------------------------------
console.log('\n5. the book is wild on lines (owner decision 2) and declared so');
{
	const pays = { PIC1: { 3: 100 } };
	const opts = { pool: ['PIC1', 'PIC2'], symbolPaytable: pays };
	const line = [[0, 0, 0, 0, 0]];
	const board = (cells) => cells.map((c) => [c]);
	const pay = (cells, o) => evaluatePaylines(board(cells), 1, line, null, o)[0]?.pay ?? 0;
	check(pay(['SCAT', 'PIC1', 'PIC1', 'PIC2', 'PIC2'], { ...opts, scatterWild: true }) === 100, 'a leading book substitutes'); // prettier-ignore
	check(pay(['PIC1', 'SCAT', 'PIC1', 'PIC2', 'PIC2'], { ...opts, scatterWild: true }) === 100, 'a book inside the run substitutes'); // prettier-ignore
	check(pay(['SCAT', 'SCAT', 'SCAT', 'SCAT', 'SCAT'], { ...opts, scatterWild: true }) === 0, 'books alone pay no line (their pay is the scatter pay)'); // prettier-ignore
	check(pay(['SCAT', 'PIC1', 'PIC1', 'PIC2', 'PIC2'], opts) === 0, 'without scatterWild the book is only a scatter'); // prettier-ignore
	const mock = linesMock({ seed: 'declared', forceTrigger: true });
	const config = (await call(mock, [{ action: 'config' }], '/rgs/engine?sid=d&seq=0')).events[0];
	const [base] = await playRound(mock, 'd');
	check(JSON.stringify(config.context.wildSymbols) === '["SCAT"]', 'config declares SCAT wild');
	check(JSON.stringify(ev(base, 'spinStart').context.wildSymbols) === '["SCAT"]', '…and so does spinStart'); // prettier-ignore
	check(!config.context.symbols.includes('WILD'), 'no separate WILD is dealt or declared');
}

// ---------------------------------------------------------------------------------------------
console.log('\n6. the facade presents the preset’s feature as it presents the book mock’s');
/** Every engine event a forced feature round becomes, one round per seed. */
const presented = async (make, label, rounds) => {
	const mock = make();
	const server = createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const rgsUrl = `http://127.0.0.1:${server.address().port}`;
	const out = [];
	await silently(async () => {
		await facade.requestAuthenticate({ rgsUrl, sessionID: label, language: 'en' });
		for (let r = 0; r < rounds; r++) {
			const bet = await facade.requestBet({
				rgsUrl,
				sessionID: label,
				currency: 'USD',
				mode: 'BASE',
				amount: 1,
			});
			out.push({ state: bet.round?.state ?? [], raw: bet._raw?.events ?? [] });
			await facade.requestEndRound({ rgsUrl, sessionID: label });
		}
	});
	server.close();
	return out;
};
// One spin of the feature: its board, the morph when the special covers its threshold, its wins,
// a big win on the way, the meter, a retrigger, the counter.
const SPIN = ' reveal( expandBookColumns)?( winInfo)*( setWin)? setTotalWin( freeSpinRetrigger)?';
const FEATURE_ROUND = new RegExp(
	`^reveal( winInfo)*( setWin)? setTotalWin freeSpinTrigger setExpandingSymbol updateFreeSpin` +
		`(${SPIN} updateFreeSpin)*${SPIN} freeSpinEnd setTotalWin( setWin)? finalWin$`,
);
{
	const lines = await presented(() => linesMock({ seed: 'facade', forceTrigger: true }), 'f-lines', 25); // prettier-ignore
	const book = await presented(() => bookMock({ seed: 'facade', forceTrigger: true }), 'f-book', 25); // prettier-ignore
	const shape = (rounds) => rounds.map((r) => r.state.map((e) => e.type).join(' '));
	const off = (rounds) => shape(rounds).filter((s) => !FEATURE_ROUND.test(s));
	check(off(book).length === 0, 'every book-mock feature round has the Book-of shape', off(book)[0] ? `\n      ${off(book)[0]}` : ''); // prettier-ignore
	check(off(lines).length === 0, 'every lines-mock feature round has the same shape', off(lines)[0] ? `\n      ${off(lines)[0]}` : ''); // prettier-ignore
	const types = (rounds) => [...new Set(rounds.flatMap((r) => r.state.map((e) => e.type)))].sort();
	check(
		JSON.stringify(types(lines)) === JSON.stringify(types(book)),
		'…built from the same engine-event types',
		` (${types(lines).join(', ')})`,
	);
	// The reels that morph are the reels the server paid the special on, spin by spin.
	let morphs = 0;
	const mismatched = [];
	for (const { state, raw } of lines) {
		const paid = raw
			.filter((e) => e.event === 'spinWin' && e.context.mode === 'scatter' && e.context.what !== 'SCAT')
			.map((e) => [...new Set(e.context.context.map((p) => p.reel))].join(','));
		const morphed = state.filter((e) => e.type === 'expandBookColumns').map((e) => e.reels.join(','));
		morphs += morphed.length;
		if (JSON.stringify(paid) !== JSON.stringify(morphed)) mismatched.push({ paid, morphed });
	} // prettier-ignore
	check(mismatched.length === 0 && morphs > 0, 'the reels that morph are the reels the server paid', ` (${morphs} morphs)`); // prettier-ignore
}

// ---------------------------------------------------------------------------------------------
console.log('\n7. the facade’s morph gate reads the authored minReels (__IE_EXPAND_MIN_REELS__)');
{
	// L1 (PIC5) the only candidate, expanding (and paying) from 2 reels — a threshold today's rule
	// gives PIC1 alone.
	const only = { candidates: [{ symbol: 'PIC5', weight: 1, minReels: 2 }] };
	const symbolPaytable = {
		...PRESET.symbolPaytable,
		PIC5: { 2: 2, ...PRESET.symbolPaytable.PIC5 },
	};
	const make = () =>
		linesMock({ seed: 'bridge', forceTrigger: true, expandingSymbol: only, symbolPaytable });
	const twoReelMorphs = (rounds) =>
		rounds.flatMap((r) => r.state.filter((e) => e.type === 'expandBookColumns' && e.reels.length === 2)).length; // prettier-ignore
	const twoReelPays = (rounds) =>
		rounds.flatMap((r) => r.raw.filter((e) => e.event === 'spinWin' && e.context.what === 'PIC5' && e.context.mode === 'scatter' && e.context.occurs === 2)).length; // prettier-ignore
	delete globalThis.__IE_EXPAND_MIN_REELS__;
	const without = await presented(make, 'b-none', 20);
	check(twoReelPays(without) > 0, 'the server pays L1 on 2 reels', ` (${twoReelPays(without)})`);
	check(twoReelMorphs(without) === 0, 'no bridge ⇒ today’s gate: L1 needs 3 reels to morph');
	globalThis.__IE_EXPAND_MIN_REELS__ = { L1: 2 };
	const bridged = await presented(make, 'b-set', 20);
	check(twoReelMorphs(bridged) === twoReelPays(bridged) && twoReelMorphs(bridged) > 0, 'bridged ⇒ L1 morphs on exactly the 2-reel spins the server pays', ` (${twoReelMorphs(bridged)})`); // prettier-ignore
	globalThis.__IE_EXPAND_MIN_REELS__ = { H2: 5 };
	const unnamed = await presented(make, 'b-other', 20);
	check(
		twoReelMorphs(unnamed) === 0,
		'a bridge that does not name the special ⇒ today’s gate for it',
	);
	// A BOOK-vocabulary server pays by its own captured rule (PIC1 from 2 reels) whatever the config
	// says, so a bridge — here every candidate at the default 3, what `expandingSymbol: {}` publishes
	// — must not stop a paid 2-reel PIC1 from morphing.
	globalThis.__IE_EXPAND_MIN_REELS__ = { H1: 3, L1: 3 };
	const onBook = await presented(
		() => bookMock({ seed: 'bridge-book', forceTrigger: true, symbols: ['PIC1', 'ACE', 'SCAT'] }),
		'b-book',
		30,
	);
	const pic1TwoReels = (rounds, pick) => rounds.flatMap((r) => pick(r)).length;
	const paidOnTwo = pic1TwoReels(onBook, (r) => r.raw.filter((e) => e.event === 'spinWin' && e.context.what === 'PIC1' && e.context.mode === 'scatter' && e.context.occurs === 2)); // prettier-ignore
	const morphedOnTwo = pic1TwoReels(onBook, (r) => r.state.filter((e) => e.type === 'expandBookColumns' && e.symbol === 'H1' && e.reels.length === 2)); // prettier-ignore
	check(paidOnTwo > 0 && morphedOnTwo === paidOnTwo, 'a book server ignores the bridge: PIC1 paid on 2 reels still morphs', ` (${morphedOnTwo}/${paidOnTwo})`); // prettier-ignore
	delete globalThis.__IE_EXPAND_MIN_REELS__;
}

// ---------------------------------------------------------------------------------------------
console.log('\n8. dealt like the book mock: the distributions side by side');
{
	const FEATURES = 2000;
	const lines = linesMock({ seed: 'dist', forceTrigger: true });
	const l = await featureStats(lines, await booted(lines, 'dist'), FEATURES);
	// The book mock pays its book no scatter pay and does not substitute it; its own line pass is
	// not under test here, only what it deals — so its wins are not compared, its boards are.
	const b = await silently(async () => {
		const own = bookMock({ seed: 'dist', forceTrigger: true });
		const s = { features: 0, picks: {}, freeSpins: 0, expansions: 0, occurs: 0, expansionPay: 0, retriggers: 0 }; // prettier-ignore
		for (let r = 0; r < FEATURES; r++) {
			const [base, ...spins] = await playRound(own, 'dist');
			const pick = ev(base, 'pickRandomly').context.item.state;
			s.features++;
			s.picks[pick] = (s.picks[pick] ?? 0) + 1;
			const minReels = pick === 'PIC1' ? 2 : 3;
			for (const events of spins) {
				s.freeSpins++;
				const covered = coveredReels(ev(events, 'playedSpin').context, pick).length;
				if (ev(events, 'retrigger')) s.retriggers++;
				if (covered < minReels) continue;
				s.expansions++;
				s.occurs += covered;
				const w = events.find((e) => e.event === 'spinWin' && e.context.what === pick);
				s.expansionPay += (w?.context.pay ?? 0) / 10;
			}
		}
		return s;
	});
	// The book mock's names for the lines mock's: the royals are L1, L2, L3, L4, L5.
	const ROYAL = { ACE: 'PIC5', KING: 'PIC6', QUEEN: 'PIC9', JACK: 'PIC10', TEN: 'PIC7' };
	const bookPicks = Object.fromEntries(Object.entries(b.picks).map(([k, n]) => [ROYAL[k] ?? k, n]));
	const pct = (n, d) => (100 * n) / d;
	const rows = CANDIDATES.map((c) => ({
		symbol: c.symbol,
		weight: pct(c.weight, WEIGHT_TOTAL),
		lines: pct(l.picks[c.symbol] ?? 0, l.features),
		book: pct(bookPicks[c.symbol] ?? 0, b.features),
	}));
	console.log('      pick    weight%  lines%   book%');
	for (const r of rows)
		console.log(`      ${r.symbol.padEnd(6)} ${r.weight.toFixed(1).padStart(7)} ${r.lines.toFixed(1).padStart(7)} ${r.book.toFixed(1).padStart(7)}`); // prettier-ignore
	const worst = Math.max(...rows.flatMap((r) => [Math.abs(r.lines - r.weight), Math.abs(r.book - r.weight)])); // prettier-ignore
	check(worst < 2.5, 'both draw the special by the captured weights (within 2.5 points)', ` (worst ${worst.toFixed(2)})`); // prettier-ignore
	const rate = (s) => pct(s.expansions, s.freeSpins);
	const meanOccurs = (s) => s.occurs / s.expansions;
	const perSpin = (s) => s.expansionPay / s.freeSpins;
	console.log(`      expansions per free spin  lines ${rate(l).toFixed(2)}%  book ${rate(b).toFixed(2)}%`); // prettier-ignore
	console.log(`      reels covered when it does lines ${meanOccurs(l).toFixed(3)}  book ${meanOccurs(b).toFixed(3)}`); // prettier-ignore
	console.log(`      expansion pay per free spin (× bet) lines ${perSpin(l).toFixed(3)}  book ${perSpin(b).toFixed(3)}`); // prettier-ignore
	console.log(`      retriggers per free spin  lines ${pct(l.retriggers, l.freeSpins).toFixed(2)}%  book ${pct(b.retriggers, b.freeSpins).toFixed(2)}%`); // prettier-ignore
	console.log(`      free spins per feature    lines ${(l.freeSpins / l.features).toFixed(2)}  book ${(b.freeSpins / b.features).toFixed(2)}`); // prettier-ignore
	check(Math.abs(rate(l) - rate(b)) < 1.5, 'the special expands as often (within 1.5 points)');
	check(Math.abs(meanOccurs(l) - meanOccurs(b)) < 0.1, '…over as many reels (within 0.1)');
	// A book is dealt at the book mock's 5% a cell when the scatter is wild, so the feature comes as
	// often and lasts as long (design §4).
	check(Math.abs(pct(l.retriggers, l.freeSpins) - pct(b.retriggers, b.freeSpins)) < 0.6, 'books retrigger as often (within 0.6 points)'); // prettier-ignore
	check(Math.abs(l.freeSpins / l.features - b.freeSpins / b.features) < 1, '…so a feature lasts as long (within 1 spin)'); // prettier-ignore

	// The base game's natural trigger: three or more books anywhere on 15 cells.
	const SPINS = 20000;
	const atLeast3 = (p) => 1 - [0, 1, 2].reduce((sum, k) => sum + binomial(15, k) * p ** k * (1 - p) ** (15 - k), 0); // prettier-ignore
	const triggerRate = async (mock, sid) => {
		let n = 0;
		for (let r = 0; r < SPINS; r++) if (ev((await playRound(mock, sid))[0], 'enterBonus')) n++;
		return pct(n, SPINS);
	};
	const natural = linesMock({ seed: 'natural' });
	const lt = await triggerRate(natural, await booted(natural, 'n'));
	const bt = await silently(() => triggerRate(bookMock({ seed: 'natural' }), 'n'));
	const expected = pct(atLeast3(0.05), 1);
	console.log(`      natural trigger per base spin lines ${lt.toFixed(2)}%  book ${bt.toFixed(2)}%  (5% a cell: ${expected.toFixed(2)}%)`); // prettier-ignore
	check(Math.abs(lt - bt) < 0.6 && Math.abs(lt - expected) < 0.6 && Math.abs(bt - expected) < 0.6, 'the base game triggers as often (within 0.6 points, both at 5% a cell)'); // prettier-ignore
}

// ---------------------------------------------------------------------------------------------
console.log('\n9. the Invisible Test Server forwards the block from a manifest entry');
{
	const tree = mkdtempSync(join(tmpdir(), 'expanding-symbol-'));
	const malformed = { candidates: [{ symbol: 'PIC1', weight: 1, minReels: 9 }] };
	const games = {
		preset: { name: 'preset', protocol: 'lines', grid: PRESET },
		malformed: { name: 'malformed', protocol: 'lines', grid: { ...PRESET, expandingSymbol: malformed } },
		crowded: { name: 'crowded', protocol: 'lines', grid: { ...PRESET, expandingSymbol: { candidates: Array.from({ length: 33 }, () => CANDIDATES[0]) } } },
		heavy: { name: 'heavy', protocol: 'lines', grid: { ...PRESET, expandingSymbol: { candidates: [{ ...CANDIDATES[0], weight: 1e7 }] } } },
	}; // prettier-ignore
	writeFileSync(join(tree, 'games.json'), JSON.stringify({ games }));
	const server = await startTestServer(tree, { SEED: 'expanding-symbol', FORCE_TRIGGER: '1' });
	try {
		const first = async (key) => {
			const res = await fetch(`${server.origin}/api/${key}/rgs/engine?sid=t&seq=0`, {
				method: 'POST',
				body: JSON.stringify([
					{ action: 'bet', context: [10, 1] },
					{ action: 'play', context: '' },
				]),
				signal: AbortSignal.timeout(15_000),
			});
			return (await res.json()).events;
		};
		const preset = await first('preset');
		check(Boolean(ev(preset, 'pickRandomly')), 'the preset’s entry deals the special');
		check(JSON.stringify(ev(preset, 'spinStart').context.wildSymbols) === '["SCAT"]', '…and its book as wild'); // prettier-ignore
		const dropped = await first('malformed');
		check(ev(dropped, 'enterBonus') && !ev(dropped, 'pickRandomly'), 'a malformed block is dropped whole (minReels past the reels)'); // prettier-ignore
		for (const key of ['crowded', 'heavy']) {
			const events = await first(key);
			check(ev(events, 'enterBonus') && !ev(events, 'pickRandomly'), `…and so is one out of bounds (${key})`); // prettier-ignore
		}
	} finally {
		server.stop();
		rmSync(tree, { recursive: true, force: true });
	}
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
