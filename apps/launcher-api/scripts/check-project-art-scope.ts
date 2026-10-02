/**
 * The Scene Editor's art scope (`$lib/server/projectArtScope.ts`): a project may read the art its doc
 * and its placed component defs reference — a SHARED def's atlas authored in another project of the
 * same client (`hudReadout` → `test6`'s `S_UI`) — and nothing beyond it.
 *
 *   1. `withinClient` keeps only the client's own keys: another client's key, a `..` key and a
 *      leading-slash key are dropped.
 *   2. `artScopeAllows` allows an exact referenced key and any file under a referenced spine folder,
 *      and refuses a sibling file, a look-alike prefix and a traversal.
 *   3. Both editor art gates (regions + asset) go through `assertProjectArt`, so a referenced atlas
 *      AND its page stream — without it the editor drew every such frame as a grey placeholder.
 *
 * Run:  pnpm --filter launcher-api check:art-scope
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artScopeAllows, withinClient } from '../src/lib/server/projectArtScope.ts';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const SHARED_DEF_ATLAS = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
const PAGE = 'invisible_wall/test6/output/S_UI.png';

console.log('1. only the client’s own keys');
const kept = withinClient(
	[
		SHARED_DEF_ATLAS,
		'other_client/game/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/../other_client/x.json',
		'/invisible_wall/test6/x.json',
	],
	'Invisible_Wall',
);
check('a sibling project of the same client is kept', kept.includes(SHARED_DEF_ATLAS));
check('another client, a traversal and an absolute key are dropped', kept.length === 1);

console.log('2. what the scope allows');
const scope = {
	keys: new Set([SHARED_DEF_ATLAS, PAGE]),
	prefixes: ['invisible_wall/test6/spines/star/'],
};
check('the referenced atlas', artScopeAllows(scope, SHARED_DEF_ATLAS));
check('its page', artScopeAllows(scope, PAGE));
check(
	'a file inside a referenced spine folder',
	artScopeAllows(scope, 'invisible_wall/test6/spines/star/star.json'),
);
check(
	'NOT an unreferenced sibling file',
	!artScopeAllows(scope, 'invisible_wall/test6/manifests/atlas_manifest_S_Other.json'),
);
check(
	'NOT a look-alike folder',
	!artScopeAllows(scope, 'invisible_wall/test6/spines/starfish/x.json'),
);
check(
	'NOT a traversal out of a spine folder',
	!artScopeAllows(scope, 'invisible_wall/test6/spines/star/../../secret.json'),
);

console.log('3. both editor art gates use the project art scope');
for (const route of ['regions', 'asset']) {
	const src = readFileSync(join(here, `../src/routes/api/editor/${route}/+server.ts`), 'utf8');
	check(
		`/api/editor/${route} gates through assertProjectArt`,
		/await assertProjectArt\(/.test(src),
	);
	check(
		`/api/editor/${route} no longer gates on the bare prefixes`,
		!/\bassertAllowed\(/.test(src),
	);
}

console.log(failures === 0 ? '\nart scope: OK' : `\nart scope: ${failures} FAILED`);
if (failures > 0) process.exit(1);
