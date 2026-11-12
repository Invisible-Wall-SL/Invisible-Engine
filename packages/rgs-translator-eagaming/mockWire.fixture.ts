/**
 * Every outcome a mock deals, driven through the REAL facade: the lines mock, the book mock and the
 * partner-wire collector mock (Getting Hot), each behind its own HTTP server, each played the way the
 * game plays it (`requestBet`, then `requestEndRound` while the round is open). The mocks stand in for
 * the partner's server, so a facade path no fixture walks is a partner bug waiting for a live session:
 * Getting Hot's line wins paid but never animated because no round with a line win had ever been
 * pushed through the collector rewrite (#1634).
 *
 * Per mock, one round of each outcome it deals — losing, line win, base-game collect, trigger,
 * retrigger, buy — found by playing a seeded mock until the wire shows it. For every round:
 *  - each board whose answer pays a `spinWin` gets exactly one `winInfo`, after that board's reveal
 *    and before the next board's, with one win per paying `spinWin`; a board that pays none gets none;
 *  - every event keeps its ordinal index, and no wire event leaks through untranslated.
 * Then the outcome's own shape: the free-spin intro, counter and outro; one `freeSpinRetrigger` per
 * retrigger — also when the server sends only the partner's `spinTrigger` and none of our `retrigger`
 * (`docs/reference/play4fun-protocol.md`, "Mock audit"); the instant collect; the respin feature.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/mockWire.fixture.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createMockRgs as createBookMock } from '../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createPartnerMock } from '../../scripts/mock-rgs-server-holdandwin-partner.mjs';
import { createMockRgs as createLinesMock } from '../../scripts/mock-rgs-server.mjs';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; index?: number; [key: string]: unknown };
type WireEvent = { event: string; context?: unknown };
type Answer = { round?: { state?: BookEvent[]; active?: boolean } };
type Mock = { handle: (req: IncomingMessage, res: ServerResponse, url: URL) => void };
type BetOption = { key: string; index: number; costMultiplier: number };

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
const realError = console.error.bind(console);
const hush = async <T>(fn: () => Promise<T>): Promise<T> => {
	console.log = () => {};
	console.warn = () => {};
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
		console.error = realError;
	}
};

/** A mock behind a real server. `rewrite` edits each answer's events, and `answers` logs them. */
const serve = async (mock: Mock, rewrite: (events: WireEvent[]) => WireEvent[] = (e) => e) => {
	const answers: WireEvent[][] = [];
	const sent: { action: string; context?: unknown }[][] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		const writeHead = res.writeHead.bind(res);
		const end = res.end.bind(res) as (text?: string) => ServerResponse;
		let head: [number, Record<string, unknown>] = [200, {}];
		const hold = res as unknown as {
			writeHead: (status: number, headers?: Record<string, unknown>) => ServerResponse;
			end: (text?: string) => ServerResponse;
		};
		hold.writeHead = (status, headers = {}) => {
			head = [status, headers];
			return res;
		};
		hold.end = (text?: string) => {
			let out = text;
			const body = text && req.url?.includes('/rgs/engine') ? JSON.parse(text) : null;
			if (body && Array.isArray(body.events)) {
				body.events = rewrite(body.events as WireEvent[]);
				answers.push(body.events);
				const raw = Buffer.concat(chunks).toString('utf8');
				sent.push(raw ? JSON.parse(raw) : []);
				out = JSON.stringify(body);
			}
			const headers = Object.fromEntries(
				Object.entries(head[1]).filter(([key]) => key.toLowerCase() !== 'content-length'),
			);
			writeHead(head[0], headers as Record<string, string>);
			return end(out);
		};
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`));
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	return {
		rgsUrl: `localhost:${typeof address === 'object' && address ? address.port : 0}`,
		answers,
		sent,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};

let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?wire=${++tabs}`);

type Played = { book: BookEvent[]; wire: WireEvent[][]; active: boolean; bet: unknown };

/** A table: one game played round by round, as the game plays it. */
const table = async (
	mock: Mock,
	amount: number,
	rewrite?: (events: WireEvent[]) => WireEvent[],
) => {
	const at = await serve(mock, rewrite);
	const facade = await openTab();
	const sid = `wire-${tabs}`;
	await hush(() =>
		facade.requestAuthenticate({ sessionID: sid, rgsUrl: at.rgsUrl, language: 'en' }),
	);
	const options =
		(globalThis as { __IE_SERVER_BET_OPTIONS__?: BetOption[] }).__IE_SERVER_BET_OPTIONS__ ?? [];
	const play = async (mode = 'BASE'): Promise<Played> => {
		const from = at.answers.length;
		const answer = (await hush(() =>
			facade.requestBet({ sessionID: sid, currency: 'USD', amount, mode, rgsUrl: at.rgsUrl }),
		)) as Answer;
		const active = Boolean(answer.round?.active);
		if (active) await hush(() => facade.requestEndRound({ sessionID: sid, rgsUrl: at.rgsUrl }));
		// The round's answers from its `bet` on: the facade may send a heartbeat or `config` first.
		const opened = at.sent.findIndex((body, i) => i >= from && body[0]?.action === 'bet');
		const wire = opened < 0 ? [] : at.answers.slice(opened);
		const bet = opened < 0 ? undefined : at.sent[opened][0].context;
		return { book: answer.round?.state ?? [], wire, active, bet };
	};
	return { play, options, close: at.close };
};

