/**
 * The `models` asset class end to end over an in-memory R2 (`modelStorage.ts` → `modelExport.ts` →
 * the pull's tier rule), on a Node-built master (`scripts/lib/modelFixtures.ts`):
 *
 *   1. a project with no `models/` exports the empty index and writes nothing (its bundle is
 *      byte-identical: `check:exporter-registry` claim 5 bakes every registry id, this one included);
 *   2. upload: a staged GLB registers as a content-addressed master + `model.json` (create-only), a
 *      second register against a stale `model.json` ETag is a 409 that changes nothing, a GLB that
 *      fails the validator is a 422, and the staged upload is deleted every time;
 *   3. export: only the models a doc names (`modelId` / `modelIds`, read raw) ship; one GLB per
 *      published tier whose LOD window and maps match the profile; a tier identical to `full` (ultra
 *      over a 1024² master) is not written and is absent from the index; textures live in `_tex/`;
 *   4. a re-export re-encodes nothing (the `models/_cache/` texture cache) and rewrites no texture;
 *   5. a model no doc names any more is pruned from `deploy/models/`;
 *   6. a `quarter` pull (the pull's `artTierDrop`) keeps no normal / ORM texture, no full-tier file
 *      with a quarter copy, and no `@half` / `@ultra` file;
 *   7. a Game Config `models.profiles` override and a `model.json` override both reach the derive,
 *      the model's winning;
 *   8. through the Scene Editor's own save: the stored doc keeps `quarter` (2D readers still see only
 *      `half`), and the export after the save still writes the quarter copy;
 *   9. a master over `MODEL_LIMITS` is refused at upload (422, `MODEL_OVER_LIMIT`, nothing decoded;
 *      a non-GLB is `GLB_UNREADABLE`),
 *      and one registered before the caps is skipped by the export with a warning while the rest
 *      still ship;
 *  10. model ids are exact, case included: `CH_testhero` registers, lists and ships; a case-only twin
 *      and a malformed id are refused at register (400) with the reason; a wrong-case reference in
 *      the game warns with the model it meant.
 *
 *   pnpm --filter launcher-api check:model-export
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { buildMasterGlb } from './lib/modelFixtures';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (!ok) failures += 1;
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// ── In-memory R2 ────────────────────────────────────────────────────────────────────────────────
const R2 = new Map<string, Uint8Array>();
const etagOf = (b: Uint8Array) => `"${createHash('md5').update(b).digest('hex')}"`;
const enc = (t: string) => new TextEncoder().encode(t);
let puts: string[] = [];
let gets: string[] = [];
const swapAfterHead = new Map<string, Uint8Array>();
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
const r2 = await import(r2Url);
const write = (
	key: string,
	body: Uint8Array,
	cond?: { ifMatch?: string; ifNoneMatch?: string },
) => {
	const cur = R2.get(key);
	if (cond?.ifNoneMatch && cur) throw new r2.ConflictError(key);
	if (cond?.ifMatch && (!cur || etagOf(cur) !== cond.ifMatch)) throw new r2.ConflictError(key);
	R2.set(key, body);
	puts.push(key);
	return etagOf(body);
};
mock.module(r2Url, {
	namedExports: {
		...r2,
		getObjectBytesBounded: async (key: string, max: number, ifMatch?: string) => {
			const b = R2.get(key);
			if (!b) return null;
			if (ifMatch && etagOf(b) !== ifMatch) return 'changed';
			return b.byteLength > max ? 'large' : b;
		},
		getObjectBytes: async (key: string) => {
			gets.push(key);
			const b = R2.get(key);
			return b ? { body: b, etag: etagOf(b), contentType: '' } : null;
		},
		getObjectText: async (key: string) => {
			const b = R2.get(key);
			return b ? new TextDecoder().decode(b) : null;
		},
		getObjectTextWithEtag: async (key: string) => {
			const b = R2.get(key);
			return b ? { text: new TextDecoder().decode(b), etag: etagOf(b) } : null;
		},
		putObjectText: async (key: string, text: string, _ct?: string, cond?: object) =>
			write(key, enc(text), cond),
		putObjectBytes: async (key: string, body: Uint8Array, _ct?: string, cond?: object) =>
			write(key, body, cond),
		headObject: async (key: string) => {
			const b = R2.get(key);
			// A presigned PUT landing between the HEAD and the read (asset review #9).
			const swap = swapAfterHead.get(key);
			if (swap) {
				swapAfterHead.delete(key);
				R2.set(key, swap);
			}
			return b ? { etag: etagOf(b), size: b.byteLength, lastModified: 0 } : null;
		},
		listAllKeys: async (prefix: string) =>
			[...R2.keys()].filter((k) => k.startsWith(prefix)).sort(),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		deleteObject: async (key: string) => void R2.delete(key),
		copyObject: async (from: string, to: string, _ct?: string, sourceEtag?: string) => {
			const b = R2.get(from);
			if (!b) return false;
			if (sourceEtag && etagOf(b) !== sourceEtag) return false;
			R2.set(to, b);
			return true;
		},
		objectExists: async (key: string) => R2.has(key),
		listFolder: async (prefix: string) => {
			const folders = new Set<string>();
			const files: { key: string; size: number; lastModified: null }[] = [];
			for (const [k, b] of R2) {
				if (!k.startsWith(prefix)) continue;
				const rest = k.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash >= 0) folders.add(prefix + rest.slice(0, slash + 1));
				else files.push({ key: k, size: b.byteLength, lastModified: null });
			}
			return { files, folders: [...folders].sort() };
		},
		presignPut: async (key: string) => `https://r2.invalid/${key}?sig`,
	},
});

const src = (rel: string) => new URL(`../src/lib/server/${rel}`, import.meta.url).href;
const storage = (await import(
	src('modelStorage.ts')
)) as typeof import('../src/lib/server/modelStorage');
const exporter = (await import(
	src('modelExport.ts')
)) as typeof import('../src/lib/server/modelExport');
const paths = (await import(
	src('projectPaths.ts')
)) as typeof import('../src/lib/server/projectPaths');
const { artTierDrop } = (await import('./lib/artTierPin.mjs')) as {
	artTierDrop: (
		rels: string[],
		tier: string,
		textOf: (rel: string) => Promise<string>,
	) => Promise<{ drop: string[]; named: unknown[] }>;
};

const C = 'acme';
const P = 'arena';
const deployPrefix = `${paths.SUB.deploy(C, P)}/models/`;
const under = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

// ── 1. A 2D project ──────────────────────────────────────────────────────────────────────────────
console.log('1. a project with no models');
R2.set(paths.editorDocKey(C, P), enc(JSON.stringify({ scenes: [], resolutionTiers: ['half'] })));
const empty = await exporter.exportModels(C, P);
check(
	'exports the empty index',
	JSON.stringify(empty) === JSON.stringify(exporter.EMPTY_MODEL_INDEX),
);
check('writes nothing', puts.length === 0 && under(deployPrefix).length === 0, puts.join(', '));

// ── 2. Upload ────────────────────────────────────────────────────────────────────────────────────
console.log('2. upload and register');
const master = await buildMasterGlb({
	id: 'PR_orb',
	textureSide: 1024,
	normal: true,
	orm: true,
	levels: [
		{ level: 0, segments: 76 },
		{ level: 1, segments: 30 },
	],
});
const stage = async (id: string, bytes: Uint8Array) => {
	const { upload, url } = await storage.presignModelUpload(C, P, id, 60);
	R2.set(paths.modelUploadKey(C, P, id, upload), bytes);
	check(
		`the presigned URL names the staging key, not a model file (${id})`,
		url.includes('/uploads/'),
	);
	return upload;
};
let upload = await stage('orb', master);
const first = await storage.registerModelUpload(C, P, 'orb', upload, 'prop', null);
check('a new model registers', first.ok, JSON.stringify(first));
const doc1 = first.ok ? first.doc : null;
check(
	'its master is content-addressed and its model.json names it',
	!!doc1 &&
		/^source\.[0-9a-f]{12}\.glb$/.test(doc1.source.file) &&
		R2.has(paths.modelSourceKey(C, P, 'orb', doc1.source.file)),
	JSON.stringify(doc1?.source),
);
check('the staged upload is gone', under(`${paths.SUB.models(C, P)}/orb/uploads/`).length === 0);

upload = await stage('orb', master);
const again = await storage.registerModelUpload(C, P, 'orb', upload, 'prop', null);
check('registering "new" over an existing model is a 409', !again.ok && again.status === 409);
upload = await stage('orb', master);
const stale = await storage.registerModelUpload(C, P, 'orb', upload, 'prop', '"stale"');
check('a stale baseEtag is a 409', !stale.ok && stale.status === 409);
check(
	'…and model.json is unchanged',
	JSON.stringify(
		storage.normalizeModelDoc(
			JSON.parse(new TextDecoder().decode(R2.get(paths.modelDocKey(C, P, 'orb'))!)),
		),
	) === JSON.stringify(doc1),
);
const bad = await buildMasterGlb({ id: 'PR_bad', textureSide: 0, levels: [] });
upload = await stage('bad', bad);
const refused = await storage.registerModelUpload(C, P, 'bad', upload, 'prop', null);
check(
	'a GLB with no mesh is refused by the validator (422) and writes no model.json',
	!refused.ok && refused.status === 422 && !R2.has(paths.modelDocKey(C, P, 'bad')),
	JSON.stringify(refused),
);
check(
	'every staged upload was deleted',
	under(`${paths.SUB.models(C, P)}/`).every((k) => !k.includes('/uploads/')),
);

// A second model the game never names.
upload = await stage('spare', master);
await storage.registerModelUpload(C, P, 'spare', upload, 'prop', null);

// ── 3. Export ────────────────────────────────────────────────────────────────────────────────────
console.log('3. export');
R2.set(
	paths.editorDocKey(C, P),
	enc(
		JSON.stringify({
			resolutionTiers: ['half', 'quarter', 'ultra'],
			scenes: [{ id: 'arena', nodes: [{ id: 'n1', type: 'model3d', props: { modelId: 'orb' } }] }],
		}),
	),
);
puts = [];
const index = await exporter.exportModels(C, P, { warn: (m) => console.log('   warn:', m) });
const orb = index.models.find((m) => m.id === 'orb');
check(
	'only the named model ships',
	index.models.length === 1 && !!orb,
	JSON.stringify(index.models.map((m) => m.id)),
);
check(
	'tiers: full, half, quarter — no ultra (a 1024² master with no _LODU equals full)',
	!!orb &&
		JSON.stringify(Object.keys(orb.tiers).sort()) === JSON.stringify(['full', 'half', 'quarter']),
	JSON.stringify(orb && Object.keys(orb.tiers)),
);
const files = under(deployPrefix).map((k) => k.slice(deployPrefix.length));
check(
	'deploy/models has orb.glb, orb@half.glb, orb@quarter.glb, index.json and _tex/ — no @ultra, no spare',
	['orb.glb', 'orb@half.glb', 'orb@quarter.glb', 'index.json'].every((f) => files.includes(f)) &&
		!files.some((f) => f.includes('@ultra') || f.startsWith('spare')) &&
		files.some((f) => f.startsWith('_tex/')),
	files.join(' '),
);
check(
	'full ships master levels 0–2, half 1–3, quarter 2–3',
	!!orb &&
		JSON.stringify(orb.tiers.full.lods.map((l) => l.level)) === '[0,1,2]' &&
		JSON.stringify(orb.tiers.half?.lods.map((l) => l.level)) === '[1,2,3]' &&
		JSON.stringify(orb.tiers.quarter?.lods.map((l) => l.level)) === '[2,3]',
);
check(
	'quarter drops normal and ORM',
	orb?.tiers.quarter?.maps.normal === 'dropped' && orb.tiers.quarter.maps.orm === 'dropped',
);
check(
	'every tier GLB in the index exists, and so does every texture it lists',
	!!orb &&
		Object.values(orb.tiers).every(
			(t) =>
				R2.has(deployPrefix + t.glb) &&
				Object.values(t.maps).every((m) => m === 'dropped' || R2.has(deployPrefix + m.file)),
		),
);
check(
	'the index records sockets and the class screen sizes',
	JSON.stringify(orb?.sockets) === '["top"]' && orb?.lodScreenSize.levels.length === 4,
	JSON.stringify(orb?.sockets),
);

// ── 4. Re-export ─────────────────────────────────────────────────────────────────────────────────
console.log('4. re-export');
const cacheKeys = under(`${paths.SUB.models(C, P)}/_cache/`).length;
puts = [];
await exporter.exportModels(C, P, { warn: () => undefined });
check(
	'no new encode (the texture cache answered)',
	under(`${paths.SUB.models(C, P)}/_cache/`).length === cacheKeys,
);
check('no texture rewritten', !puts.some((k) => k.includes('/_tex/')), puts.join(', '));

// ── 5. Prune ─────────────────────────────────────────────────────────────────────────────────────
console.log('5. prune');
const quarterRels = files.map((f) => `models/${f}`);
R2.set(paths.editorDocKey(C, P), enc(JSON.stringify({ scenes: [], resolutionTiers: ['half'] })));
const none = await exporter.exportModels(C, P, { warn: () => undefined });
check(
	'a model no doc names any more leaves deploy/models (only the empty index stays)',
	none.models.length === 0 &&
		JSON.stringify(under(deployPrefix).map((k) => k.slice(deployPrefix.length))) ===
			'["index.json"]',
	JSON.stringify(under(deployPrefix)),
);

// ── 6. The quarter pull ──────────────────────────────────────────────────────────────────────────
console.log('6. a quarter pull');
R2.set(
	paths.editorDocKey(C, P),
	enc(
		JSON.stringify({
			resolutionTiers: ['half', 'quarter'],
			scenes: [
				{
					id: 'arena',
					name: 'Arena',
					nodes: [{ id: 'orb1', kind: 'container', children: [], modelId: 'orb' }],
				},
			],
		}),
	),
);
const idx = await exporter.exportModels(C, P, { warn: () => undefined });
const rels = under(deployPrefix).map((k) => `models/${k.slice(deployPrefix.length)}`);
const textOf = async (rel: string) =>
	new TextDecoder('latin1').decode(R2.get(deployPrefix + rel.slice('models/'.length)));
// The pull's two passes: drop by name first, then give back what a kept GLB names.
const { drop } = await artTierDrop(rels, 'quarter', async () => '');
const keptFirst = rels.filter((r) => !drop.includes(r));
const named = (
	await artTierDrop(rels, 'quarter', (rel) =>
		keptFirst.includes(rel) ? textOf(rel) : Promise.resolve(''),
	)
).drop;
const kept = rels.filter((r) => !named.includes(r));
const full = idx.models[0]?.tiers.full;
const half = idx.models[0]?.tiers.half;
const maps = (t: typeof full) =>
	Object.entries(t?.maps ?? {})
		.filter(([k, m]) => (k === 'normal' || k === 'orm') && m !== 'dropped')
		.map(([, m]) => (m === 'dropped' ? '' : `models/${m.file}`));
check(
	'no normal / ORM texture of any tier',
	![...maps(full), ...maps(half)].some((f) => kept.includes(f)),
	kept.join(' '),
);
check('no @half / @ultra file', !kept.some((r) => /@(half|ultra)\./.test(r)), kept.join(' '));
check(
	'no full-tier GLB with a quarter copy',
	!kept.includes('models/orb.glb') && kept.includes('models/orb@quarter.glb'),
);
check(
	'the quarter GLB keeps every texture it names',
	Object.values(idx.models[0]?.tiers.quarter?.maps ?? {}).every(
		(m) => m === 'dropped' || kept.includes(`models/${m.file}`),
	),
	kept.join(' '),
);
void quarterRels;

// ── 7. Overrides ─────────────────────────────────────────────────────────────────────────────────
console.log('7. overrides');
const project = storage.resolveModelProfile('prop', null, {
	profiles: { prop: { half: { maps: { baseColor: 256 } } } },
});
check('a Game Config profile override reaches the derive', project.half.maps.baseColor === 256);
const both = storage.resolveModelProfile(
	'prop',
	{ overrides: { half: { maps: { baseColor: 128 }, encoding: { baseColor: 'uastc' } } } },
	{ profiles: { prop: { half: { maps: { baseColor: 256 } } } } },
);
check(
	'model.json wins over the Game Config, and keeps the rest of the code default',
	both.half.maps.baseColor === 128 &&
		both.half.encoding.baseColor === 'uastc' &&
		both.half.maps.normal === 1024,
	JSON.stringify(both.half),
);

// ── 8. Through the Scene Editor's save ──────────────────────────────────────────────────────────
console.log('8. save → load → export');
const editor = (await import(
	src('editorStorage.ts')
)) as typeof import('../src/lib/server/editorStorage');
const { normalizeResolutionTiers } = await import('engine-layout');
const stored = JSON.parse(new TextDecoder().decode(R2.get(paths.editorDocKey(C, P))!));
R2.delete(paths.editorDocKey(C, P));
await editor.saveDoc(
	C,
	P,
	{ ...stored, version: 2, projectKey: P, mainSizesMap: {}, updatedAt: '' },
	null,
);
const reloaded = await editor.loadDoc(C, P);
check(
	'an editor save keeps the model tiers in the stored doc',
	JSON.stringify(reloaded.resolutionTiers) === '["half","quarter"]',
	JSON.stringify(reloaded.resolutionTiers),
);
check(
	'…while every 2D reader (the page store, the art export) still gets only half',
	JSON.stringify(normalizeResolutionTiers(reloaded.resolutionTiers)) === '["half"]',
	JSON.stringify(normalizeResolutionTiers(reloaded.resolutionTiers)),
);
const afterSave = await exporter.exportModels(C, P, { warn: (m) => console.log('   warn:', m) });
check(
	'the export after the save still writes the quarter copy',
	!!afterSave.models[0]?.tiers.quarter && R2.has(`${deployPrefix}orb@quarter.glb`),
	JSON.stringify(afterSave.models.map((m) => [m.id, Object.keys(m.tiers)])),
);

// ── 9. Input limits ──────────────────────────────────────────────────────────────────────────────
console.log('9. input limits');
const jsonText = enc(
	JSON.stringify({
		asset: { version: '2.0' },
		accessors: [{ count: 3_000_000, type: 'VEC3', componentType: 5126 }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
	}),
);
const jsonLen = Math.ceil(jsonText.length / 4) * 4;
const overLimit = new Uint8Array(20 + jsonLen).fill(0x20, 20);
const hv = new DataView(overLimit.buffer);
hv.setUint32(0, 0x46546c67, true);
hv.setUint32(4, 2, true);
hv.setUint32(8, overLimit.length, true);
hv.setUint32(12, jsonLen, true);
hv.setUint32(16, 0x4e4f534a, true);
overLimit.set(jsonText, 20);
upload = await stage('huge', overLimit);
const tooBig = await storage.registerModelUpload(C, P, 'huge', upload, 'prop', null);
check(
	'an over-limit master is refused at upload (422, MODEL_OVER_LIMIT)',
	!tooBig.ok &&
		tooBig.status === 422 &&
		!!tooBig.issues?.length &&
		tooBig.issues.every((i) => i.level === 'error' && i.code === 'MODEL_OVER_LIMIT') &&
		!R2.has(paths.modelDocKey(C, P, 'huge')),
	JSON.stringify(tooBig),
);
upload = await stage('junk', enc('definitely not a GLB file at all'));
const junk = await storage.registerModelUpload(C, P, 'junk', upload, 'prop', null);
check(
	'a file that is not a GLB is refused as GLB_UNREADABLE, not as over the limits',
	!junk.ok &&
		junk.status === 422 &&
		!!junk.issues?.length &&
		junk.issues.every((i) => i.code === 'GLB_UNREADABLE'),
	JSON.stringify(junk),
);
const hugeFile = 'source.000000000000.glb';
R2.set(paths.modelSourceKey(C, P, 'huge', hugeFile), overLimit);
R2.set(
	paths.modelDocKey(C, P, 'huge'),
	enc(
		JSON.stringify({
			class: 'prop',
			source: { file: hugeFile, sha256: '', bytes: overLimit.byteLength },
			validator: { issues: [] },
		}),
	),
);
R2.set(
	paths.editorDocKey(C, P),
	enc(JSON.stringify({ scenes: [{ nodes: [{ modelIds: ['huge', 'orb'] }] }] })),
);
const warnings: string[] = [];
const skipped = await exporter.exportModels(C, P, { warn: (m) => warnings.push(m) });
check(
	'an over-limit model registered before the caps is skipped with a warning',
	!skipped.models.some((m) => m.id === 'huge') &&
		warnings.some((w) => w.includes('"huge"') && w.includes('over the model limits')),
	warnings.join(' | '),
);
check(
	'…and the rest of the export still ships',
	skipped.models.some((m) => m.id === 'orb') &&
		!under(deployPrefix).some((k) => k.includes('huge')),
	JSON.stringify(skipped.models.map((m) => m.id)),
);

// ── 10. Ids are exact, case included ─────────────────────────────────────────────────────────────
console.log('10. model ids keep their case');
upload = await stage('CH_testhero', master);
const upper = await storage.registerModelUpload(C, P, 'CH_testhero', upload, 'prop', null);
check(
	'an id in the Blender export’s own spelling (CH_testhero) registers',
	upper.ok,
	JSON.stringify(upper),
);
check(
	'…and the model listing includes it',
	(await storage.listModelIds(C, P)).includes('CH_testhero'),
	JSON.stringify(await storage.listModelIds(C, P)),
);
upload = await stage('ch_testhero', master);
const twin = await storage.registerModelUpload(C, P, 'ch_testhero', upload, 'prop', null);
check(
	'an id differing from an existing model only in case is refused (400), naming it',
	!twin.ok && twin.status === 400 && twin.error.includes('"CH_testhero"'),
	JSON.stringify(twin),
);
upload = await stage('Bad-Id', master);
const malformed = await storage.registerModelUpload(C, P, 'Bad-Id', upload, 'prop', null);
check(
	'a malformed id is refused (400) with the rule, and writes no model.json',
	!malformed.ok &&
		malformed.status === 400 &&
		malformed.error.includes('letters, digits') &&
		!R2.has(paths.modelDocKey(C, P, 'Bad-Id')),
	JSON.stringify(malformed),
);
check(
	'every refused upload was deleted',
	under(`${paths.SUB.models(C, P)}/`).every((k) => !k.includes('/uploads/')),
);
R2.set(
	paths.editorDocKey(C, P),
	enc(
		JSON.stringify({
			scenes: [
				{
					id: 'arena',
					name: 'Arena',
					nodes: [
						{ id: 'hero', kind: 'container', children: [], modelId: 'CH_testhero' },
						{ id: 'typo', kind: 'container', children: [], modelId: 'ch_TESTHERO' },
					],
				},
			],
		}),
	),
);
const caseWarnings: string[] = [];
const cased = await exporter.exportModels(C, P, { warn: (m) => caseWarnings.push(m) });
check(
	'the export ships CH_testhero.glb under its exact id',
	cased.models.some((m) => m.id === 'CH_testhero') && R2.has(`${deployPrefix}CH_testhero.glb`),
	JSON.stringify(cased.models.map((m) => m.id)),
);
check(
	'a reference spelled in another case warns, naming the model it meant',
	caseWarnings.some((w) => w.includes('"ch_TESTHERO"') && w.includes('did you mean "CH_testhero"')),
	JSON.stringify(caseWarnings),
);

// ── One model's failure is its own ─────────────────────────────────────────────────────────────
console.log('a model that passes upload but fails its derive');
const broken = await buildMasterGlb({
	id: 'PR_broken',
	textureSide: 256,
	corruptBase: true,
	levels: [{ level: 0, segments: 30 }],
});
upload = await stage('broken', broken);
const brokenReg = await storage.registerModelUpload(C, P, 'broken', upload, 'prop', null);
check(
	'it passes the upload checks (its size reads from the PNG header)',
	brokenReg.ok,
	JSON.stringify(brokenReg),
);
R2.set(
	paths.editorDocKey(C, P),
	enc(
		JSON.stringify({
			resolutionTiers: ['half'],
			scenes: [
				{
					id: 'arena',
					name: 'Arena',
					nodes: [
						{ id: 'a', kind: 'container', children: [], modelId: 'broken' },
						{ id: 'b', kind: 'container', children: [], modelId: 'orb' },
					],
				},
			],
		}),
	),
);
let isolated: Awaited<ReturnType<typeof exporter.exportModels>> | null = null;
try {
	isolated = await exporter.exportModels(C, P, { warn: () => undefined });
} catch (e) {
	check('the export does not throw for one bad model', false, (e as Error).message);
}
check(
	'the good model still ships',
	!!isolated?.models.some((m) => m.id === 'orb') && R2.has(`${deployPrefix}orb.glb`),
	JSON.stringify(isolated?.models.map((m) => m.id)),
);
check(
	'the bad one is reported as skipped with its derive error, not shipped',
	!!isolated?.skipped?.some((x) => x.id === 'broken' && x.reason.includes('derive failed')) &&
		!isolated.models.some((m) => m.id === 'broken'),
	JSON.stringify(isolated?.skipped),
);
check(
	'no GLB of the failed model is left in deploy/models',
	!under(deployPrefix).some((k) => k.slice(deployPrefix.length).startsWith('broken')),
	JSON.stringify(under(deployPrefix)),
);

// ── The derived-tier cache (asset review #4) ─────────────────────────────────────────────────────
console.log('a warm export: every tier already derived');
const sourceKeyOf = (id: string) =>
	paths.modelSourceKey(
		C,
		P,
		id,
		storage.normalizeModelDoc(
			JSON.parse(new TextDecoder().decode(R2.get(paths.modelDocKey(C, P, id))!)),
		)!.source.file,
	);
await exporter.exportModels(C, P, { warn: () => undefined });
puts = [];
gets = [];
const warm = await exporter.exportModels(C, P, { warn: () => undefined });
check(
	'it still ships the model',
	warm.models.some((m) => m.id === 'orb'),
);
check(
	'it never downloads the master',
	!gets.includes(sourceKeyOf('orb')),
	gets.filter((k) => k.includes('/source.')).join(', '),
);
check(
	'it derives and encodes nothing (no derived-tier or texture-cache write)',
	!puts.some((k) => k.includes('/derived/') || k.includes('/_cache/')),
	puts.join(', '),
);

console.log('a cached file gone missing');
const derivedGlbs = [...R2.keys()].filter(
	(k) => k.includes('/orb/derived/') && k.endsWith('model.glb'),
);
for (const k of derivedGlbs) R2.delete(k);
for (const k of [...R2.keys()]) if (k.startsWith(`${deployPrefix}orb`)) R2.delete(k);
puts = [];
const healed = await exporter.exportModels(C, P, { warn: () => undefined });
check(
	'the tier is derived again and the model still ships',
	healed.models.some((m) => m.id === 'orb') &&
		R2.has(`${deployPrefix}orb.glb`) &&
		puts.some((k) => k.includes('/orb/derived/') && k.endsWith('model.glb')),
	puts.join(', '),
);

console.log('a cached file that no longer holds its record’s bytes');
for (const k of [...R2.keys()])
	if (k.includes('/orb/derived/') && k.endsWith('model.glb'))
		R2.set(k, enc('not the recorded GLB'));
for (const k of [...R2.keys()]) if (k.startsWith(`${deployPrefix}orb`)) R2.delete(k);
await exporter.exportModels(C, P, { warn: () => undefined });
const shipped = R2.get(`${deployPrefix}orb.glb`);
check(
	'it is never copied: the tier is derived again and the shipped GLB is a real GLB',
	!!shipped && new TextDecoder().decode(shipped.subarray(0, 4)) === 'glTF',
	shipped ? new TextDecoder().decode(shipped.subarray(0, 24)) : 'missing',
);

console.log('a profile change');
const configWith = (baseColor: number) =>
	R2.set(
		paths.gameConfigDocKey(C, P),
		enc(JSON.stringify({ models: { profiles: { prop: { half: { maps: { baseColor } } } } } })),
	);
configWith(256);
puts = [];
const reprofiled = await exporter.exportModels(C, P, { warn: () => undefined });
const halfMap = reprofiled.models.find((m) => m.id === 'orb')?.tiers.half?.maps.baseColor;
const newRecords = puts.filter((k) => k.includes('/orb/derived/') && k.endsWith('tier.json'));
check(
	'a Game Config change to the half profile re-derives half alone (one new tier record)',
	typeof halfMap === 'object' && halfMap.w === 256 && newRecords.length === 1,
	`${JSON.stringify(halfMap)} — ${newRecords.length} new tier record(s)`,
);
R2.delete(paths.gameConfigDocKey(C, P));

// ── Register: a bounded, pinned read; budgets refused (asset review #9, #10) ───────────────────
console.log('register reads only the bytes it weighed, and refuses an over-budget master');
upload = await stage('swapped', master);
swapAfterHead.set(paths.modelUploadKey(C, P, 'swapped', upload), new Uint8Array(4096).fill(7));
const swapped = await storage.registerModelUpload(C, P, 'swapped', upload, 'prop', null);
check(
	'an upload replaced after its HEAD is refused, and no model.json is written',
	!swapped.ok && swapped.status === 404 && !R2.has(paths.modelDocKey(C, P, 'swapped')),
	JSON.stringify(swapped),
);
const dense = await buildMasterGlb({
	id: 'PR_dense',
	textureSide: 0,
	levels: [{ level: 0, segments: 120 }],
});
upload = await stage('dense', dense);
const overBudget = await storage.registerModelUpload(C, P, 'dense', upload, 'prop', null);
check(
	'a LOD0 over its class budget (14,400 tris for a 6,000 prop) is refused: TRIS_OVER_BUDGET',
	!overBudget.ok &&
		overBudget.status === 422 &&
		!!overBudget.issues?.some((i) => i.code === 'TRIS_OVER_BUDGET' && i.level === 'error'),
	JSON.stringify(overBudget),
);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall model-export checks passed');
process.exit(failures ? 1 : 0);
