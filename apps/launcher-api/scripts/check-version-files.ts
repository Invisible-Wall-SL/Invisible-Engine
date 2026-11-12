/**
 * Contract check for what a published version freezes of `deploy/`:
 *   pnpm --filter launcher-api check:version-files
 *
 * Publish (`publishedRuntime.ts`) and a Director draft copy only the `deploy/` files a player can
 * load: the generated subtrees whole, plus whatever else the version's runtime bundle names
 * (`versionFiles`, `scripts/lib/assetReachability.mjs`). The copy used to take ALL of `deploy/`, so
 * every version carried the Sheet Maker's raw `sprites/` (107 MB of Test6's 195 MB) that no player
 * requests, and the Build breakdown counted it as a download. Claims, each over the filter, so a
 * planted mutant can fail them (a guard that can't fail proves nothing):
 *
 *  1. Every generated subtree is kept whole, named or not (`_pages/`, `_boot/`, an index nothing
 *     reads).
 *  2. Raw tool folders and export by-products nothing names are dropped (`sprites/`, `spines/`,
 *     `cinematics/`, the top-level flow files), including a sibling of a named folder.
 *  3. Whatever the bundle names outside them is kept: a file with its siblings (a sheet's page), a
 *     folder with and without a trailing `/`, a bare top-level file and folder, a path inside a URL,
 *     a runtime-built `${…}` prefix, and what a kept descriptor names in turn — reading only the
 *     kept descriptors outside the generated subtrees.
 *  4. An empty `deploy/` freezes nothing.
 *  5. Through the REAL `stageSnapshot` / `copyDeployTree` over an in-memory R2: only the kept set
 *     is copied, the snapshot's `files`/`bytes` count only it, the player route serves a named
 *     extra and 404s a dropped source page, a draft freezes the same set, and a KEPT file that
 *     vanishes mid-copy still fails the stage.
 */
import { mock } from 'node:test';
import {
	collectRefs,
	emptyRefs,
	isGenerated,
	isReachable,
	versionFiles,
} from './lib/assetReachability.mjs';

type Read = (rel: string) => Promise<string | null>;
type Filter = (rels: string[], bundle: unknown, read: Read) => Promise<string[]>;

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

// ── The fixture deploy/ tree and the bundle that names into it ────────────────
const GENERATED: Record<string, string> = {
	'_boot/boot.json': '{"entries":[{"atlas":"_boot/hd/loader.atlas"}]}',
	'_boot/hd/loader.atlas': 'loader.webp\nsize: 64, 64\n',
	'_boot/hd/loader.webp': 'P',
	'_pages/abc.webp': 'P',
	'_pages/abc.meta.json': '{}',
	'editor-art/index.json': '{}',
	'editor-art/bg/bg.json': '{"meta":{"image":"../../_pages/abc.webp"}}',
	'editor-symbols/h1/h1.json': '{"meta":{"image":"../../_pages/abc.webp"}}',
	'editor-fonts/Gold/gold.fnt': 'page id=0 file="gold.png"',
	'editor-fonts/Gold/gold.png': 'P',
	'editor-shaders/_index.json': '[]',
	'effects/index.json': '{}',
	'clips/index.json': '{}',
	'sounds/index.json': '{}',
	'sounds/spin.mp3': 'A',
};
const DROPPED: Record<string, string> = {
	'sprites/S_Background/S_Background.webp': 'RAW PAGE',
	'sprites/S_Background/S_Background.json': '{"meta":{"image":"S_Background.webp"}}',
	'sprites/S_Other/other.webp': 'RAW',
	'spines/R_WinSquare/R_WinSquare.json': '{}',
	'cinematics/intro.json': '{}',
	'flow-v2.json': '{}',
	'flow-v2-library.json': '{}',
	'fonts/Unused/unused.fnt': 'page id=0 file="unused.png"',
};
/** What the bundle names outside the generated subtrees, by how it names it. */
const NAMED: Record<string, [rel: string, body: string]> = {
	'a named file': ['sprites/S_Hero/S_Hero.json', '{"font":"fonts/Hero/hero.fnt"}'],
	"…its sibling (the sheet's page)": ['sprites/S_Hero/S_Hero.webp', 'P'],
	'a folder named with a trailing /': ['sprites/S_Logo/logo.webp', 'P'],
	'a folder named without one': ['sprites/S_Glow/glow.webp', 'P'],
	'a bare top-level file': ['onboardSheet.png', 'P'],
	'a bare top-level folder': ['audio/theme.mp3', 'A'],
	'a path inside a URL': ['video/intro.webm', 'V'],
	'a runtime-built ${…} prefix': ['music/track1.mp3', 'A'],
	'what a kept descriptor names': ['fonts/Hero/hero.fnt', 'page id=0 file="hero.png"'],
	'…and its sibling': ['fonts/Hero/hero.png', 'P'],
};
const BUNDLE = {
	doc: {
		scenes: [
			{
				id: 'basegame',
				nodes: [
					{ assetKey: 'sprites/S_Hero/S_Hero.json' },
					{ folder: 'sprites/S_Logo/' },
					{ folder: 'sprites/S_Glow' },
					{ file: 'onboardSheet.png' },
					{ bank: 'audio' },
					{ url: 'https://cdn.example/x/deploy/video/intro.webm' },
					{ pattern: 'assets/music/${track}' },
				],
			},
		],
	},
	editorArt: { sheets: [{ key: 'bg', json: 'editor-art/bg/bg.json' }] },
	flowV2: { nodes: [] },
	cinematics: [{ id: 'intro' }],
};
const TREE: Record<string, string> = {
	...GENERATED,
	...DROPPED,
	...Object.fromEntries(Object.values(NAMED)),
};
const RELS = Object.keys(TREE).sort();

