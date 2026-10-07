// The BOOK mock RGS deals a Book-of project's authored free-spins rule — its Invisible Game Config's
// Free spins section, sent by the launcher's mock contract (`projectBookFreeSpins`) — the way
// `check-freespin-protocol.mjs` §6–§13 hold the lines mock to it. And a Book-of project that
// authored nothing is dealt byte for byte what it was dealt before the rule existed.
//
//   pnpm check:freespins          (runs this beside check-freespin-protocol.mjs)
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/check-book-freespin-protocol.mjs --print --mock <dir>
//     prints the parity digests of another copy of the book mock (`<dir>` holding its
//     `mock-rgs-server-book.mjs` and siblings) — how the pinned ones below were taken, from
//     origin/main's mock before this rule existed.
//
// A Book-of game always triggers on its book (`docs/design/book-feature.md`, decision 9), so only
// the trigger COUNT is honoured; its retrigger awards +10 untold (decision 8).

import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
	addPotsOverlay,
	freeSpinsAwardFor,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
} from '../packages/game-config/index.ts';

const { values: opt } = parseArgs({
	options: { print: { type: 'boolean' }, mock: { type: 'string' } },
});
const dir = opt.mock ? resolve(opt.mock) : resolve(import.meta.dirname);
const { createMockRgs: createBookMock } = await import(
	pathToFileURL(`${dir}/mock-rgs-server-book.mjs`).href
);
const { withPotsOverlay } = await import(pathToFileURL(`${dir}/mock-pots-overlay.mjs`).href);

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

/** One booted mock behind a real HTTP server, plus the `post` the facade would make. */
const serve = async (mock) => {
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, 'http://127.0.0.1')),
	);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const post = (path, body) =>
		new Promise((done, reject) => {
			const payload = JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port: server.address().port,
					path,
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(payload),
						connection: 'close',
					},
				},
				(res) => {
					let text = '';
					res.setEncoding('utf8');
					res.on('data', (c) => (text += c));
					res.on('end', () => {
						try {
							done(JSON.parse(text));
						} catch {
							done(null);
						}
					});
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	return { post, close: () => new Promise((r) => server.close(r)) };
};
const boot = (opts) =>
	serve(createBookMock({ label: 'book-fs-check', seed: 'book-freespins', ...opts }));

const ev = (resp, name) => (resp?.events ?? []).find((e) => e.event === name);

/**
 * Play one round to completion the way the facade does: `bet [option, 1]` + `play` opens it, a bare
 * `play` per free spin while it stays open, then `collect`. `force` rides the opening `play`'s
 * context (the pots overlay's `force:pot:<id>`).
 */
const playRound = async (post, sid, { option = 0, force } = {}) => {
	const spins = [];
	let seq = 0;
	let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
		{ action: 'bet', context: [option, 1] },
		{ action: 'play', context: force ?? null },
	]);
	seq += 2;
	spins.push(resp);
	const gid = resp?.platform?.gameRound?.id;
	let guard = 0;
	while (gid && !ev(resp, 'gameEnd') && !ev(resp, 'gameRoundOver') && guard++ < 300) {
		resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
		seq += 1;
		spins.push(resp);
	}
	const collect =
		!gid || ev(resp, 'gameRoundOver')
			? resp
			: await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
	return { spins, collect, hung: guard >= 300 };
};

// ---------- §1 parity ----------

/** A response with its round ids blanked: the mock mints them from `Math.random`, not the seed. */
const stable = (resp) =>
	JSON.stringify(resp, (key, value) =>
		key === 'id' && typeof value === 'string' && /^G[a-z0-9]+$/.test(value) ? 'G' : value,
	);

