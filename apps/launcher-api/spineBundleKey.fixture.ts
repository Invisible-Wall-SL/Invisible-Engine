/**
 * Offline fixture for the spine bundle-ADDRESS rules — run with `node` (Node ≥ 22.18 / 24
 * strips the types):
 *   node apps/launcher-api/spineBundleKey.fixture.ts
 *
 * Runs directly because `src/lib/spineBundleKey.ts` is dependency-free by design (its only
 * imports are types, erased at runtime). This app's `build` is a bare `vite build` that strips
 * types without checking them, so a green build proves nothing here; these assertions are the
 * gate — same reasoning as `pickSheets.fixture.ts`.
 *
 * What it pins is the invariant behind "the free-spin cage is missing in the shipped game": a
 * spine `assetKey` under ANOTHER project's prefix exports nothing while the doc keeps that
 * prefix as its runtime lookup key. Two distinctions carry the whole behaviour, and both are
 * invisible at build time:
 *   - a bundle ADDRESS vs a coded/game-bundled key (`bigwin`) — only the former can be stranded;
 *   - a static `assetKey` the runtime can REACH vs one a param default permanently shadows.
 */

import {
	foreignSpineRefs,
	parseSpineBundleKey,
	staticSpineKeyIsReachable,
} from './src/lib/spineBundleKey.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL  ${label}\n        got      ${a}\n        expected ${e}`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture builds partial nodes
const spine = (assetKey: string, boundTo?: string): any => ({
	id: 'n1',
	kind: 'spine',
	assetKey,
	...(boundTo ? { paramBindings: { assetKey: boundTo } } : {}),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixture builds partial nodes
const container = (...children: any[]): any => ({ id: 'root', kind: 'container', children });

const IW = { client: 'invisible_wall', project: 'test6' };

console.log('parseSpineBundleKey — a bundle ADDRESS, whoever owns it');
check(
	'project prefix, trailing slash',
	parseSpineBundleKey('invisible_wall/bookofborutremake/spines/R_Cage_Freespin/'),
	{
		shared: false,
		client: 'invisible_wall',
		project: 'bookofborutremake',
		bundle: 'R_Cage_Freespin',
	},
);
check(
	'project prefix, no trailing slash',
	parseSpineBundleKey('invisible_wall/test6/spines/R_SpinButton'),
	{
		shared: false,
		client: 'invisible_wall',
		project: 'test6',
		bundle: 'R_SpinButton',
	},
);
check('shared library prefix', parseSpineBundleKey('_shared/spines/engine-loader/'), {
	shared: true,
	bundle: 'engine-loader',
});
check('coded/game-bundled key is not an address', parseSpineBundleKey('bigwin'), null);
check('bare bundle name is not an address', parseSpineBundleKey('R_SpinButtonNew'), null);
check(
	'the spines root itself names no bundle',
	parseSpineBundleKey('invisible_wall/test6/spines/'),
	null,
);
check(
	'a file inside a bundle is not an address',
	parseSpineBundleKey('invisible_wall/test6/spines/R_Plus/R_Plus.atlas'),
	null,
);
check(
	'a sheet manifest key is not an address',
	parseSpineBundleKey('invisible_wall/test6/manifests/atlas_manifest_S_UI.json'),
	null,
);
check('empty string', parseSpineBundleKey(''), null);
// `assertBundle` permits a NESTED bundle folder, so the reader must too or the writer and the
// reader disagree; both sides now share `BUNDLE_SEGMENT_RE`, which is also what rejects the
// file path above (no segment may contain a dot).
check('nested bundle folder', parseSpineBundleKey('invisible_wall/test6/spines/loader/sub/'), {
	shared: false,
	client: 'invisible_wall',
	project: 'test6',
	bundle: 'loader/sub',
});
check(
	'a segment that is not a legal bundle name',
	parseSpineBundleKey('invisible_wall/test6/spines/../secrets'),
	null,
);

console.log('\nstaticSpineKeyIsReachable — can the runtime ever look this key up?');
check('unbound node', staticSpineKeyIsReachable(spine('x/y/spines/b/'), []), true);
check(
	'bound, param declares a non-empty default (Button_Square v11)',
	staticSpineKeyIsReachable(spine('x/y/spines/b/', 'rspinbuttonnewSpine'), [
		{ key: 'rspinbuttonnewSpine', kind: 'spine', default: 'R_SpinButtonNew' },
	]),
	false,
);
check(
	'bound, param has no default (exposeSpineParam on a foreign key)',
	staticSpineKeyIsReachable(spine('x/y/spines/b/', 'spineKey'), [
		{ key: 'spineKey', kind: 'spine' },
	]),
	true,
);
check(
	'bound, param default is the empty string',
	staticSpineKeyIsReachable(spine('x/y/spines/b/', 'spineKey'), [
		{ key: 'spineKey', kind: 'spine', default: '' },
	]),
	true,
);
check(
	'bound to a param the def no longer declares',
	staticSpineKeyIsReachable(spine('x/y/spines/b/', 'gone'), [
		{ key: 'other', kind: 'spine', default: 'B' },
	]),
	true,
);
check('non-spine node', staticSpineKeyIsReachable({ id: 'n', kind: 'text' } as never, []), false);

console.log('\nforeignSpineRefs — what a save must re-point');
check(
	'the reported bug: a SHARED def pinned to one project',
	foreignSpineRefs(
		container(spine('invisible_wall/bookofborutremake/spines/R_Cage_Freespin/')),
		undefined,
	),
	[
		{
			nodeId: 'n1',
			assetKey: 'invisible_wall/bookofborutremake/spines/R_Cage_Freespin/',
			bundle: 'R_Cage_Freespin',
			bound: false,
		},
	],
);
check(
	'project def borrowing ANOTHER project',
	foreignSpineRefs(container(spine('invisible_wall/bookofborutremake/spines/R_Cage_Freespin/')), IW)
		.length,
	1,
);
check(
	'project def using its OWN bundle',
	foreignSpineRefs(container(spine('invisible_wall/test6/spines/R_SpinButton/')), IW),
	[],
);
check(
	'same project name, DIFFERENT client, is still foreign',
	foreignSpineRefs(container(spine('borut/test6/spines/R_X/')), IW).length,
	1,
);
check(
	'shared library is never foreign, at either scope',
	[
		foreignSpineRefs(container(spine('_shared/spines/engine-loader/')), IW).length,
		foreignSpineRefs(container(spine('_shared/spines/engine-loader/')), undefined).length,
	],
	[0, 0],
);
check('coded key is left alone', foreignSpineRefs(container(spine('bigwin')), IW), []);
check(
	'bare bundle name is left alone',
	foreignSpineRefs(container(spine('R_SpinButtonNew')), undefined),
	[],
);
check('empty assetKey is left alone', foreignSpineRefs(container(spine('')), undefined), []);
check(
	'nested inside a container',
	foreignSpineRefs(container(container(spine('a/b/spines/R_X/'))), IW).length,
	1,
);
check(
	'a bound node reports `bound` so the save can CLEAR it rather than refuse',
	foreignSpineRefs(container(spine('a/b/spines/R_X/', 'someSpine')), IW)[0].bound,
	true,
);
check(
	'a shared-scope def owns no project, so its own-looking key is foreign',
	foreignSpineRefs(container(spine('invisible_wall/test6/spines/R_X/')), undefined).length,
	1,
);

console.log(
	failures === 0 ? '\nAll spine bundle-key assertions pass.' : `\n${failures} FAILURE(S)`,
);
if (failures > 0) process.exit(1);
