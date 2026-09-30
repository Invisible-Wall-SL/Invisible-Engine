/**
 * Invisible Flow v2 — LOADING-BAR DEFAULT PARAMS harness.
 *
 *   pnpm --filter flow-spike run loadingbar
 *
 * Proves, HEADLESSLY over the REAL `engine-layout` modules, that `resolveComponentParams` applies
 * `LOADING_BAR_DEF.defaultInstanceParams` at runtime, and pins WHAT that seed is.
 *
 * History: a hand-authored / scaffold `loadingBar` node (no `params`) used to get no
 * `defaultInstanceParams` at all (c98e4447 fixed that). The seed then carried `completeOnLoaded`
 * too, which silently released a splash the author was holding with `showContainer{awaitComplete}`
 * — a second, invisible owner of visibility. #560 dropped it: the seed is `{ tapToContinue: true }`
 * only, and an author who wants a self-dismissing splash ticks "On loaded" explicitly.
 *
 * Assertions:
 *   1. The scaffold loadingBar resolves `tapToContinue` = true and does NOT auto-advance.
 *   2. An explicit instance/project value still WINS over the seed, in both directions.
 *   3. A def with NO `defaultInstanceParams` is unaffected (regression control) — no keys invented.
 *
 * Prints PASS/FAIL per assertion + a final `LOADING-BAR DEFAULTS HARNESS: PASSED`.
 */

import {
	LOADING_BAR_DEF,
	isCompleteOnLoadedEnabled,
	isTapToContinueEnabled,
	resolveComponentParams,
	type ComponentDef,
} from 'engine-layout';

let failures = 0;
const check = (label: string, cond: boolean): void => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
	if (!cond) failures += 1;
};

// 1 — the scaffold (param-less) loadingBar waits for the tap and nothing else.
const scaffold = resolveComponentParams(LOADING_BAR_DEF, {}, undefined);
check('scaffold loadingBar: tapToContinue === true', scaffold.tapToContinue === true);
check('scaffold loadingBar: isTapToContinueEnabled', isTapToContinueEnabled(scaffold) === true);
check(
	'scaffold loadingBar: completeOnLoaded is NOT seeded',
	scaffold.completeOnLoaded === undefined,
);
check(
	'scaffold loadingBar: isCompleteOnLoadedEnabled is false',
	isCompleteOnLoadedEnabled(scaffold) === false,
);

// 2 — explicit values win over the seed.
const autoAdvance = resolveComponentParams(LOADING_BAR_DEF, { completeOnLoaded: true }, undefined);
check(
	'explicit completeOnLoaded:true enables auto-advance',
	isCompleteOnLoadedEnabled(autoAdvance),
);
check(
	'the tapToContinue seed survives an unrelated explicit param',
	isTapToContinueEnabled(autoAdvance) === true,
);
const tapCleared = resolveComponentParams(LOADING_BAR_DEF, { tapToContinue: false }, undefined);
check(
	'explicit tapToContinue:false overrides the seed',
	isTapToContinueEnabled(tapCleared) === false,
);
// project defaults sit below instance params but above the seed.
const projClear = resolveComponentParams(LOADING_BAR_DEF, undefined, { tapToContinue: false });
check('project default can clear a seed too', isTapToContinueEnabled(projClear) === false);

// 3 — a def with no defaultInstanceParams invents nothing (regression control).
const plainDef: ComponentDef = {
	id: '__test_plain__',
	name: 'plain',
	version: 1,
	scope: 'shared',
	category: 'ui',
	params: [{ key: 'foo', kind: 'string', default: 'bar' }],
	root: { id: 'r', kind: 'container', x: 0, y: 0, children: [] },
};
const plain = resolveComponentParams(plainDef, {}, undefined);
check('plain def: declared default applied', plain.foo === 'bar');
check('plain def: no completeOnLoaded invented', plain.completeOnLoaded === undefined);
check('plain def: no tapToContinue invented', plain.tapToContinue === undefined);

console.log('');
if (failures === 0) console.log('LOADING-BAR DEFAULTS HARNESS: PASSED');
else {
	console.log(`LOADING-BAR DEFAULTS HARNESS: FAILED (${failures} assertion(s))`);
	process.exit(1);
}
