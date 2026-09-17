/**
 * Offline fixture for the DELIVERY PROFILE merge — the config a build carries so it can be hosted
 * by someone who knows nothing about our launch URLs. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/delivery-profile/profile.fixture.ts
 *
 * EIGHT claims, each of which is a way a delivered build could fail on a client's site:
 *
 *  1. A BUILD THAT BAKES NO PROFILE IS UNCHANGED. Every default restates the pre-profile
 *     behaviour, because this feature ships into a repo whose games are already live — the
 *     internal path has to be untouched, not merely equivalent.
 *  2. A PATCH MERGES FIELD BY FIELD. A delivery moving to a staging host writes one field; it must
 *     not silently reset the session param it was shipped with.
 *  3. AN EXPLICIT EMPTY `baseUrl` IS SAME-ORIGIN, AND IS NOT THE SAME GESTURE AS OMITTING IT. The
 *     two mean opposite things ("the RGS serves this page" vs "keep what you have"), and a merge
 *     that treated empty strings as absent would silently pin a delivery to its baked host.
 *     Whitespace, though, is a typo and must NOT read as the declaration.
 *  4. AN UNSAFE `baseUrl` IS REFUSED AND THE BASE STANDS. It becomes the prefix of every wallet
 *     call, so the check parses rather than pattern-matches: userinfo (`https://our.rgs@evil`) is
 *     the case that reads as our host to a person and resolves to someone else's to the browser,
 *     and a query/fragment silently swallows the endpoint path appended after it.
 *  5. `endpoint` IS STORED WITH A LEADING SLASH. It is concatenated onto the base, so `engine.js`
 *     and `/engine.js` must not produce two different URLs.
 *  6. A MALFORMED PATCH WARNS AND CHANGES NOTHING. It never throws — the thing being parsed is a
 *     file edited by people who cannot rebuild the game — but it must never fail SILENTLY either:
 *     a typo'd key with no diagnostic is the likeliest failure of all.
 *  7. `config.json` MAY REPOINT THE BUILD BUT NOT RE-POLICE IT. Whether a missing token is fatal,
 *     whether the host page can repoint the wallet, and whether calls are credentialed are decided
 *     when the delivery is cut. A staging↔production move needs none of them.
 *  8. THE SHIPPED PARTNER PROFILE RESOLVES TO THE TRANSPORT WE INTEND. The profile is the whole
 *     integration; a typo in it is indistinguishable from the server being down.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DELIVERY_PROFILE } from './src/types.ts';
// Imported straight from the build validator's own leaf module, so the two field lists are
// compared for real rather than scraped out of a vite config we cannot load here.
import { KNOWN_PROFILE_FIELDS, deliveryProfileProblems } from '../config-vite/deliveryProfile.js';
import {
	DELIVERY_PROFILE_FIELDS,
	mergeDeliveryProfile,
	type DeliveryProfileScope,
} from './src/normalize.ts';

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

const merge = (
	patch: unknown,
	base = DEFAULT_DELIVERY_PROFILE,
	scope: DeliveryProfileScope = 'baked',
) => mergeDeliveryProfile(base, patch, scope);

const DELIVERY = merge({
	id: 'partner',
	rgs: {
		baseUrl: 'https://rgs.example',
		endpoint: '/webnode/engine.js',
		withCredentials: false,
		allowUrlOverride: false,
	},
	session: { param: 'sid', required: true },
}).profile;

console.log('\n1. a build that bakes no profile is unchanged');
check('endpoint', DEFAULT_DELIVERY_PROFILE.rgs.endpoint, '/rgs/engine');
check('credentialed fetch (the captured same-origin behaviour)', DEFAULT_DELIVERY_PROFILE.rgs.withCredentials, true); // prettier-ignore
check('?rgs_url= still wins', DEFAULT_DELIVERY_PROFILE.rgs.allowUrlOverride, true);
check('same-origin base', DEFAULT_DELIVERY_PROFILE.rgs.baseUrl, '');
check('session param', DEFAULT_DELIVERY_PROFILE.session.param, 'sessionID');
check('the token comes from the URL, as it always did', DEFAULT_DELIVERY_PROFILE.session.source, 'param'); // prettier-ignore
check('demo session still minted', DEFAULT_DELIVERY_PROFILE.session.required, false);
check('a JSON content type (NOT the preflight-free simple request)', DEFAULT_DELIVERY_PROFILE.rgs.simpleRequest, false); // prettier-ignore
check('an absent patch is a no-op', merge(undefined).profile, DEFAULT_DELIVERY_PROFILE);
check('...and warns about nothing', merge(undefined).warnings, []);
check('the default is frozen, so a consumer cannot move it for everyone', Object.isFrozen(DEFAULT_DELIVERY_PROFILE.rgs), true); // prettier-ignore

console.log('\n2. a patch merges field by field');
check(
	'one field moves, the rest of the delivery survives',
	merge({ rgs: { baseUrl: 'https://staging.example' } }, DELIVERY).profile,
	{ ...DELIVERY, rgs: { ...DELIVERY.rgs, baseUrl: 'https://staging.example' } },
);
check('an empty patch changes nothing', merge({}, DELIVERY).profile, DELIVERY);
check('a trailing slash is normalised off', merge({ rgs: { baseUrl: 'https://a.example/' } }).profile.rgs.baseUrl, 'https://a.example'); // prettier-ignore
check('a bare host is kept (the transport adds the scheme)', merge({ rgs: { baseUrl: 'localhost:7788' } }).profile.rgs.baseUrl, 'localhost:7788'); // prettier-ignore
check('a path prefix is kept (our test server proxies per game)', merge({ rgs: { baseUrl: 'games.example/api/stargate' } }).profile.rgs.baseUrl, 'games.example/api/stargate'); // prettier-ignore

console.log('\n3. an explicit empty baseUrl is same-origin; whitespace is a typo');
check('explicit empty clears the delivery host', merge({ rgs: { baseUrl: '' } }, DELIVERY).profile.rgs.baseUrl, ''); // prettier-ignore
check('omitting it keeps the delivery host', merge({ rgs: {} }, DELIVERY).profile.rgs.baseUrl, 'https://rgs.example'); // prettier-ignore
check('whitespace does NOT mean same-origin', merge({ rgs: { baseUrl: '  ' } }, DELIVERY).profile.rgs.baseUrl, 'https://rgs.example'); // prettier-ignore
check('...and says so', merge({ rgs: { baseUrl: '  ' } }, DELIVERY).warnings.length, 1);

console.log('\n4. an unsafe baseUrl is refused and the base stands');
for (const bad of [
	'javascript:alert(1)',
	'data:text/html,x',
	'//evil.example',
	'has space.example',
	'https://rgs.example@evil.example',
	'https://user:pw@evil.example',
	'https://good.example/x?y',
	'https://good.example/x#y',
	'https://a\\b.example',
]) {
	check(`${JSON.stringify(bad)} is ignored`, merge({ rgs: { baseUrl: bad } }, DELIVERY).profile.rgs.baseUrl, 'https://rgs.example'); // prettier-ignore
	check(`...and is reported`, merge({ rgs: { baseUrl: bad } }, DELIVERY).warnings.length, 1);
}

console.log('\n5. endpoint is stored with a leading slash');
check('a bare path gains one', merge({ rgs: { endpoint: 'webnode/engine.js' } }).profile.rgs.endpoint, '/webnode/engine.js'); // prettier-ignore
check('an absolute path is untouched', merge({ rgs: { endpoint: '/webnode/engine.js' } }).profile.rgs.endpoint, '/webnode/engine.js'); // prettier-ignore
check('an empty endpoint is refused', merge({ rgs: { endpoint: '' } }, DELIVERY).profile.rgs.endpoint, '/webnode/engine.js'); // prettier-ignore
check('an endpoint with whitespace is refused', merge({ rgs: { endpoint: '/a b' } }, DELIVERY).profile.rgs.endpoint, '/webnode/engine.js'); // prettier-ignore

console.log('\n6. a malformed patch warns and changes nothing — and never silently');
check('a string patch', merge('nope', DELIVERY).profile, DELIVERY);
check('an array patch', merge([1, 2], DELIVERY).profile, DELIVERY);
check('a number where a bool belongs', merge({ session: { required: 1 } }, DELIVERY).profile.session.required, true); // prettier-ignore
check('...and is reported', merge({ session: { required: 1 } }, DELIVERY).warnings, ['session.required must be true or false — ignored']); // prettier-ignore
check('an object where a string belongs', merge({ rgs: { endpoint: {} } }, DELIVERY).profile.rgs.endpoint, '/webnode/engine.js'); // prettier-ignore
check('an empty session param is refused', merge({ session: { param: '  ' } }, DELIVERY).profile.session.param, 'sid'); // prettier-ignore
check('a typo\'d key is REPORTED, not swallowed', merge({ rgs: { baseURL: 'https://x.example' } }, DELIVERY).warnings, ['unknown field rgs.baseURL — ignored']); // prettier-ignore
check('...and leaves the baked target alone', merge({ rgs: { baseURL: 'https://x.example' } }, DELIVERY).profile.rgs.baseUrl, 'https://rgs.example'); // prettier-ignore
check('a wrong-typed SECTION is reported', merge({ rgs: 'https://x.example' }, DELIVERY).warnings, ['rgs must be an object — the whole section was ignored']); // prettier-ignore
check('a _comment is a legal profile field', merge({ _comment: 'x' }, DELIVERY).warnings, []);

console.log('\n7. config.json may repoint the build but not re-police it');
const policed = { rgs: { allowUrlOverride: true, withCredentials: true }, session: { required: false } }; // prettier-ignore
check('an override cannot unpin the RGS', merge(policed, DELIVERY, 'override').profile.rgs.allowUrlOverride, false); // prettier-ignore
check('...nor re-credential the calls', merge(policed, DELIVERY, 'override').profile.rgs.withCredentials, false); // prettier-ignore
check('...nor make a missing token survivable', merge(policed, DELIVERY, 'override').profile.session.required, true); // prettier-ignore
check('...and each refusal is reported', merge(policed, DELIVERY, 'override').warnings.length, 3);
check('the BAKED half may set all three', merge(policed, DELIVERY, 'baked').profile.rgs.allowUrlOverride, true); // prettier-ignore
check('an override CAN repoint the host', merge({ rgs: { baseUrl: 'https://staging.example' } }, DELIVERY, 'override').profile.rgs.baseUrl, 'https://staging.example'); // prettier-ignore
check('...and rename the session param', merge({ session: { param: 'token' } }, DELIVERY, 'override').profile.session.param, 'token'); // prettier-ignore

console.log('\n7b. the token can be taken from the operator page instead of the URL');
check('a profile can ask for it', merge({ session: { source: 'host' } }).profile.session.source, 'host'); // prettier-ignore
check('...and back again', merge({ session: { source: 'param' } }, DELIVERY).profile.session.source, 'param'); // prettier-ignore
check('anything else is refused', merge({ session: { source: 'postMessage' } }, DELIVERY).profile.session.source, DELIVERY.session.source); // prettier-ignore
check('...and named', merge({ session: { source: 'postMessage' } }, DELIVERY).warnings, ['session.source must be "param" or "host" — ignored']); // prettier-ignore
check('omitting it keeps what the build was cut with', merge({ session: {} }, DELIVERY).profile.session.source, DELIVERY.session.source); // prettier-ignore

console.log('\n7d. rgs.source is bake-only, and only two values mean anything');
{
	const base = DEFAULT_DELIVERY_PROFILE;
	check(
		'a baked profile may declare the operator page as the RGS origin',
		mergeDeliveryProfile(base, { rgs: { source: 'host' } }, 'baked').profile.rgs.source,
		'host',
	);
	// The reason it is bake-only: `config.json` lives on the operator's own server and may repoint a
	// build between THEIR hosts. Letting it switch the build to "whatever your page says" is a
	// different power, and it is the same one `allowUrlOverride: false` was added to deny.
	const overridden = mergeDeliveryProfile(base, { rgs: { source: 'host' } }, 'override');
	check('an operator config.json may not', overridden.profile.rgs.source, 'profile');
	check(
		'...and says why',
		overridden.warnings.some((w) => w.startsWith('rgs.source is set when the build is cut')),
		true,
	);
	const nonsense = mergeDeliveryProfile(base, { rgs: { source: 'wherever' } }, 'baked');
	check('an unknown value is ignored', nonsense.profile.rgs.source, 'profile');
	check('...loudly', nonsense.warnings.length > 0, true);
}

console.log('\n7c. the BUILD validator knows every field the runtime does');
{
	// These two lists are one fact in two places — `config-vite` fails the build on an unknown
	// field, this package degrades at runtime — and they have drifted TWICE: once for
	// `rgs.simpleRequest`, once for `session.source`. Each time the symptom was the same and
	// mystifying: a profile using the brand-new field could not be built at all.
	//
	// Compared by IMPORTING the list, not by scraping the file for it, which is only possible now
	// that the check lives in its own leaf module — see the note there. The scrape this replaces
	// asked whether the string `'simpleRequest'` appeared anywhere in a block of source, which is a
	// weaker claim than it looks: it would have passed on a field mentioned in a comment.
	for (const [section, fields] of Object.entries(DELIVERY_PROFILE_FIELDS)) {
		const known = KNOWN_PROFILE_FIELDS[section] ?? [];
		for (const field of fields) {
			check(
				`config-vite knows ${section ? `${section}.` : ''}${field}`,
				known.includes(field),
				true,
			);
		}
	}
	// And the other direction, which the scrape could not ask at all: a field the BUILD accepts and
	// the runtime would discard as unknown.
	for (const [section, fields] of Object.entries(KNOWN_PROFILE_FIELDS)) {
		for (const field of fields) {
			check(
				`the runtime knows ${section ? `${section}.` : ''}${field}`,
				(DELIVERY_PROFILE_FIELDS[section] ?? []).includes(field),
				true,
			);
		}
	}
}

console.log('\n7e. the BUILD refuses a delivery that names no RGS at all');
{
	const problems = (profile: unknown) => deliveryProfileProblems(profile);
	const session = { source: 'host', param: 'sid', required: true };
	const names = (list: string[]) => list.some((p) => p.startsWith('rgs.baseUrl'));

	// The operator delivery: nothing here names a host, because the operator's page IS the origin.
	check(
		'source:host stands in for a base URL',
		names(problems({ id: 'x', rgs: { source: 'host', endpoint: '/webnode/engine' }, session })),
		false,
	);
	// The accident the check exists to stop. An omitted base and an empty one are the same mistake,
	// and neither is a declaration that the page is the RGS.
	check('a missing base is still fatal', names(problems({ id: 'x', rgs: {}, session })), true);
	check(
		'an empty base is still fatal',
		names(problems({ id: 'x', rgs: { baseUrl: '   ' }, session })),
		true,
	);
	check(
		'a source we do not know is refused',
		problems({ id: 'x', rgs: { source: 'somewhere', baseUrl: 'h.example' }, session }),
		['rgs.source must be "profile" or "host"'],
	);
	// The shipped profiles must both survive their own validator — the check that would have caught
	// each of the two drifts on its own.
	for (const name of ['2complex', 'operator-embed']) {
		const json = JSON.parse(
			readFileSync(fileURLToPath(new URL(`./profiles/${name}.json`, import.meta.url)), 'utf8'),
		);
		check(`profiles/${name}.json builds`, problems(json), []);
	}
}

console.log('\n8. the shipped partner profile resolves to the transport we intend');
const shipped = JSON.parse(
	readFileSync(fileURLToPath(new URL('./profiles/2complex.json', import.meta.url)), 'utf8'),
);
const resolved = merge(shipped);
check('parses and merges cleanly', resolved.warnings, []);
check('RGS', `${resolved.profile.rgs.baseUrl}${resolved.profile.rgs.endpoint}`, 'https://gs.2-complex.science/webnode/engine'); // prettier-ignore
check('uncredentialed, so the partner can answer CORS with a wildcard', resolved.profile.rgs.withCredentials, false); // prettier-ignore
check('the host page cannot repoint the wallet', resolved.profile.rgs.allowUrlOverride, false);
check('a missing token is fatal, not a demo wallet', resolved.profile.session.required, true);
check('posts as a CORS simple request (the node sends no Access-Control-Allow-Headers)', resolved.profile.rgs.simpleRequest, true); // prettier-ignore

console.log('\n9. the operator-embed profile reaches the RGS without naming a host');
{
	const embed = merge(
		JSON.parse(
			readFileSync(
				fileURLToPath(new URL('./profiles/operator-embed.json', import.meta.url)),
				'utf8',
			),
		),
	);
	check('parses and merges cleanly', embed.warnings, []);
	// The whole point: no host anywhere in the artifact. The operator's own infrastructure decides
	// it, which is the only party that knows it — and same-origin means no CORS at all.
	check('the page is the origin', embed.profile.rgs.source, 'host');
	check('...so nothing names a host', embed.profile.rgs.baseUrl, '');
	check('no simple-request dodge needed', embed.profile.rgs.simpleRequest, false);
	check('the host page cannot repoint the wallet', embed.profile.rgs.allowUrlOverride, false);
	check('the token comes from the page, not the URL', embed.profile.session.source, 'host');
	check('a missing token is fatal, not a demo wallet', embed.profile.session.required, true);
}

console.log(
	failures === 0 ? '\nAll delivery-profile claims hold.\n' : `\n${failures} FAILED claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
