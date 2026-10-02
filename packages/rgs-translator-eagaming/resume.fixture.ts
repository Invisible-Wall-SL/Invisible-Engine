/**
 * Offline fixture for a round left OPEN when the game starts. Run it with node:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/resume.fixture.ts
 *
 * Drives the REAL facade against the REAL book mock, in the partner's no-auto-collect mode. A
 * "reload" is a fresh import of the facade — its sessions, seq and gid are module state, exactly what
 * a closed tab loses — against a server that still holds the round.
 *
 * SIX claims:
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
 *     `resume`. A resume dropped for GOOD is resent until the transport gives up — then the player is
 *     asked to reload, and a poll stands down rather than talk past a connection it cannot trust.
 *  5. A FREE SPIN REFUSED MID-FEATURE DOES NOT ZERO THE WALLET. An error envelope's `platform` is
 *     empty; settling the round on it showed a balance of 0, and a `collect` was posted into the
 *     refusal. Since 2026-10-02 the feature is not presented at all (it has no end): the session is
 *     given up for a reload, nothing is collected, and the reload resumes the round and closes it.
 *  6. A RESUMED RETRIGGERED FREE-SPIN ROUND ENDS ON ITS OWN TOTAL AND RETURNS TO IDLE. The resumed
 *     book is translated inside `requestAuthenticate`, so the game must hand the facade its authored
 *     win-tier ladder before it authenticates. Booted in that order, the outro carries the round's
 *     total at its own tier on the authored ladder, and the round ends. Booted the old way (the
 *     ladder published only once the game mounted), the outro's level came from the facade's coded
 *     ladder and was off the authored one, which froze the outro on "$0.00" until the engine learned
 *     to present such a level on the nearest tier (`engine-game` `winLadder.fixture.ts`).
 */

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import compiledLinesConfig from '../../apps/lines/src/game/config.ts';
import { createGameConfig } from '../engine-game/src/game/gameConfig.ts';
import { normalizeGameConfigDoc, type WinLevelTier } from '../game-config/index.ts';
import { createMockRgs } from '../../scripts/mock-rgs-server-book.mjs';

type Facade = typeof import('./src/engineFacade.ts');
type Event = { type: string; amount?: number; winLevel?: number; total?: number };
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
		{ action: 'bet', context: [1, 10] },
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
		tabB.setResendPolicy({ attemptTimeoutMs: 200, resendDelayMs: 10, giveUpAfterMs: 300 });
		const answer = await boot(tabB, sid).catch((err: unknown) => ({ thrown: String(err) }));
		[console.warn, console.error] = [warn, error];
		globalThis.fetch = realFetch;

		/** `lost`: the server stopped answering for good, so the transport gave up — the player is asked
		 *  to reload and a poll stands down rather than talk past a connection it cannot trust. */
		const clean = async (label: string, connection: 'kept' | 'lost' = 'kept') => {
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
				connection === 'kept'
					? `${label}: …so a balance poll is not skipped`
					: `${label}: …and, the connection given up on, a poll stands down`,
				(await tabB.requestBalance({ sessionID: sid, rgsUrl })).status.statusCode,
				connection === 'kept' ? 'SUCCESS' : 'SKIPPED',
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
	await dropped.clean('dropped mid-replay', 'lost');

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
	const verdict = await tab
		.requestBet({ sessionID: sid, rgsUrl, currency: 'USD', amount: 1, mode: 'OPTION1' })
		.then(
			() => 'presented',
			(err: Error & { reason?: string }) => `${err.name}:${err.reason ?? ''}`,
		);
	globalThis.fetch = realFetch;

	check('the cut-short feature asks for a reload', verdict, 'Play4FunConnectionError:refused');
	check(
		'no collect was posted into the refusal',
		sent.some((line) => line.includes('collect')),
		false,
	);
	check('…so the round is still open', serverSide(sid).round !== null, true);
	const reloaded = (await boot(await openTab(), sid)) as Answer;
	check('the reload resumes it and closes it on the server', serverSide(sid).round, null);
	check('…handing the HUD a real balance, not 0', (reloaded.balance?.amount ?? 0) > 0, true);
}