const pays = (three, four, five) => ({ paytable: [{ 3: three }, { 4: four }, { 5: five }] });
const STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'PIC2', 'TEN'].map((name) => ({ name }));
/** A Book-of host in the book mock's own names, as `check-pots-overlay-protocol.mjs` builds one. */
const BOOK_HOST = normalizeGameConfigDoc({
	providerName: 'invisible_wall',
	gameName: 'book_fs',
	gameID: 'book_fs',
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
});
const overlayInputs = (preset) => {
	const added = addPotsOverlay(BOOK_HOST, preset);
	if (!added.ok) throw new Error(`pots overlay ${preset}: ${added.reason}`);
	return potsOverlayMockInputs(normalizeGameConfigDoc(added.doc));
};
const FREE_SPINS_POTS = overlayInputs('potsToFreeSpins');
const THREE_POTS = overlayInputs('threePots');

/** The transcript of `rounds` rounds on a fresh, seeded mock — every response, in order. */
const transcript = async (make, rounds, play = {}) => {
	const { post, close } = await serve(make());
	const sid = 'parity';
	const out = [stable(await post(`/rgs/engine?sid=${sid}&seq=0`, []))];
	for (let i = 0; i < rounds; i++) {
		const round = await playRound(post, sid, typeof play === 'function' ? play(i) : play);
		out.push(...round.spins.map(stable), stable(round.collect));
	}
	await close();
	return createHash('sha256').update(out.join('\n')).digest('hex').slice(0, 16);
};
const seeded = (extra = {}) => ({ label: 'parity', seed: 'book-parity', ...extra });
const firstPot = (inputs) => inputs.pots[0]?.id;

/** Each configuration a Book-of project could be dealt in before free spins were authorable. */
const PARITY = {
	'plain base rounds': () => transcript(() => createBookMock(seeded()), 300),
	'forced trigger (FORCE_TRIGGER)': () =>
		transcript(() => createBookMock(seeded({ forceTrigger: true })), 25),
	'bought feature (bet option 1)': () =>
		transcript(() => createBookMock(seeded()), 25, { option: 1 }),
	'a narrower pool and an authored table': () =>
		transcript(
			() =>
				createBookMock(
					seeded({
						symbols: ['PIC1', 'PIC2', 'ACE', 'KING', 'SCAT'],
						symbolPaytable: { PIC1: { 3: 50, 4: 500, 5: 2500 } },
						forceTrigger: true,
					}),
				),
			25,
		),
	'pots overlay → free spins, a pot forced full': () =>
		transcript(
			() => withPotsOverlay(createBookMock, FREE_SPINS_POTS)(seeded({ allowForce: true })),
			30,
			(i) => (i % 3 === 0 ? { force: `force:pot:${firstPot(FREE_SPINS_POTS)}` } : {}),
		),
	'pots overlay → Hold and Win (3 Pots), forced trigger': () =>
		transcript(
			() =>
				withPotsOverlay(
					createBookMock,
					THREE_POTS,
				)(seeded({ allowForce: true, forceTrigger: true })),
			20,
		),
};

/**
 * Taken from origin/main's book mock (2026-10-07, before this rule) with `--print --mock`.
 * A Book-of project that authored no free-spins rule must keep exactly this deal.
 */
const PINNED = {
	'plain base rounds': 'e6886d9488162e56',
	'forced trigger (FORCE_TRIGGER)': '59686cb9763b609b',
	'bought feature (bet option 1)': 'cd48bfff2b17fede',
	'a narrower pool and an authored table': 'de463c2b1377988e',
	'pots overlay → free spins, a pot forced full': '0304500ded66227b',
	'pots overlay → Hold and Win (3 Pots), forced trigger': '20bf55a93c44110c',
};

if (opt.print) {
	for (const [name, run] of Object.entries(PARITY)) console.log(`\t'${name}': '${await run()}',`);
	process.exit(0);
}

console.log('\n§1 — parity: a Book-of game with no free-spins rule is dealt exactly as before');
for (const [name, run] of Object.entries(PARITY)) {
	const digest = await run();
	check(digest === PINNED[name], name, ` (${digest})`);
}

/** The base board a round was dealt (its first `playedSpin`), and how many books it holds. */
const baseBoard = (round) => ev(round.spins[0], 'playedSpin')?.context ?? [];
const books = (board) => board.flat().filter((cell) => cell === 'SCAT').length;