async function claims(filter: Filter): Promise<string[]> {
	const failed: string[] = [];
	const reads: string[] = [];
	const kept = new Set(
		await filter(RELS, BUNDLE, async (rel) => {
			reads.push(rel);
			return TREE[rel] ?? null;
		}),
	);
	for (const rel of Object.keys(GENERATED))
		if (!kept.has(rel)) failed.push(`1. generated subtree kept whole: ${rel}`);
	for (const rel of Object.keys(DROPPED))
		if (kept.has(rel)) failed.push(`2. unnamed source dropped: ${rel}`);
	for (const [how, [rel]] of Object.entries(NAMED))
		if (!kept.has(rel)) failed.push(`3. ${how} kept: ${rel}`);
	const read = [...new Set(reads)].sort().join(', ');
	if (read !== `fonts/Hero/hero.fnt, ${NAMED['a named file'][0]}`)
		failed.push(`3. reads only the kept descriptors outside the generated subtrees: ${read}`);
	if ((await filter([], BUNDLE, async () => null)).length)
		failed.push('4. an empty deploy/ freezes nothing');
	return failed;
}

// ── 1–4 on the real filter ───────────────────────────────────────────────────
check('claims: the real filter passes every claim', await claims(versionFiles), []);

// ── …and each fails on a planted mutant ──────────────────────────────────────
const tops = (rels: string[]) => [
	...new Set(rels.filter((r) => r.includes('/') && !isGenerated(r)).map((r) => r.split('/')[0])),
];
function strings(value: unknown, out: string[] = []): string[] {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) for (const v of value) strings(v, out);
	else if (value && typeof value === 'object')
		for (const v of Object.values(value)) strings(v, out);
	return out;
}
const MUTANTS: Record<string, Filter> = {
	'copies everything (the old copy)': async (rels) => rels,
	'ignores the bundle (generated subtrees only)': async (rels) => rels.filter(isGenerated),
	'without _pages/ in the generated list': async (rels, b, read) =>
		(await versionFiles(rels, b, read)).filter((r) => !r.startsWith('_pages/')),
	'without _boot/ in the generated list': async (rels, b, read) =>
		(await versionFiles(rels, b, read)).filter((r) => !r.startsWith('_boot/')),
	"the pull's scan alone (no bare names)": async (rels, b) => {
		const refs = collectRefs(emptyRefs(), JSON.stringify(b), { json: true, tops: tops(rels) });
		return rels.filter((r) => isReachable(r, refs));
	},
	'exact names alone (no paths inside strings, no siblings)': async (rels, b) => {
		const named = strings(b).map((s) => s.replace(/\/+$/, ''));
		return rels.filter(
			(r) => isGenerated(r) || named.some((n) => r === n || r.startsWith(`${n}/`)),
		);
	},
	'never reads a kept descriptor': (rels, b) => versionFiles(rels, b, async () => null),
};
for (const [name, mutant] of Object.entries(MUTANTS)) {
	const failed = await claims(mutant);
	check(`mutant "${name}" is caught`, failed.length > 0, true);
	if (failed.length) console.log(`  mutant "${name}" caught by: ${failed[0]}`);
}

