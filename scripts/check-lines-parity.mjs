// The LINES mock deals every configuration a project could already have exactly as it did before
// the Book-of mechanic came to it (docs/design/book-feature.md Phase 3): same seed, same responses,
// byte for byte (round ids blanked — they come from `Math.random`, not the seed). The digests were
// taken from origin/main's mock (ebc2197, 2026-10-07) with `--print`; a change that moves one has
// changed a game nobody asked to change.
//
//   pnpm check:lines-parity            (part of check:rgs)
//   node scripts/check-lines-parity.mjs --print [--mock <dir>]   print the digests of a mock copy

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
	options: { print: { type: 'boolean' }, mock: { type: 'string' } },
});
const dir = opt.mock ? resolve(opt.mock) : resolve(import.meta.dirname);
const { createMockRgs } = await import(pathToFileURL(`${dir}/mock-rgs-server.mjs`).href);

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
		const res = { writeHead() {}, end: (text) => done(text) };
		mock.handle(req, res, new URL(url, 'http://mock'));
	});
const blank = (text) => text.replace(/"G[a-z0-9]{6,}"/g, '"G"');

/** Every response of `rounds` rounds, played the way the facade plays them, as one digest. */
const transcript = async (opts, rounds, { table = false, option = 0 } = {}) => {
	const mock = createMockRgs({
		label: 'parity',
		seed: 'lines-parity',
		quiet: true,
		startBalance: 1e9,
		...opts,
	});
	const out = [
		blank(await call(mock, table ? [{ action: 'config' }] : [], '/rgs/engine?sid=s&seq=0')),
	];
	for (let i = 0; i < rounds; i++) {
		let text = await call(
			mock,
			[
				{ action: 'bet', context: table ? [option, 1] : [5, 1] },
				{ action: 'play', context: null },
			],
			'/rgs/engine?sid=s&seq=0',
		);
		out.push(blank(text));
		let resp = JSON.parse(text);
		const gid = resp.platform?.gameRound?.id;
		let seq = 2;
		for (
			let guard = 0;
			gid && !resp.events?.some((e) => e.event === 'gameEnd') && guard < 400;
			guard++
		) {
			text = await call(mock, [{ action: 'play' }], `/rgs/engine?sid=s&seq=${seq++}&gid=${gid}`);
			out.push(blank(text));
			resp = JSON.parse(text);
		}
		if (gid && !resp.events?.some((e) => e.event === 'gameRoundOver'))
			out.push(
				blank(await call(mock, [{ action: 'collect' }], `/rgs/engine?sid=s&seq=${seq}&gid=${gid}`)),
			);
	}
	return createHash('sha256').update(out.join('\n')).digest('hex').slice(0, 16);
};

const BUY = [
	{ mode: 'base', cost: 1, kind: 'base' },
	{ mode: 'bonus', cost: 100, kind: 'buy' },
];
const CONFIGS = {
	default: [{}, 300],
	'forced trigger': [{ forceTrigger: true }, 40],
	WIN_X: [{ winX: '10,20,40,70,120' }, 20],
	'restricted pool': [
		{ symbols: ['PIC1', 'PIC2', 'PIC5', 'PIC9', 'SCAT'], forceTrigger: true },
		40,
	],
	'table + buy': [{ betModes: BUY }, 30, { table: true, option: 1 }],
	ways: [{ winModel: 'ways', forceTrigger: true }, 40],
	stepped: [{ rows: [3, 4, 5, 4, 3], forceTrigger: true }, 40],
	cascade: [{ cascade: true }, 100],
	'wild + stacked': [
		{ wild: { paytable: { 3: 5, 4: 20, 5: 100 } }, stacked: true, forceTrigger: true },
		40,
	],
	'authored scatter pays + awards': [
		{
			scatterPaytable: { 3: 2, 4: 20, 5: 200 },
			freeSpinsAwards: {
				awards: [{ count: 3, spins: 8 }],
				retrigger: [{ count: 3, spins: 10 }],
				random: false,
			},
			forceTrigger: true,
		},
		40,
	],
};

const PINNED = {
	default: 'a29483558989bb48',
	'forced trigger': '05325dcbc3fcfcf4',
	WIN_X: '25de5e85af753994',
	'restricted pool': '6d9561c8a0c96acd',
	'table + buy': 'd9b3308652b18df7',
	ways: '81667960c70789cb',
	stepped: '61499b10ee2ea754',
	cascade: '8c0534948e1bac53',
	'wild + stacked': '8665602ddf7d8c84',
	'authored scatter pays + awards': 'fa11e0f0e4292e46',
};

const digests = {};
for (const [name, [opts, rounds, how]] of Object.entries(CONFIGS))
	digests[name] = await transcript(opts, rounds, how);
if (opt.print) {
	for (const [name, digest] of Object.entries(digests)) console.log(`\t'${name}': '${digest}',`);
	process.exit(0);
}
let failed = 0;
for (const [name, digest] of Object.entries(digests)) {
	const ok = digest === PINNED[name];
	console.log(`${ok ? '  ✓' : '  ✗'} ${name} (${digest})`);
	if (!ok) failed++;
}
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
