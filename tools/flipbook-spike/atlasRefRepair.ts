/**
 * Invisible Flipbook — headless harness for the ATLAS-REF REPAIR contract:
 *
 *   pnpm --filter flipbook-spike run atlas-ref
 *
 * The bug this guards (confirmed live on project `test1`, symbol H3 "Lotus"): a clip whose atlas
 * ref is not a full `<path>/<name>.json` manifest key makes `resolveClipFrames` SKIP the
 * atlas-scoped lookup and fall through to the flat bare-name texture cache. Every Sheet-Maker clip
 * names its frames `frame_0000…`, byte-identical across sheets, so the last-loaded sheet wins and
 * one symbol plays another symbol's animation while its static sprite stays correct.
 *
 * There are TWO such forms and the repair pass originally handled only the first:
 *   1. a bare manifest BASENAME  — `atlas_manifest_S_Gem.json`
 *   2. a Sheet-Maker OUTPUT PREFIX — `<client>/<project>/sheets/S_Gem/`
 *
 * `needsAtlasRefRepair` (engine-layout, beside the runtime's own `isManifestAssetKey`) is the one
 * answer both the pipeline's repair and the runtime's lookup read, so they cannot disagree — the
 * disagreement IS the bug. Proven here against the REAL `resolveClipFrames`, in Node, because the
 * launcher build is not a type check.
 */

import { resolveClipFrames } from 'engine-flipbook';
import {
	isBareManifestBasename,
	isManifestAssetKey,
	needsAtlasRefRepair,
	scopedFrameRef,
} from 'engine-layout';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

const LOTUS = 'iw/test1/sheets/S_Lotus/atlas_manifest_S_Lotus.json';
const GEM = 'iw/test1/manifests/atlas_manifest_S_Gem.json';

console.log('atlas refs — which forms need repairing');
assert(needsAtlasRefRepair('atlas_manifest_S_Lotus.json'), 'a bare manifest BASENAME needs repair');
assert(needsAtlasRefRepair('iw/test1/sheets/S_Lotus/'), 'a Sheet-Maker OUTPUT PREFIX needs repair');
assert(
	needsAtlasRefRepair('iw/test1/sheets/S_Lotus'), // the picker stores it either way
	'a sheet prefix without its trailing slash needs repair too',
);
assert(!needsAtlasRefRepair(LOTUS), 'a full manifest key is already scopeable — no repair');
assert(!needsAtlasRefRepair(GEM), 'a full manifest key under manifests/ needs no repair');
assert(
	!needsAtlasRefRepair('symbolsStatic'),
	'a game-bundled key is neither form — left alone, so it never costs an R2 lookup',
);
assert(!needsAtlasRefRepair(''), 'an empty ref is not repairable');

console.log('atlas refs — the predicates agree with the runtime');
// The whole point of co-locating them: "needs repair" must be exactly "the runtime cannot scope by
// it", for every form an authoring tool can store.
for (const ref of [
	'atlas_manifest_S_Lotus.json',
	'iw/test1/sheets/S_Lotus/',
	LOTUS,
	GEM,
	'symbolsStatic',
]) {
	assert(
		!(isManifestAssetKey(ref) && needsAtlasRefRepair(ref)),
		`"${ref}" is never both scopeable AND in need of repair`,
	);
}
assert(
	isBareManifestBasename('atlas_manifest_S_Lotus.json') &&
		!isBareManifestBasename(LOTUS) &&
		!isBareManifestBasename('iw/test1/sheets/S_Lotus/'),
	'isBareManifestBasename picks out exactly the no-path `.json` form',
);

// ---------------------------------------------------------------------------
// The consequence, against the REAL resolver: two sheets, identical frame names.
// ---------------------------------------------------------------------------
console.log('atlas refs — the collision the repair prevents');

/** The flat `loadedAssets` map the game builds: each editor-art sheet registers its frames BOTH
 *  scoped (`<manifest>::<frame>`) and bare — so bare `frame_0000` is whatever loaded LAST. */
const loadedAssets: Record<string, unknown> = {
	[scopedFrameRef(LOTUS, 'frame_0000')]: 'LOTUS_0',
	[scopedFrameRef(LOTUS, 'frame_0001')]: 'LOTUS_1',
	[scopedFrameRef(GEM, 'frame_0000')]: 'GEM_0',
	[scopedFrameRef(GEM, 'frame_0001')]: 'GEM_1',
	// Gem's sheet loaded last, so it owns the bare keys.
	frame_0000: 'GEM_0',
	frame_0001: 'GEM_1',
};

const FRAMES = ['frame_0000', 'frame_0001'];

// BEFORE the repair — the Lotus clip stored its atlas by bare basename.
const broken = resolveClipFrames(
	{ assetKey: 'atlas_manifest_S_Lotus.json', frames: FRAMES },
	loadedAssets,
);
assert(
	broken.textures.join(',') === 'GEM_0,GEM_1',
	'UNREPAIRED: the Lotus clip resolves to the GEM sheet — the reported symptom',
);

// BEFORE the repair — the other storable form, a Sheet-Maker output prefix.
const brokenPrefix = resolveClipFrames(
	{ assetKey: 'iw/test1/sheets/S_Lotus/', frames: FRAMES },
	loadedAssets,
);
assert(
	brokenPrefix.textures.join(',') === 'GEM_0,GEM_1',
	'UNREPAIRED: a sheet-prefix atlas ref collides the same way',
);

// AFTER the repair — both forms canonicalize to the full manifest key.
const repaired = resolveClipFrames({ assetKey: LOTUS, frames: FRAMES }, loadedAssets);
assert(
	repaired.textures.join(',') === 'LOTUS_0,LOTUS_1',
	'REPAIRED: the Lotus clip resolves to its OWN frames',
);
assert(repaired.missing.length === 0, 'REPAIRED: nothing goes missing in the process');

// The neighbour must be unaffected — this is why only ONE symbol misbehaved.
const gem = resolveClipFrames({ assetKey: GEM, frames: FRAMES }, loadedAssets);
assert(
	gem.textures.join(',') === 'GEM_0,GEM_1',
	'a clip already on a full manifest key was never broken and stays correct',
);

console.log('atlas refs — scoped per-frame prefixes');
// A multi-sheet clip pins each frame's own atlas; those prefixes need the same repair.
const spanningRepaired = resolveClipFrames(
	{ assetKey: LOTUS, frames: ['frame_0000', scopedFrameRef(GEM, 'frame_0001')] },
	loadedAssets,
);
assert(
	spanningRepaired.textures.join(',') === 'LOTUS_0,GEM_1',
	'a repaired per-frame prefix resolves against ITS sheet, not the primary',
);

console.log('');
if (failures > 0) {
	console.error(`ATLAS REF REPAIR: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('ATLAS REF REPAIR: PASSED');