const names = (events: WireEvent[]) => events.map((e) => e.event);
const paying = (events: WireEvent[]) =>
	events.filter((e) => e.event === 'spinWin' && ((e.context as { pay?: number })?.pay ?? 0) > 0);
/** A free-spin retrigger on the wire: a `spinTrigger` once the feature has been entered. */
const retriggersOf = (wire: WireEvent[][]) => {
	const all = wire.flat();
	const entered = names(all).indexOf('enterBonus');
	return entered < 0 ? [] : all.slice(entered).filter((e) => e.event === 'spinTrigger');
};

/** The claims every round must meet, whatever it dealt. */
const everyRound = (label: string, round: Played) => {
	const { book } = round;
	check(
		`${label}: every event keeps its ordinal index`,
		book.every((e, i) => e.index === i),
		true,
	);
	check(
		`${label}: no wire event leaks through untranslated`,
		book.filter((e) => e.type.startsWith('_')).map((e) => e.type),
		[],
	);
	// Board n is the n-th answer that deals one; each of that answer's `spinWin`s is its own `winInfo`
	// between that board's reveal and the next (a scatter's zero-pay one too: it lights the trigger).
	const boards = round.wire.filter((events) => names(events).includes('playedSpin'));
	const expected = boards.flatMap((events, n) =>
		events.filter((e) => e.event === 'spinWin').map(() => [n, 1]),
	);
	let board = -1;
	const shown: number[][] = [];
	for (const e of book) {
		if (e.type === 'reveal' || e.type === 'respinReveal') board += 1;
		if (e.type === 'winInfo') shown.push([board, (e.wins as unknown[]).length]);
	}
	check(`${label}: a winInfo per spinWin, after its board's reveal`, shown, expected);
	check(`${label}: one reveal per board dealt`, board + 1, boards.length);
};

/** Plays rounds until `wanted` says one is the outcome sought, or gives up after `tries`. */
const find = async (
	play: () => Promise<Played>,
	wanted: (round: Played) => boolean,
	tries: number,
): Promise<Played | null> => {
	for (let i = 0; i < tries; i++) {
		const round = await play();
		if (wanted(round)) return round;
	}
	return null;
};

const first = (round: Played) => names(round.wire[0] ?? []);
const losing = (round: Played) =>
	!round.wire.flat().some((e) => ['spinWin', 'collect', 'enterBonus'].includes(e.event));
const lineWin = (round: Played) =>
	paying(round.wire[0] ?? []).length > 0 &&
	!first(round).includes('enterBonus') &&
	!first(round).includes('collect');
const triggered = (round: Played) => first(round).includes('enterBonus');

/** The free-spin feature, as the lines and book mocks deal it. */
const freeSpinChecks = (label: string, round: Played) => {
	const types = round.book.map((e) => e.type);
	const counters = round.wire.flat().filter((e) => e.event === 'playedBonusSpin').length;
	check(`${label}: one intro`, types.filter((t) => t === 'freeSpinTrigger').length, 1);
	check(
		`${label}: one counter per free spin`,
		types.filter((t) => t === 'updateFreeSpin').length,
		counters,
	);
	check(`${label}: one outro`, types.filter((t) => t === 'freeSpinEnd').length, 1);
	const retriggers = retriggersOf(round.wire).map((e) => {
		const spins = (e.context as { spins?: { spins: number }[] }).spins ?? [];
		return spins.reduce((sum, s) => sum + s.spins, 0);
	});
	check(
		`${label}: one freeSpinRetrigger per retrigger, with its spins`,
		round.book.filter((e) => e.type === 'freeSpinRetrigger').map((e) => e.extraFs),
		retriggers,
	);
};

