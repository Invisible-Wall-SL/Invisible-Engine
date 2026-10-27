/**
 * Contract check for the build breakdown — what a published version shipped:
 *   pnpm --filter launcher-api check:build-breakdown
 *
 * Runs the REAL `buildBreakdown.ts` and `publishedRuntime.ts` over an in-memory R2 holding two
 * snapshots of one project. Pins, each because getting it wrong misleads whoever checks a publish:
 *  - every file lands in its category, with its size, kind and reference count;
 *  - a shared atlas page counts once per referencing file and is shared between the assets;
 *  - an asset's uses come from the game data, never from the index that lists it;
 *  - a dead file, a missing page, a duplicate and an oversized texture are each reported;
 *  - the diff against the previous version, and the cache written beside the snapshot.
 */
import { mock } from 'node:test';

const R2 = new Map<string, { body: string; etag: string }>();
const put = (key: string, body: string, etag = `e${R2.size + 1}`) => R2.set(key, { body, etag });
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (key: string, text: string) => {
			put(key, text);
			return 'e';
		},
		copyObject: async () => true,
		deleteObjects: async () => undefined,
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({
				key,
				size: R2.get(key)!.body.length,
				lastModified: 1,
				etag: R2.get(key)!.etag,
			})),
		listObjects: async () => ({ prefixes: [], keys: [] }),
	},
});

const { loadBuildBreakdown, BREAKDOWN_VERSION } = await import(src('lib/server/buildBreakdown.ts'));

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const CLIENT = 'iw';
const PROJECT = 'demo';
const PUB = `${CLIENT}/${PROJECT}/published/`;
const OLD = '20261001T100000Z-aaaa';
const NEW = '20261027T100000Z-bbbb';
const meta = (id: string) => ({
	id,
	createdAt: '2026-10-27T10:00:00.000Z',
	by: 'a@b.c',
	flow: 'valid',
	runtime: 'lines',
	files: 0,
	bytes: 0,
});
put(
	`${PUB}pointer.json`,
	JSON.stringify({ version: 1, current: NEW, snapshots: [meta(NEW), meta(OLD)] }),
);

const bundle = {
	doc: {
		gameType: 'lines',
		scenes: [
			{
				id: 'base',
				name: 'Base',
				nodes: [
					{ kind: 'sprite', assetKey: 'iw/demo/manifests/ui.json', region: 'a' },
					{ kind: 'sprite', assetKey: 'iw/demo/manifests/ui.json', region: 'b' },
					{ kind: 'spine', assetKey: 'R_Spin' },
					{ kind: 'text', style: { fontFamily: 'gold' } },
				],
			},
		],
	},
	componentDefs: { btn: { root: { kind: 'sprite', assetKey: 'iw/demo/manifests/ui.json' } } },
	componentDefaults: {},
	editorArt: {
		sheets: [{ key: 'iw/demo/manifests/ui.json', json: 'editor-art/ui/ui.json', frames: 2 }],
		images: [],
		spines: [
			{
				key: 'iw/demo/rigs/R_Spin',
				atlas: 'editor-art/R_Spin/R_Spin.atlas',
				skeleton: 'editor-art/R_Spin/R_Spin.json',
				scale: 1,
			},
		],
		spinesMissing: [],
		collisions: [],
		missing: ['ghost'],
		clipMissing: [],
	},
	fonts: {
		catalog: {
			prefix: 'editor-fonts',
			fonts: [
				{
					id: 'gold',
					name: 'gold',
					kind: 'web',
					folder: 'gold',
					files: [{ file: 'gold.woff2', format: 'woff2' }],
				},
			],
		},
	},
	sounds: {
		catalog: {
			prefix: 'sounds',
			sounds: [
				{ name: 'win', file: 'win.mp3', durationMs: 1 },
				{ name: 'gone', file: 'gone.mp3', durationMs: 1 },
			],
			bindings: { spinStart: 'win' },
		},
	},
	localization: { sourceLang: 'en', messages: { en: { a: 'A', b: 'B' }, de: { a: 'A' } } },
	symbols: {
		map: {},
		index: { sheets: [], images: [], spines: [], collisions: [], missing: [], spinesMissing: [] },
	},
};

const snap = (id: string, rel: string, body: string, etag?: string) =>
	put(`${PUB}${id}/deploy/${rel}`, body, etag);
put(`${PUB}${NEW}/runtime.json`, JSON.stringify(bundle));
snap(
	NEW,
	'editor-art/ui/ui.json',
	JSON.stringify({
		frames: { 'a.png': {} },
		meta: { image: '../../_pages/p1.webp', size: { w: 8192, h: 512 } },
	}),
);
snap(
	NEW,
	'editor-art/R_Spin/R_Spin.atlas',
	'../../_pages/p1.webp\nsize: 8192,512\n\n../../_pages/p2.webp\nsize: 256,256\n',
);
snap(NEW, 'editor-art/R_Spin/R_Spin.json', '{"skeleton":{}}');
snap(NEW, '_pages/p1.webp', 'x'.repeat(1000), 'same');
snap(NEW, 'editor-fonts/gold/gold.woff2', 'f'.repeat(50));
snap(NEW, 'sounds/win.mp3', 's'.repeat(300), 'win');
snap(NEW, 'sounds/gone.mp3', 'g'.repeat(20));
snap(NEW, 'editor-art/index.json', '{}');
snap(NEW, 'stray/leftover.png', 'x'.repeat(1000), 'same');

