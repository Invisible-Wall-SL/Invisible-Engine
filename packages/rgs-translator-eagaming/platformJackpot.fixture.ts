/**
 * The operator platform jackpot through the facade (`engineFacade.ts`, design `hold-and-win.md` §7
 * 11c): the REAL facade against the REAL book mock wrapped by `mock-platform-jackpot.mjs`. Pins what
 * the engine is handed — the tiers on every answer, the hit as a `platformJackpotWin` after the round's
 * own wins, its money held out of every shown balance until released — and that a server with no
 * platform jackpot is answered exactly as before.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/platformJackpot.fixture.ts
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createMockRgs } from '../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import {
	HOLD_AND_WIN_PRESETS,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
} from '../game-config/index.ts';
import { createPlatformJackpot } from '../../scripts/mock-platform-jackpot.mjs';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; [key: string]: unknown };
type Answer = { balance?: { amount: number }; round?: { state?: BookEvent[] } };
type Level = { name: string; value: number };
type Globals = {
	__IE_PLATFORM_JACKPOTS__?: Level[];
	__IE_PLATFORM_JACKPOT_RELEASE__?: () => number;
};

let failures = 0;
let passes = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const realLog = console.log.bind(console);
const realWarn = console.warn.bind(console);
const hush = async <T>(fn: () => T | Promise<T>): Promise<T> => {
	console.log = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
};

let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);
const globals = globalThis as Globals;

type Handle = (req: IncomingMessage, res: ServerResponse, url: URL) => unknown;

/** The 3 Pots mock (`holdAndWin`), every round forced into the respin feature. */
const holdAndWinMock = () => {
	const doc = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots)!;
	return createHoldAndWinMock({
		label: 'pj-fixture-hnw',
		quiet: true,
		seed: 'pj-fixture-hnw',
		force: 'trigger',
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		paylines: Object.values(doc.paylines),
		holdAndWin: holdAndWinMockInputs(doc),
	});
};

