/**
 * Offline fixture for PARTNER SESSION MINTING. Run with tsx:
 *   pnpm --filter launcher-api exec tsx partnerRgs.fixture.ts
 *
 * A partner's session endpoint is an ADMIN one — user, password, and it will mint for any player
 * id — so the launcher holds those and hands the game only a token. FIVE claims, each one a way
 * that could go wrong:
 *
 *  1. CONFIG IS READ, NORMALISED, AND ITS ABSENCE IS NOT A CRASH. Unset `PARTNER_RGS` just means no
 *     partner launches; a MALFORMED one is a named error, and never one that echoes the value,
 *     because the value holds credentials.
 *  2. EVERY LAUNCH GETS ITS OWN PLAYER ID. The test server once shipped `?sessionID=demo` to
 *     everyone and every visitor shared one server-side wallet. A partner wallet is money-shaped
 *     state, so two people testing at once must not collide.
 *  3. THE MINT REQUEST CARRIES WHAT THE PARTNER ASKS FOR. action, remote_id, game_id, and the
 *     credentials — and a missing game id is refused before any call is made.
 *  4. A BAD ANSWER IS A READABLE ERROR, NOT A TOKEN-SHAPED UNDEFINED. Anything that is not a real
 *     token must fail loudly: a launch with `sid=undefined` looks like a working link.
 *  5. THE LAUNCH URL SWAPS ONLY THE RGS HALF. `runtime=1`, `project` and the read token `k` are what
 *     make an online game work at all, so they carry over untouched; `rgs_url`/`sessionID` are ours
 *     and must go, or the game would still be pointed at our server.
 */

import {
	PartnerRgsError,
	mintPartnerSession,
	partnerLaunchUrl,
	partnerRemoteId,
	partnerRgsConfig,
	partnerRgsRegistry,
} from './src/lib/server/partnerRgs.ts';

const CONFIG = JSON.stringify({
	'2complex': {
		baseUrl: 'https://rgs.example/',
		adminPath: 'webnode/api/admin.js',
		user: 'u',
		pass: 'p',
		gameId: '2',
		players: ['player1', 'player2', 'player3'],
	},
});

const NO_GAME_ID = JSON.stringify({
	bare: { baseUrl: 'https://x.example', adminPath: '/a', user: 'u', pass: 'p' },
});

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

const messageOf = (run: () => unknown): string => {
	try {
		run();
		return '';
	} catch (error) {
		return (error as Error).message;
	}
};

const statusOf = async (run: () => Promise<unknown>): Promise<number> => {
	try {
		await run();
		return 0;
	} catch (error) {
		return (error as InstanceType<typeof PartnerRgsError>).status ?? -1;
	}
};

const CARD_URL =
	'https://games.invisiblewall.org/bookofborutremake/?runtime=1&project=bookofborutremake' +
	'&k=READTOKEN&editorDocBase=https%3A%2F%2Fapp.invisiblewall.org' +
	'&rgs_url=games.invisiblewall.org/api/bookofborutremake&sessionID=demo&lang=en&currency=EUR';

