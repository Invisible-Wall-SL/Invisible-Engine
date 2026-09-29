/**
 * Offline fixture: a buy card's price is what the wallet is charged.
 *
 * Drives the REAL book mock (`scripts/mock-rgs-server-book.mjs` — what `services/test-server` serves
 * Book-of projects) through the REAL facade (`packages/rgs-translator-eagaming/src/engineFacade.ts`):
 *
 *   Part 1 (mock):   the mock declares `betOptions` and prices a `bet` [x, M] the way the partner does
 *                    for such a game — `betOptions[x] × M`, x an OPTION INDEX — and refuses an index
 *                    outside its table rather than charging some other price.
 *   Part 2 (chain):  for every option the facade publishes to the game's menu
 *                    (`__IE_SERVER_BET_OPTIONS__`, what `betModeMeta.ts` builds the cards from), a
 *                    `requestBet` in that mode is debited exactly the card's price,
 *                    `betAmount × costMultiplier`. This is the check that was missing when a $100
 *                    card debited $1 (2026-09-28): the facade sent option 1 and the mock read it as
 *                    a 1× cost multiplier. A mode the table cannot name is refused by the facade
 *                    before any bet is sent.
 *   Part 3 (pays):   a bought round's free spins pay at the BASE stake, identical to the same
 *                    feature reached by a base spin — the buy premium must not scale the wins.
 *
 * Run: pnpm check:buy-cost   (part of `pnpm check:rgs`)
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs } from './mock-rgs-server-book.mjs';
import {
	requestAuthenticate,
	requestBet,
	requestEndRound,
} from '../packages/rgs-translator-eagaming/src/engineFacade';

type WireEvent = { event: string; context: Record<string, unknown> };
type WireResponse = { events?: WireEvent[]; error?: string; platform?: { balance?: number } };

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = got === want;
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
};

const startMock = (opts: { seed: string; forceTrigger?: boolean }) => {
	const mock = createMockRgs({
		label: 'buycost-fixture',
		startBalance: 1_000_000_000,
		...opts,
	});
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	return new Promise<{ server: Server; rgsUrl: string }>((resolve) => {
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ server, rgsUrl: `localhost:${port}` });
		});
	});
};

const postEngine = async (
	rgsUrl: string,
	sid: string,
	seq: number,
	body: unknown,
	gid?: string,
) => {
	const res = await fetch(
		`http://${rgsUrl}/rgs/engine?sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
		{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
	);
	return res.json() as Promise<WireResponse & { platform?: { gameRound?: { id?: string } } }>;
};

const betTotal = (resp: WireResponse) =>
	resp.events?.find((e) => e.event === 'bet')?.context.total as number | undefined;

/** Play one round opened by `bet` to its `collect`, the way the facade drives it. Returns every
 *  free-spin win as `what:pay`, in order, and how many were the expanding special's own pay. */
const playRoundRaw = async (rgsUrl: string, sid: string, bet: [number, number]) => {
	let resp = await postEngine(rgsUrl, sid, 0, [
		{ action: 'bet', context: bet },
		{ action: 'play', context: '' },
	]);
	const gid = resp.platform?.gameRound?.id;
	const pays: string[] = [];
	let specials = 0;
	let seq = 2;
	while (gid && !resp.events?.some((e) => e.event === 'gameEnd') && seq < 200) {
		resp = await postEngine(rgsUrl, sid, seq++, [{ action: 'play' }], gid);
		for (const e of resp.events ?? []) {
			if (e.event !== 'spinWin') continue;
			pays.push(`${e.context.what}:${e.context.pay}`);
			if (e.context.mode === 'scatter' && e.context.what !== 'SCAT') specials += 1;
		}
	}
	if (gid) await postEngine(rgsUrl, sid, seq, [{ action: 'collect' }], gid);
	return { pays, specials };
};

