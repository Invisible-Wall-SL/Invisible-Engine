/**
 * Offline fixture for the transport on a bad connection. Run it with node:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/connection.fixture.ts
 *
 * Drives the REAL fetcher (and, at the end, the real facade) against the REAL mocks, with a fetch in
 * between that loses requests the way a network does. The money rule over all of it: a request is
 * charged, dealt and credited ONCE however many times it is sent.
 *
 *  1. A HANG is abandoned and resent at the same `seq`; the position moves once.
 *  2. A 5xx and an EMPTY 200 are resent; a refusal is not.
 *  3. A DROPPED ANSWER INSIDE A ROUND is resent under its `gid` and REPLAYED — a free spin is not
 *     re-dealt, a `collect` is not credited twice, even after it closed the round.
 *  4. A DROPPED ANSWER TO THE BET THAT OPENS A ROUND: a round the server holds OPEN is replayed under
 *     its `gid`; anything else is NOT resent — the server may still take it, or have settled it on
 *     the spot — so the transport gives up and the player reloads. A closed round a probe or a poll
 *     names is never taken for the new bet's.
 *  5. OFFLINE sends nothing and waits for the network; ONLINE resumes at once.
 *  6. GIVING UP: bounded, reported, the position unmoved, and every later request refused.
 *  7. ONE AT A TIME: requests on a session never overtake each other; a poll never queues behind one.
 *  8. THE FACADE over all of it: a spin whose answer is lost presents the round the server dealt.
 *  9. "NO COLLECT" IS A LOSING SPIN: in the partner's no-auto-collect mode a zero-win round is
 *     closed by the server in the bet's own answer, so there is nothing to collect — the partner's
 *     client sends none either. Every round still ends closed on the server, to the cent.
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs as createBookMock } from '../../scripts/mock-rgs-server-book.mjs';
import {
	createPlay4FunFetcher,
	type Play4FunConnectionState,
	type Play4FunResendPolicy,
} from './src/eagamingFetcher.ts';
import { createPlay4FunSessionState } from './src/sessionState.ts';
import type { Play4FunRequestBody, Play4FunResponse } from './src/types.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

// ---------- a browser's network, in node ----------

let online = true;
const windowEvents = new EventTarget();
Object.assign(globalThis, {
	addEventListener: windowEvents.addEventListener.bind(windowEvents),
	removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
});
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });
const goOnline = () => {
	online = true;
	windowEvents.dispatchEvent(new Event('online'));
};

// ---------- servers ----------

type MockSession = { balance: number; round: { id: string } | null };
const serve = async (mock: ReturnType<typeof createBookMock>) => {
	const server: Server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	return {
		server,
		base: `http://localhost:${typeof address === 'object' && address ? address.port : 0}`,
		held: (sid: string): MockSession => mock.sessions.get(sid),
	};
};

const START = 1_000_000;
// Partner mode: a winning base round stays open until `collect`, a losing one closes itself.
const partner = await serve(
	createBookMock({ label: 'partner', seed: 'conn', autoCollect: false, startBalance: START }),
);
const partnerWins = await serve(
	createBookMock({
		label: 'partner-win',
		seed: 'conn',
		bigWin: true,
		autoCollect: false,
		startBalance: START,
	}),
);
// Our own test server's default: every round closes in the bet's own answer.
const autoCollect = await serve(
	createBookMock({ label: 'auto', seed: 'conn', bigWin: true, startBalance: START }),
);

// ---------- a lossy network ----------

type Fault =
	| 'pass'
	| 'hang'
	| 'hang-after'
	| 'late'
	| 'drop-before'
	| 'drop-after'
	| '503'
	| 'empty';
interface Wire {
	faults: Fault[];
	sent: string[];
	fetchImpl: typeof fetch;
}
const wire = (...faults: Fault[]): Wire => {
	const w: Wire = { faults, sent: [], fetchImpl: fetch };
	w.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const body = JSON.parse(String(init?.body ?? '[]')) as { action: string }[];
		const fault = w.faults.shift() ?? 'pass';
		w.sent.push(
			`${url.searchParams.get('seq')}${url.searchParams.get('gid') ? 'g' : ''}:${body.map((a) => a.action).join('+') || '[]'}${fault === 'pass' ? '' : `(${fault})`}`,
		);
		switch (fault) {
			case 'hang-after':
				await fetch(input, { ...init, signal: undefined });
				return new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError')),
					),
				);
			case 'hang':
				return new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError')),
					),
				);
			case 'late':
				setTimeout(
					() => void fetch(input, { ...init, signal: undefined }).catch(() => undefined),
					250,
				);
				throw new TypeError('network error');
			case 'drop-before':
				throw new TypeError('network error');
			case 'drop-after':
				await fetch(input, { ...init, signal: undefined });
				throw new TypeError('network error');
			case '503':
				return new Response('upstream unavailable', { status: 503 });
			case 'empty':
				return new Response('', { status: 200 });
			default:
				return fetch(input, init);
		}
	}) as typeof fetch;
	return w;
};

const FAST: Play4FunResendPolicy = { attemptTimeoutMs: 150, resendDelayMs: 20, giveUpAfterMs: 600 };

let sids = 0;
const harness = (base: string, w: Wire, policy: Partial<Play4FunResendPolicy> = FAST) => {
	const sid = `S-conn-${++sids}`;
	const session = createPlay4FunSessionState(sid);
	const states: string[] = [];
	const fetcher = createPlay4FunFetcher(
		{
			baseUrl: base,
			sid,
			fetchImpl: w.fetchImpl,
			resendPolicy: policy,
			onConnection: (s: Play4FunConnectionState) => states.push(s.state),
		},
		session,
	);
	return {
		sid,
		session,
		states,
		post: (body: Play4FunRequestBody, resend?: boolean) => fetcher.post({ body, resend }),
	};
};

const BET_PLAY: Play4FunRequestBody = [
	{ action: 'bet', context: [0, 10] },
	{ action: 'play', context: '' },
];
const BUY: Play4FunRequestBody = [
	{ action: 'bet', context: [1, 10] },
	{ action: 'play', context: '' },
];
const PLAY: Play4FunRequestBody = [{ action: 'play' }];
const COLLECT: Play4FunRequestBody = [{ action: 'collect' }];
const board = (r: Play4FunResponse | null) =>
	JSON.stringify(r?.events?.find((e) => e.event === 'playedSpin')?.context);
const names = (r: Play4FunResponse | null) => (r?.events ?? []).map((e) => e.event);
const rejection = (p: Promise<unknown>) =>
	p.then(
		() => 'resolved',
		(err: Error & { reason?: string }) => `${err.name}:${err.reason ?? ''}`,
	);

console.log('\n1. a hang is abandoned and resent at the same seq');
{
	const w = wire('pass', 'pass', 'hang');
	const h = harness(partner.base, w);
	await h.post([]);
	await h.post(BUY);
	const spin = await h.post(PLAY);
	check(
		'the free spin answered after the resend',
		names(spin.response).includes('playedSpin'),
		true,
	);
	check('…sent twice at 2, under the round', w.sent.slice(2), ['2g:play(hang)', '2g:play']);
	check('the position moved ONCE', h.session.seq, 3);
	check('the player was told, then told it was back', h.states, ['reconnecting', 'connected']);
}

console.log('\n2. a 5xx and an empty 200 are resent; a refusal is not');
{
	const w = wire('pass', 'pass', '503', 'empty');
	const h = harness(partner.base, w);
	await h.post([]);
	await h.post(BUY);
	const spin = await h.post(PLAY);
	check(
		'answered after a 503 and an empty body',
		names(spin.response).includes('playedSpin'),
		true,
	);
	check('…all three at 2', w.sent.slice(2), ['2g:play(503)', '2g:play(empty)', '2g:play']);
	check('the position moved once', h.session.seq, 3);

	const refusedWire = wire();
	const r = harness(partner.base, refusedWire);
	const refused = await r.post([{ action: 'collect' }]);
	check('a refusal comes back as an answer', typeof refused.response, 'object');
	check('…sent once', refusedWire.sent, ['0:collect']);
	check('…and consumed no position (nothing was stored)', r.session.seq, 0);
}

console.log('\n3. a dropped answer inside a round is REPLAYED, not re-dealt or re-credited');
{
	const w = wire('pass', 'pass', 'drop-after');
	const h = harness(partner.base, w);
	await h.post([]);
	const buy = await h.post(BUY);
	const charged = partner.held(h.sid).balance;
	check('the buy opened a round', !!buy.response?.platform?.gameRound?.id, true);
	const spin = await h.post(PLAY);
	const direct = await fetch(`${partner.base}/rgs/engine?sid=${h.sid}&seq=2&gid=${h.session.gid}`, {
		method: 'POST',
		body: JSON.stringify(PLAY),
	}).then((r) => r.json() as Promise<Play4FunResponse>);
	check('the resend got the board the server dealt at 2', board(spin.response), board(direct));
	check('…and the next spin goes at 3', h.session.seq, 3);
	check('nothing was charged', partner.held(h.sid).balance, charged);

	const c = wire('pass', 'pass', 'drop-after');
	const k = harness(partnerWins.base, c);
	await k.post([]);
	const won = await k.post(BET_PLAY);
	check('a won base round is held open', names(won.response).includes('gameRoundOver'), false);
	const before = partnerWins.held(k.sid).balance;
	const collected = await k.post(COLLECT);
	const win = (won.response?.events?.find((e) => e.event === 'gameEnd')?.context as { win: number })
		.win;
	check('the lost collect is resent under the round', c.sent.slice(2), [
		'2g:collect(drop-after)',
		'2g:collect',
	]);
	check('…into a round the server already CLOSED, and replayed', names(collected.response), [
		'gameRoundOver',
	]);
	check('the win was credited ONCE', partnerWins.held(k.sid).balance, before + win);
	check(
		'the round is closed on both sides',
		[partnerWins.held(k.sid).round, k.session.gid],
		[null, null],
	);
}

console.log('\n4. a dropped answer to the bet that OPENS a round');
{
	const w = wire('pass', 'drop-after');
	const h = harness(partnerWins.base, w);
	await h.post([]);
	const opened = await h.post(BET_PLAY);
	const round = partnerWins.held(h.sid).round;
	check('the server holds the round open, so it is replayed under its gid', w.sent.slice(1), [
		'0:bet+play(drop-after)',
		'0:[]',
		'0g:bet+play',
	]);
	check(
		'…the answer is the round the server dealt',
		opened.response?.platform?.gameRound?.id,
		round?.id,
	);
	check('…charged ONCE', partnerWins.held(h.sid).balance, START - 10 * 10);
	check('…and the collect goes at 2', h.session.seq, 2);

	// A SLOW server: the attempt is given up on, the probe finds nothing — and only then does the bet
	// land. "No open round, balance unchanged" proves nothing while the server may still be working,
	// so the transport must not resend; resending here was a second stake.
	const u = wire('pass', 'pass', 'pass', 'late');
	const n = harness(partnerWins.base, u);
	await n.post([]);
	await n.post(BET_PLAY);
	await n.post(COLLECT);
	const settled = partnerWins.held(n.sid).balance;
	n.session.startRound();
	const slow = await rejection(n.post(BET_PLAY));
	await new Promise((r) => setTimeout(r, 400));
	check('with no open round, a lost opening bet is NOT resent', u.sent.slice(3), [
		'0:bet+play(late)',
		'0:[]',
	]);
	check('…the player is sent to reload', slow, 'Play4FunConnectionError:unresolved');
	check(
		'…and the bet that landed late was charged ONCE',
		partnerWins.held(n.sid).balance,
		settled - 10 * 10,
	);

	// The partner keeps naming a round on `platform.gameRound` after it closed. A probe naming a CLOSED
	// round is not a round the lost bet opened — replaying it would show the player an old spin as
	// this one. Two ways to know: the lane saw it close, or the server does not call it `updating`.
	const probeNaming = (gameRound: () => { id: string; updating?: boolean } | null) => {
		const w = wire('pass', 'pass', 'pass', 'drop-before');
		const real = w.fetchImpl;
		w.fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const response = await real(input, init);
			const named = gameRound();
			if (String(init?.body ?? '') !== '[]' || !named) return response;
			const body = (await response.json()) as Play4FunResponse;
			body.platform = { ...body.platform, gameRound: named } as Play4FunResponse['platform'];
			return new Response(JSON.stringify(body), { status: 200 });
		}) as typeof fetch;
		return w;
	};
	let closedGid: string | null = null;
	const seen = probeNaming(() => (closedGid ? { id: closedGid, updating: true } : null));
	const p = harness(partnerWins.base, seen);
	await p.post([]);
	await p.post(BET_PLAY);
	closedGid = p.session.gid;
	await p.post(COLLECT);
	p.session.startRound();
	await rejection(p.post(BET_PLAY));
	check('a probe naming the round this lane saw close is not replayed', seen.sent.slice(3), [
		'0:bet+play(drop-before)',
		'0:[]',
	]);

	const before = probeNaming(() => (closedGid ? { id: closedGid } : null));
	const q = harness(partnerWins.base, before);
	await q.post([]);
	await q.post(BET_PLAY);
	await q.post(COLLECT);
	q.session.startRound();
	await rejection(q.post(BET_PLAY));
	check('…nor one closed before this boot (not `updating`)', before.sent.slice(3), [
		'0:bet+play(drop-before)',
		'0:[]',
	]);

	// A balance poll answered while a spin waits behind it names the round it last saw. That answer
	// must not bind its `gid` to the new bet, or the bet goes out under a closed round.
	const polled = probeNaming(() => (closedGid ? { id: closedGid, updating: true } : null));
	const r = harness(partnerWins.base, polled);
	await r.post([]);
	await r.post(BET_PLAY);
	closedGid = r.session.gid;
	await r.post(COLLECT);
	polled.faults.length = 0;
	const poll = r.post([], false);
	r.session.startRound();
	const bet = await r.post(BET_PLAY);
	await poll;
	check('a poll answered ahead of a spin does not lend it a closed round', polled.sent.slice(3), [
		'0:[]',
		'0:bet+play',
	]);
	check('…a NEW round came back', bet.response?.platform?.gameRound?.id !== closedGid, true);

	// A server that closes rounds in the bet's own answer: the bet may have been taken and settled.
	const a = wire('pass', 'drop-after');
	const s = harness(autoCollect.base, a);
	await s.post([]);
	const verdict = await rejection(s.post(BET_PLAY));
	const held = autoCollect.held(s.sid);
	check('a bet that may have been settled is NOT resent', a.sent.slice(1), [
		'0:bet+play(drop-after)',
		'0:[]',
	]);
	check('…the transport gives up, saying why', verdict, 'Play4FunConnectionError:unresolved');
	check('…the player is sent to reload', s.states, ['reconnecting', 'failed']);
	check('…and the server charged it once, and closed it', held.round, null);
}

console.log('\n5. offline sends nothing; online resumes at once');
{
	const w = wire();
	const h = harness(partner.base, w, { ...FAST, giveUpAfterMs: 5_000, resendDelayMs: 2_000 });
	await h.post([]);
	online = false;
	const started = Date.now();
	const pending = h.post(BUY);
	await new Promise((r) => setTimeout(r, 100));
	check('nothing is sent while offline', w.sent.length, 1);
	goOnline();
	const opened = await pending;
	check(
		'the online event resumes it without waiting out the pause',
		Date.now() - started < 1_500,
		true,
	);
	check('…sent once, as it was', w.sent.slice(1), ['0:bet+play']);
	check('…a round came back', !!opened.response?.platform?.gameRound?.id, true);
	check('the player saw it', h.states, ['reconnecting', 'connected']);
}

console.log('\n6. giving up is bounded, reported, and final');
{
	const w = wire('pass', 'pass', ...Array<Fault>(200).fill('503'));
	const h = harness(partner.base, w);
	await h.post([]);
	await h.post(BUY);
	const started = Date.now();
	const verdict = await rejection(h.post(PLAY));
	const took = Date.now() - started;
	check('it gives up', verdict, 'Play4FunConnectionError:unreachable');
	check(
		'…inside the budget',
		took >= FAST.giveUpAfterMs - 50 && took < FAST.giveUpAfterMs + 400,
		true,
	);
	check('…the position unmoved, so a reload resumes it from the right place', h.session.seq, 2);
	check('…the last word is "failed"', h.states.at(-1), 'failed');
	const sentBefore = w.sent.length;
	check(
		'a later request is refused without sending',
		await rejection(h.post(PLAY)),
		'Play4FunConnectionError:unreachable',
	);
	check('…nothing sent', w.sent.length, sentBefore);
}

console.log('\n7. one at a time; a poll never queues behind a spin');
{
	const w = wire('pass', 'hang-after');
	const h = harness(partner.base, w);
	await h.post([]);
	const buy = h.post(BUY);
	const spin = h.post(PLAY);
	const poll = await rejection(h.post([], false));
	await Promise.all([buy, spin]);
	check('the poll stood down', poll, 'Play4FunConnectionError:unreachable');
	check('the spin waited for the buy, and its resend', w.sent.slice(1), [
		'0:bet+play(hang-after)',
		'0:[]',
		'0g:bet+play',
		'2g:play',
	]);
}

// ---------- the facade ----------

type Facade = typeof import('./src/engineFacade.ts');
type Answer = { balance?: { amount: number }; round?: { state?: { type: string }[] } };
let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);
const rgsUrl = (base: string) => base.replace('http://', '');

console.log('\n8. the facade: a spin whose answer is lost presents the round the server dealt');
{
	const facade = await openTab();
	const sid = 'S-facade-drop';
	const base = partnerWins.base;
	await facade.requestAuthenticate({ sessionID: sid, rgsUrl: rgsUrl(base), language: 'en' });
	const realFetch = globalThis.fetch;
	let drop = true;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (!drop) return realFetch(input, init);
		drop = false;
		await realFetch(input, { ...init, signal: undefined });
		throw new TypeError('network error');
	}) as typeof fetch;
	const bet = (await facade.requestBet({
		sessionID: sid,
		rgsUrl: rgsUrl(base),
		currency: 'USD',
		amount: 1,
		mode: 'BASE',
	})) as Answer;
	globalThis.fetch = realFetch;
	const held = partnerWins.held(sid);
	check(
		'the round is presented',
		(bet.round?.state ?? []).some((e) => e.type === 'reveal'),
		true,
	);
	check('…it is the one the server holds open', facade.getSessionState(sid)?.gid, held.round?.id);
	check('…charged once ($1)', held.balance, START - 100);
	const end = (await facade.requestEndRound({ sessionID: sid, rgsUrl: rgsUrl(base) })) as Answer;
	check(
		'it collects and ends on the server’s wallet',
		end.balance?.amount,
		partnerWins.held(sid).balance * 10_000,
	);
}

console.log('\n9. "no collect" is a losing spin — the server closed it in the bet’s own answer');
{
	const facade = await openTab();
	const sid = 'S-no-collect';
	const url = rgsUrl(partner.base);
	const sent: string[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? '[]')) as { action: string }[];
		if (body.length) sent.push(body.map((a) => a.action).join('+'));
		return realFetch(input, init);
	}) as typeof fetch;
	await facade.requestAuthenticate({ sessionID: sid, rgsUrl: url, language: 'en' });
	const rounds: { won: boolean; collected: boolean }[] = [];
	let expected = partner.held(sid).balance;
	for (let i = 0; i < 12; i++) {
		sent.length = 0;
		const bet = (await facade.requestBet({
			sessionID: sid,
			rgsUrl: url,
			currency: 'USD',
			amount: 1,
			mode: 'BASE',
		})) as Answer & { round?: { payout?: number } };
		await facade.requestEndRound({ sessionID: sid, rgsUrl: url });
		const won = sent[0] === 'bet+play' && (bet.round?.payout ?? 0) > 0;
		rounds.push({ won, collected: sent.includes('collect') });
		expected = partner.held(sid).balance;
		check(`round ${i + 1} ends closed on the server`, partner.held(sid).round, null);
	}
	globalThis.fetch = realFetch;
	const losses = rounds.filter((r) => !r.won);
	const wins = rounds.filter((r) => r.won);
	check(
		'the sample holds both losing and winning rounds',
		[losses.length > 0, wins.length > 0],
		[true, true],
	);
	check(
		'every WINNING round sent a collect',
		wins.every((r) => r.collected),
		true,
	);
	check(
		'no LOSING round did — there was nothing open to collect',
		losses.some((r) => r.collected),
		false,
	);
	check('the wallet is the server’s', partner.held(sid).balance, expected);
}

partner.server.close();
partnerWins.server.close();
autoCollect.server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