const start = async (opts: { platform: boolean; forceTrigger?: boolean; holdAndWin?: boolean }) => {
	const mock = opts.holdAndWin
		? holdAndWinMock()
		: createMockRgs({
				label: 'pj-fixture',
				seed: 'pj-fixture',
				forceTrigger: opts.forceTrigger,
			});
	const platform = opts.platform ? createPlatformJackpot() : null;
	const handle: Handle = (req, res, url) =>
		platform ? platform.handle(req, res, url, mock.handle) : mock.handle(req, res, url);
	const server: Server = createServer((req, res) =>
		handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const hold = (sid: string, tier: string, when = '') =>
		fetch(`http://localhost:${port}/platformJackpot?sid=${sid}&hit=${tier}${when}`);
	return {
		rgsUrl: `localhost:${port}`,
		hold,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};

const bet = (facade: Facade, sessionID: string, rgsUrl: string) =>
	facade.requestBet({
		sessionID,
		currency: 'USD',
		amount: 1,
		mode: 'BASE',
		rgsUrl,
	}) as Promise<Answer>;

const types = (answer: Answer) => (answer.round?.state ?? []).map((e) => e.type);

// ---- parity: no platform jackpot ⇒ nothing published, nothing held, the same book ----
{
	delete globals.__IE_PLATFORM_JACKPOTS__;
	const plain = await hush(() => start({ platform: false }));
	const tab = await openTab();
	const answer = await hush(async () => {
		await tab.requestAuthenticate({ sessionID: 'plain', rgsUrl: plain.rgsUrl, language: 'en' });
		return bet(tab, 'plain', plain.rgsUrl);
	});
	check(
		'parity: no platform jackpot publishes no tiers',
		globals.__IE_PLATFORM_JACKPOTS__,
		undefined,
	);
	check(
		'parity: no platform jackpot puts no beat in the book',
		types(answer).includes('platformJackpotWin'),
		false,
	);
	check('parity: nothing is held to release', globals.__IE_PLATFORM_JACKPOT_RELEASE__?.(), 0);
	await plain.close();

	// The same seed with the platform on and no hit: the engine is handed the same round.
	const wrapped = await hush(() => start({ platform: true }));
	const tab2 = await openTab();
	const twin = await hush(async () => {
		await tab2.requestAuthenticate({ sessionID: 'plain', rgsUrl: wrapped.rgsUrl, language: 'en' });
		return bet(tab2, 'plain', wrapped.rgsUrl);
	});
	const strip = (a: Answer) => JSON.stringify({ balance: a.balance, state: a.round?.state });
	check(
		'parity: with the platform on and no hit, the book and balance are unchanged',
		strip(twin),
		strip(answer),
	);
	await wrapped.close();
}

// ---- a base-game hit ----
{
	const g = await hush(() => start({ platform: true }));
	const tab = await openTab();
	const sid = 'hit';
	await hush(() => tab.requestAuthenticate({ sessionID: sid, rgsUrl: g.rgsUrl, language: 'en' }));
	const boot = globals.__IE_PLATFORM_JACKPOTS__;
	check(
		'the boot answer publishes every tier, in engine money units',
		boot?.map((t) => [t.name, t.value]),
		[
			['Mini', 1_000 * 10_000],
			['Minor', 5_000 * 10_000],
			['Major', 50_000 * 10_000],
			['Grand', 500_000 * 10_000],
		],
	);
	const before =
		(await hush(() => tab.requestBalance({ sessionID: sid, rgsUrl: g.rgsUrl }))).balance?.amount ??
		0;
	check('a heartbeat republishes the tiers', Array.isArray(globals.__IE_PLATFORM_JACKPOTS__), true);

	await g.hold(sid, 'Grand');
	const answer = await hush(() => bet(tab, sid, g.rgsUrl));
	const state = answer.round?.state ?? [];
	const win = state.find((e) => e.type === 'platformJackpotWin');
	check('the hit reaches the book as platformJackpotWin, named by tier', win?.tier, 'Grand');
	check(
		'…after every event the round itself presents, before the round closes',
		types(answer).indexOf('platformJackpotWin'),
		types(answer).includes('finalWin') ? types(answer).indexOf('finalWin') - 1 : state.length - 1,
	);
	const held = globals.__IE_PLATFORM_JACKPOTS__ && (win?.amount as number);
	const end = await hush(() => tab.requestEndRound({ sessionID: sid, rgsUrl: g.rgsUrl }));
	const final = end.balance?.amount ?? 0;
	const roundDelta = final - before;
	check('the final balance carries the jackpot win', roundDelta > 0, true);
	check(
		'the shown interim balance holds the jackpot win back',
		final - (answer.balance?.amount ?? 0) >= 0 && (answer.balance?.amount ?? 0) < before,
		true,
	);
	const pollHeld = (await hush(() => tab.requestBalance({ sessionID: sid, rgsUrl: g.rgsUrl })))
		.balance?.amount;
	const released = globals.__IE_PLATFORM_JACKPOT_RELEASE__?.() ?? 0;
	check(
		'the release answers the held money (the win the platform paid)',
		released > 0 && released === final - (pollHeld ?? 0),
		true,
	);
	const pollAfter = (await hush(() => tab.requestBalance({ sessionID: sid, rgsUrl: g.rgsUrl })))
		.balance?.amount;
	check('once released, a heartbeat shows the whole balance', pollAfter, final);
	check('a second release holds nothing', globals.__IE_PLATFORM_JACKPOT_RELEASE__?.(), 0);
	check(
		'the beat amount is book units (a positive win)',
		typeof held === 'number' && held > 0,
		true,
	);
	await g.close();
}

// ---- a hit inside free spins still plays outside the feature ----
{
	const g = await hush(() => start({ platform: true, forceTrigger: true }));
	const tab = await openTab();
	const sid = 'fs';
	await hush(() => tab.requestAuthenticate({ sessionID: sid, rgsUrl: g.rgsUrl, language: 'en' }));
	await g.hold(sid, 'Major', '&when=feature');
	const answer = await hush(() => bet(tab, sid, g.rgsUrl));
	const order = types(answer);
	check('a free-spin round with a hit has its beat', order.includes('platformJackpotWin'), true);
	check(
		'…after the feature has ended',
		order.indexOf('platformJackpotWin') > order.lastIndexOf('freeSpinEnd') &&
			order.lastIndexOf('freeSpinEnd') !== -1,
		true,
	);
	check(
		'…and it is the held tier',
		answer.round?.state?.find((e) => e.type === 'platformJackpotWin')?.tier,
		'Major',
	);
	globals.__IE_PLATFORM_JACKPOT_RELEASE__?.();
	await hush(() => tab.requestEndRound({ sessionID: sid, rgsUrl: g.rgsUrl }));
	await g.close();
}

// ---- a hit inside a Hold and Win respin plays after the feature's end ----
{
	const g = await hush(() => start({ platform: true, holdAndWin: true }));
	const tab = await openTab();
	const sid = 'hnw';
	await hush(() => tab.requestAuthenticate({ sessionID: sid, rgsUrl: g.rgsUrl, language: 'en' }));
	await g.hold(sid, 'Minor', '&when=feature');
	const answer = await hush(() => bet(tab, sid, g.rgsUrl));
	const order = types(answer);
	check(
		'a respin with a hit puts the beat in the book',
		order.includes('platformJackpotWin'),
		true,
	);
	check(
		'…after the respin feature has ended',
		order.lastIndexOf('holdAndWinEnd') !== -1 &&
			order.indexOf('platformJackpotWin') > order.lastIndexOf('holdAndWinEnd'),
		true,
	);
	check(
		'…as the held tier',
		answer.round?.state?.find((e) => e.type === 'platformJackpotWin')?.tier,
		'Minor',
	);
	check('…with its money held', (globals.__IE_PLATFORM_JACKPOT_RELEASE__?.() ?? 0) > 0, true);
	await hush(() => tab.requestEndRound({ sessionID: sid, rgsUrl: g.rgsUrl }));
	await g.close();
}

console.log(
	failures === 0
		? `${passes} platform jackpot facade checks passed, 0 failed.`
		: `${failures} platform jackpot facade check(s) FAILED (${passes} passed).`,
);
process.exit(failures === 0 ? 0 : 1);