const main = async () => {
	const { server, rgsUrl } = await startMock({ seed: 'buycost' });

	// ---- Part 1: the mock prices [x, M] as betOptions[x] × M ----
	const config = await postEngine(rgsUrl, 'cfg', 0, [{ action: 'config' }]);
	const betOptions = config.events?.find((e) => e.event === 'config')?.context
		.betOptions as number[];
	assert('mock declares betOptions', JSON.stringify(betOptions), '[10,1000]');
	const wireCases: { ctx: [number, number]; want: number }[] = [
		{ ctx: [0, 10], want: 100 }, // $1 base spin
		{ ctx: [1, 10], want: 10_000 }, // $100 buy at the same M
		{ ctx: [0, 4], want: 40 },
		{ ctx: [1, 4], want: 4_000 },
	];
	for (const { ctx, want } of wireCases) {
		const resp = await postEngine(rgsUrl, `wire-${ctx.join('-')}`, 0, [
			{ action: 'bet', context: ctx },
		]);
		assert(`mock charge [${ctx}]`, betTotal(resp), want);
	}
	for (const bad of [2, 25, 100, -1]) {
		const resp = await postEngine(rgsUrl, `wire-bad-${bad}`, 0, [
			{ action: 'bet', context: [bad, 10] },
		]);
		assert(`mock refuses option ${bad}`, !!resp.error && betTotal(resp) === undefined, true);
	}

	// ---- Part 2: every card the game offers is debited its displayed price ----
	const realFetch = globalThis.fetch;
	const betResponses: WireResponse[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const res = await realFetch(input, init);
		if (String(init?.body ?? '').includes('"bet"')) betResponses.push(await res.clone().json());
		return res;
	}) as typeof fetch;

	await requestAuthenticate({ sessionID: 'menu', rgsUrl, language: 'en' });
	const menu = (
		globalThis as {
			__IE_SERVER_BET_OPTIONS__?: { key: string; index: number; costMultiplier: number }[];
		}
	).__IE_SERVER_BET_OPTIONS__;
	assert('facade publishes the server menu', menu?.map((o) => o.key).join(','), 'BASE,OPTION1');
	for (const amount of [1, 0.4]) {
		for (const option of menu ?? []) {
			const sid = `card-${option.key}-${amount}`;
			await requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
			betResponses.length = 0;
			await requestBet({ sessionID: sid, currency: 'USD', amount, mode: option.key, rgsUrl });
			await requestEndRound({ sessionID: sid, rgsUrl });
			const cardCents = Math.round(amount * option.costMultiplier * 100);
			assert(
				`$${amount} ${option.key} card $${cardCents / 100} is debited`,
				betTotal(betResponses[0] ?? {}),
				cardCents,
			);
		}
	}

	// An authored card the server's table cannot name is refused by the FACADE: no bet reaches the
	// server, so nothing can charge it some other price. The session is left as it was, so the next
	// bet goes through at its own price.
	await requestAuthenticate({ sessionID: 'unpriced', rgsUrl, language: 'en' });
	betResponses.length = 0;
	const unpriced = (await requestBet({
		sessionID: 'unpriced',
		currency: 'USD',
		amount: 1,
		mode: 'HIGHNOON',
		rgsUrl,
	})) as { error?: string };
	assert('an unpriced authored mode is refused', !!unpriced.error, true);
	assert('...before any bet is sent', betResponses.length, 0);
	const wallet = await postEngine(rgsUrl, 'unpriced', 0, []);
	assert('...and the wallet is untouched', wallet.platform?.balance, 1_000_000_000);
	await requestBet({ sessionID: 'unpriced', currency: 'USD', amount: 1, mode: 'BASE', rgsUrl });
	await requestEndRound({ sessionID: 'unpriced', rgsUrl });
	assert('...and the next base spin is charged $1', betTotal(betResponses[0] ?? {}), 100);
	globalThis.fetch = realFetch;
	server.close();

	// ---- Part 3: a bought feature pays at the base stake ----
	// Same seed, same request sequence ⇒ same RNG draws: the buy and a forced base trigger deal the
	// identical feature, so every free-spin pay must match to the cent. The seed is one whose feature
	// pays the expanding special, the pay that is priced off the stake rather than off betPerLine.
	const seed = 'buycost-pays-0';
	const bought = await startMock({ seed });
	const buy = await playRoundRaw(bought.rgsUrl, 'pays', [1, 10]);
	bought.server.close();
	const forced = await startMock({ seed, forceTrigger: true });
	const base = await playRoundRaw(forced.rgsUrl, 'pays', [0, 10]);
	forced.server.close();
	assert('the feature paid the expanding special', buy.specials > 0, true);
	assert('bought feature pays = base-triggered pays', buy.pays.join(' '), base.pays.join(' '));

	console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
	process.exit(failures === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
