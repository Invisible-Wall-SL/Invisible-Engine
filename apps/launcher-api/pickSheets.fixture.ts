/**
 * Offline fixture for the atlas-key rules behind the region picker — run with `node` (Node ≥ 22.18
 * / 24 strips the types):
 *   node apps/launcher-api/pickSheets.fixture.ts
 *
 * Runs directly because `src/lib/pickSheets.ts` is dependency-free by design. This app's `build` is
 * a bare `vite build` that strips types without checking them, so a green build proves nothing
 * here; these assertions are the gate.
 *
 * What it pins is the invariant behind the "buy-feature card art is missing" bug: the key a pick is
 * SCOPED BY must be the key the editor-art export registers that sheet's textures under — its
 * MANIFEST, never its R2 output prefix.
 */

import { manifestKeyByFolder, pickManifestKey, pickSheetsFrom } from './src/lib/pickSheets.ts';

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

const ROOT = 'invisible_wall/bookofborutremake/sheets/';

console.log('pickManifestKey');
check(
	'prefers the Sheet Maker manifest over a plain json',
	pickManifestKey([`${ROOT}S_Gem/S_Gem.json`, `${ROOT}S_Gem/atlas_manifest_S_Gem.json`]),
	`${ROOT}S_Gem/atlas_manifest_S_Gem.json`,
);
check(
	'falls back to the first json',
	pickManifestKey([`${ROOT}S_Game_UI2/S_Game_UI2.json`]),
	`${ROOT}S_Game_UI2/S_Game_UI2.json`,
);
check('no json ⇒ null', pickManifestKey([]), null);

console.log('manifestKeyByFolder');
// The real Book of Borut shape: one sheet whose folder holds only `<name>.json`.
const keys = [
	`${ROOT}.keep`,
	`${ROOT}S_Game_UI2/S_Game_UI2.json`,
	`${ROOT}S_Game_UI2/S_Game_UI2.png`,
	`${ROOT}S_Gem/S_Gem.json`,
	`${ROOT}S_Gem/atlas_manifest_S_Gem.json`,
	`${ROOT}S_Gem/S_Gem.webp`,
	// A nested json must NOT win: `resolveManifestKey` lists with a `/` delimiter and cannot see
	// it, so counting it here would make the picker name a manifest the repair never resolves to.
	`${ROOT}S_Nested/sub/inner.json`,
	`${ROOT}S_Nested/S_Nested.json`,
	// A sheet that never finished exporting has no json at all.
	`${ROOT}S_Empty/S_Empty.png`,
];
const map = manifestKeyByFolder(ROOT, keys);
check('plain json sheet', map.get(`${ROOT}S_Game_UI2/`), `${ROOT}S_Game_UI2/S_Game_UI2.json`);
check('atlas_manifest wins', map.get(`${ROOT}S_Gem/`), `${ROOT}S_Gem/atlas_manifest_S_Gem.json`);
check('nested json ignored', map.get(`${ROOT}S_Nested/`), `${ROOT}S_Nested/S_Nested.json`);
check('json-less sheet is absent', map.get(`${ROOT}S_Empty/`), undefined);
check('root-level file is not a sheet', map.get(ROOT), undefined);

console.log('pickSheetsFrom');
const assets = {
	atlases: [
		{
			key: 'c/p/manifests/atlas_manifest_S_Game_UI2.json',
			name: 'S_Game_UI2',
			kind: 'atlas-manifest',
		},
		// An atlas PAGE is not a manifest — it must never be pickable as a scope.
		{ key: 'c/p/atlas/S_Game_UI2.png', name: 'S_Game_UI2', kind: 'atlas-page' },
	],
	sheets: [
		{
			key: `${ROOT}S_Game_UI2/`,
			name: 'S_Game_UI2',
			manifestKey: `${ROOT}S_Game_UI2/S_Game_UI2.json`,
		},
		// No resolvable manifest ⇒ still listed, under its prefix: the frames stay pickable and a
		// ref scoped by it degrades to the bare frame name rather than vanishing.
		{ key: `${ROOT}S_Empty/`, name: 'S_Empty' },
	],
};
check(
	'picker keys',
	pickSheetsFrom(assets).map((s) => s.key),
	[
		'c/p/manifests/atlas_manifest_S_Game_UI2.json',
		`${ROOT}S_Game_UI2/S_Game_UI2.json`,
		`${ROOT}S_Empty/`,
	],
);
// The regression itself: the picker must never hand back the R2 output prefix for a sheet that has
// a manifest — that is the key the export never registers.
check(
	'a resolvable sheet never yields its output prefix',
	pickSheetsFrom(assets).some((s) => s.key === `${ROOT}S_Game_UI2/`),
	false,
);
check(
	'atlas pages are excluded',
	pickSheetsFrom(assets).some((s) => s.key.endsWith('.png')),
	false,
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
