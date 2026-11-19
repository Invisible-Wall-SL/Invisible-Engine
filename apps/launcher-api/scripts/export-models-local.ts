/**
 * Run the launcher's real `models` export (`modelStorage.ts` register → `modelExport.ts`) over
 * local master GLBs, with R2 in memory, and write what a publish would put in `deploy/models/` to a
 * folder. For proving a Blender export end to end before there is a Model Viewer to upload it with
 * (`tools/blender/ie_test_character.py` → this → `scripts/playtest/arcade3d-play.mjs --models`).
 *
 *   pnpm --filter launcher-api exec tsx --tsconfig tsconfig.scripts.json \
 *     --experimental-test-module-mocks scripts/export-models-local.ts \
 *     --model CH_testhero=<dir>/CH_testhero.glb:hero --model anim_locomotion=<dir>/locomotion.glb:anim \
 *     --tiers half,quarter --out <deploy dir>
 *
 * Writes `<out>/models/…` (GLBs, `_tex/`, `index.json`) and prints the index's sizes.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mock } from 'node:test';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
	options: {
		model: { type: 'string', multiple: true, default: [] },
		tiers: { type: 'string', default: '' },
		out: { type: 'string' },
	},
});
if (!opt.out || !opt.model.length) {
	console.error('usage: --model <id>=<file.glb>:<class> … [--tiers half,quarter] --out <dir>');
	process.exit(2);
}

const R2 = new Map<string, Uint8Array>();
const etagOf = (b: Uint8Array) => `"${createHash('md5').update(b).digest('hex')}"`;
const enc = (t: string) => new TextEncoder().encode(t);
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
	return etagOf(body);
};
mock.module(r2Url, {
	namedExports: {
		...r2,
		getObjectBytes: async (key: string) => {
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
			return b ? { etag: etagOf(b), size: b.byteLength, lastModified: 0 } : null;
		},
		listAllKeys: async (prefix: string) =>
			[...R2.keys()].filter((k) => k.startsWith(prefix)).sort(),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		deleteObject: async (key: string) => void R2.delete(key),
		copyObject: async (from: string, to: string) => {
			const b = R2.get(from);
			if (!b) return false;
			R2.set(to, b);
			return true;
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
const { isModelClass } = await import('constants-shared/modelTiers');

const C = 'local';
const P = 'models';
const ids: string[] = [];
for (const spec of opt.model) {
	const match = /^([a-z0-9_]+)=(.+):([a-z]+)$/i.exec(spec);
	if (!match || !isModelClass(match[3])) {
		console.error(`bad --model ${spec}: <id>=<file.glb>:<class>`);
		process.exit(2);
	}
	const [, id, file, cls] = match;
	const { upload } = await storage.presignModelUpload(C, P, id, 60);
	R2.set(paths.modelUploadKey(C, P, id, upload), new Uint8Array(readFileSync(resolve(file))));
	const result = await storage.registerModelUpload(C, P, id, upload, cls, null);
	if (!result.ok) {
		console.error(`${id}: ${result.error} ${JSON.stringify(result.issues ?? [])}`);
		process.exit(1);
	}
	for (const issue of result.doc.validator.issues)
		console.log(`  ${id}: ${issue.level} ${issue.message}`);
	ids.push(id);
}
const tiers = opt.tiers.split(',').filter(Boolean);
R2.set(
	paths.editorDocKey(C, P),
	enc(
		JSON.stringify({
			resolutionTiers: tiers,
			scenes: [{ id: 'models', nodes: [{ id: 'n', props: { modelIds: ids } }] }],
		}),
	),
);
const index = await exporter.exportModels(C, P, { warn: (m) => console.warn(`  warn: ${m}`) });
const prefix = `${paths.SUB.deploy(C, P)}/`;
const out = resolve(opt.out);
for (const [key, bytes] of R2) {
	if (!key.startsWith(`${prefix}models/`)) continue;
	const file = join(out, key.slice(prefix.length));
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, bytes);
}
for (const m of index.models)
	for (const [tier, t] of Object.entries(m.tiers))
		console.log(
			`${m.id} ${tier}: ${t.glb} ${t.bytes} B, lods ${t.lods.map((l) => `${l.level}:${l.tris}`).join(' ')}, maps ${JSON.stringify(
				Object.fromEntries(
					Object.entries(t.maps).map(([k, v]) => [k, v === 'dropped' ? v : `${v.w}² ${v.enc}`]),
				),
			)}`,
		);
console.log(`wrote ${join(out, 'models')}`);