console.log('\n§2 — free spins OFF: books land, the feature never opens, the buy leaves the table');
{
	const { post, close } = await boot({
		forceTrigger: true,
		freeSpins: false,
		startBalance: 100_000_000,
	});
	const sid = 'off';
	const boot0 = await post(`/rgs/engine?sid=${sid}&seq=0`, []);
	check(
		JSON.stringify(ev(boot0, 'config')?.context?.betOptions) === '[10]',
		'the boot config declares the base option only',
		` (${JSON.stringify(ev(boot0, 'config')?.context?.betOptions)})`,
	);
	let opened = 0;
	let bookBoards = 0;
	for (let i = 0; i < 200; i++) {
		const round = await playRound(post, sid);
		if (round.spins.some((s) => ev(s, 'spinTrigger') || ev(s, 'enterBonus'))) opened++;
		if (books(baseBoard(round)) >= 3) bookBoards++;
	}
	check(opened === 0, 'no `spinTrigger` / `enterBonus` in 200 forced rounds', ` (${opened})`);
	check(bookBoards > 0, 'boards with 3+ books still land', ` (${bookBoards})`);
	const before = (await post(`/rgs/engine?sid=${sid}&seq=0`, []))?.platform?.balance;
	const buy = await post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [1, 1] },
		{ action: 'play', context: null },
	]);
	check(buy?.result === 0 && buy?.errorCode === 101, 'a buy is refused as an invalid bet option');
	check(buy?.platform?.balance === before, '…and nothing is charged', ` (${before})`);
	await close();
}

console.log('\n§3 — a trigger count: the feature opens on that many books, and retriggers on them');
{
	const { post, close } = await boot({
		freeSpinsTrigger: { symbol: 'SCAT', count: 4 },
		startBalance: 100_000_000,
	});
	let disagree = 0;
	let threeOnly = 0;
	let opened = 0;
	let badRetrigger = 0;
	let badRule = 0;
	for (let i = 0; i < 1500; i++) {
		const round = await playRound(post, 'count');
		const board = baseBoard(round);
		const trigger = ev(round.spins[0], 'spinTrigger')?.context;
		if (trigger) opened++;
		if (Boolean(trigger) !== books(board) >= 4) disagree++;
		if (books(board) === 3 && !trigger) threeOnly++;
		if (trigger && (trigger.trigger?.occurs?.[0] !== 4 || trigger.occurs < 4)) badRule++;
		for (const s of round.spins.slice(1)) {
			const retrigger = ev(s, 'retrigger');
			if (
				retrigger &&
				(retrigger.context.occurs < 4 || books(ev(s, 'playedSpin')?.context ?? []) < 4)
			)
				badRetrigger++;
		}
	}
	check(disagree === 0, 'a round opens exactly when 4+ books land', ` (${disagree})`);
	check(opened > 0, 'the feature still opens naturally', ` (${opened}/1500)`);
	check(threeOnly > 0, 'three books no longer open it', ` (${threeOnly})`);
	check(badRule === 0, '`spinTrigger` states the 4+ rule and what landed', ` (${badRule})`);
	check(badRetrigger === 0, 'a retrigger also needs 4+ books', ` (${badRetrigger})`);
	await close();

	for (const count of [6, 8]) {
		const forced = await boot({
			forceTrigger: true,
			freeSpinsTrigger: { symbol: 'SCAT', count },
			startBalance: 100_000_000,
		});
		let short = 0;
		for (let i = 0; i < 10; i++) {
			if (books(baseBoard(await playRound(forced.post, 'forced'))) < count) short++;
		}
		check(short === 0, `every forced board holds ${count}+ books`, ` (${short}/10 short)`);
		await forced.close();
	}
}

