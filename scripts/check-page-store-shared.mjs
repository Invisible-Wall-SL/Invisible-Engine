/**
 * Every exporter that ships atlas pages shares ONE page store, and only its owner prunes it.
 *
 *     node scripts/check-page-store-shared.mjs
 *
 * WHY A GUARD AND NOT A TYPE. `pageStore` is an OPTIONAL parameter on `exportSpineBundle`, and it
 * has to be: `bootSplashExport` is deliberately exempt (below). Optional means a new caller that
 * simply does not pass it compiles, ships, and silently writes a private copy of every page it
 * touches — which is exactly what `symbolExport` did. Eight symbols sharing `S_Game_Reel` shipped
 * that page eight times (12.3 MB of one delivery), and the game loaded identical bytes as eight
 * separate GPU textures. `pageStore.ts`'s own header records where that ends: a monotonic VRAM
 * climb that OOM-crashed iOS.
 *
 * The launcher-api build does not type-check (see `apps/launcher-api/CLAUDE.md`), so a compile-time
 * guard would not run here even if one were possible. This reads the source instead.
 *
 * Six claims:
 *   1. The orchestrator constructs the store — exactly one, for the whole pass.
 *   2. It passes that store to BOTH parallel exporters that write pages.
 *   3. `symbolExport` forwards it to `exportSpineBundle` AND routes its own SHEET pages through
 *      it. The sheet half was the one left behind: symbol sheet pages are the largest textures a
 *      board holds, and without the store they shipped raw and undeduped.
 *   4. NO exporter prunes `_pages/` — not even one that made its own store. A page is stale only
 *      once every exporter that could claim it has run, and no single exporter can see the others
 *      (on the bake path they are separate HTTP endpoints). Only the orchestrator prunes.
 *   5. The orchestrator prunes, and does it AFTER the exports have all completed.
 *   6. The BAKE path passes a store too. `bake-editor-doc.mjs` calls `/api/editor/export-symbols`
 *      as its own endpoint, and that endpoint not passing a store is how every standalone game
 *      repo shipped uncompressed symbol pages while the publish path shipped compressed ones.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SERVER = `${ROOT}/apps/launcher-api/src/lib/server`;
const read = (f) => readFileSync(`${SERVER}/${f}`, 'utf8');

/** `bootSplashExport` is EXEMPT, on purpose and on the record. The splash paints before the bundle
 *  is fetched and is the first thing a player ever sees, so its pages stay a private copy until the
 *  shared path has been proven on a real export. It is ~1 MB. Remove it from this list when that
 *  changes — do not quietly add a sixth caller beside it. */
const EXEMPT = new Set(['bootSplashExport.ts']);

let checks = 0;
const ok = (label, condition, detail = '') => {
	if (!condition) {
		console.error(`\n  FAIL  ${label}${detail ? `\n        ${detail}` : ''}\n`);
		process.exit(1);
	}
	checks += 1;
	console.log(`  [ok] ${label}`);
};

const orchestrator = read('runtimeBundle.ts');
const art = read('editorArtExport.ts');
const symbols = read('symbolExport.ts');

console.log('1. the orchestrator owns exactly one store');
ok(
	'runtimeBundle constructs a PageStore',
	/const pageStore = new PageStore\(/.test(orchestrator),
	'the pass-wide store lives in runtimeBundle.ts',
);
ok(
	'it constructs exactly one',
	(orchestrator.match(/new PageStore\(/g) ?? []).length === 1,
	'two stores in one pass dedup against each other, i.e. not at all',
);

console.log('2. both page-writing exporters receive it');
for (const call of ['exportEditorArt', 'exportEditorSymbols']) {
	const invocation = new RegExp(`${call}\\([^)]*\\{[^}]*pageStore[^}]*\\}`, 's');
	ok(`${call} is passed pageStore`, invocation.test(orchestrator));
}

console.log('3. symbolExport forwards it to the bundle export AND uses it for sheets');
ok(
	'symbolExport accepts a pageStore',
	/pageStore\?: PageStore/.test(symbols),
	'without it every symbol rig copies its own atlas page',
);
ok(
	'symbolExport passes it to exportSpineBundle',
	/exportSpineBundle\(\{[\s\S]*?pageStore[\s\S]*?\}\)/.test(symbols),
);
ok(
	'its SHEET pages go through the store too',
	/pageStore\.ensure\(/.test(symbols),
	'a sheet that skips the store ships a raw 32 MB page — the largest texture on the board',
);
ok(
	'and the sheet JSON references the shared page',
	/PAGE_REF_PREFIX/.test(symbols),
	'the deduped page is referenced as `../../_pages/<hash>`, not by a private copy',
);
ok(
	'the compressed tier gets its own sheet JSON',
	/ktx2Json/.test(symbols),
	'without a ktx2 twin JSON the game has nothing compressed to select',
);

console.log('4. no exporter prunes _pages — only the orchestrator does');
for (const [name, src] of [
	['editorArtExport.ts', art],
	['symbolExport.ts', symbols],
]) {
	ok(
		`${name} does not list _pages/ to prune it`,
		!/listAllKeys\(\s*`?\$\{deployPrefix\}_pages\//.test(src),
		'an exporter cannot see what the others still claim; runtimeBundle prunes once, at the end',
	);
}

console.log('5. the orchestrator prunes, after the exports');
const pruneAt = orchestrator.search(/_pages\/`\)\)\.filter|prune:pages/);
const joinAt = orchestrator.indexOf('await Promise.all([');
ok('runtimeBundle prunes _pages', pruneAt !== -1);
ok(
	'it prunes AFTER the Promise.all',
	joinAt !== -1 && pruneAt > joinAt,
	'pruning before the join deletes pages a parallel export is still writing',
);

console.log('6. the bake path passes a store as well as the publish path');
const bakeEndpoint = readFileSync(
	`${ROOT}/apps/launcher-api/src/routes/api/editor/export-symbols/+server.ts`,
	'utf8',
);
ok(
	'the export-symbols endpoint constructs a PageStore',
	/new PageStore\(/.test(bakeEndpoint),
	'bake-editor-doc.mjs calls this endpoint; without a store a baked game ships raw pages',
);
ok(
	'and hands it to exportEditorSymbols',
	/exportEditorSymbols\([^)]*\{[\s\S]*?pageStore[\s\S]*?\}\)/.test(bakeEndpoint),
);

console.log('7. no unexempted caller skips the store');
for (const file of ['editorArtExport.ts', 'symbolExport.ts', 'bootSplashExport.ts']) {
	const src = read(file);
	if (!/exportSpineBundle\(/.test(src)) continue;
	const passes = /exportSpineBundle\(\{[\s\S]*?pageStore[\s\S]*?\}\)/.test(src);
	ok(
		`${file} ${EXEMPT.has(file) ? 'is exempt' : 'passes the store'}`,
		EXEMPT.has(file) ? !passes || true : passes,
		EXEMPT.has(file) ? '' : 'a caller without the store writes a private copy of every page',
	);
}

console.log(`\nPASS: ${checks} checks.`);
