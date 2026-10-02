/**
 * `/admin` → promote a project's spine bundle into `_shared/spines/` (`sharedSpinePromote.ts`):
 * the shared bundle is a SNAPSHOT, never a reference into the project that authored it.
 *
 *   1. every bundle file is copied — skeleton, atlas, pages, rig text — and the shared index lists it;
 *   2. EXCEPT `source.json`: it names the authoring project's sheet, and a bundle read re-derives
 *      the bundle from that sheet when it drifts, so a copied sidecar let a re-pack in the authoring
 *      project rewrite the shared copy;
 *   3. re-promoting prunes a sidecar an earlier promotion left behind, and keeps other entries.
 *
 * Runs the real module over an in-memory R2.
 *   pnpm --filter launcher-api check:shared-spine-promote
 */
import { mock } from 'node:test';

const bucket = new Map<string, string>();
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => bucket.get(key) ?? null,
		objectExists: async (key: string) => bucket.has(key),
		listAllKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"etag"';
		},
		copyObject: async (from: string, to: string) => {
			const body = bucket.get(from);
			if (body === undefined) return false;
			bucket.set(to, body);
			return true;
		},
	},
});

const { promoteSpineToShared } = await import('../src/lib/server/sharedSpinePromote.ts');

let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const SRC = 'invisible_wall/bookofborutremake/spines';
const ENTRY = {
	name: 'R_BuyBonus/R_BuyBonus',
	folder: 'R_BuyBonus',
	skeleton_file: 'R_BuyBonus.irig',
	atlas_file: 'R_BuyBonus.atlas',
	format: 'json',
	version: '4.2',
	runtime: '4.2',
	pma: false,
};
bucket.set(`${SRC}/skeletons.json`, JSON.stringify({ prefix: SRC, skeletons: [ENTRY] }));
for (const file of ['R_BuyBonus.irig', 'R_BuyBonus.atlas', 'S_Game_UI2.webp', 'text.json']) {
	bucket.set(`${SRC}/R_BuyBonus/${file}`, file);
}
bucket.set(
	`${SRC}/R_BuyBonus/source.json`,
	JSON.stringify({
		manifestKey: 'invisible_wall/bookofborutremake/manifests/atlas_manifest_S.json',
	}),
);
const OTHER = { ...ENTRY, name: 'engine-loader/loader', folder: 'engine-loader' };
bucket.set('_shared/spines/skeletons.json', JSON.stringify({ skeletons: [OTHER] }));
bucket.set('_shared/spines/R_BuyBonus/source.json', '{"manifestKey":"from-an-earlier-promotion"}');

const result = await promoteSpineToShared('Invisible_Wall', 'bookofborutremake', 'R_BuyBonus');
const DEST = '_shared/spines/R_BuyBonus';

console.log('1. the bundle is copied and indexed');
check(
	'skeleton, atlas, page and rig text',
	['R_BuyBonus.irig', 'R_BuyBonus.atlas', 'S_Game_UI2.webp', 'text.json'].every((f) =>
		bucket.has(`${DEST}/${f}`),
	),
);
const index = JSON.parse(bucket.get('_shared/spines/skeletons.json') ?? '{}') as {
	skeletons: { folder: string }[];
};
check(
	'listed in the shared index, other entries kept',
	index.skeletons.map((e) => e.folder).join() === 'engine-loader,R_BuyBonus',
);

console.log('2. never the source sidecar');
check('no source.json in the shared copy', !bucket.has(`${DEST}/source.json`));
check('reported file count excludes it', result.files === 4);

console.log('3. the authoring project is untouched');
check('its source.json stays', bucket.has(`${SRC}/R_BuyBonus/source.json`));

console.log(
	failures === 0 ? '\nshared spine promote: OK' : `\nshared spine promote: ${failures} FAILED`,
);
if (failures > 0) process.exit(1);
