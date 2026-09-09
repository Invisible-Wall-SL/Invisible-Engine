/**
 * Offline fixture for the project-purge safety rules. Bundle first (it reaches
 * `projectPaths` → `engine-layout`, whose published `dist` uses extensionless imports),
 * then run — from the repo root, with a writable <tmp>:
 *
 *   node node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/bin/esbuild \
 *     apps/launcher-api/projectPurge.fixture.ts --bundle --platform=node --format=esm \
 *     --outfile=<tmp>/projectPurge.fixture.mjs && node <tmp>/projectPurge.fixture.mjs
 *
 * It imports `projectRoots.ts`, NOT `projectPurge.ts` — the pure rules were split into
 * their own module precisely so this command needs no `$env/dynamic/private` stub (the
 * DB/R2 imports esbuild cannot resolve). A documented command that doesn't run is the
 * failure mode a fixture exists to prevent.
 *
 * Why this exists: this app's `build` is a bare `vite build` that strips types without
 * checking them, so a green build proves nothing about which keys a purge selects — and
 * a purge is unrecoverable. These assertions are the only thing standing between a
 * mistake here and someone's artwork.
 *
 * The regression it pins: `r2Slug` maps every non-alphanumeric to `_` and truncates at
 * 60 chars, while a project key legally contains BOTH `-` and `_`
 * (`^[a-z0-9][a-z0-9_-]{0,63}$`). So `my-game` and `my_game` are two DIFFERENT projects
 * that share ONE R2 prefix, and `editor/<project>/` drops the client segment, so two
 * projects under different clients collide there too. Purging either would silently
 * delete the other's work. No such pair exists in the bucket today; this check is what
 * stops one being purgeable tomorrow.
 */

import { collidingProjectKeys, projectR2Roots } from './src/lib/server/projectRoots.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

/** Keys are `^[a-z0-9][a-z0-9_-]{0,63}$` — every key used below must satisfy it. */
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const key = (k: string): string => {
	if (!KEY_RE.test(k)) {
		failures += 1;
		console.error(`  FAIL fixture uses an INVALID project key: ${k}`);
	}
	return k;
};

const LONG_A = key('a'.repeat(61) + 'x');
const LONG_B = key('a'.repeat(61) + 'y');
const LONG_C = key('a'.repeat(60));

console.log('project R2 roots — what a project owns');
check('both roots, client-scoped repo + client-less editor root', projectR2Roots('borut', 'test6'), [
	'borut/test6/',
	'editor/test6/',
]);
check('a null client falls back to the unassigned bucket', projectR2Roots(null, 'test6'), [
	'unassigned/test6/',
	'editor/test6/',
]);
check('slugging applies to BOTH segments', projectR2Roots('Invisible Wall', 'My-Game'), [
	'invisible_wall/my_game/',
	'editor/my_game/',
]);
// The real prefix the incident hinged on, asserted verbatim.
check(
	'test6 resolves to the prefix holding the 2.26 GB',
	projectR2Roots('invisible_wall', 'test6'),
	['invisible_wall/test6/', 'editor/test6/'],
);

console.log('\ncollision guard — the purge must REFUSE these');
check(
	'hyphen vs underscore collide under one client',
	collidingProjectKeys({ key: key('my-game'), clientKey: 'iw' }, [
		{ key: key('my_game'), clientKey: 'iw' },
	]),
	['my_game'],
);
check(
	'…and still collide via editor/ across DIFFERENT clients',
	collidingProjectKeys({ key: key('my-game'), clientKey: 'iw' }, [
		{ key: key('my_game'), clientKey: 'borut' },
	]),
	['my_game'],
);
check(
	'keys differing only past 60 chars collide',
	collidingProjectKeys({ key: LONG_A, clientKey: 'iw' }, [{ key: LONG_B, clientKey: 'iw' }]),
	[LONG_B],
);
check(
	'every colliding project is reported, not just the first',
	collidingProjectKeys({ key: LONG_A, clientKey: 'iw' }, [
		{ key: LONG_B, clientKey: 'iw' },
		{ key: LONG_C, clientKey: 'borut' },
	]),
	[LONG_B, LONG_C],
);

console.log('\ncollision guard — the purge must ALLOW these');
check(
	'distinct keys under the same client are independent',
	collidingProjectKeys({ key: key('test6'), clientKey: 'invisible_wall' }, [
		{ key: key('test5'), clientKey: 'invisible_wall' },
		{ key: key('test7'), clientKey: 'invisible_wall' },
	]),
	[],
);
check(
	'the same key never collides with ITSELF',
	collidingProjectKeys({ key: key('test6'), clientKey: 'invisible_wall' }, [
		{ key: key('test6'), clientKey: 'invisible_wall' },
	]),
	[],
);
check('no other projects at all', collidingProjectKeys({ key: 'test6', clientKey: 'iw' }, []), []);

// The live roster at the time of writing — purging test6 must have been safe.
const LIVE = [
	{ key: 'cloud', clientKey: null },
	{ key: 'salmons', clientKey: 'invisible_wall' },
	{ key: 'bookofborut', clientKey: 'borut' },
	{ key: 'test1', clientKey: 'invisible_wall' },
	{ key: 'hotfruits', clientKey: 'borut' },
	{ key: 'bookofborutremake', clientKey: 'invisible_wall' },
	{ key: 'test2', clientKey: 'invisible_wall' },
	{ key: 'test3', clientKey: 'invisible_wall' },
	{ key: 'test4', clientKey: 'invisible_wall' },
	{ key: 'test5', clientKey: 'invisible_wall' },
];
check(
	'the real production roster is collision-free for test6',
	collidingProjectKeys({ key: 'test6', clientKey: 'invisible_wall' }, LIVE),
	[],
);
check(
	'…and for every project actually in it',
	LIVE.filter((p) => collidingProjectKeys(p, LIVE).length > 0).map((p) => p.key),
	[],
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
