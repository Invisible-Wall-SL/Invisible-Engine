/**
 * Offline fixture for the atlas-scoped frame-ref helpers — run with `node` (Node ≥ 22.18 / 24
 * strips the types):
 *   node packages/engine-layout/scopedFrameRef.fixture.ts
 *
 * Covers the three prefix shapes `parseScopedFrameRef` has to tell apart, because getting the
 * third one wrong is INVISIBLE at build time and costs the art at runtime:
 *   - a FULL manifest key      ⇒ scoped lookup, atlas pinned;
 *   - an UN-SCOPEABLE atlas ref (bare manifest basename / Sheet-Maker output prefix, the forms the
 *     ship-path repair exists for) ⇒ the BARE region, so an unrepaired ref still resolves;
 *   - anything else that merely contains `::` ⇒ the whole value, unchanged (parity).
 */

import {
	editorArtTextureKey,
	isManifestAssetKey,
	needsAtlasRefRepair,
	parseScopedFrameRef,
} from './src/lib/editorArtKey.ts';

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

const MANIFEST = 'invisible_wall/bookofborutremake/manifests/atlas_manifest_S_Game_UI2.json';
const SHEET_PREFIX = 'invisible_wall/bookofborutremake/sheets/S_Game_UI2/';
const SHEET_MANIFEST = 'invisible_wall/bookofborutremake/sheets/S_Game_UI2/S_Game_UI2.json';

console.log('needsAtlasRefRepair');
check('full manifest key needs no repair', needsAtlasRefRepair(MANIFEST), false);
check('resolved sheet manifest needs no repair', needsAtlasRefRepair(SHEET_MANIFEST), false);
check('sheet output prefix needs repair', needsAtlasRefRepair(SHEET_PREFIX), true);
check(
	'bare manifest basename needs repair',
	needsAtlasRefRepair('atlas_manifest_S_Gem.json'),
	true,
);
check('game-bundled key needs no repair', needsAtlasRefRepair('symbolsStatic'), false);
check('a plain region name needs no repair', needsAtlasRefRepair('T_UI_BuyBack_glow.png'), false);

console.log('parseScopedFrameRef — full manifest key keeps the atlas pin');
check('scoped ref splits', parseScopedFrameRef(`${MANIFEST}::T_FeatureSelect_0000_Frame`), {
	assetKey: MANIFEST,
	region: 'T_FeatureSelect_0000_Frame',
});
check(
	'round-trips through editorArtTextureKey',
	parseScopedFrameRef(editorArtTextureKey(SHEET_MANIFEST, 'T_UI_BuyBack_glow.png')),
	{ assetKey: SHEET_MANIFEST, region: 'T_UI_BuyBack_glow.png' },
);

console.log('parseScopedFrameRef — un-scopeable prefix degrades to the BARE region');
// The live Book of Borut regression: the region picker stored a Sheet-Maker output prefix, the
// export registers that sheet under its MANIFEST key, and the whole string was used as a region
// name — a key no sheet can ever carry, so the buy-feature button glow drew nothing.
check(
	'sheet output prefix ⇒ bare region',
	parseScopedFrameRef(`${SHEET_PREFIX}::T_UI_BuyBack_glow.png`),
	{ region: 'T_UI_BuyBack_glow.png' },
);
check(
	'bare manifest basename ⇒ bare region',
	parseScopedFrameRef('atlas_manifest_S_Gem.json::frame_0000'),
	{ region: 'frame_0000' },
);
check(
	'the degraded region is a key a sheet can actually carry',
	isManifestAssetKey(parseScopedFrameRef(`${SHEET_PREFIX}::T_UI_BuyBack_glow.png`).assetKey),
	false,
);

console.log('parseScopedFrameRef — everything else is unchanged (parity)');
check('bare name', parseScopedFrameRef('T_UI_BuyBack_glow.png'), {
	region: 'T_UI_BuyBack_glow.png',
});
check('empty', parseScopedFrameRef(''), { region: '' });
check('undefined', parseScopedFrameRef(undefined), { region: '' });
// A region NAME that merely contains `::` is not an atlas ref (no `/`, no `.json`), so splitting it
// would invent a frame that does not exist. It must survive whole.
check('region name containing ::', parseScopedFrameRef('weird::name'), { region: 'weird::name' });
check('leading ::', parseScopedFrameRef('::frame'), { region: '::frame' });
check('empty region after a real manifest', parseScopedFrameRef(`${MANIFEST}::`), {
	region: `${MANIFEST}::`,
});
// A game-bundled assetKey is neither a manifest key nor repairable — unchanged.
check('game-bundled prefix', parseScopedFrameRef('symbolsStatic::H1'), {
	region: 'symbolsStatic::H1',
});

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