put(`${PUB}${OLD}/runtime.json`, JSON.stringify(bundle));
snap(OLD, '_pages/p1.webp', 'y'.repeat(900));
snap(OLD, 'sounds/win.mp3', 's'.repeat(300), 'win');
snap(OLD, 'sounds/old.mp3', 'o'.repeat(40));

const b = await loadBuildBreakdown(CLIENT, PROJECT, NEW);
const file = (rel: string) => b.files.find((f: { rel: string }) => f.rel === rel);
const asset = (id: string) => b.assets.find((a: { id: string }) => a.id === id);
const issue = (title: string) =>
	b.issues.find((i: { title: string }) => i.title === title)?.items ?? [];

check('files: every shipped file is listed', b.files.length, 9);
check('category: shared pages', file('_pages/p1.webp')?.category, 'pages');
check('category: unknown subtree', file('stray/leftover.png')?.category, 'other');
check(
	'kind: rig skeleton from the index',
	file('editor-art/R_Spin/R_Spin.json')?.kind,
	'rig-skeleton',
);
check('kind: subtree index', file('editor-art/index.json')?.kind, 'index');
check('refs: a page shared by a sheet and a rig atlas', file('_pages/p1.webp')?.refs, 2);
check('refs: a sheet named once by the bundle index', file('editor-art/ui/ui.json')?.refs, 1);
check('refs: a font file through the catalog', file('editor-fonts/gold/gold.woff2')?.refs, 1);
check('dims: read from the spritesheet meta', file('_pages/p1.webp')?.dims, { w: 8192, h: 512 });
check('duplicate: same ETag and size', file('stray/leftover.png')?.duplicateOf, '_pages/p1.webp');

check('asset: the sheet pulls in its page', asset('sheet:iw/demo/manifests/ui.json')?.files, [
	'_pages/p1.webp',
	'editor-art/ui/ui.json',
]);
check(
	'asset: the page is shared bytes',
	asset('sheet:iw/demo/manifests/ui.json')?.sharedBytes,
	1000,
);
check(
	'uses: two scene nodes + one component, not the index',
	asset('sheet:iw/demo/manifests/ui.json')?.uses,
	3,
);
check('uses: a rig placed by its bare bundle name', asset('rig:iw/demo/rigs/R_Spin')?.uses, 1);
check('uses: where', asset('sheet:iw/demo/manifests/ui.json')?.usedIn, [
	{ where: 'scene Base', count: 2 },
	{ where: 'component btn', count: 1 },
]);
check('uses: a sound named by a binding', asset('sound:win')?.uses, 1);
check('uses: an unbound sound', asset('sound:gone')?.uses, 0);

check('issue: the missing rig page', issue('Referenced but not shipped'), [
	'_pages/p2.webp ← editor-art/R_Spin/R_Spin.atlas',
]);
check('issue: dead file, but never an index', issue('Shipped but never loaded'), [
	'stray/leftover.png (1000 B)',
]);
check('issue: oversized pages', issue('Textures over 4096 px'), ['_pages/p1.webp — 8192×512']);
check('issue: exporter warning passed through', issue('Placed art no sheet packs'), ['ghost']);
check('totals: dead bytes', b.totals.unreferencedBytes, 1000);
check('totals: GPU estimate of the known page', b.totals.gpuBytes, 8192 * 512 * 4);

check('diff: against the older retained version', b.diff?.previousId, OLD);
check('diff: removed', b.diff?.removed, [{ rel: 'sounds/old.mp3', bytes: 40 }]);
check('diff: changed', b.diff?.changed, [{ rel: '_pages/p1.webp', before: 900, after: 1000 }]);
check('diff: added count', b.diff?.added.length, 7);

check(
	'content: languages',
	b.content.find((c: { label: string }) => c.label === 'Languages')?.value,
	'2 (en, de)',
);

const cached = R2.get(`${PUB}${NEW}/breakdown.json`);
check(
	'cache: written beside the snapshot',
	JSON.parse(cached?.body ?? '{}').version,
	BREAKDOWN_VERSION,
);
R2.delete(`${PUB}${NEW}/runtime.json`);
check(
	'cache: a second load reads it',
	(await loadBuildBreakdown(CLIENT, PROJECT, NEW)).files.length,
	9,
);

let unknown = '';
try {
	await loadBuildBreakdown(CLIENT, PROJECT, '20200101T000000Z-cccc');
} catch (e) {
	unknown = (e as Error).name;
}
check('a version the pointer does not name is refused', unknown, 'UnknownBreakdownError');

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
