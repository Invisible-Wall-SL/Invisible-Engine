/**
 * The family set (`families.js`, `docs/design/phase-11.md` §2.2): how `PUBLIC_IE_FAMILIES` parses,
 * and that the seam plugin swaps a left-out family's seam for its stub, both in `apps/lines` and in
 * a standalone game repo's `engine/apps/lines/src` layout, and leaves everything else alone.
 *
 *     node packages/config-vite/families.fixture.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compiledFamilies, familySeams } from './families.js';

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};
const same = (name, got, want) =>
	check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const ALL = ['slot', 'match3', 'arcade', 'card'];
same('unset ⇒ all', compiledFamilies(undefined), ALL);
same('all ⇒ all', compiledFamilies('all'), ALL);
same('empty ⇒ every family (a blank variable is unset)', compiledFamilies(' '), [
	'slot',
	'match3',
	'arcade',
	'card',
]);
same('slot ⇒ slot only', compiledFamilies('slot'), ['slot']);
same('slot ⇒ slot only', compiledFamilies('slot'), ['slot']);
same('a list keeps its families, slot implied', compiledFamilies(' card , match3'), [
	'slot',
	'match3',
	'card',
]);
let threw = false;
try {
	compiledFamilies('match-3');
} catch {
	threw = true;
}
check('an unknown family throws', threw);

const LINES_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/lines/src');
const resolveIn = (families, source, importer) => familySeams(families).resolveId(source, importer);

const game = join(LINES_SRC, 'components/Game.svelte');
const layout = join(LINES_SRC, 'routes/+layout.ts');
for (const family of ['match3', 'arcade', 'card']) {
	same(
		`slot-only: ${family}'s seam ⇒ its stub`,
		resolveIn(['slot'], `../families/${family}`, game),
		join(LINES_SRC, 'families/off', `${family}.ts`).replace(/\\/g, '/'),
	);
	same(`all: ${family}'s seam is left alone`, resolveIn(ALL, `../families/${family}`, game), null);
}
same(
	'a svelte importer with a query resolves the same',
	resolveIn(['slot'], '../families/card.ts', `${game}?svelte&type=script`),
	join(LINES_SRC, 'families/off/card.ts').replace(/\\/g, '/'),
);
same(
	'a kept family is left alone',
	resolveIn(['slot', 'arcade'], '../families/arcade', layout),
	null,
);
same('a bare package name is left alone', resolveIn(['slot'], 'families/match3', game), null);

const repo = mkdtempSync(join(tmpdir(), 'ie-families-'));
try {
	const src = join(repo, 'engine/apps/lines/src');
	mkdirSync(join(src, 'families/off'), { recursive: true });
	mkdirSync(join(src, 'game'), { recursive: true });
	writeFileSync(join(src, 'families/match3.ts'), '');
	writeFileSync(join(src, 'families/off/match3.ts'), '');
	writeFileSync(join(src, 'families/arcade.ts'), '');
	same(
		'a game repo (engine/apps/lines/src): the seam ⇒ its stub',
		resolveIn(['slot'], '../families/match3', join(src, 'game/actor.ts')),
		join(src, 'families/off/match3.ts').replace(/\\/g, '/'),
	);
	same(
		'a seam with no stub beside it is left alone',
		resolveIn(['slot'], '../families/arcade', join(src, 'game/actor.ts')),
		null,
	);
} finally {
	rmSync(repo, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} family-set check(s) failed`);
	process.exit(1);
}
console.log('\nfamily set ok');
