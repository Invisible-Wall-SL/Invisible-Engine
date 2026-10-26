/**
 * Offline fixture for RULER GUIDES (P10.9) — run with `npx tsx apps/launcher-api/editorGuides.fixture.ts`.
 *
 * Pins: the stored shape canonicalizes (finite, rounded, sorted, de-duplicated, capped, empty ⇒
 * absent, so an untouched screen saves as before); a guide drag adds, moves and removes; the
 * rulers' tick spacing stays readable at any zoom; a guide is grabbed within a few screen pixels.
 * And the editor-only promise: every path that hands a doc or a def to a game strips them.
 */
import { readFileSync } from 'node:fs';
import {
	MAX_GUIDES_PER_AXIS,
	nearestGuide,
	normalizeEditorGuides,
	withoutEditorGuides,
} from 'engine-layout';
import {
	applyGuideDrag,
	hitGuide,
	rulerStep,
	rulerTicks,
} from './src/routes/(app)/editor/editorRulers.ts';

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

console.log('guides — the stored shape');
check(
	'per layout, sorted, rounded, de-duplicated, junk dropped',
	normalizeEditorGuides({
		desktop: { x: [640, 12.3456, 640, 'a', Number.NaN, -20], y: [360] },
		portrait: { x: [], y: [] },
		'': { x: [1] },
		junk: 7,
	}),
	{ desktop: { x: [-20, 12.35, 640], y: [360] } },
);
check('nothing to keep ⇒ absent', normalizeEditorGuides({ desktop: {} }), undefined);
check('not an object ⇒ absent', normalizeEditorGuides([1, 2]), undefined);
check(
	'capped per axis',
	normalizeEditorGuides({ d: { x: Array.from({ length: 100 }, (_, i) => i) } })?.d?.x?.length,
	MAX_GUIDES_PER_AXIS,
);
const once = normalizeEditorGuides({ desktop: { x: [3, 1], y: [2] } });
check('idempotent', normalizeEditorGuides(once), once);

console.log('guides — never handed to a game');
const scene = { id: 's', name: 'S', nodes: [], guides: { desktop: { x: [10] } } };
check('stripped', 'guides' in withoutEditorGuides(scene), false);
check('the rest kept', withoutEditorGuides(scene), { id: 's', name: 'S', nodes: [] });
check(
	'a guide-less item is returned as is',
	withoutEditorGuides(scene.nodes as never),
	scene.nodes,
);
const src = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
check(
	'loadDoc (every ship reader of a layout doc) strips every screen',
	src('./src/lib/server/editorStorage.ts').includes(
		'doc.scenes = doc.scenes.map(withoutEditorGuides)',
	),
	true,
);
for (const file of [
	'./src/routes/api/editor/doc/+server.ts',
	'./src/lib/server/runtimeBundle.ts',
]) {
	const text = src(file);
	check(
		`${file} resolves the shipped defs without guides`,
		text.includes('loadComponentForGame(id, projectKey)') && !/=> loadComponent\(/.test(text),
		true,
	);
}

console.log('guides — dragging');
const g = { x: [100, 300], y: [50] };
check(
	'a new guide is added',
	applyGuideDrag(g, { axis: 'x', index: null, value: 200, remove: false }),
	{
		x: [100, 200, 300],
		y: [50],
	},
);
check(
	'a new guide dropped on its ruler adds nothing',
	applyGuideDrag(g, { axis: 'y', index: null, value: 9, remove: true }),
	g,
);
check('a guide is moved', applyGuideDrag(g, { axis: 'x', index: 1, value: 50, remove: false }), {
	x: [50, 100],
	y: [50],
});
check(
	'a guide dropped on its ruler is removed',
	applyGuideDrag(g, { axis: 'y', index: 0, value: 50, remove: true }),
	{
		x: [100, 300],
	},
);

console.log('guides — grabbing and snapping');
check('grabbed within 4 screen px', hitGuide(g, { x: 103, y: 999 }, 1), { axis: 'x', index: 0 });
check('not beyond', hitGuide(g, { x: 105, y: 999 }, 1), null);
check('zoomed in, the world tolerance shrinks', hitGuide(g, { x: 103, y: 999 }, 2), null);
check('the nearest of two wins', hitGuide(g, { x: 102, y: 51 }, 1), { axis: 'y', index: 0 });
check('nearestGuide within tolerance', nearestGuide([10, 20], 18, 3), 20);
check('nearestGuide none', nearestGuide([10, 20], 15, 3), undefined);

console.log('rulers');
check('1:1 labels every 100 px', rulerStep(1), 100);
check('zoomed in to 4×, every 20', rulerStep(4), 20);
check('zoomed out to 0.1×, every 1000', rulerStep(0.1), 1000);
check('ticks cover the range on the step', rulerTicks(-30, 250, 100), [0, 100, 200]);
check('an empty range has none', rulerTicks(10, 10, 100), []);

if (failures) {
	console.error(`\n✗ editor guides: ${failures} failed`);
	process.exit(1);
}
console.log('\n✓ editor guides: all checks pass');
