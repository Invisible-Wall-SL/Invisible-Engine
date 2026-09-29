// The LINES mock RGS pays — and declares — the project's AUTHORED scatter pays (`scatterPaytable`,
// the scatter symbol's own paytable in `/config`, handed over by the Invisible Test Server), so the
// info page's scatter row, the payouts and the wire agree. Unauthored, it keeps its placeholder
// table, paid but never declared, exactly as before scatter pays had an authored home.
//
//   node scripts/check-lines-scatter-paytable.mjs
//
// Every round forces the free-spin trigger, so every opening spin lands at least three scatters.

import { EventEmitter } from 'node:events';

import { createMockRgs } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

/** One POST through the mock's own `handle`, with no socket. */
const post = (mock, path, body) =>
	new Promise((resolve, reject) => {
		const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {} });
		const res = {
			writeHead: () => {},
			setHeader: () => {},
			end: (text) => resolve(JSON.parse(text)),
		};
		mock.handle(req, res, new URL(path, 'http://mock')).catch(reject);
		setImmediate(() => {
			req.emit('data', Buffer.from(JSON.stringify(body)));
			req.emit('end');
		});
	});

const ev = (resp, name) => (resp?.events ?? []).find((e) => e.event === name);

/** The mock's placeholder, restated so the check is independent of the code under test. */
const PLACEHOLDER = { 3: 2, 4: 10, 5: 100 };
/** An authored row as the contract delivers it: JSON, so the count keys are STRINGS. */
const AUTHORED = { 3: 7, 4: 30, 5: 300 };
const TOTAL = 20;

/** The declared config and the opening spin's scatter wins over a batch of forced-trigger rounds. */
const run = async (scatterPaytable) => {
	const log = console.log;
	console.log = () => {};
	try {
		const mock = createMockRgs({
			label: 'lines-scatter-check',
			seed: 'lines-scatter-check',
			startBalance: 1_000_000_000,
			forceTrigger: true,
			quiet: true,
			...(scatterPaytable ? { scatterPaytable: JSON.parse(JSON.stringify(scatterPaytable)) } : {}),
		});
		const config = ev(await post(mock, '/rgs/engine?sid=fx&seq=0', []), 'config')?.context;
		const wins = [];
		for (let i = 0; i < 30; i++) {
			const opening = await post(mock, `/rgs/engine?sid=fx${i}&seq=0`, [
				{ action: 'bet', context: [20, 1] },
				{ action: 'play', context: null },
			]);
			for (const e of opening?.events ?? []) {
				if (e.event === 'spinWin' && e.context?.what === 'SCAT') wins.push(e.context);
			}
		}
		return { config, wins };
	} finally {
		console.log = log;
	}
};

console.log('§1 unauthored: the placeholder table, paid and never declared');
{
	const { config, wins } = await run(null);
	check(Boolean(config?.paytable), 'the mock declares a paytable');
	check(!('SCAT' in (config?.paytable ?? {})), 'no SCAT row is declared');
	check(wins.length > 0, 'forced triggers land paying scatters', ` (${wins.length})`);
	check(
		wins.every((w) => w.pay === PLACEHOLDER[w.occurs] * TOTAL),
		'each pays the placeholder × total stake',
	);
}

console.log('§2 authored: paid AND declared');
{
	const { config, wins } = await run(AUTHORED);
	const row = config?.paytable?.SCAT;
	check(
		JSON.stringify(row) === JSON.stringify({ occurs: [3, 4, 5], pay: [7, 30, 300] }),
		'the SCAT row is declared in the symbol-keyed shape',
		` (${JSON.stringify(row)})`,
	);
	check(wins.length > 0, 'forced triggers land paying scatters', ` (${wins.length})`);
	check(
		wins.every((w) => w.pay === AUTHORED[w.occurs] * TOTAL),
		'each pays the authored row × total stake',
		` (${wins.map((w) => `${w.occurs}:${w.pay}`).join(' ')})`,
	);
}

console.log('§3 a malformed table is ignored, not trusted');
{
	const { config, wins } = await run({ 3: 'x', 0: 5, '-1': 2 });
	check(!('SCAT' in (config?.paytable ?? {})), 'nothing usable ⇒ no SCAT row declared');
	check(
		wins.every((w) => w.pay === PLACEHOLDER[w.occurs] * TOTAL),
		'…and the placeholder still pays',
	);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
