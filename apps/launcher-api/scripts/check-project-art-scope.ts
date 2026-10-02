/**
 * The Scene Editor's art scope (`$lib/server/projectArtScope.ts`): a project may read the ATLASES its
 * doc and its placed component defs reference — a SHARED def's atlas authored in another project of
 * the same client (`hudReadout` → `test6`'s `S_UI`) — and nothing beyond them.
 *
 *   1. `candidateAtlases` keeps only this client's keys SHAPED like an atlas manifest: another
 *      client's key, a traversal, an arbitrary `.json` (a doc, a config), an image, a folder are
 *      dropped.
 *   2. `borrowsClientArt` refuses the shared `unassigned` pseudo-client and the default project.
 *   3. `artScopeAllows` allows exactly the scope's keys — no prefix matching, no traversal.
 *   4. Both editor art gates (regions + asset) go through `assertProjectArt`, so a referenced atlas
 *      AND its page stream — without it the editor drew every such frame as a grey placeholder.
 *
 * Run:  pnpm --filter launcher-api check:art-scope
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	artScopeAllows,
	borrowsClientArt,
	candidateAtlases,
} from '../src/lib/server/projectArtScope.ts';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const SHARED_DEF_ATLAS = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
const PAGE = 'invisible_wall/test6/sheets/S_UI/S_UI.png';

console.log('1. only this client’s atlas manifests');
const kept = candidateAtlases(
	[
		SHARED_DEF_ATLAS,
		'other_client/game/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/../other_client/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/test6/editor/scenes.json',
		'invisible_wall/test6/config/config.json',
		'invisible_wall/test6/sheets/S_UI/S_UI.png',
		'invisible_wall/',
		'invisible_wall/test6/spines/star/',
	],
	'Invisible_Wall',
);
check('a sibling project’s atlas manifest is kept', kept.includes(SHARED_DEF_ATLAS));
check('everything else is dropped', kept.length === 1);

console.log('2. who may borrow client art');
check('a named client’s project may', borrowsClientArt('Invisible_Wall', 'hw-3pots-sample'));
check('NOT the unassigned pseudo-client', !borrowsClientArt('unassigned', 'some-game'));
check('NOT the default project', !borrowsClientArt('Invisible_Wall', 'cloud'));

console.log('3. what the scope allows');
const scope = { keys: new Set([SHARED_DEF_ATLAS, PAGE]) };
check('the referenced atlas', artScopeAllows(scope, SHARED_DEF_ATLAS));
check('its page', artScopeAllows(scope, PAGE));
check(
	'NOT a file next to the page',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/x.png'),
);
check(
	'NOT a traversal dressed as a scope key',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/../../editor/scenes.json'),
);

console.log('4. both editor art gates use the project art scope');
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
