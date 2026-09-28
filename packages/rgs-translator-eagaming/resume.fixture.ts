/**
 * Offline fixture for a round left OPEN when the game starts. Run it with node:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/resume.fixture.ts
 *
 * Drives the REAL facade against the REAL book mock, in the partner's no-auto-collect mode. A
 * "reload" is a fresh import of the facade — its sessions, seq and gid are module state, exactly what
 * a closed tab loses — against a server that still holds the round.
 *
 * FIVE claims:
 *
 *  1. NOTHING OPEN, NOTHING CHANGES. A boot with no open round hands the engine no round.
 *  2. A BASE WIN LEFT UNCOLLECTED IS SHOWN, THEN PAID. The boot replays the round (charging nothing),
 *     hands it to the engine as an active round to present, and `requestEndRound` collects it — so the
 *     wallet the player ends on is the one the server holds.
 *  3. A FEATURE CUT OFF BETWEEN FREE SPINS IS PLAYED OUT. The spins already dealt are replayed, not
 *     re-dealt; the rest are played; the round is collected once and pays what it shows; and it
 *     resumes on the BASE mode, so the next spin does not buy again.
 *  4. A RESUME THAT CANNOT FINISH BOOTS CLEAN — refused, dropped mid-way, or not REPLAYED at all (a
 *     server that ignored the `gid` and charged the `bet` again is caught and reported, never
 *     presented). No round, the server's balance, and no `gid` left bound — which would stand the
 *     balance poll down until the next spin. The same holds for a round the boot names without
 *     `resume`.
 *  5. A FREE SPIN REFUSED MID-FEATURE DOES NOT ZERO THE WALLET. An error envelope's `platform` is
 *     empty; settling the round on it showed a balance of 0, and a `collect` was posted into the
 *     refusal. The round is left open instead, for `requestEndRound` to collect.
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs } from '../../scripts/mock-rgs-server-book.mjs';

type Facade = typeof import('./src/engineFacade.ts');
type Event = { type: string; amount?: number };
type Round = { active?: boolean; mode?: string; amount?: number; state?: Event[] };
type Answer = { balance?: { amount: number }; round?: Round };
type MockSession = { balance: number; round: { stored: unknown[] } | null };

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

let tabs = 0;
/** A new tab: a facade with none of the previous one's session state. */
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);

const START = 1_000_000; // cents
const ENGINE_PER_CENT = 10_000;
const mock = createMockRgs({
	label: 'resume-fixture',
	seed: 'resume',
	bigWin: true,
	autoCollect: false,
	startBalance: START,
});
const server: Server = createServer((req, res) =>
	mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
);
await new Promise<void>((resolve) => server.listen(0, resolve));
const address = server.address();
const rgsUrl = `localhost:${typeof address === 'object' && address ? address.port : 0}`;