/** The feature a round played, read the way the facade reads it. */
const featureOf = (round) => {
	const trigger = ev(round.spins[0], 'spinTrigger')?.context;
	return {
		landed: books(baseBoard(round)),
		awarded: trigger?.spins?.[0]?.spins,
		entered: ev(round.spins[0], 'enterBonus')?.context?.left,
		retriggers: round.spins
			.slice(1)
			.map((s) => ev(s, 'retrigger')?.context)
			.filter(Boolean),
		counters: round.spins.map((s) => ev(s, 'playedBonusSpin')?.context).filter(Boolean),
		gameEnds: round.spins.filter((s) => ev(s, 'gameEnd')).length,
		special: ev(round.spins[0], 'pickRandomly')?.context?.item?.state,
	};
};

/** Every award a round dealt against `freeSpinsAwardFor`, and its counter against them. */
const audit = (round, { awards, retrigger, random }) => {
	const f = featureOf(round);
	const problems = [];
	const entry = freeSpinsAwardFor(awards, f.landed, random);
	if (!entry || f.awarded < entry.min || f.awarded > entry.max) problems.push('entry award');
	if (f.entered !== f.awarded) problems.push('enterBonus left');
	for (const r of f.retriggers) {
		const added = freeSpinsAwardFor(retrigger, r.occurs, random);
		if (!added || r.spins < added.min || r.spins > added.max) problems.push('retrigger award');
	}
	const total = f.awarded + f.retriggers.reduce((sum, r) => sum + r.spins, 0);
	if (f.counters.length !== total || f.counters.at(-1)?.left !== 0) problems.push('counter');
	if (f.gameEnds !== 1 || round.hung) problems.push('round end');
	if (!f.special) problems.push('no expanding special');
	return { ...f, problems };
};
const playAwards = async (rule, n, { force = true, option = 0 } = {}) => {
	const { post, close } = await boot({
		forceTrigger: force,
		...(rule.sent === false
			? {}
			: {
					freeSpinsAwards: { awards: rule.awards, retrigger: rule.retrigger, random: rule.random },
				}),
		startBalance: 100_000_000,
	});
	const rounds = [];
	for (let i = 0; i < n; i++) rounds.push(audit(await playRound(post, 'awards', { option }), rule));
	await close();
	return rounds;
};
const broken = (rounds) => rounds.filter((r) => r.problems.length).map((r) => r.problems.join('+'));
const awardsAt = (rounds, test) =>
	new Set(rounds.filter((r) => test(r.landed)).map((r) => r.awarded));

console.log('\n§4 — untold, a Book-of game awards 10 and retriggers +10');
{
	const rounds = await playAwards(
		{
			sent: false,
			awards: [{ count: 3, spins: 10 }],
			retrigger: [{ count: 3, spins: 10 }],
			random: false,
		},
		60,
	);
	const added = new Set(rounds.flatMap((r) => r.retriggers.map((t) => t.spins)));
	check(
		broken(rounds).length === 0,
		'every award, counter, round end and special checks out',
		` (${broken(rounds).join(', ') || `${rounds.length} rounds`})`,
	);
	check([...added].join() === '10', 'every retrigger adds 10', ` (${[...added]})`);
}

console.log('\n§5 — a fixed award table: each landed count gets exactly its row');
{
	const rule = {
		awards: [
			{ count: 3, spins: 7 },
			{ count: 5, spins: 12 },
		],
		retrigger: [{ count: 3, spins: 4 }],
		random: false,
	};
	const rounds = await playAwards(rule, 60);
	check(
		broken(rounds).length === 0,
		'every award, counter and round end checks out',
		` (${broken(rounds).join(', ') || `${rounds.length} rounds`})`,
	);
	check(
		[...awardsAt(rounds, (n) => n < 5)].join() === '7',
		'3–4 books ⇒ 7',
		` (${[...awardsAt(rounds, (n) => n < 5)]})`,
	);
	check(
		[...awardsAt(rounds, (n) => n >= 5)].join() === '12',
		'5+ books ⇒ 12',
		` (${[...awardsAt(rounds, (n) => n >= 5)]})`,
	);
	const bought = await playAwards(rule, 15, { force: false, option: 1 });
	check(
		broken(bought).length === 0 && bought.every((r) => r.awarded === (r.landed >= 5 ? 12 : 7)),
		'a bought feature is awarded by the same table',
		` (${broken(bought).join(', ') || `${bought.length} rounds`})`,
	);
}