console.log('\n6. a resumed retriggered free-spin round ends on its own total and returns to idle');
{
	/** A project's authored win tiers, stopping short of the facade's coded ten. */
	const LADDER: WinLevelTier[] = [
		{ alias: 'zero', name: 'ZERO', threshold: 0, type: 'small' },
		{ alias: 'win', name: 'WIN', threshold: 1, type: 'small' },
		{ alias: 'nice', name: 'NICE WIN', threshold: 5, type: 'medium' },
		{ alias: 'big', name: 'BIG WIN', threshold: 15, type: 'big' },
		{ alias: 'mega', name: 'MEGA WIN', threshold: 40, type: 'big' },
	];
	const template = normalizeGameConfigDoc(compiledLinesConfig);
	const game = createGameConfig({
		bakedConfig: () => (template ? { ...template, winLevels: LADDER } : undefined),
		compiledConfig: compiledLinesConfig,
	});
	const onLadder = (level: number | undefined) =>
		level !== undefined && LADDER.some((_, index) => index + 1 === level);

	const layout = readFileSync(
		new URL('../../apps/lines/src/routes/+layout.ts', import.meta.url),
		'utf8',
	);
	const load = layout.slice(layout.indexOf('export const load'));
	const at = (call: string) => load.indexOf(call);
	check(
		'the game hands the facade its ladder before it authenticates (layout `load`, after the bundle)',
		at('await prepareRuntimeBundle()') >= 0 &&
			at('await prepareRuntimeBundle()') < at('resetGameConfigCache()') &&
			at('resetGameConfigCache()') < at('publishWinLevelsToFacade()'),
		true,
	);

	type OpenFeature = { mock: ReturnType<typeof createMockRgs>; server: Server; url: string };
	/** A book mock of its own on `seed`, with a bought feature left open right after it retriggers. */
	const openRetriggered = async (seed: string): Promise<OpenFeature | null> => {
		const own = createMockRgs({ label: 'resume-retrigger', seed, autoCollect: false });
		const ownServer: Server = createServer((req, res) =>
			own.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
		);
		await new Promise<void>((resolve) => ownServer.listen(0, resolve));
		const port = (ownServer.address() as { port: number }).port;
		const send = async (seq: number, gid: string | null, body: unknown) => {
			const res = await fetch(
				`http://localhost:${port}/rgs/engine?sid=S-retrigger&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
				{ method: 'POST', body: JSON.stringify(body) },
			);
			return (await res.json()) as {
				events: { event: string }[];
				platform: { gameRound?: { id: string } };
			};
		};
		const log = console.log;
		console.log = () => {};
		try {
			const opened = await send(0, null, [
				{ action: 'bet', context: [1, 10] },
				{ action: 'play', context: '' },
			]);
			const gid = opened.platform.gameRound?.id ?? null;
			for (let seq = 2; gid && seq < 12; seq++) {
				const { events } = await send(seq, gid, [{ action: 'play' }]);
				if (events.some((e) => e.event === 'retrigger'))
					return { mock: own, server: ownServer, url: `localhost:${port}` };
				if (events.some((e) => e.event === 'gameEnd')) break;
			}
		} finally {
			console.log = log;
		}
		ownServer.close();
		return null;
	};

	/** Boot a new tab on an open feature, read the book it hands the engine, then end the round. */
	const resume = async (feature: OpenFeature, ladderFirst: boolean) => {
		if (ladderFirst) game.publishWinLevelsToFacade();
		else delete (globalThis as { __IE_WIN_LEVELS__?: unknown }).__IE_WIN_LEVELS__;
		const tab = await openTab();
		const held = feature.mock.sessions.get('S-retrigger') as MockSession;
		const heldBefore = held.balance;
		const answer = (await tab.requestAuthenticate({
			sessionID: 'S-retrigger',
			rgsUrl: feature.url,
			language: 'en',
		})) as Answer;
		const credited = held.balance - heldBefore;
		const end = (await tab.requestEndRound({
			sessionID: 'S-retrigger',
			rgsUrl: feature.url,
		})) as Answer;
		return { tab, answer, credited, end, state: answer.round?.state ?? [], held };
	};
	const outroOf = (state: Event[]) => state.find((e) => e.type === 'freeSpinEnd');
	/** A shown amount is hundredths of the stake. */
	const timesStake = (e: Event | undefined) => (e?.amount ?? 0) / 100;

	// Booted the old way — the ladder reached the facade only once the game had mounted — on a round
	// that tells the two orders apart: a big win the authored ladder also calls big (15× or more), and
	// an outro well past the last coded level this ladder has (20× is coded level 7), not on a boundary.
	let seed: string | null = null;
	let old: Awaited<ReturnType<typeof resume>> | null = null;
	for (let n = 0; n < 200 && !seed; n++) {
		const candidate = `resume-retrigger-${n}`;
		const open = await openRetriggered(candidate);
		if (!open) continue;
		const booted = await resume(open, false);
		open.server.close();
		const bigWin = booted.state.some((e) => e.type === 'setWin' && timesStake(e) >= 15);
		if (bigWin && timesStake(outroOf(booted.state)) >= 20) [seed, old] = [candidate, booted];
	}
	check(
		`a seed whose bought feature retriggers, wins big on the way and pays 20× or more${seed ? ` (${seed})` : ''}`,
		seed !== null,
		true,
	);

	if (seed && old) {
		const oldOutro = outroOf(old.state)?.winLevel;
		check(
			'booted before the ladder is published, its outro is stamped off the authored ladder',
			onLadder(oldOutro),
			false,
		);
		check(
			'…which no longer freezes it: the engine presents it on the top tier',
			oldOutro === undefined ? undefined : game.activeWinLevelData(oldOutro)?.alias,
			LADDER.at(-1)?.alias,
		);

		const feature = (await openRetriggered(seed)) as OpenFeature;
		const { tab, answer, credited, end, state, held } = await resume(feature, true);
		const outro = outroOf(state);
		const lastCounter = state.filter((e) => e.type === 'updateFreeSpin').at(-1);
		check('the round reaches the engine as ACTIVE', answer.round?.active, true);
		check(
			'it retriggered, and every spin of it is presented (the base spin + every free spin)',
			[
				state.some((e) => e.type === 'freeSpinRetrigger'),
				state.filter((e) => e.type === 'reveal').length,
			],
			[true, 1 + (lastCounter?.total ?? 0)],
		);
		check('…the same round the old boot order dealt', outro?.amount, outroOf(old.state)?.amount);
		// The stake is 100 cents, so a shown amount reads as cents.
		check('the outro counts up to exactly what the server paid', outro?.amount, credited);
		check(
			'…on the authored tier for that total',
			outro?.winLevel,
			game.activeWinLevel(timesStake(outro)),
		);
		check(
			'…a level on the authored ladder, so it is shown as stamped',
			onLadder(outro?.winLevel),
			true,
		);
		const bigWins = state.filter((e) => e.type === 'setWin');
		check(
			'every big win on the way is on the ladder too',
			[bigWins.length > 0, bigWins.every((e) => onLadder(e.winLevel))],
			[true, true],
		);
		check(
			'requestEndRound leaves no round open and ends on the server’s wallet',
			[held.round, end.balance?.amount],
			[null, held.balance * ENGINE_PER_CENT],
		);
		const next = (await tab.requestBet({
			sessionID: 'S-retrigger',
			rgsUrl: feature.url,
			currency: 'USD',
			amount: 1,
			mode: 'BASE',
		})) as Answer;
		check('back to idle: the next spin is a fresh round', types(next.round)[0], 'reveal');
		feature.server.close();
		delete (globalThis as { __IE_WIN_LEVELS__?: unknown }).__IE_WIN_LEVELS__;
	}
}

server.close();
console.log(failures === 0 ? '\nAll resume claims hold.\n' : `\n${failures} FAILED claim(s).\n`);
process.exit(failures === 0 ? 0 : 1);