/** The free-spin outcomes of the lines or the book mock. */
const slotOutcomes = async (
	label: string,
	make: (opts: Record<string, unknown>) => Mock,
	buyOpts: Record<string, unknown>,
) => {
	const base = await table(make({}), 1);
	const lose = await find(base.play, losing, 50);
	check(`${label} losing: found`, Boolean(lose), true);
	if (lose) {
		everyRound(`${label} losing`, lose);
		check(
			`${label} losing: no win shown`,
			lose.book.some((e) => e.type === 'winInfo'),
			false,
		);
	}
	const win = await find(base.play, lineWin, 100);
	check(`${label} line win: found`, Boolean(win), true);
	if (win) everyRound(`${label} line win`, win);
	await base.close();

	const forced = await table(make({ forceTrigger: true }), 1);
	const trigger = await find(forced.play, triggered, 5);
	check(`${label} trigger: found`, Boolean(trigger), true);
	if (trigger) {
		everyRound(`${label} trigger`, trigger);
		freeSpinChecks(`${label} trigger`, trigger);
	}
	const retrigger = await find(forced.play, (r) => retriggersOf(r.wire).length > 0, 60);
	check(`${label} retrigger: found`, Boolean(retrigger), true);
	if (retrigger) {
		everyRound(`${label} retrigger`, retrigger);
		freeSpinChecks(`${label} retrigger`, retrigger);
	}
	await forced.close();

	// The partner's shape: a retrigger is its `spinTrigger` alone. Same seed, so the same rounds.
	const partnerShape = await table(make({ forceTrigger: true }), 1, (events) =>
		events.filter((e) => e.event !== 'retrigger'),
	);
	const bare = await find(partnerShape.play, (r) => retriggersOf(r.wire).length > 0, 60);
	check(`${label} retrigger, spinTrigger only: found`, Boolean(bare), true);
	if (bare) {
		everyRound(`${label} retrigger, spinTrigger only`, bare);
		freeSpinChecks(`${label} retrigger, spinTrigger only`, bare);
		check(
			`${label} retrigger, spinTrigger only: the same celebration as with ours`,
			bare.book.filter((e) => e.type === 'freeSpinRetrigger'),
			retrigger?.book.filter((e) => e.type === 'freeSpinRetrigger'),
		);
	}
	await partnerShape.close();

	const shop = await table(make(buyOpts), 1);
	const buy = shop.options.find((o) => o.costMultiplier > 1);
	check(`${label} buy: the boot names a buy option`, Boolean(buy), true);
	if (buy) {
		const bought = await shop.play(buy.key);
		check(`${label} buy: bet sent as the option index`, (bought.bet as number[])?.[0], buy.index);
		check(`${label} buy: enters the feature`, triggered(bought), true);
		everyRound(`${label} buy`, bought);
		freeSpinChecks(`${label} buy`, bought);
	}
	await shop.close();
};

console.log('1. the lines mock');
await slotOutcomes(
	'lines',
	(opts) =>
		createLinesMock({ label: 'wire', seed: 'mock-wire', quiet: true, startBalance: 1e9, ...opts }),
	{
		betModes: [
			{ mode: 'base', cost: 1, kind: 'base' },
			{ mode: 'bonus', cost: 100, kind: 'buy' },
		],
	},
);

console.log('2. the book mock');
await slotOutcomes(
	'book',
	(opts) => createBookMock({ label: 'wire', seed: 'mock-wire', startBalance: 1e9, ...opts }),
	{},
);

console.log('3. the partner-wire collector mock (Getting Hot)');
{
	const partner = await table(
		createPartnerMock({ quiet: true, seed: 'mock-wire', startBalance: 1e9 }) as Mock,
		0.4,
	);
	const lose = await find(partner.play, losing, 50);
	check('collector losing: found', Boolean(lose), true);
	if (lose) {
		everyRound('collector losing', lose);
		check('collector losing: closed in its own batch', lose.active, false);
	}
	const win = await find(partner.play, lineWin, 200);
	check('collector line win: found', Boolean(win), true);
	if (win) {
		everyRound('collector line win', win);
		const types = win.book.map((e) => e.type);
		check(
			'collector line win: its winInfo follows the reveal',
			types.indexOf('winInfo'),
			types.indexOf('reveal') + 1,
		);
	}
	const collect = await find(
		partner.play,
		(r) => first(r).includes('collect') && !triggered(r),
		400,
	);
	check('collector base-game collect: found', Boolean(collect), true);
	if (collect) {
		everyRound('collector base-game collect', collect);
		const types = collect.book.map((e) => e.type);
		check(
			'collector base-game collect: one instant collect',
			types.filter((t) => t === 'coinInstantCollect').length,
			1,
		);
		check('collector base-game collect: no feature', types.includes('holdAndWinTrigger'), false);
		check('collector base-game collect: held open for our collect', collect.active, true);
	}
	const respinChecks = (label: string, round: Played) => {
		everyRound(label, round);
		const types = round.book.map((e) => e.type);
		check(`${label}: one respin feature`, types.filter((t) => t === 'holdAndWinTrigger').length, 1);
		check(`${label}: it ends`, types.filter((t) => t === 'holdAndWinEnd').length, 1);
		check(
			`${label}: one respin board per respin answer`,
			types.filter((t) => t === 'respinReveal').length,
			round.wire.slice(1).filter((events) => names(events).includes('playedSpin')).length,
		);
		check(`${label}: not presented as free spins`, types.includes('freeSpinTrigger'), false);
	};
	const natural = await find(partner.play, triggered, 600);
	check('collector natural trigger: found', Boolean(natural), true);
	if (natural) respinChecks('collector natural trigger', natural);
	for (const key of ['BUYCENTERCOIN', 'GOLDSTRIKE']) {
		const option = partner.options.find((o) => o.key === key);
		check(`collector ${key}: the boot names it`, Boolean(option), true);
		if (!option) continue;
		const bought = await partner.play(key);
		check(
			`collector ${key}: bet sent as the option index`,
			(bought.bet as number[])?.[0],
			option.index,
		);
		if (triggered(bought)) respinChecks(`collector ${key}`, bought);
		else everyRound(`collector ${key}`, bought);
	}
	await partner.close();
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
