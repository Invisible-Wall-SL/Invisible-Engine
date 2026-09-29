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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createMockRgs } from './mock-rgs-server-book.mjs';
import { carrySession, createMockRgs as createLinesMock } from './mock-rgs-server.mjs';
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

type Session = Record<string, unknown>;
type MockHandle = {
	handle: (req: IncomingMessage, res: ServerResponse, url: URL) => unknown;
	sessions?: Map<string, Session>;
};

const startMock = (opts: { seed: string; forceTrigger?: boolean }) =>
	serve(createMockRgs({ label: 'buycost-fixture', startBalance: 1_000_000_000, ...opts }));

/** Serve a mock. `swap` replaces it the way the test server's `swapMock` does, sessions carried;
 *  `restart` replaces it with every session lost, as a process restart does. */
const serve = (first: MockHandle) => {
	let mock = first;
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	const swap = (next: MockHandle, keepBetShape: boolean) => {
		for (const [sid, session] of mock.sessions ?? []) {
			next.sessions?.set(sid, carrySession(session, { keepBetShape }));
		}
		mock = next;
	};
	const restart = (next: MockHandle) => {
		mock = next;
	};
	return new Promise<{
		server: Server;
		rgsUrl: string;
		swap: typeof swap;
		restart: typeof restart;
	}>((resolve) => {
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ server, rgsUrl: `localhost:${port}`, swap, restart });
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

/** Play one round opened by `bet` to its `collect`, the way the facade drives it — config first, as
 *  a table game prices only a session that asked. Returns every free-spin win as `what:pay`, in
 *  order, and how many were the expanding special's own pay. */
const playRoundRaw = async (rgsUrl: string, sid: string, bet: [number, number]) => {
	await postEngine(rgsUrl, sid, 0, [{ action: 'config' }]);
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

	// ---- Part 4: the lines-family mock sells what the project authored ----
	// A project that authors an ante or a buy gets a `betOptions` table (test server → `betModes`),
	// every win model. Before this a buy on it went out as a line bet, was debited the base stake and
	// dealt a base spin while the card showed the authored price.
	const modes = [
		{ mode: 'base', cost: 1, kind: 'base' },
		{ mode: 'bonus', cost: 100, kind: 'buy' },
		{ mode: 'ante', cost: 1.25, kind: 'ante' },
	];
	const linesMock = (winModel: string, extra: Record<string, unknown> = {}) =>
		serve(
			createLinesMock({
				label: `buycost-${winModel}`,
				startBalance: 1_000_000_000,
				quiet: true,
				winModel,
				// Scatter-pays needs 8 of a kind by default, which a 5×3 feature seldom deals; 4 makes
				// the pays check below compare real wins rather than two empty lists.
				...(winModel === 'scatter' ? { minCount: 4 } : {}),
				...extra,
			}) as MockHandle,
		);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const res = await realFetch(input, init);
		if (String(init?.body ?? '').includes('"bet"')) betResponses.push(await res.clone().json());
		return res;
	}) as typeof fetch;

	for (const winModel of ['lines', 'ways', 'cluster', 'scatter']) {
		const table = await linesMock(winModel, { seed: 'lines-buy', betModes: modes });
		// A table game answers config only when asked, and prices only a session that asked.
		const heartbeat = await postEngine(table.rgsUrl, `cfg-${winModel}`, 0, []);
		assert(`${winModel}: a heartbeat carries no config`, heartbeat.events?.some((e) => e.event === 'config'), false); // prettier-ignore
		const unasked = await postEngine(table.rgsUrl, `cfg-${winModel}`, 0, [
			{ action: 'bet', context: [0, 10] },
		]);
		assert(`${winModel}: a session that never asked is refused`, !!unasked.error && betTotal(unasked) === undefined, true); // prettier-ignore
		const cfg = (
			await postEngine(table.rgsUrl, `cfg-${winModel}`, 0, [{ action: 'config' }])
		).events?.find((e) => e.event === 'config')?.context;
		const unit = winModel === 'lines' ? (cfg?.paylines as unknown[]).length : 1;
		assert(
			`${winModel}: declares betOptions`,
			JSON.stringify(cfg?.betOptions),
			JSON.stringify([unit, unit * 100, unit * 1.25]),
		);
		const refused = await postEngine(table.rgsUrl, `cfg-${winModel}`, 0, [
			{ action: 'bet', context: [3, 10] },
		]);
		assert(`${winModel}: refuses option 3`, !!refused.error && betTotal(refused) === undefined, true); // prettier-ignore

		await requestAuthenticate({ sessionID: `menu-${winModel}`, rgsUrl: table.rgsUrl, language: 'en' }); // prettier-ignore
		const offered = (
			globalThis as { __IE_SERVER_BET_OPTIONS__?: { key: string; costMultiplier: number }[] }
		).__IE_SERVER_BET_OPTIONS__;
		assert(`${winModel}: menu`, offered?.map((o) => o.key).join(','), 'BASE,BONUS,ANTE');
		for (const amount of [1, 0.4]) {
			for (const option of offered ?? []) {
				const sid = `card-${winModel}-${option.key}-${amount}`;
				await requestAuthenticate({ sessionID: sid, rgsUrl: table.rgsUrl, language: 'en' });
				betResponses.length = 0;
				await requestBet({ sessionID: sid, currency: 'USD', amount, mode: option.key, rgsUrl: table.rgsUrl }); // prettier-ignore
				await requestEndRound({ sessionID: sid, rgsUrl: table.rgsUrl });
				const cardCents = Math.round(amount * option.costMultiplier * 100);
				const first = betResponses[0] ?? {};
				assert(`${winModel}: $${amount} ${option.key} card $${cardCents / 100} is debited`, betTotal(first), cardCents); // prettier-ignore
				const entered = !!first.events?.some((e) => e.event === 'enterBonus');
				if (option.key === 'BONUS') assert(`${winModel}: $${amount} BONUS enters the feature`, entered, true); // prettier-ignore
			}
		}
		table.server.close();

		// Priced on the BASE stake: the same seed bought and force-triggered deals the same feature,
		// and every pay in it must match to the cent. Pricing off the round total would pay the buy
		// 100× over.
		const seed = `lines-buy-pays-${winModel}`;
		const bought = await linesMock(winModel, { seed, betModes: modes });
		const buyPays = await playRoundRaw(bought.rgsUrl, 'pays', [1, 10]);
		bought.server.close();
		const forced = await linesMock(winModel, { seed, betModes: modes, forceTrigger: true });
		const basePays = await playRoundRaw(forced.rgsUrl, 'pays', [0, 10]);
		forced.server.close();
		assert(`${winModel}: the bought feature paid something`, buyPays.pays.length > 0, true);
		assert(`${winModel}: bought feature pays = base-triggered pays`, buyPays.pays.join(' '), basePays.pays.join(' ')); // prettier-ignore
	}

	// A project that sells nothing stays a LINE-CONFIG game: no table, `[lines, betPerLine]`.
	const lineConfig = await linesMock('lines', { seed: 'line-config' });
	const plain = await postEngine(lineConfig.rgsUrl, 'plain', 0, [{ action: 'bet', context: [5, 20] }]); // prettier-ignore
	assert('line-config: no betOptions declared', JSON.stringify(plain.events?.find((e) => e.event === 'config')?.context.betOptions), undefined); // prettier-ignore
	assert('line-config: [5, 20] costs 100', betTotal(plain), 100);
	lineConfig.server.close();

	// ---- Part 5: a tab open while its game gains or loses a table keeps the shape it booted with ----
	// The test server rebuilds a game's mock when its contract changes (`carrySession`), and the facade
	// keeps the first config it saw. Measured before the pin: a $1 base spin on a ways game that had
	// just gained a buy went out as `[1, 100]` and was charged 10000 as the buy.
	const waysMock = (withTable: boolean) =>
		createLinesMock({
			label: 'buycost-swap',
			startBalance: 1_000_000_000,
			quiet: true,
			winModel: 'ways',
			seed: 'swap',
			...(withTable ? { betModes: modes } : {}),
		}) as MockHandle;
	const spinBase = async (rgsUrl: string, sid: string) => {
		betResponses.length = 0;
		await requestBet({ sessionID: sid, currency: 'USD', amount: 1, mode: 'BASE', rgsUrl });
		await requestEndRound({ sessionID: sid, rgsUrl });
		return betResponses[0] ?? {};
	};

	const gains = await serve(waysMock(false));
	await requestAuthenticate({ sessionID: 'gains', rgsUrl: gains.rgsUrl, language: 'en' });
	gains.swap(waysMock(true), true);
	const staleGain = await spinBase(gains.rgsUrl, 'gains');
	assert("gains a buy: an open tab's $1 base spin costs $1", betTotal(staleGain), 100);
	assert('...and does not buy the feature', !!staleGain.events?.some((e) => e.event === 'enterBonus'), false); // prettier-ignore
	// A reload's balance probe carries no config, so it asks for one and is re-pinned to the table.
	const probe = await postEngine(gains.rgsUrl, 'gains', 0, []);
	assert('...a reload\'s balance probe carries no config', probe.events?.some((e) => e.event === 'config'), false); // prettier-ignore
	const asked = await postEngine(gains.rgsUrl, 'gains', 0, [{ action: 'config' }]);
	const askedCfg = asked.events?.find((e) => e.event === 'config')?.context;
	assert('...its config probe gets the table', JSON.stringify(askedCfg?.betOptions), '[1,100,1.25]'); // prettier-ignore
	const repinned = await postEngine(gains.rgsUrl, 'gains', 0, [{ action: 'bet', context: [1, 2] }]);
	assert('...and it is priced by it from then on', betTotal(repinned), 200);
	gains.server.close();

	// A restart loses every session, pins included. The stale tab heartbeats (as it does every 30s)
	// into a new session, and must be refused rather than priced by a table it never saw — measured
	// before this, the buy price: 10000 for a $1 base spin.
	const restarted = await serve(waysMock(false));
	await requestAuthenticate({ sessionID: 'restarted', rgsUrl: restarted.rgsUrl, language: 'en' });
	restarted.restart(waysMock(true));
	await postEngine(restarted.rgsUrl, 'restarted', 0, []);
	const afterRestart = await spinBase(restarted.rgsUrl, 'restarted');
	assert('restart: a stale tab\'s bet is refused, not charged', !!afterRestart.error && betTotal(afterRestart) === undefined, true); // prettier-ignore
	const untouched = await postEngine(restarted.rgsUrl, 'restarted', 0, []);
	assert('...and its wallet is untouched', untouched.platform?.balance, 1_000_000_000);
	restarted.server.close();

	const loses = await serve(waysMock(true));
	await requestAuthenticate({ sessionID: 'loses', rgsUrl: loses.rgsUrl, language: 'en' });
	loses.swap(waysMock(false), true);
	assert('loses its buy: an open tab\'s $1 base spin costs $1', betTotal(await spinBase(loses.rgsUrl, 'loses')), 100); // prettier-ignore
	loses.server.close();

	// A desktop build keeps what it always had: the next heartbeat re-sends the config.
	const desktop = await serve(waysMock(false));
	await requestAuthenticate({ sessionID: 'desktop', rgsUrl: desktop.rgsUrl, language: 'en' });
	desktop.swap(waysMock(false), false);
	const resent = await postEngine(desktop.rgsUrl, 'desktop', 0, []);
	assert('desktop build: the next heartbeat re-sends the config', resent.events?.some((e) => e.event === 'config'), true); // prettier-ignore
	desktop.server.close();
	globalThis.fetch = realFetch;

	console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
	process.exit(failures === 0 ? 0 : 1);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
