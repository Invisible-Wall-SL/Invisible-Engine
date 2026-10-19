/**
 * Contract check for minting a partner RGS session (`$lib/server/partnerRgs`), over the REAL module
 * with a fake `fetch`: `pnpm --filter launcher-api check:partner-rgs`.
 *
 * Pins what `/api/partner-session` relies on: the token, the partner's own launch URL (`game_url`,
 * which `?on=partner` redirects to and so must be https or nothing), and the partner's error text
 * surviving its habit of answering failures with HTTP 200.
 */
import {
	mintPartnerSession,
	partnerGameUrl,
	type PartnerRgsConfig,
} from '../src/lib/server/partnerRgs.ts';

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	if (actual !== expected) {
		failures++;
		console.error(
			`FAIL  ${label}\n        expected ${String(expected)}\n        got      ${String(actual)}`,
		);
	}
}

const config: PartnerRgsConfig = {
	baseUrl: 'https://rgs.example',
	adminPath: '/admin.js',
	user: 'u',
	pass: 'p',
	gameId: '2',
	players: ['player1'],
};

function answering(body: unknown, seen?: URL[]): typeof fetch {
	return (async (input: string | URL | Request) => {
		seen?.push(new URL(String(input)));
		return new Response(JSON.stringify(body), { status: 200 });
	}) as typeof fetch;
}

// ── game_url is kept only as an https URL ─────────────────────────────────────
check(
	'https kept',
	partnerGameUrl('https://gs.example/play?sid=x'),
	'https://gs.example/play?sid=x',
);
check('http dropped', partnerGameUrl('http://gs.example/play'), '');
check('javascript: dropped', partnerGameUrl('javascript:alert(1)'), '');
check('relative dropped', partnerGameUrl('/play?sid=x'), '');
check('non-string dropped', partnerGameUrl(42), '');

// ── a successful mint returns the token and the partner's launch URL ──────────
const seen: URL[] = [];
const ok = await mintPartnerSession({
	config,
	profileId: 'p',
	userId: 'user-1',
	gameId: '7',
	fetchImpl: answering(
		{
			response: { token: 'S1', gameName: 'Book of Borut', game_url: 'https://gs.example/g?sid=S1' },
		},
		seen,
	),
});
check('token', ok.token, 'S1');
check('game name', ok.gameName, 'Book of Borut');
check('game url', ok.gameUrl, 'https://gs.example/g?sid=S1');
check(
	'the per-launch game id wins over the configured one',
	seen[0].searchParams.get('game_id'),
	'7',
);

const noUrl = await mintPartnerSession({
	config,
	profileId: 'p',
	userId: 'user-1',
	fetchImpl: answering({ response: { token: 'S2' } }),
});
check('no game_url → empty, token still returned', `${noUrl.token}|${noUrl.gameUrl}`, 'S2|');

// ── the partner's own error text survives an HTTP 200 ─────────────────────────
let refused = '';
try {
	await mintPartnerSession({
		config,
		profileId: 'p',
		userId: 'user-1',
		fetchImpl: answering({ response: 'player not found: x', code: -1, status: 500 }),
	});
} catch (e) {
	refused = e instanceof Error ? e.message : String(e);
}
check('refusal names their reason', refused.includes('player not found'), true);

console.info(`partner-rgs: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
