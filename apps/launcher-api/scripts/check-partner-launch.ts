/**
 * Gate for a project's PARTNER LAUNCH (`$lib/partnerLaunch`, `$lib/server/partnerRefusal`), over
 * the real modules: `pnpm --filter launcher-api check:partner-launch`.
 *
 * Pins:
 *  1. Resolution in `/api/partner-session`: the query beats the project's stored setting, which beats
 *     the env default (the only `PARTNER_RGS` profile, and its own `gameId` — proven by the
 *     `game_id` the real `mintPartnerSession` sends). A query naming ANOTHER profile does not
 *     borrow the stored game id or alias.
 *  2. What the card form may store: empty clears, the profile defaults to the only one and is
 *     written explicitly, an unknown profile or a non-segment id is refused.
 *  3. The card's gating: no buttons without an id or with an unconfigured partner; both disabled
 *     with a reason before Publish; ▶ Partner page disabled until something is delivered; the
 *     hrefs carry only the key.
 *  4. Refusals read as a cause + a fix, are HTML-escaped, and never carry the admin credentials.
 *  5. Saving for a project deleted or renamed since the access check answers 404, not ok.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	normalizePartnerLaunch,
	parsePartnerLaunchInput,
	partnerButtons,
	resolvePartnerLaunch,
	type PartnerLaunch,
} from '../src/lib/partnerLaunch.ts';
import { partnerRefusalAdvice, partnerRefusalPage } from '../src/lib/server/partnerRefusal.ts';
import {
	mintPartnerSession,
	partnerProfileIds,
	partnerRgsConfig,
	withoutCredentials,
} from '../src/lib/server/partnerRgs.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
	}
}

const ONE = JSON.stringify({
	'2complex': {
		baseUrl: 'https://rgs.example',
		adminPath: '/admin.js',
		user: 'admin-user',
		pass: 's3cret-pass',
		gameId: '2',
		players: ['player4'],
	},
});
const TWO = JSON.stringify({
	...JSON.parse(ONE),
	other: { baseUrl: 'https://o.example', adminPath: '/a', user: 'uuuu', pass: 'pppp' },
});
const one = partnerProfileIds(ONE);
const two = partnerProfileIds(TWO);
check('profile ids only', one, ['2complex']);
check('malformed PARTNER_RGS reads as none', partnerProfileIds('{nope'), []);

const q = (s = '') => new URLSearchParams(s);
const stored: PartnerLaunch = { gameId: '8', profile: '2complex' };

// ── 1. resolution ─────────────────────────────────────────────────────────────
const resolve = (query: string, s: PartnerLaunch | null, profiles = one) =>
	resolvePartnerLaunch({ query: q(query), stored: s, profiles, cardName: 'Getting Hot' });

check('stored beats env default', resolve('key=gh', stored), {
	profileId: '2complex',
	gameId: '8',
	alias: 'GettingHot',
	aliasNamed: false,
});
check('query beats stored', resolve('key=gh&game=9&alias=GH2', stored), {
	profileId: '2complex',
	gameId: '9',
	alias: 'GH2',
	aliasNamed: true,
});
check('env default when nothing stored', resolve('key=gh', null), {
	profileId: '2complex',
	alias: 'GettingHot',
	aliasNamed: false,
});
check(
	'stored alias used',
	resolve('', { ...stored, alias: 'BookOfBetOptions' }).alias ?? '',
	'BookOfBetOptions',
);
check('stored without a profile means the only one', resolve('', { gameId: '8' }), {
	profileId: '2complex',
	gameId: '8',
	alias: 'GettingHot',
	aliasNamed: false,
});
check(
	'a query naming another profile does not borrow the stored game',
	resolve('profile=other', { ...stored, alias: 'X' }, two),
	{ profileId: 'other', alias: 'GettingHot', aliasNamed: false },
);
check(
	'stored profile picks among several',
	'profileId' in resolve('', stored, two) && resolve('', stored, two),
	{
		profileId: '2complex',
		gameId: '8',
		alias: 'GettingHot',
		aliasNamed: false,
	},
);
check('stored player used', resolve('', { ...stored, player: 'player7' }).player, 'player7');
check(
	'query player beats stored',
	resolve('player=player9', { ...stored, player: 'player7' }).player,
	'player9',
);
check('no player means the pool', 'player' in resolve('', stored), false);
check(
	'a query naming another profile does not borrow the stored player',
	'player' in resolve('profile=other', { ...stored, player: 'player7' }, two),
	false,
);
check('a bad ?player= is an error, not the pool', 'error' in resolve('player=a%26b', stored), true);
check('several profiles and none named is an error', 'error' in resolve('', null, two), true);
check('no profiles at all is an error', 'error' in resolve('', null, []), true);

// The resolved id is what reaches the partner, and "undefined" falls through to the env's gameId.
async function gameIdSent(gameId: string | undefined): Promise<string | null> {
	let sent: URL | undefined;
	await mintPartnerSession({
		config: partnerRgsConfig(ONE, '2complex'),
		profileId: '2complex',
		userId: 'u1',
		gameId,
		fetchImpl: (async (input: string | URL | Request) => {
			sent = new URL(String(input));
			return new Response(JSON.stringify({ response: { token: 't' } }));
		}) as typeof fetch,
	});
	return sent?.searchParams.get('game_id') ?? null;
}
const r1 = resolve('', stored);
const r2 = resolve('', null);
check(
	'stored id is what the partner gets',
	await gameIdSent('gameId' in r1 ? r1.gameId : 'x'),
	'8',
);
async function playerSent(player: string | undefined): Promise<string | null> {
	let sent: URL | undefined;
	await mintPartnerSession({
		config: partnerRgsConfig(ONE, '2complex'),
		profileId: '2complex',
		userId: 'u1',
		player,
		fetchImpl: (async (input: string | URL | Request) => {
			sent = new URL(String(input));
			return new Response(JSON.stringify({ response: { token: 't' } }));
		}) as typeof fetch,
	});
	return sent?.searchParams.get('remote_id') ?? null;
}
check('the set player is the remote_id', await playerSent('player7'), 'player7');
check('no player is the pool player', await playerSent(undefined), 'player4');
check('no id falls to the env gameId', await gameIdSent('gameId' in r2 ? r2.gameId : 'x'), '2');

// ── 2. what the form may store ────────────────────────────────────────────────
check('empty clears', parsePartnerLaunchInput({ gameId: '  ' }, one), { ok: true, value: null });
check('profile defaulted and written', parsePartnerLaunchInput({ gameId: ' 8 ' }, one), {
	ok: true,
	value: { gameId: '8', profile: '2complex' },
});
check('alias kept', parsePartnerLaunchInput({ gameId: '2', alias: 'BookOfBetOptions' }, one), {
	ok: true,
	value: { gameId: '2', profile: '2complex', alias: 'BookOfBetOptions' },
});
check('bad id refused', parsePartnerLaunchInput({ gameId: '8&x=1' }, one).ok, false);
check('player kept', parsePartnerLaunchInput({ gameId: '8', player: ' player7 ' }, one), {
	ok: true,
	value: { gameId: '8', profile: '2complex', player: 'player7' },
});
check('bad player refused', parsePartnerLaunchInput({ gameId: '8', player: 'a b' }, one).ok, false);
check('normalize keeps a player', normalizePartnerLaunch({ gameId: '8', player: 'player7' }), {
	gameId: '8',
	player: 'player7',
});
check('bad alias refused', parsePartnerLaunchInput({ gameId: '8', alias: 'a/b' }, one).ok, false);
check(
	'unknown profile refused',
	parsePartnerLaunchInput({ gameId: '8', profile: 'nope' }, one).ok,
	false,
);
check('several profiles need one named', parsePartnerLaunchInput({ gameId: '8' }, two).ok, false);
check('no partner configured refused', parsePartnerLaunchInput({ gameId: '8' }, []).ok, false);
check('normalize drops junk', normalizePartnerLaunch({ gameId: 8 }), null);
check('normalize drops a bad alias only', normalizePartnerLaunch({ gameId: '8', alias: '../x' }), {
	gameId: '8',
});
check('normalize null', normalizePartnerLaunch(null), null);

// ── 3. the card's gating ──────────────────────────────────────────────────────
const buttons = (o: Partial<Parameters<typeof partnerButtons>[0]>) =>
	partnerButtons({
		key: 'getting-hot',
		partner: stored,
		profiles: one,
		published: true,
		latestDelivery: 'v3',
		...o,
	});
check('no id, no buttons', buttons({ partner: null }), null);
check('unconfigured partner, no buttons', buttons({ profiles: [] }), null);
check(
	'partner gone from the env, no buttons',
	buttons({ partner: { gameId: '8', profile: 'old' } }),
	null,
);
check('both live', buttons({}), {
	card: { href: '/api/partner-session?key=getting-hot' },
	page: { href: '/api/partner-session?key=getting-hot&on=partner' },
});
const unpublished = buttons({ published: false });
check('unpublished: card disabled', unpublished?.card.disabled, 'Publish the game first.');
check('unpublished: page disabled', unpublished?.page.disabled, 'Publish the game first.');
const undelivered = buttons({ latestDelivery: null });
check('undelivered: card live', undelivered?.card.disabled, undefined);
check(
	'undelivered: page disabled with a reason',
	/Nothing delivered/.test(undelivered?.page.disabled ?? ''),
	true,
);

// ── 4. refusals ───────────────────────────────────────────────────────────────
const banned = partnerRefusalAdvice(
	'Partner RGS refused the session: Player is banned: player4',
	502,
);
check('banned: names the player', banned.cause.includes('"player4"'), true);
check('banned: unban step', banned.steps[0], 'Ask the partner to unban the player "player4".');
check('banned: player step', banned.steps[1].includes('Partner player'), true);
check('banned: pool step', banned.steps[2].includes('PARTNER_RGS'), true);
check(
	'not found',
	partnerRefusalAdvice('Partner RGS refused the session: player not found: x', 502).title,
	'The partner does not know your test player',
);
check(
	'no game id points at the card',
	partnerRefusalAdvice('No game id for profile "p" — pass ?game=', 400).steps[0].includes(
		'Game Maker',
	),
	true,
);
check(
	'unreachable',
	partnerRefusalAdvice('Could not reach the partner RGS for profile "p"', 502).title,
	'The partner RGS did not answer',
);
check('401', partnerRefusalAdvice('Unauthorized', 401).title, 'Sign in first');

const page = partnerRefusalPage({
	message: 'Player is banned: <b>x</b>',
	status: 502,
	gameName: 'A & B',
});
check('page escapes the message', page.includes('<b>x</b>'), false);
check('page escapes the game name', page.includes('A &#38; B'), true);
check('page is a document', page.startsWith('<!doctype html>'), true);

check(
	'credentials blanked from the partner text',
	withoutCredentials('bad login admin-user / s3cret-pass', {
		user: 'admin-user',
		pass: 's3cret-pass',
	}),
	'bad login … / …',
);
check(
	'URL-encoded credentials blanked too',
	withoutCredentials('usr=a%40min&passw=p+w%26rd', { user: 'a@min', pass: 'p w&rd' }),
	'usr=…&passw=…',
);
check('short values left alone', withoutCredentials('a u p', { user: 'u', pass: 'p' }), 'a u p');
let echoed = '';
try {
	await mintPartnerSession({
		config: partnerRgsConfig(ONE, '2complex'),
		profileId: '2complex',
		userId: 'u1',
		fetchImpl: (async () =>
			new Response(
				JSON.stringify({ response: 'denied for usr=admin-user passw=s3cret-pass', code: -1 }),
			)) as typeof fetch,
	});
} catch (e) {
	echoed = e instanceof Error ? e.message : '';
}
check('a refusal never carries the password', echoed.includes('s3cret-pass'), false);
check('…nor the admin user', echoed.includes('admin-user'), false);
check(
	'…but keeps the sentence',
	echoed.startsWith('Partner RGS refused the session: denied'),
	true,
);

// 5. The save answers 404 when the project went away after the access check (zero rows updated).
//    A source pin — the UPDATE needs a database.
const projectsSrc = readFileSync(
	fileURLToPath(new URL('../src/lib/server/projects.ts', import.meta.url)),
	'utf8',
);
const saveSrc = readFileSync(
	fileURLToPath(new URL('../src/routes/api/game-maker/partner/+server.ts', import.meta.url)),
	'utf8',
);
check(
	'setPartnerLaunch reports whether a row was updated',
	/setPartnerLaunch\([^)]*\): Promise<boolean>[\s\S]*?\.returning\([\s\S]*?return rows\.length > 0;/.test(
		projectsSrc,
	),
	true,
);
check(
	'the save answers 404 when no row was updated',
	/if \(!\(await setPartnerLaunch\(project, parsed\.value\)\)\) \{[\s\S]*?status: 404/.test(
		saveSrc,
	),
	true,
);
check(
	'a gone project is not logged as a save',
	saveSrc.includes('status: 404') &&
		saveSrc.indexOf('status: 404') < saveSrc.indexOf('console.info'),
	true,
);

if (failures) {
	console.error(`\ncheck:partner-launch — ${failures}/${checks} FAILED`);
	process.exit(1);
}
console.log(`check:partner-launch — ${checks} checks passed`);