/** A partner stand-in: records the URL it was called with and answers however the test wants. */
const fakePartner = (body: unknown, status = 200) => {
	const calls: URL[] = [];
	const fetchImpl = (async (input: URL | string) => {
		calls.push(new URL(String(input)));
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
};

const OK_BODY = { status: 200, response: { token: 'S00012345', gameName: 'Book Of Bet Options' } };

const main = async () => {
	console.log('\n1. config is read, normalised, and its absence is not a crash');
	{
		const reg = partnerRgsRegistry(CONFIG);
		check('trailing slash off the base', reg['2complex'].baseUrl, 'https://rgs.example');
		check('leading slash on the admin path', reg['2complex'].adminPath, '/webnode/api/admin.js');
		check('session param defaults to sid', reg['2complex'].sessionParam, 'sid');
		check('unset ⇒ no partners, no throw', partnerRgsRegistry(''), {});

		const malformed = messageOf(() => partnerRgsRegistry('not json'));
		check('malformed ⇒ named error', malformed, 'PARTNER_RGS is not valid JSON');
		check('...that does not echo the value', malformed.includes('not json'), false);
		check(
			'an array is not a registry',
			messageOf(() => partnerRgsRegistry('[]')),
			'PARTNER_RGS must be a JSON object keyed by profile id',
		);
		check(
			'incomplete ⇒ says which fields',
			messageOf(() =>
				partnerRgsRegistry(JSON.stringify({ p: { baseUrl: 'https://x.example', user: 'u' } })),
			),
			'PARTNER_RGS["p"] is missing: adminPath, pass',
		);
		check(
			'an unconfigured profile ⇒ 404',
			await statusOf(async () => partnerRgsConfig(CONFIG, 'nope')),
			404,
		);
	}

	console.log('\n2. every launch gets its own player id');
	{
		const pool = ['player1', 'player2', 'player3'];
		check('with no pool, the id is derived', partnerRemoteId('u-123'), 'iw-u-123');
		check('two derived users never collide', partnerRemoteId('a') === partnerRemoteId('b'), false);
		check('with a pool, only pool members are used', pool.includes(partnerRemoteId('u-123', pool)), true); // prettier-ignore
		check('the same user is stable across launches', partnerRemoteId('u-9', pool), partnerRemoteId('u-9', pool)); // prettier-ignore
		const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((u) => partnerRemoteId(u, pool)));
		check('and users are spread across it, not all on one', spread.size > 1, true);
	}

	console.log('\n3. the mint request carries what the partner asks for');
	{
		const config = partnerRgsConfig(CONFIG, '2complex');
		const partner = fakePartner(OK_BODY);
		const result = await mintPartnerSession({
			config,
			profileId: '2complex',
			userId: 'u-1',
			fetchImpl: partner.fetchImpl,
		});
		const called = partner.calls[0];
		check('token returned', result.token, 'S00012345');
		check('game name returned', result.gameName, 'Book Of Bet Options');
		check('endpoint', `${called.origin}${called.pathname}`, 'https://rgs.example/webnode/api/admin.js'); // prettier-ignore
		check('action', called.searchParams.get('action'), 'create_session');
		check('remote_id comes from the configured pool', ['player1', 'player2', 'player3'].includes(called.searchParams.get('remote_id') ?? ''), true); // prettier-ignore
		check('game_id from config', called.searchParams.get('game_id'), '2');
		check('credentials', [called.searchParams.get('usr'), called.searchParams.get('passw')], ['u', 'p']); // prettier-ignore

		const override = fakePartner(OK_BODY);
		await mintPartnerSession({
			config,
			profileId: '2complex',
			userId: 'u-1',
			gameId: '7',
			fetchImpl: override.fetchImpl,
		});
		check('an explicit ?game= wins', override.calls[0].searchParams.get('game_id'), '7');

		const never = fakePartner(OK_BODY);
		check(
			'no game id anywhere ⇒ 400',
			await statusOf(() =>
				mintPartnerSession({
					config: partnerRgsConfig(NO_GAME_ID, 'bare'),
					profileId: 'bare',
					userId: 'u',
					fetchImpl: never.fetchImpl,
				}),
			),
			400,
		);
		check('...and no call was made', never.calls.length, 0);
	}

	console.log('\n4. a bad answer is a readable error, not a token-shaped undefined');
	{
		const config = partnerRgsConfig(CONFIG, '2complex');
		for (const [label, body, httpStatus] of [
			['no token in the body', { status: 200, response: {} }, 200],
			['a non-string token', { response: { token: 12345 } }, 200],
			['an empty token', { response: { token: '' } }, 200],
			['an error envelope', { error: 'bad credentials' }, 200],
			['the partner HTTP-200 error body', { response: 'player not found: x', code: -1, status: 500 }, 200], // prettier-ignore
			['a 500 from the partner', {}, 500],
		] as const) {
			const partner = fakePartner(body, httpStatus);
			check(
				`${label} ⇒ 502`,
				await statusOf(() =>
					mintPartnerSession({
						config,
						profileId: '2complex',
						userId: 'u',
						fetchImpl: partner.fetchImpl,
					}),
				),
				502,
			);
		}

		const unreachable = (async () => {
			throw new Error('ECONNREFUSED https://rgs.example/webnode/api/admin.js?usr=u&passw=p');
		}) as unknown as typeof fetch;
		let leaked = '';
		try {
			await mintPartnerSession({
				config,
				profileId: '2complex',
				userId: 'u',
				fetchImpl: unreachable,
			});
		} catch (error) {
			leaked = (error as Error).message;
		}
		check('an unreachable partner ⇒ readable error', leaked.startsWith('Could not reach'), true);
		check('...that does NOT carry the credentials', leaked.includes('passw'), false);
	}

	console.log('\n5. the launch URL swaps only the RGS half');
	{
		const target = new URL(
			partnerLaunchUrl({
				cardUrl: CARD_URL,
				profileId: '2complex',
				token: 'S00012345',
				sessionParam: 'sid',
			}),
		);
		check('our RGS is gone', target.searchParams.get('rgs_url'), null);
		check('our session is gone', target.searchParams.get('sessionID'), null);
		check('the profile is selected', target.searchParams.get('rgs_profile'), '2complex');
		check('the token rides the partner param', target.searchParams.get('sid'), 'S00012345');
		check('runtime mode survives', target.searchParams.get('runtime'), '1');
		check('the project survives', target.searchParams.get('project'), 'bookofborutremake');
		check('the read token survives', target.searchParams.get('k'), 'READTOKEN');
		check('the doc base survives', target.searchParams.get('editorDocBase'), 'https://app.invisiblewall.org'); // prettier-ignore
		check('the locale survives', target.searchParams.get('lang'), 'en');
		check('and so does the origin + path', `${target.origin}${target.pathname}`, 'https://games.invisiblewall.org/bookofborutremake/'); // prettier-ignore
		check(
			'a partner that names its param differently is honoured',
			new URL(
				partnerLaunchUrl({ cardUrl: CARD_URL, profileId: 'x', token: 'T1', sessionParam: 'token' }),
			).searchParams.get('token'),
			'T1',
		);
	}

	console.log(failures === 0 ? '\nAll partner-minting claims hold.\n' : `\n${failures} FAILED.\n`);
	process.exit(failures === 0 ? 0 : 1);
};

void main();
