/**
 * Offline check of the layout-doc / component-def atlas-ref repair, over the REAL module.
 *
 * It cannot be run directly — `atlasRefRepair.ts` imports `engine-layout` (extensionless imports)
 * and, through `manifestBasename`, the R2 client. Bundle it first, from THIS directory:
 *
 *   echo "export const env = {};" > .env-stub.mjs
 *   pnpm exec esbuild atlasRefRepair.fixture.ts --bundle --platform=node --format=esm \
 *     --outfile=.fixture.run.mjs "--alias:\$env/dynamic/private=./.env-stub.mjs" \
 *     --external:@aws-sdk/client-s3 --external:@aws-sdk/s3-request-presigner \
 *     --external:drizzle-orm --external:postgres
 *   node .fixture.run.mjs && rm -f .fixture.run.mjs .env-stub.mjs
 *
 * The resolver is stubbed, so what is under test is the WALK: which fields carry an atlas ref,
 * which prefix shapes get repaired, and — the half that matters most — what is left strictly alone.
 * A repair that rewrites a text node or a spine bundle name would be far worse than the bug.
 */

import { repairComponentDefsWith, repairLayoutDocWith } from './src/lib/server/atlasRefRepair.ts';

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

const SHEET = 'invisible_wall/borut/sheets/S_Game_UI2/';
const MANIFEST = 'invisible_wall/borut/sheets/S_Game_UI2/S_Game_UI2.json';
const ATLAS = 'invisible_wall/borut/manifests/atlas_manifest_S_VFX.json';

/** Stands in for `createAtlasRefResolver`: resolves the one sheet prefix, knows nothing else. */
const resolved: string[] = [];
const resolve = async (ref: string): Promise<string> => {
	resolved.push(ref);
	return ref === SHEET ? MANIFEST : ref;
};

const doc = {
	version: 2,
	projectKey: 'borut',
	mainSizesMap: {},
	updatedAt: '',
	scenes: [
		{
			id: 's1',
			name: 'base',
			nodes: [
				{
					id: 'c1',
					kind: 'container',
					children: [
						// The regression: assetKey is the sheet's OUTPUT PREFIX.
						{ id: 'n1', kind: 'sprite', assetKey: SHEET, region: 'T_UI_BuyBack_glow.png' },
						// A scoped `region` — what an image-kind param binding stores.
						{ id: 'n2', kind: 'sprite', assetKey: '', region: `${SHEET}::T_UI_Check_glow.png` },
						// Already correct: must come back byte-identical.
						{ id: 'n3', kind: 'sprite', assetKey: ATLAS, region: 'vfx_0001' },
						// A game-BUNDLED key is not an atlas ref at all.
						{ id: 'n4', kind: 'sprite', assetKey: 'symbolsStatic', region: 'H1' },
					],
				},
				{
					id: 'i1',
					kind: 'componentInstance',
					componentId: 'featureCard',
					params: {
						buttonImage: `${SHEET}::T_UI_BuyBack_glow.png`,
						panelImage: `${ATLAS}::T_Frame`,
						// A spine param holds a bundle NAME, and a text param holds prose. Neither is a
						// scoped ref, and rewriting either would be a far worse bug than the one this fixes.
						cardSpine: 'featureCardSpine',
						title: 'High Noon Spin',
						oddLabel: 'a/b::c',
						panelTint: 16777215,
					},
				},
				// Nothing on these kinds is an atlas ref.
				{ id: 't1', kind: 'text', text: `${SHEET}::not a frame` },
				{ id: 'sp1', kind: 'spine', assetKey: SHEET },
			],
		},
	],
};

await repairLayoutDocWith(doc as never, resolve);
const nodes = doc.scenes[0].nodes[0].children as Record<string, string>[];
const inst = doc.scenes[0].nodes[1] as { params: Record<string, unknown> };

console.log('layout doc');
check('sprite assetKey prefix → manifest', nodes[0].assetKey, MANIFEST);
check('its bare region is untouched', nodes[0].region, 'T_UI_BuyBack_glow.png');
check('scoped region prefix → manifest', nodes[1].region, `${MANIFEST}::T_UI_Check_glow.png`);
check(
	'a correct atlas ref is untouched',
	[nodes[2].assetKey, nodes[2].region],
	[ATLAS, 'vfx_0001'],
);
check('a game-bundled key is untouched', nodes[3].assetKey, 'symbolsStatic');
check(
	'image param prefix → manifest',
	inst.params.buttonImage,
	`${MANIFEST}::T_UI_BuyBack_glow.png`,
);
check('a correct image param is untouched', inst.params.panelImage, `${ATLAS}::T_Frame`);
check('a spine bundle name is untouched', inst.params.cardSpine, 'featureCardSpine');
check('prose is untouched', inst.params.title, 'High Noon Spin');
// `a/b::c` contains `::` and its prefix contains `/`, so a looser rule WOULD rewrite it. It only
// survives because an unresolvable ref comes back unchanged — the resolver is asked, and says no.
check('a non-atlas value containing :: survives', inst.params.oddLabel, 'a/b::c');
check('a non-string param is untouched', inst.params.panelTint, 16777215);
check(
	'a text node is untouched',
	(doc.scenes[0].nodes[2] as { text: string }).text,
	`${SHEET}::not a frame`,
);
check(
	'a SPINE assetKey is not an atlas ref',
	(doc.scenes[0].nodes[3] as { assetKey: string }).assetKey,
	SHEET,
);

console.log('component defs');
const def = {
	id: 'featureCard',
	name: 'Feature Card',
	params: [
		{ key: 'buttonImage', kind: 'image', default: `${SHEET}::T_UI_BuyBack_glow.png` },
		{ key: 'panelImage', kind: 'image', default: `${ATLAS}::T_Frame` },
		{ key: 'cardSpine', kind: 'spine', default: `${SHEET}::looks-scoped` },
	],
	root: {
		id: 'root',
		kind: 'container',
		children: [{ id: 'r1', kind: 'sprite', assetKey: SHEET, region: 'T_UI_BuyBack.png' }],
	},
};
await repairComponentDefsWith([def] as never, resolve);
check('image param default repaired', def.params[0].default, `${MANIFEST}::T_UI_BuyBack_glow.png`);
check('correct image default untouched', def.params[1].default, `${ATLAS}::T_Frame`);
// Only `image` params are art refs. A `spine` default is a bundle name, even one shaped like a ref.
check('spine param default untouched', def.params[2].default, `${SHEET}::looks-scoped`);
check(
	'def root sprite repaired',
	(def.root.children[0] as { assetKey: string }).assetKey,
	MANIFEST,
);

console.log('resolver use');
// The candidate test is deliberately LOOSE — `needsAtlasRefRepair` accepts any path-shaped prefix,
// the same rule the clip and card-param repairs use — so a non-art param value that happens to
// contain `::` IS offered to the resolver (`a/b` below). That is the contract, and it is safe
// because a repair can only make a ref MORE specific: the resolver lists the prefix, finds no
// manifest, and the value comes back untouched (asserted above). What it costs is one cached R2
// listing per distinct odd prefix. The residual risk is a prose value whose prefix is LITERALLY an
// existing sheet folder; tightening that would need the component DEFS, which `loadDoc` cannot see.
check(
	'the walk only ever asks about `::` prefixes, never bare prose',
	[...new Set(resolved)].sort(),
	['a/b', SHEET],
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