console.log("\n§6 — random awards: inside each row's range, and more than one value of it");
{
	const rule = {
		awards: [{ count: 3, spins: 1, maxSpins: 4 }],
		retrigger: [{ count: 3, spins: 1, maxSpins: 3 }],
		random: true,
	};
	const rounds = await playAwards(rule, 80);
	const values = awardsAt(rounds, () => true);
	check(
		broken(rounds).length === 0,
		"every award is inside its row's range, counters agree",
		` (${broken(rounds).join(', ') || `${rounds.length} rounds`})`,
	);
	check(values.size > 1, 'several values of 1–4', ` (${[...values].sort()})`);
	const fixed = await playAwards({ ...rule, random: false }, 20);
	check(
		broken(fixed).length === 0 && [...awardsAt(fixed, () => true)].join() === '1',
		'random off: a stored range awards exactly its spins',
	);
}

console.log("\n§7 — a retrigger table: a retrigger adds its row's award, not the +10 default");
{
	const rule = {
		awards: [{ count: 3, spins: 10 }],
		retrigger: [
			{ count: 3, spins: 2 },
			{ count: 4, spins: 9 },
		],
		random: false,
	};
	const rounds = await playAwards(rule, 120);
	const added = rounds.flatMap((r) => r.retriggers.map((t) => t.spins));
	check(
		broken(rounds).length === 0,
		'every retrigger adds its row, the counter runs it down to 0',
		` (${broken(rounds).join(', ') || `${rounds.length} rounds`})`,
	);
	check(added.length > 0, 'retriggers happen', ` (${added.length})`);
	check(!added.includes(10), 'none of them adds the default 10', ` (${[...new Set(added)]})`);
}

console.log('\n§8 — the pots overlay composes over the same rule');
{
	// The preset's pot names its own spin count (10), which rightly wins; a pot that names none is
	// awarded by the host's table.
	const countless = {
		...FREE_SPINS_POTS,
		pots: FREE_SPINS_POTS.pots.map((p) => ({ ...p, bonus: { mode: p.bonus.mode } })),
	};
	const { post, close } = await serve(
		withPotsOverlay(
			createBookMock,
			countless,
		)({
			label: 'book-fs-pots',
			seed: 'book-freespins',
			allowForce: true,
			startBalance: 100_000_000,
			freeSpinsAwards: {
				awards: [{ count: 3, spins: 6 }],
				retrigger: [{ count: 3, spins: 3 }],
				random: false,
			},
		}),
	);
	const pot = firstPot(FREE_SPINS_POTS);
	let potFeatures = 0;
	let wrong = 0;
	for (let i = 0; i < 20; i++) {
		const round = await playRound(post, 'pots', { force: `force:pot:${pot}` });
		const entry = round.spins
			.flatMap((s) => s?.events ?? [])
			.find((e) => e.event === 'spinTrigger' && e.context?.cause === 'meter');
		if (!entry) continue;
		potFeatures++;
		if (entry.context.spins?.[0]?.spins !== 6) wrong++;
	}
	check(potFeatures > 0, "a full pot starts the host's free spins", ` (${potFeatures}/20)`);
	check(
		wrong === 0,
		"…a pot naming no count is awarded by the project's own table (6)",
		` (${wrong})`,
	);
	await close();

	const off = withPotsOverlay(
		createBookMock,
		FREE_SPINS_POTS,
	)({ label: 'book-fs-pots-off', seed: 'book-freespins', freeSpins: false });
	const served = await serve(off);
	const cfg = ev(await served.post('/rgs/engine?sid=off&seq=0', []), 'config')?.context;
	check(
		JSON.stringify(cfg?.betOptions) === '[10]' && Boolean(cfg?.potsOverlay),
		'free spins off reaches the host under the overlay too (base option only, overlay declared)',
	);
	await served.close();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
