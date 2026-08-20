/**
 * `ways` FILLED reference layout harness.
 *
 *   pnpm --filter bg-scene-spike run waysreference
 *
 * Proves the ways reference layout is the lines one up to the Book-of mechanic, and — the assertion
 * that actually protects something — that teaching `defaultLayout` a second game type did NOT
 * disturb the lines doc, which ships as `apps/lines`' `fallbackEditorScenes`.
 */

import {
	defaultLayout,
	waysReferenceLayout,
	getReferenceLayout,
	listImportableKinds,
	listFullSceneSets,
	type LayoutDoc,
} from 'engine-layout';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

console.log('ways reference layout\n');

const lines = defaultLayout('lines');
const ways = waysReferenceLayout();

// 1. It is FILLED — the whole point. A skeleton would make "Import composed reference" pointless.
assert('ways ships a filled (art-bearing) reference layout', !!getReferenceLayout('ways'));
assert(
	'ways is offered in "Import composed reference"',
	listImportableKinds().some((k) => k.id === 'ways'),
);
assert(
	'ways is still offered in "New game from kind"',
	listFullSceneSets().some((k) => k.gameType === 'ways'),
);
assert(
	'cluster/scatter stay engine-skeleton (not importable)',
	!getReferenceLayout('cluster') && !getReferenceLayout('scatter'),
);

// 2. The doc identifies as ways, and carries the board art the import rewrites per project.
assert('doc gameType/projectKey are ways', ways.gameType === 'ways' && ways.projectKey === 'ways');
const artKeys = (doc: LayoutDoc) =>
	JSON.stringify(doc)
		.match(/"assetKey":"[^"]+"/g)
		?.sort() ?? [];
assert(
	'carries the same board-frame art keys as lines',
	JSON.stringify(artKeys(ways)) === JSON.stringify(artKeys(lines)),
	artKeys(ways).join(','),
);

// 3. The ONLY difference is the Book-of mechanic scene.
assert(
	'omits the specialBook scene (no expanding symbol in a ways game)',
	!ways.scenes.some((s) => s.id === 'specialBook'),
);
const ignoreType = (doc: LayoutDoc) =>
	JSON.stringify(doc).replace(/"(gameType|projectKey)":"(lines|ways)"/g, '"$1":"X"');
assert(
	'otherwise byte-identical to the lines doc',
	ignoreType({ ...lines, scenes: lines.scenes.filter((s) => s.id !== 'specialBook') }) ===
		ignoreType(ways),
);

// 4. PARITY — the lines doc that ships as `fallbackEditorScenes` is untouched by all of the above.
assert(
	'lines still ships its specialBook scene',
	lines.scenes.some((s) => s.id === 'specialBook'),
);
assert(
	'every option combo still builds for lines',
	[
		{},
		{ buttons: true },
		{ transition: true },
		{ freeSpinOverlays: true },
		{ winInstance: true },
		{ buttons: true, transition: true, freeSpinOverlays: true, winInstance: true },
	].every((o) => defaultLayout('lines', o).scenes.length > 0),
);
assert(
	'an unknown game type still throws rather than silently returning lines',
	(() => {
		try {
			defaultLayout('crash');
			return false;
		} catch {
			return true;
		}
	})(),
);

console.log(`\n${failed ? 'WAYS REFERENCE HARNESS: FAILED' : 'WAYS REFERENCE HARNESS: PASSED'}`);
process.exit(failed ? 1 : 0);