const serverSide = (sid: string): MockSession => mock.sessions.get(sid);
const boot = async (facade: Facade, sid: string) =>
	(await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' })) as Answer;
const types = (round: Round | undefined) => (round?.state ?? []).map((e) => e.type);
const post = async (sid: string, seq: number, gid: string | null, body: unknown) => {
	const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
	const res = await fetch(`http://${rgsUrl}/rgs/engine?${query}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return (await res.json()) as {
		events: { event: string; context: unknown }[];
		platform: { balance: number; gameRound?: { id: string } };
	};
};

console.log('\n1. nothing open, nothing changes');
{
	const facade = await openTab();
	const answer = await boot(facade, 'S-quiet');
	check('no round is handed to the engine', answer.round, undefined);
	check('the balance is the server’s', answer.balance?.amount, START * ENGINE_PER_CENT);
}

console.log('\n2. a base win left uncollected is shown, then paid');
{
	const sid = 'S-base';
	const tabA = await openTab();
	await boot(tabA, sid);
	const bet = (await tabA.requestBet({
		sessionID: sid,
		rgsUrl,
		currency: 'USD',
		amount: 1,
		mode: 'BASE',
	})) as Answer;
	const won = bet.round?.state?.some((e) => e.type === 'winInfo');
	check('the spin won (the mock is forced to)', won, true);
	check('…and the tab closed before collecting it', serverSide(sid).round !== null, true);
	const heldBefore = serverSide(sid).balance;

	const tabB = await openTab();
	const answer = await boot(tabB, sid);
	check('the round reaches the engine as ACTIVE', answer.round?.active, true);
	check('…to present from its first event', types(answer.round).slice(0, 1), ['reveal']);
	check('…with the win in it', types(answer.round).includes('winInfo'), true);
	check('…at the stake it was played at ($1)', answer.round?.amount, 100 * ENGINE_PER_CENT);
	check('the replay charged nothing', serverSide(sid).balance, heldBefore);
	check('the boot balance is the unpaid one', answer.balance?.amount, heldBefore * ENGINE_PER_CENT);

	const end = (await tabB.requestEndRound({ sessionID: sid, rgsUrl })) as Answer;
	check('requestEndRound closed it on the server', serverSide(sid).round, null);
	check(
		'…and ends on the server’s wallet',
		end.balance?.amount,
		serverSide(sid).balance * ENGINE_PER_CENT,
	);
	check('…which now includes the win', serverSide(sid).balance > heldBefore, true);

	const next = (await tabB.requestBet({
		sessionID: sid,
		rgsUrl,
		currency: 'USD',
		amount: 1,
		mode: 'BASE',
	})) as Answer;
	check('the next spin is a fresh round', types(next.round).includes('reveal'), true);
}

console.log('\n3. a feature cut off between free spins is played out');
{
	const sid = 'S-feature';
	const tabA = await openTab();
	await boot(tabA, sid);
	// The first second of a buy, then the tab dies: bet+play at 0, two free spins at 2 and 3.
	const opened = await post(sid, 0, null, [
		{ action: 'bet', context: [100, 10] },
		{ action: 'play', context: '' },
	]);
	const gid = opened.platform.gameRound?.id ?? null;
	const dealt = [opened];
	dealt.push(await post(sid, 2, gid, [{ action: 'play' }]));
	dealt.push(await post(sid, 3, gid, [{ action: 'play' }]));
	const afterBuy = serverSide(sid).balance;
	check('the buy charged 100× a $1 stake', START - afterBuy, 100 * 100);

	const tabB = await openTab();
	const sent: { request: string; board: unknown }[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? '[]')) as { action: string }[];
		const response = await realFetch(input, init);
		const { events = [] } = (await response.clone().json()) as typeof opened;
		sent.push({
			request: `${new URL(String(input)).searchParams.get('seq')}:${body.map((a) => a.action).join('+')}`,
			board: events.find((e) => e.event === 'playedSpin')?.context,
		});
		return response;
	}) as typeof fetch;
	const answer = await boot(tabB, sid);
	globalThis.fetch = realFetch;
	const stored = sent.filter((r) => /^\d+:[a-z]/i.test(r.request) && !r.request.endsWith('config'));
	check(
		'the three dealt requests are re-posted where they were stored',
		stored.slice(0, 3).map((r) => r.request),
		['0:bet+play', '2:play', '3:play'],
	);
	check(
		'…and the server answered them with the boards it had already dealt',
		stored.slice(0, 3).map((r) => r.board),
		dealt.map((r) => r.events.find((e) => e.event === 'playedSpin')?.context),
	);
	check(
		'…then the round continues from 4 and is collected after the last spin',
		stored.slice(3).map((r) => r.request),
		[...Array.from({ length: 8 }, (_, i) => `${i + 4}:play`), '12:collect'],
	);
	const state = answer.round?.state ?? [];
	const reveals = state.filter((e) => e.type === 'reveal').length;
	check('the round reaches the engine as ACTIVE', answer.round?.active, true);
	check('every spin of it is presented (1 base + 10 free)', reveals, 11);
	check('it resumes on the BASE mode', answer.round?.mode, 'BASE');
	check('…at the base stake, not the buy price', answer.round?.amount, 100 * ENGINE_PER_CENT);
	check('the round was played out and collected once', serverSide(sid).round, null);
	// A shown amount is hundredths of the stake; the stake is 100 cents, so it reads as cents.
	const shown = Math.max(0, ...state.map((e) => e.amount ?? 0));
	check(
		'the server paid exactly the win the player is shown, on top of ONE buy',
		serverSide(sid).balance,
		START - 100 * 100 + shown,
	);
	check(
		'the boot balance is the interim, before the win',
		answer.balance?.amount,
		afterBuy * ENGINE_PER_CENT,
	);

	const end = (await tabB.requestEndRound({ sessionID: sid, rgsUrl })) as Answer;
	check(
		'requestEndRound ends on the server’s wallet',
		end.balance?.amount,
		serverSide(sid).balance * ENGINE_PER_CENT,
	);
}

console.log('\n4. a resume that cannot finish boots clean');
{
	type Intercept = (url: string, init: RequestInit | undefined) => Promise<Response>;
	const realFetch = globalThis.fetch;

	/** Leave a base win open, then boot a new tab through `intercept`. */
	const bootThrough = async (sid: string, intercept: Intercept) => {
		const tabA = await openTab();
		await boot(tabA, sid);
		await tabA.requestBet({ sessionID: sid, rgsUrl, currency: 'USD', amount: 1, mode: 'BASE' });
		const opened = serverSide(sid).round !== null;

		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
			intercept(String(input), init)) as typeof fetch;
		const said: string[] = [];
		const [warn, error] = [console.warn, console.error];
		console.warn = console.error = (...args: unknown[]) => said.push(args.join(' '));
		const tabB = await openTab();
		const answer = await boot(tabB, sid).catch((err: unknown) => ({ thrown: String(err) }));
		[console.warn, console.error] = [warn, error];
		globalThis.fetch = realFetch;

		const clean = async (label: string) => {
			check(`${label}: a round was left open`, opened, true);
			check(`${label}: the boot survives`, 'thrown' in answer, false);
			check(`${label}: no round is handed to the engine`, (answer as Answer).round, undefined);
			check(
				`${label}: the balance is the server’s`,
				(answer as Answer).balance?.amount,
				serverSide(sid).balance * ENGINE_PER_CENT,
			);
			check(`${label}: no gid is left bound`, tabB.getSessionState(sid)?.gid, null);
			check(
				`${label}: …so a balance poll is not skipped`,
				(await tabB.requestBalance({ sessionID: sid, rgsUrl })).status.statusCode,
				'SUCCESS',
			);
		};
		return { said, clean };
	};

	const refused = await bootThrough('S-refused', (url, init) =>
		url.includes('gid=')
			? Promise.resolve(
					new Response(
						JSON.stringify({ result: 0, error: 'not authorized', errorCode: 118, platform: {} }),
					),
				)
			: realFetch(url, init),
	);
	await refused.clean('refused');

	const dropped = await bootThrough('S-dropped', (url, init) =>
		url.includes('gid=') ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(url, init),
	);
	await dropped.clean('dropped mid-replay');

	// The dangerous one: a server that does not honour `gid` on a re-posted `bet` opens a new round.
	const notReplayed = await bootThrough('S-not-replayed', (url, init) =>
		realFetch(url.replace(/&gid=[^&]+/, ''), init),
	);
	await notReplayed.clean('not replayed');
	check(
		'not replayed: and it is reported as an error, not a warning',
		notReplayed.said.some((line) => line.includes('the server did not replay it')),
		true,
	);

	// A boot that names a `gameRound` but offers no resume leaves nothing of ours open.
	const nameOnly = await bootThrough('S-named-only', async (url, init) => {
		const response = await realFetch(url, init);
		const body = (await response.json()) as { events: { event: string; resume?: boolean }[] };
		for (const e of body.events ?? []) if (e.event === 'config') delete e.resume;
		return new Response(JSON.stringify(body));
	});
	await nameOnly.clean('named without resume');
}

console.log('\n5. a free spin refused mid-feature does not zero the wallet');
{
	const sid = 'S-refused-spin';
	const tab = await openTab();
	await boot(tab, sid);
	const realFetch = globalThis.fetch;
	const sent: string[] = [];
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		sent.push(`${new URL(url).searchParams.get('seq')}:${String(init?.body)}`);
		return url.includes('seq=4&')
			? Promise.resolve(
					new Response(
						JSON.stringify({ result: 0, error: 'try again', errorCode: 500, platform: {} }),
					),
				)
			: realFetch(input, init);
	}) as typeof fetch;
	const bet = (await tab.requestBet({
		sessionID: sid,
		rgsUrl,
		currency: 'USD',
		amount: 1,
		mode: 'OPTION1',
	})) as Answer;
	globalThis.fetch = realFetch;

	check(
		'the HUD is handed the server’s balance, not 0',
		bet.balance?.amount,
		serverSide(sid).balance * ENGINE_PER_CENT,
	);
	check(
		'no collect was posted into the refusal',
		sent.some((line) => line.includes('collect')),
		false,
	);
	check('…so the round is still open', serverSide(sid).round !== null, true);
	await tab.requestEndRound({ sessionID: sid, rgsUrl });
	check('requestEndRound collects it', serverSide(sid).round, null);
}

server.close();
console.log(failures === 0 ? '\nAll resume claims hold.\n' : `\n${failures} FAILED claim(s).\n`);
process.exit(failures === 0 ? 0 : 1);
