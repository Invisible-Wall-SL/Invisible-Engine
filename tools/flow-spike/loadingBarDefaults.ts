/**
 * Invisible Flow v2 — LOADING-BAR DEFAULT PARAMS harness.
 *
 *   pnpm --filter flow-spike run loadingbar
 *
 * Proves, HEADLESSLY over the REAL `engine-layout` modules, that the driven-flow loading handoff is
 * no longer disabled by the `defaultInstanceParams`-not-applied-at-runtime bug.
 *
 * Root cause it pins: a HAND-AUTHORED / scaffold `loadingBar` node (no `params`) never received
 * `LOADING_BAR_DEF.defaultInstanceParams` — `resolveComponentParams` applied only declared
 * `def.params` defaults + project defaults + instance params, NOT `defaultInstanceParams`. So
 * `completeOnLoaded` (a shared overlay param) stayed unset ⇒ `completeOnLoadedEnabled` false ⇒ the
 * gate's `$effect` returned early and never fired ⇒ a driven flow stranded on loading.
 *
 * Assertions:
 *   1. `resolveComponentParams(LOADING_BAR_DEF, {}, undefined)` now carries BOTH `completeOnLoaded`
 *      and `tapToContinue` = true (the scaffold gets the gate + the tap fallback out of the box).
 *   2. `isCompleteOnLoadedEnabled` + `isTapToContinueEnabled` both read `true` off the resolved params.
 *   3. An explicit instance override still WINS (clearing a toggle writes explicit `false`).
 *   4. A def with NO `defaultInstanceParams` is unaffected (regression control) — no keys invented.
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

// 1 + 2 — the scaffold (param-less) loadingBar resolves the gate + tap fallback ON.
const scaffold = resolveComponentParams(LOADING_BAR_DEF, {}, undefined);
check('scaffold loadingBar: completeOnLoaded === true', scaffold.completeOnLoaded === true);
check('scaffold loadingBar: tapToContinue === true', scaffold.tapToContinue === true);
check(
	'scaffold loadingBar: isCompleteOnLoadedEnabled',
	isCompleteOnLoadedEnabled(scaffold) === true,
);
check('scaffold loadingBar: isTapToContinueEnabled', isTapToContinueEnabled(scaffold) === true);

// 3 — an explicit instance override wins (an author can clear the toggle).
const cleared = resolveComponentParams(LOADING_BAR_DEF, { completeOnLoaded: false }, undefined);
check(
	'explicit completeOnLoaded:false overrides the seed',
	isCompleteOnLoadedEnabled(cleared) === false,
);
check(
	'the OTHER seed (tapToContinue) survives a partial clear',
	isTapToContinueEnabled(cleared) === true,
);
// project defaults sit below instance params but above the seed.
const projClear = resolveComponentParams(LOADING_BAR_DEF, undefined, { tapToContinue: false });
check('project default can clear a seed too', isTapToContinueEnabled(projClear) === false);

// 4 — a def with no defaultInstanceParams invents nothing (regression control).
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