// ── 5. Through the real publish copy, over an in-memory R2 ────────────────────
const R2 = new Map<string, string>();
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectTextWithEtag: async (key: string) => {
			const body = R2.get(key);
			return body === undefined ? null : { text: body, etag: '"e"' };
		},
		getObjectBytes: async () => null,
		getObjectStream: async (key: string) => {
			const body = R2.get(key);
			return body === undefined
				? null
				: { body: new Response(body).body!, contentLength: body.length };
		},
		putObjectText: async (key: string, text: string) => {
			R2.set(key, text);
			return '"e"';
		},
		copyObject: async (from: string, to: string) => {
			const body = R2.get(from);
			if (body === undefined) return false;
			R2.set(to, body);
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({
				key,
				size: R2.get(key)?.length ?? 0,
				lastModified: 1,
			})),
		listObjects: async () => ({ keys: [], prefixes: [] }),
	},
});
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectReadClient: async (p: string, t: string) =>
			p === 'remake' && t === 'TOK' ? 'invisible_wall' : null,
	},
});

const pub = await import(src('lib/server/publishedRuntime.ts'));
const assetRoute = await import(
	src('routes/api/published/f/[token]/[project]/[snapshot]/[...rel]/+server.ts')
);

const DEPLOY = 'invisible_wall/remake/deploy/';
for (const [rel, body] of Object.entries(TREE)) R2.set(`${DEPLOY}${rel}`, body);
const keptRels = await versionFiles(RELS, BUNDLE, async (rel) => TREE[rel] ?? null);

{
	const meta = await pub.stageSnapshot('invisible_wall', 'remake', BUNDLE, {
		by: null,
		flow: 'absent',
		runtime: 'lines',
	});
	const prefix = `invisible_wall/remake/published/${meta.id}/deploy/`;
	check(
		'stage: copies exactly the kept set',
		sortedKeys(prefix).map((k) => k.slice(prefix.length)),
		[...keptRels].sort(),
	);
	check('stage: files counts only what it copied', meta.files, keptRels.length);
	check(
		'stage: bytes counts only what it copied',
		meta.bytes,
		keptRels.reduce((sum, rel) => sum + TREE[rel].length, 0),
	);
	const serve = async (rel: string) => {
		const res: Response = await assetRoute.GET({
			params: { token: 'TOK', project: 'remake', snapshot: meta.id, rel },
		} as never);
		return res.status;
	};
	check('player route: serves a bundle-named extra', await serve('onboardSheet.png'), 200);
	check('player route: serves a generated page', await serve('_pages/abc.webp'), 200);
	check(
		'player route: a raw source page is not in the version',
		await serve('sprites/S_Background/S_Background.webp'),
		404,
	);
}

{
	const objects = await pub.copyDeployTree(
		DEPLOY,
		'invisible_wall/remake/director/drafts/d1/deploy/',
		BUNDLE,
	);
	check(
		'draft: freezes the same set as a version',
		objects.map((o: { key: string }) => o.key.slice(DEPLOY.length)).sort(),
		[...keptRels].sort(),
	);
}

{
	const realGet = R2.get.bind(R2);
	R2.get = (k: string) => (k === `${DEPLOY}_pages/abc.webp` ? undefined : realGet(k));
	let failed = '';
	try {
		await pub.stageSnapshot('invisible_wall', 'remake', BUNDLE, {
			by: null,
			flow: 'absent',
			runtime: 'lines',
		});
	} catch (e) {
		failed = (e as Error).message;
	}
	R2.get = realGet;
	check(
		'stage: a kept file that vanishes mid-copy still fails the stage',
		failed,
		'deploy/_pages/abc.webp vanished while being snapshotted — publish again',
	);
}

{
	R2.clear();
	const meta = await pub.stageSnapshot('invisible_wall', 'remake', BUNDLE, {
		by: null,
		flow: 'absent',
		runtime: 'lines',
	});
	check('stage: an empty deploy/ freezes no file', [meta.files, meta.bytes], [0, 0]);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
