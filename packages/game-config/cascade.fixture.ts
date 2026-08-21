/**
 * Offline fixture for the cascade (tumble) mechanic flag. This package's internal imports are
 * extensionless (bundler resolution), which bare `node` cannot resolve, so run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/game-config/cascade.fixture.ts
 *
 * The rule this pins is "the win model decides, the project may disagree", and the trap it guards
 * is the STORAGE half: `cascade` must be persisted only when it DEPARTS from the type's default.
 * Storing the agreeing value instead would add a field to every doc, which is invisible at build
 * time and shows up as a config that saves and comes back changed.
 */

import { normalizeGameConfigDoc } from './src/normalize.ts';
import { cascadeDefaultFor, normalizeCascade, resolveCascade } from './src/mechanics.ts';
import type { GameConfigDoc } from './src/types.ts';

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

console.log('\ncascade defaults follow the win model');
check('lines does not tumble', cascadeDefaultFor('lines'), false);
check('ways does not tumble', cascadeDefaultFor('ways'), false);
check('cluster tumbles', cascadeDefaultFor('cluster'), true);
check('scatter tumbles', cascadeDefaultFor('scatter'), true);

console.log('\nresolveCascade — absent means "ask the win model"');
check('un-authored doc ⇒ lines ⇒ off', resolveCascade(undefined), false);
check(
	'scatter, unstated ⇒ on',
	resolveCascade({ winModel: { type: 'scatter', minCount: 8 } }),
	true,
);
check(
	'cluster, unstated ⇒ on',
	resolveCascade({ winModel: { type: 'cluster', minCluster: 5, adjacency: 'orthogonal' } }),
	true,
);
check(
	'scatter, authored off ⇒ off',
	resolveCascade({ winModel: { type: 'scatter', minCount: 8 }, cascade: false }),
	false,
);
check('lines, authored on ⇒ on', resolveCascade({ cascade: true }), true);

console.log('\nnormalizeCascade — store ONLY a departure');
check('scatter + true ⇒ dropped (agrees)', normalizeCascade(true, 'scatter'), undefined);
check('scatter + false ⇒ kept', normalizeCascade(false, 'scatter'), false);
check('lines + false ⇒ dropped (agrees)', normalizeCascade(false, 'lines'), undefined);
check('lines + true ⇒ kept', normalizeCascade(true, 'lines'), true);
check('garbage ⇒ dropped', normalizeCascade('yes', 'lines'), undefined);
check('absent ⇒ dropped', normalizeCascade(undefined, 'cluster'), undefined);

console.log('\nround-trip through the real normalizer');
const base = {
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	paylines: { '0': [0, 0, 0, 0, 0] },
	symbols: { H1: { name: 'H1' } },
	paddingReels: {
		BR: [
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
			['H1', 'H1', 'H1'],
		],
	},
	betModes: {},
};

const agreeing = normalizeGameConfigDoc({
	...base,
	winModel: { type: 'scatter', minCount: 8 },
	cascade: true,
}) as GameConfigDoc;
check('a scatter that simply tumbles stores nothing', 'cascade' in agreeing, false);
check('...and still resolves on', resolveCascade(agreeing), true);

const departing = normalizeGameConfigDoc({
	...base,
	winModel: { type: 'scatter', minCount: 8 },
	cascade: false,
}) as GameConfigDoc;
check('a scatter that opts OUT stores the field', departing.cascade, false);
check('...and resolves off', resolveCascade(departing), false);

const linesOn = normalizeGameConfigDoc({ ...base, cascade: true }) as GameConfigDoc;
check('a lines game that opts IN stores the field', linesOn.cascade, true);
check('...and resolves on', resolveCascade(linesOn), true);

const untouched = normalizeGameConfigDoc({ ...base }) as GameConfigDoc;
check('a doc that never mentioned cascade is unchanged', 'cascade' in untouched, false);

console.log(failures === 0 ? '\nAll cascade assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
