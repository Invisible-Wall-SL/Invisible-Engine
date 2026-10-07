// Offline contract test for the Rigger's guarded `.irig` save (conditional write, structural
// check, rolling backups).
//
//   node tools/rigger-spike/irig-save.mjs
//
// Bundles the REAL `riggerIrig.ts` + `riggerIrigWrite.ts` with esbuild and runs them against an
// in-memory R2 that implements the precondition semantics (`If-Match` / `If-None-Match: *` →
// ConflictError). The skeleton index + atlas sync are stubbed: they are covered by
// `reindex-preserve.mjs`. The structural check is held against the engine-rig loader —
// every doc it accepts must load, every reference break it names must make the loader throw — on
// a synthetic rig, and on every skeleton checked into the repo (loaded with one stand-in region
// for every atlas lookup: the check is about references, not art).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RIG_CORE } from './rig.mjs';
import { ESBUILD } from './esbuild.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const SERVER_DIR = join(APP, 'src/lib/server');
const esbuild = await import(ESBUILD);
const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import(RIG_CORE);

// ── in-memory R2 ────────────────────────────────────────────────────────────────────────────
const fakeR2 = `
	export class ConflictError extends Error { constructor(k) { super('conflict ' + k); this.name = 'ConflictError'; } }
	const store = globalThis.__r2 = globalThis.__r2 || { objects: new Map(), n: 0, log: [] };
	const put = (key, text) => { const etag = '"' + (++store.n).toString(16).padStart(8, 'a') + 'ffff"'; store.objects.set(key, { text, etag }); return etag; };
	export function precondition(b) { if (b === undefined) return undefined; return b === null ? { ifNoneMatch: '*' } : { ifMatch: b }; }
	export async function putObjectText(key, text, _ct, cond) {
		const cur = store.objects.get(key);
		if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
		if (cond?.ifMatch && (!cur || cur.etag !== cond.ifMatch)) throw new ConflictError(key);
		store.log.push('put ' + key);
		return put(key, text);
	}
	export async function headObject(key) { const o = store.objects.get(key); return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null; }
	export async function copyObject(src, dest) { const o = store.objects.get(src); if (!o) return false; store.log.push('copy ' + src); put(dest, o.text); return true; }
	export async function getObjectText(key) { return store.objects.get(key)?.text ?? null; }
	export async function getObjectTextWithEtag(key) { const o = store.objects.get(key); return o ? { text: o.text, etag: o.etag } : null; }
	export async function listAllObjects(prefix) { return [...store.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.text.length, lastModified: 0 })); }
	export async function deleteObjects(keys) { for (const k of keys) store.objects.delete(k); }
`;
const stubs = {
	name: 'stubs',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'r2', namespace: 'stub' }));
		build.onResolve({ filter: /^\.\/rigBundleSync$/ }, () => ({ path: 'sync', namespace: 'stub' }));
		build.onResolve({ filter: /^\.\/rigIndex$/ }, () => ({ path: 'index', namespace: 'stub' }));
		build.onResolve({ filter: /^\$lib\// }, (a) => ({ path: join(APP, 'src/lib', a.path.slice(5) + '.ts') }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
			contents:
				a.path === 'r2'
					? fakeR2
					: a.path === 'sync'
						? 'export async function ensureBundleAtlasFresh() { return null; }'
						: `export const scanSkeletonsIndex = async () => ({});
						   export async function reindexSkeletonsPreserving() {
						     return { index: { skeletons: [{}] }, atlasMissingFolders: globalThis.__atlasMissing || [], rederivedFolders: [], preservedFolders: [] };
						   }`,
			loader: 'js',
		}));
	},
};
const out = join(mkdtempSync(join(tmpdir(), 'irig-save-')), 'bundle.mjs');
await esbuild.build({
	stdin: {
		contents:
			"export * from './riggerIrig.ts'; export * from './riggerIrigWrite.ts'; export * from './riggerNewRig.ts'; export { sharedRigKey } from './projectPaths.ts';",
		resolveDir: SERVER_DIR,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	plugins: [stubs],
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const M = await import(pathToFileURL(out).href);
const r2 = globalThis.__r2;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
// `seq1` is frame 1 of a one-frame image sequence based at `seq`.
const ATLAS = 'page.png\nsize: 64,64\nfilter: Linear,Linear\nhead\nbounds: 0,0,32,32\nseq1\nbounds: 32,0,32,32\n';
const mesh = () => ({
	type: 'mesh', path: 'head', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3],
	vertices: [0, 0, 32, 0, 32, 32, 0, 32], hull: 4, width: 32, height: 32,
});
const linked = (parent, skin) => ({ type: 'linkedmesh', path: 'head', parent, ...(skin === undefined ? {} : { skin }), width: 32, height: 32 });
const good = () => ({
	skeleton: { spine: '4.2.40', width: 32, height: 32 },
	bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'arm', parent: 'body' }],
	slots: [{ name: 'head', bone: 'body', attachment: 'head' }, { name: 'cape', bone: 'body' }],
	ik: [{ name: 'reach', bones: ['arm'], target: 'root' }],
	transform: [{ name: 'follow', bones: ['arm'], target: 'body' }],
	path: [{ name: 'rail', bones: ['arm'], target: 'cape' }],
	physics: [{ name: 'wobble', bone: 'arm' }],
	skins: [
		{ name: 'default', attachments: { head: { head: { width: 32, height: 32 } }, cape: { cape: mesh(), flap: linked('cape') } } },
		// A linked mesh names the skin its parent is in — unless that is `default`, which is what no
		// skin means, whichever skin the linked mesh itself sits in.
		{
			name: 'red', bones: ['arm'], ik: ['reach'], transform: ['follow'], path: ['rail'], physics: ['wobble'],
			attachments: { cape: { redcape: mesh(), redflap: linked('redcape', 'red'), plainflap: linked('cape') } },
		},
	],
	events: { hit: {} },
	animations: {
		idle: {
			bones: { arm: { rotate: [{ value: 10 }] } },
			slots: { head: { rgba: [{ color: 'ffffffff' }] } },
			ik: { reach: [{ mix: 0.5 }] },
			transform: { follow: [{ mixRotate: 0.5 }] },
			path: { rail: { position: [{ value: 0.5 }] } },
			physics: { wobble: { inertia: [{ value: 0.5 }] }, '': { reset: [{}] } },
			attachments: { default: { cape: { cape: { deform: [{ vertices: [1, 1] }] } } }, red: { cape: { redcape: { deform: [{}] } } } },
			drawOrder: [{ offsets: [{ slot: 'cape', offset: -1 }] }, {}],
			events: [{ name: 'hit' }],
		},
	},
});
const atlas = new TextureAtlas(ATLAS);
for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {} });
/** Every lookup answers the one region, so a checked-in rig loads without its own atlas. */
const anyArt = { findRegion: () => atlas.findRegion('head') };
const loads = (doc, art = atlas) => {
	try { new SkeletonJson(new AtlasAttachmentLoader(art)).readSkeletonData(JSON.parse(JSON.stringify(doc))); return null; }
	catch (e) { return String(e.message || e); }
};
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Every skeleton checked into the apps: `{ file, doc }`. */
function checkedInRigs() {
	const appsDir = fileURLToPath(new URL('apps/', ROOT));
	const files = readdirSync(appsDir).flatMap((app) => {
		try {
			return readdirSync(join(appsDir, app, 'static'), { recursive: true }).map(
				(f) => `${app}/static/${String(f).replaceAll('\\', '/')}`,
			);
		} catch {
			return [];
		}
	});
	const rigs = [];
	for (const file of files) {
		if (!file.endsWith('.json') || !file.includes('/spines/')) continue;
		let doc;
		try { doc = JSON.parse(readFileSync(join(appsDir, file), 'utf8')); } catch { continue; }
		if (doc && Array.isArray(doc.bones)) rigs.push({ file, doc });
	}
	return rigs;
}

// Read the way SkeletonJson reads them, independently of the check under test.
function* linkedMeshesOf(doc) {
	for (const skin of doc.skins ?? []) {
		for (const entries of Object.values(skin.attachments ?? {})) {
			for (const a of Object.values(entries ?? {})) {
				if ((a?.type === 'mesh' || a?.type === 'linkedmesh') && a.parent) yield a;
			}
		}
	}
}
/** Animation keys that make the loader look an attachment up: a deform or sequence with a first key. */
function* attachmentKeysOf(doc) {
	for (const anim of Object.values(doc.animations ?? {})) {
		for (const [skin, bySlot] of Object.entries(anim.attachments ?? {})) {
			for (const [slot, byName] of Object.entries(bySlot ?? {})) {
				for (const [name, timelines] of Object.entries(byName ?? {})) {
					if (['deform', 'sequence'].some((t) => Array.isArray(timelines?.[t]) && timelines[t][0])) {
						yield { bySkin: anim.attachments, skin, bySlot, slot, byName, name };
					}
				}
			}
		}
	}
}
const rename = (obj, from, to) => { obj[to] = obj[from]; delete obj[from]; };
const CONSTRAINT_KINDS = ['ik', 'transform', 'path', 'physics'];
const aKind = (kind) => (kind === 'ik' ? 'an IK' : `a ${kind}`);
/**
 * Every name an animation's constraint keys, draw order and events hold, with a setter — whether
 * the loader looks each one up is left to the loader.
 */
function* animationNamesOf(doc) {
	for (const [anim, map] of Object.entries(doc.animations ?? {})) {
		for (const kind of CONSTRAINT_KINDS) {
			for (const name of Object.keys(map[kind] ?? {})) {
				yield { what: `${kind} key "${name}" in "${anim}"`, set: (to) => rename(map[kind], name, to) };
			}
		}
		for (const [i, frame] of (map.drawOrder ?? []).entries()) {
			for (const o of frame?.offsets ?? []) yield { what: `draw order #${i} in "${anim}"`, set: (to) => { o.slot = to; } };
		}
		for (const e of map.events ?? []) yield { what: `event "${e.name}" in "${anim}"`, set: (to) => { e.name = to; } };
	}
}

console.log('\n1. irigDocProblem agrees with the official loader');
{
	ok('the good fixture loads', loads(good()) === null, loads(good()));
	ok('…and passes the check', M.irigDocProblem(good()) === null, M.irigDocProblem(good()));
	const breaks = {
		'slot on a missing bone': (d) => { d.slots[0].bone = 'nope'; },
		'ik bone missing': (d) => { d.ik[0].bones = ['nope']; },
		'ik target missing': (d) => { d.ik[0].target = 'nope'; },
		'skin names a missing slot': (d) => { d.skins[0].attachments.ghost = {}; },
		'animation keys a missing bone': (d) => { d.animations.idle.bones.ghost = { rotate: [{ value: 1 }] }; },
		'animation keys a missing slot': (d) => { d.animations.idle.slots.ghost = { rgba: [{ color: 'ffffffff' }] }; },
		'ik has no bones list': (d) => { delete d.ik[0].bones; },
		'ik bones are null': (d) => { d.ik[0].bones = null; },
		'an animation that is null': (d) => { d.animations.blank = null; },
	};
	for (const [label, mutate] of Object.entries(breaks)) {
		const d = good();
		mutate(d);
		const loaderErr = loads(d);
		const ours = M.irigDocProblem(d);
		ok(`${label}: the loader throws AND the check refuses`, loaderErr !== null && ours !== null, `loader=${loaderErr} check=${ours}`);
	}
	// A linked mesh's parent and an animation's deform / sequence keys, resolved by NAME, and what
	// the loader then reads off the attachment it found. Each case pins why both refuse: the
	// loader's own message (for a TypeError, the property it could not read), and what the check
	// names.
	const named = {
		'a linked mesh names a skin that does not exist': [(d) => { d.skins[1].attachments.cape.redflap.skin = 'ghost'; }, /Skin not found: ghost/, /"redflap".*skin "ghost" for its parent/],
		'a linked mesh with no skin, and no default skin': [(d) => { d.skins[0].name = 'base'; rename(d.animations.idle.attachments, 'default', 'base'); }, /Skin not found: null/, /"flap".*names no skin/],
		'a linked mesh with no skin, whose parent only its own skin has': [(d) => { delete d.skins[1].attachments.cape.redflap.skin; }, /Parent mesh not found: redcape/, /"redflap".*"redcape", which skin "default" does not have/],
		'a linked mesh whose parent is on another slot': [(d) => { d.skins[0].attachments.head.face = mesh(); d.skins[0].attachments.cape.flap.parent = 'face'; }, /Parent mesh not found: face/, /"flap".*"face", which skin "default" does not have/],
		'a "mesh" with a parent is linked too, so its parent must exist': [(d) => { Object.assign(d.skins[0].attachments.cape.flap, { type: 'mesh', parent: 'ghost' }); }, /Parent mesh not found: ghost/, /"flap".*"ghost", which skin "default" does not have/],
		'a linked mesh whose parent is not a mesh': [(d) => { d.skins[0].attachments.cape.plate = { path: 'head', width: 32, height: 32 }; d.skins[0].attachments.cape.flap.parent = 'plate'; }, /Linked mesh parent is not a mesh: plate/, /"plate", which is a region, not a mesh/],
		'no skin means the LAST skin named "default"': [(d) => { d.skins.push({ name: 'default', attachments: { head: { head: { width: 32, height: 32 } } } }); }, /Parent mesh not found: cape/, /"flap".*"cape", which skin "default" does not have/],
		'a named skin is the FIRST with that name': [(d) => { d.skins.push({ name: 'red', attachments: { cape: { other: mesh() } } }); d.skins[1].attachments.cape.redflap.parent = 'other'; }, /Parent mesh not found: other/, /"redflap".*"other", which skin "red" does not have/],
		'a skin named ""': [(d) => { d.skins.push({ name: '' }); }, /name cannot be null/, /skin #2 has no name/],
		'an animation keys attachments in a skin that does not exist': [(d) => { d.animations.idle.attachments.ghost = {}; }, /Skin not found: ghost/, /keys attachments in skin "ghost"/],
		'an animation keys attachments on a slot that does not exist': [(d) => { d.animations.idle.attachments.default.ghost = {}; }, /Slot not found: ghost/, /keys attachments on slot "ghost"/],
		"an animation deforms an attachment its skin lacks (default's, keyed under red)": [(d) => { d.animations.idle.attachments.red.cape.cape = { deform: [{}] }; }, /Deform attachment not found: cape/, /attachment "cape" on slot "cape", which skin "red" does not have/],
		'an animation keys a sequence on an attachment its skin lacks': [(d) => { d.animations.idle.attachments.default.cape.ghost = { sequence: [{}] }; }, /Sequence attachment not found: ghost/, /attachment "ghost" on slot "cape", which skin "default" does not have/],
		'an animation deforms a region, which has no vertices': [(d) => { d.animations.idle.attachments.default.head = { head: { deform: [{}] } }; }, /Deform keys on an attachment with no vertices: head/, /attachment "head" on slot "head" with deform keys, but it is a region/],
		'an animation keys a sequence on a mesh that declares none': [(d) => { d.animations.idle.attachments.default.cape.cape = { sequence: [{}] }; }, /Sequence keys on an attachment with no sequence: cape/, /attachment "cape" on slot "cape" with sequence keys, but it has no sequence/],
		'an attachment typed null is one the loader skips, so its sequence keys find nothing': [(d) => { d.skins[0].attachments.cape.nul = { type: null, path: 'seq', sequence: { count: 1 }, width: 32, height: 32 }; d.animations.idle.attachments.default.cape.nul = { sequence: [{}] }; }, /Sequence attachment not found: nul/, /attachment "nul" on slot "cape" with sequence keys, but it has no sequence/],
		'an animation keys a sequence on a bounding box (only a region or mesh reads one)': [(d) => { d.skins[0].attachments.cape.box = { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 32, 0, 32, 32], sequence: { count: 1 } }; d.animations.idle.attachments.default.cape.box = { sequence: [{}] }; }, /Sequence keys on an attachment with no sequence: box/, /attachment "box" on slot "cape" with sequence keys, but it has no sequence/],
		// A skin's bone and constraint lists, and an animation's constraint keys, draw order and events.
		'a skin lists a bone that does not exist': [(d) => { d.skins[1].bones.push('ghost'); }, /Couldn't find bone ghost for skin red/, /skin "red" lists bone "ghost"/],
		'a skin lists an IK constraint that does not exist': [(d) => { d.skins[1].ik = ['ghost']; }, /Couldn't find IK constraint ghost for skin red/, /skin "red" lists ik constraint "ghost"/],
		'a skin lists a transform constraint that does not exist': [(d) => { d.skins[1].transform = ['ghost']; }, /Couldn't find transform constraint ghost for skin red/, /skin "red" lists transform constraint "ghost"/],
		'a skin lists a path constraint that does not exist': [(d) => { d.skins[1].path = ['ghost']; }, /Couldn't find path constraint ghost for skin red/, /skin "red" lists path constraint "ghost"/],
		'a skin lists a physics constraint that does not exist': [(d) => { d.skins[1].physics = ['ghost']; }, /Couldn't find physics constraint ghost for skin red/, /skin "red" lists physics constraint "ghost"/],
		'a skin lists a transform constraint as an IK one (names are per kind)': [(d) => { d.skins[1].ik = ['follow']; }, /Couldn't find IK constraint follow/, /skin "red" lists ik constraint "follow"/],
		'a skin lists a bone as null': [(d) => { d.skins[1].bones = [null]; }, /boneName cannot be null/, /skin "red" lists bone "null"/],
		'a skin lists a constraint named "", even though one is': [(d) => { d.ik.push({ name: '', bones: ['arm'], target: 'root' }); d.skins[1].ik = ['']; }, /constraintName cannot be null/, /skin "red" lists ik constraint ""/],
		'a renamed constraint strands the skin that lists it': [(d) => { d.transform[0].name = 'moved'; }, /Couldn't find transform constraint follow for skin red/, /skin "red" lists transform constraint "follow"/],
		'an animation keys an IK constraint that does not exist': [(d) => { d.animations.idle.ik.ghost = [{}]; }, /IK Constraint not found: ghost/, /animation "idle" keys ik constraint "ghost"/],
		'an animation keys a transform constraint that does not exist': [(d) => { d.animations.idle.transform.ghost = [{}]; }, /Transform constraint not found: ghost/, /animation "idle" keys transform constraint "ghost"/],
		'an animation keys a path constraint that does not exist, even with no keys': [(d) => { d.animations.idle.path.ghost = {}; }, /Path constraint not found: ghost/, /animation "idle" keys path constraint "ghost"/],
		'an animation keys a physics constraint that does not exist, even with no keys': [(d) => { d.animations.idle.physics.ghost = {}; }, /Physics constraint not found: ghost/, /animation "idle" keys physics constraint "ghost"/],
		'an animation keys an IK constraint named "" (only a physics "" means all)': [(d) => { d.ik.push({ name: '', bones: ['arm'], target: 'root' }); d.animations.idle.ik[''] = [{}]; }, /constraintName cannot be null/, /animation "idle" keys ik constraint ""/],
		'a renamed constraint strands the animation that keys it': [(d) => { d.path[0].name = 'moved'; d.skins[1].path = ['moved']; }, /Path constraint not found: rail/, /animation "idle" keys path constraint "rail"/],
		'a draw-order key names a slot that does not exist': [(d) => { d.animations.idle.drawOrder[0].offsets[0].slot = 'ghost'; }, /Slot not found: ghost/, /animation "idle" keys draw order for slot "ghost"/],
		'a later draw-order key names a slot that does not exist': [(d) => { d.animations.idle.drawOrder.push({ time: 1, offsets: [{ slot: 'ghost', offset: 0 }] }); }, /Slot not found: ghost/, /animation "idle" keys draw order for slot "ghost"/],
		'a draw-order offset names no slot': [(d) => { delete d.animations.idle.drawOrder[0].offsets[0].slot; }, /slotName cannot be null/, /animation "idle" keys draw order for slot "undefined"/],
		'an event key names an event that is not defined': [(d) => { d.animations.idle.events[0].name = 'ghost'; }, /Event not found: ghost/, /animation "idle" keys event "ghost"/],
		'the event an animation keys is no longer defined': [(d) => { delete d.events; }, /Event not found: hit/, /animation "idle" keys event "hit"/],
		'an event key names no event': [(d) => { delete d.animations.idle.events[0].name; }, /eventDataName cannot be null/, /animation "idle" keys event "undefined"/],
	};
	for (const [label, [mutate, loaderSays, checkSays]] of Object.entries(named)) {
		const d = good();
		mutate(d);
		const loaderErr = loads(d);
		const ours = M.irigDocProblem(d);
		ok(`${label}: the loader throws AND the check names it`, loaderSays.test(loaderErr ?? '') && checkSays.test(ours ?? ''), `loader=${loaderErr} check=${ours}`);
	}
	// What the loader accepts, the check must too — each a near miss of a case above.
	const fine = {
		'a linked mesh with an empty skin reads default': (d) => { d.skins[1].attachments.cape.plainflap.skin = ''; },
		'a "mesh" with a parent is a linked mesh too': (d) => { d.skins[0].attachments.cape.flap.type = 'mesh'; },
		"a linked mesh's parent may be a linked mesh": (d) => { d.skins[0].attachments.cape.flap2 = linked('flap'); },
		'deform keys with no first key, on an attachment the skin lacks': (d) => { d.animations.idle.attachments.default.cape.ghost = { deform: [] }; },
		'a timeline the loader does not read, on an attachment the skin lacks': (d) => { d.animations.idle.attachments.default.cape.ghost = { future: [{}] }; },
		'deform keys on a bounding box, which has vertices': (d) => { d.skins[0].attachments.cape.box = { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 32, 0, 32, 32] }; d.animations.idle.attachments.default.cape.box = { deform: [{}] }; },
		'sequence keys on a region that declares a sequence': (d) => { d.skins[0].attachments.head.flip = { path: 'seq', sequence: { count: 1 }, width: 32, height: 32 }; d.animations.idle.attachments.default.head = { flip: { sequence: [{}] } }; },
		'sequence keys on a mesh that declares a sequence': (d) => { d.skins[0].attachments.cape.seqcape = { ...mesh(), path: 'seq', sequence: { count: 1 } }; d.animations.idle.attachments.default.cape.seqcape = { sequence: [{}] }; },
		'IK and transform keys with no first key, on constraints that do not exist': (d) => { d.animations.idle.ik.ghost = []; d.animations.idle.transform.ghost = []; },
		'a physics key "" keys every physics constraint, even with none defined': (d) => { delete d.physics; delete d.skins[1].physics; delete d.animations.idle.physics.wobble; },
		"a skin's lists may be null or empty": (d) => { Object.assign(d.skins[1], { bones: null, ik: [], transform: null, path: [], physics: null }); },
		'a skin lists a bone by a number, which the loader matches with ==': (d) => { d.bones.push({ name: '7', parent: 'root' }); d.skins[1].bones = [7]; },
		'two constraints may share a name': (d) => { d.transform.push(clone(d.transform[0])); },
		'a draw-order key with null offsets resets the order': (d) => { d.animations.idle.drawOrder.push({ time: 1, offsets: null }); },
		'events defined as a list are named by index': (d) => { d.events = [{}]; d.animations.idle.events = [{ name: '0' }]; },
	};
	for (const [label, mutate] of Object.entries(fine)) {
		const d = good();
		mutate(d);
		ok(`${label}: the loader accepts it AND so does the check`, loads(d) === null && M.irigDocProblem(d) === null, `loader=${loads(d)} check=${M.irigDocProblem(d)}`);
	}
	// Where the loader reads a falsy field as absent, so must the check. Top-level lists are set on
	// a bare skeleton, so nothing else in it names what they would have held.
	const bare = () => ({ skeleton: { spine: '4.2.40' }, bones: [{ name: 'root' }] });
	const falsy = {
		'"skeleton"': [bare, (d, v) => { d.skeleton = v; }],
		...Object.fromEntries(['slots', ...CONSTRAINT_KINDS, 'skins', 'animations'].map((f) => [`"${f}"`, [bare, (d, v) => { d[f] = v; }]])),
		"a bone's parent": [good, (d, v) => { d.bones.push({ name: 'loose', parent: v }); }],
		...Object.fromEntries(['ik', 'transform', 'path'].map((kind) => [`${aKind(kind)} constraint's bones`, [good, (d, v) => { d[kind][0].bones = v; }]])),
		"a skin's attachments": [good, (d, v) => { d.skins.push({ name: 'blank', attachments: v }); }],
		'an animation': [good, (d, v) => { d.animations.blank = v; }],
	};
	for (const [field, [base, set]] of Object.entries(falsy)) {
		for (const v of [null, 0, '', false]) {
			// null is dereferenced where the loader walks a constraint's bones or reads an animation.
			if (v === null && (field.endsWith("constraint's bones") || field === 'an animation')) continue;
			const d = base();
			set(d, v);
			ok(`${field} = ${JSON.stringify(v)}: the loader reads it as absent AND so does the check`, loads(d) === null && M.irigDocProblem(d) === null, `loader=${loads(d)} check=${M.irigDocProblem(d)}`);
		}
	}
	// A missing/late parent does not throw in engine-rig — it silently makes the bone a ROOT, i.e.
	// a corrupted hierarchy. The check refuses it; the Rigger itself always topo-sorts.
	const orphan = good();
	orphan.bones[2].parent = 'ghost';
	ok('an undefined parent is refused (engine-rig would silently re-root it)', /ghost/.test(M.irigDocProblem(orphan) ?? ''));
	ok('no bones is refused', M.irigDocProblem({ bones: [] }) !== null);
	ok('a non-object is refused', M.irigDocProblem('x') !== null && M.irigDocProblem(null) !== null);
	const dup = good();
	dup.bones.push({ name: 'arm', parent: 'root' });
	ok('duplicate bone names are refused', /two bones/.test(M.irigDocProblem(dup) ?? ''));
	const extra = good();
	extra.someFutureField = { x: 1 };
	extra.bones[1].newProp = 3;
	ok('unknown fields from a newer Rigger are NOT refused', M.irigDocProblem(extra) === null);
}

console.log('\n2. backup ids + prefix are path-safe and chronological');
{
	const id = M.irigBackupId(new Date('2026-09-28T10:11:12.345Z'), '"0123abcdEF99"');
	ok('id shape', id === 'irig-20260928T101112345Z-0123abcd', id);
	ok('id round-trips to the instant', M.irigBackupSavedAt(id) === '2026-09-28T10:11:12.345Z');
	ok('the restore id regex rejects traversal', !M.IRIG_BACKUP_ID_RE.test('../x') && !M.IRIG_BACKUP_ID_RE.test(id + '/..'));
	const p = M.irigBackupsPrefix('Acme', 'Borut', 'chars/hero', 'hero');
	ok('backups live OUTSIDE spines/ (the skeleton scan would list them as rigs)', p.startsWith('acme/borut/rigger-backups/') && !p.includes('/spines/'), p);
	ok('the dir is one opaque segment', p.split('/').length === 6, p);
	ok('root bundle gets its own segment', M.irigBackupsPrefix('a', 'b', '', 's') === 'a/b/rigger-backups/_root/s/');
}

console.log('\n3. irigTarget path guards');
{
	const t = M.irigTarget('a', 'b', Buffer.from('hero').toString('base64url'), 'hero');
	ok('key under the bundle', t.key === 'a/b/spines/hero/hero.irig', t.key);
	const threw = (fn) => { try { fn(); return false; } catch { return true; } };
	ok('.. in dir refused', threw(() => M.irigTarget('a', 'b', Buffer.from('../x').toString('base64url'), 's')));
	ok('/ in stem refused', threw(() => M.irigTarget('a', 'b', '', 'x/y')));
	ok('missing stem refused', threw(() => M.irigTarget('a', 'b', '', '')));
}

console.log('\n4. writeIrig — conditional write + backup ordering');
{
	const t = M.irigTarget('a', 'b', '', 'hero');
	const body = (n) => JSON.stringify({ ...good(), v: n });

	let r = await M.writeIrig('a', 'b', t, body(1), null);
	ok('create (baseEtag null) succeeds', r.ok && typeof r.etag === 'string');
	ok('a create takes no backup', r.ok && r.backupId === null);
	const e1 = r.etag;

	r = await M.writeIrig('a', 'b', t, body(2), null);
	ok('a second create of the same .irig is a 409, not an overwrite', !r.ok && r.response.status === 409);
	ok('…and the stored rig is unchanged', JSON.parse(r2.objects.get(t.key).text).v === 1);

	r2.log.length = 0;
	r = await M.writeIrig('a', 'b', t, body(2), e1);
	ok('an update on the current etag succeeds', r.ok);
	ok('the previous bytes were copied aside BEFORE the put', r2.log[0] === 'copy ' + t.key && r2.log[1] === 'put ' + t.key, r2.log.join(' | '));
	const e2 = r.etag;

	r = await M.writeIrig('a', 'b', t, body(3), e1);
	const conflictBody = r.ok ? null : await r.response.json();
	ok('a stale etag is a 409 conflict', !r.ok && r.response.status === 409 && conflictBody.error === 'conflict');
	ok('…carrying the CURRENT etag, so "overwrite" can retry conditionally', conflictBody?.etag === e2);
	ok('…and nothing was overwritten', JSON.parse(r2.objects.get(t.key).text).v === 2);
	const before = (await M.listIrigBackups(t.backupsPrefix)).length;
	for (let i = 0; i < 5; i++) await M.writeIrig('a', 'b', t, body(3), e1);
	await M.writeIrig('a', 'b', t, body(3), null);
	ok('refused writes add NO backups (they would push real history out of retention)', (await M.listIrigBackups(t.backupsPrefix)).length === before);

	r = await M.writeIrig('a', 'b', t, body(3), conflictBody.etag);
	ok('the conditional retry on the returned etag succeeds', r.ok && JSON.parse(r2.objects.get(t.key).text).v === 3);

	r = await M.writeIrig('a', 'b', t, body(4), undefined);
	ok('force (undefined) overwrites', r.ok && JSON.parse(r2.objects.get(t.key).text).v === 4);

	const backups = await M.listIrigBackups(t.backupsPrefix);
	const versions = await Promise.all(backups.map(async (b) => JSON.parse(await M.readIrigBackup(t.backupsPrefix, b.id)).v));
	ok('history holds every overwritten version, once each', versions.join(',') === '3,2,1', versions.join(','));
	ok('readIrigBackup refuses a malformed id', (await M.readIrigBackup(t.backupsPrefix, '../../x')) === null);

	for (let i = 0; i < M.IRIG_BACKUP_KEEP + 5; i++) {
		const cur = r2.objects.get(t.key).etag;
		await new Promise((res) => setTimeout(res, 2)); // distinct ms stamps
		await M.writeIrig('a', 'b', t, body(10 + i), cur);
	}
	const kept = await M.listIrigBackups(t.backupsPrefix);
	ok(`retention keeps the newest ${M.IRIG_BACKUP_KEEP}`, kept.length === M.IRIG_BACKUP_KEEP, String(kept.length));
	ok('newest first', kept[0].id > kept[kept.length - 1].id);

	globalThis.__atlasMissing = [''];
	const cur = r2.objects.get(t.key).etag;
	r = await M.writeIrig('a', 'b', t, body(99), cur);
	const amBody = r.ok ? null : await r.response.json();
	ok('atlas-missing reports the write DID land, with its new etag', !r.ok && amBody.saved === true && amBody.etag === r2.objects.get(t.key).etag);
	globalThis.__atlasMissing = [];
}

console.log('\n5. scope mismatch + create claim');
{
	const mm = M.scopeMismatch('x', 'b');
	ok('the scope-mismatch answer is a 409 naming both projects', mm.status === 409 && /"x".*"b"/.test((await mm.json()).message));
	ok('claimNewIrig creates when absent', await M.claimNewIrig('a/b/spines/n/n.irig', '{}'));
	ok('claimNewIrig refuses when present', !(await M.claimNewIrig('a/b/spines/n/n.irig', '{}')));
}

const rigs = checkedInRigs();

console.log('\n6. no false refusals on the real skeletons checked into the repo');
{
	const unloadable = rigs.flatMap(({ file, doc }) => { const e = loads(doc, anyArt); return e ? [`${file}: ${e}`] : []; });
	const refused = rigs.flatMap(({ file, doc }) => { const p = M.irigDocProblem(doc); return p ? [`${file}: ${p}`] : []; });
	ok(`every checked-in skeleton loads (${rigs.length} checked)`, rigs.length > 0 && unloadable.length === 0, unloadable.slice(0, 3).join(' | '));
	ok('…and passes the check', refused.length === 0, refused.slice(0, 3).join(' | '));
	const linkedCount = rigs.reduce((n, { doc }) => n + [...linkedMeshesOf(doc)].length, 0);
	const keyCount = rigs.reduce((n, { doc }) => n + [...attachmentKeysOf(doc)].length, 0);
	ok(`…${linkedCount} linked meshes and ${keyCount} deform / sequence keys among them`, linkedCount > 0 && keyCount > 0);
	const s = rigs.find((r) => r.file === 'lines/static/assets/spines/symbols2/S.json');
	const noSkin = s ? [...linkedMeshesOf(s.doc)].filter((a) => !a.skin).length : 0;
	ok(`symbols2/S passes — ${noSkin} linked meshes, each naming no skin, so each read from "default"`, noSkin > 0 && M.irigDocProblem(s.doc) === null, s ? M.irigDocProblem(s.doc) : 'S.json not found');
}

console.log('\n7. breaking a linked mesh or an animation attachment key in a checked-in rig: the loader throws AND the check names it');
{
	const breaks = {
		'a linked mesh names a parent that does not exist': ['ghost-parent', (d) => {
			const a = linkedMeshesOf(d).next().value;
			if (a) a.parent = 'ghost-parent';
			return a;
		}],
		'a linked mesh names a skin that does not exist': ['ghost-skin', (d) => {
			const a = linkedMeshesOf(d).next().value;
			if (a) a.skin = 'ghost-skin';
			return a;
		}],
		'the default skin is renamed under a linked mesh that names no skin': ['names no skin', (d) => {
			const a = linkedMeshesOf(d).next().value;
			const def = d.skins?.find((s) => s.name === 'default');
			if (!a || a.skin || !def) return null;
			def.name = 'renamed';
			return a;
		}],
		'an animation keys attachments in a skin that does not exist': ['ghost-skin', (d) => {
			const k = attachmentKeysOf(d).next().value;
			if (k) rename(k.bySkin, k.skin, 'ghost-skin');
			return k;
		}],
		'an animation keys attachments on a slot that does not exist': ['ghost-slot', (d) => {
			const k = attachmentKeysOf(d).next().value;
			if (k) rename(k.bySlot, k.slot, 'ghost-slot');
			return k;
		}],
		'an animation deforms / sequences an attachment its skin lacks': ['ghost-attachment', (d) => {
			const k = attachmentKeysOf(d).next().value;
			if (k) rename(k.byName, k.name, 'ghost-attachment');
			return k;
		}],
		"a sequence key's attachment stops declaring its sequence": ['has no sequence', (d) => {
			const k = [...attachmentKeysOf(d)].find((key) => key.byName[key.name].sequence?.[0]);
			const target = k && d.skins.find((s) => s.name === k.skin).attachments[k.slot][k.name];
			if (!target?.sequence) return null;
			delete target.sequence;
			return k;
		}],
	};
	for (const [label, [named, mutate]] of Object.entries(breaks)) {
		let applied = 0;
		const wrong = [];
		for (const { file, doc } of rigs) {
			const d = clone(doc);
			if (!mutate(d)) continue;
			applied++;
			const loaderErr = loads(d, anyArt);
			const ours = M.irigDocProblem(d);
			if (loaderErr === null || !ours?.includes(named)) wrong.push(`${file}: loader=${loaderErr} check=${ours}`);
		}
		ok(`${label}: on all ${applied} rigs it applies to`, applied > 0 && wrong.length === 0, wrong.slice(0, 3).join(' | '));
	}
}

console.log("\n7b. a skin's bone / constraint lists and an animation's constraint keys, draw order and events, in the checked-in rigs: the loader throws ⇔ the check refuses");
{
	// One name at a time, renamed to one nothing defines. The loader decides whether it looks the
	// name up; the check must refuse exactly when it throws, naming it.
	const tally = new Map();
	const wrong = [];
	for (const { file, doc } of rigs) {
		const count = [...animationNamesOf(doc)].length;
		for (let i = 0; i < count; i++) {
			const d = clone(doc);
			const site = [...animationNamesOf(d)][i];
			site.set('ghost-ref');
			const loaderErr = loads(d, anyArt);
			const ours = M.irigDocProblem(d);
			const kind = site.what.split(' ')[0] === 'draw' ? 'draw order' : site.what.split(' ')[0];
			const t = tally.get(kind) ?? { thrown: 0, loaded: 0 };
			t[loaderErr === null ? 'loaded' : 'thrown']++;
			tally.set(kind, t);
			const agree = loaderErr === null ? ours === null : Boolean(ours?.includes('"ghost-ref"'));
			if (!agree) wrong.push(`${file} ${site.what}: loader=${loaderErr} check=${ours}`);
		}
	}
	const summary = [...tally].map(([k, t]) => `${k} ${t.thrown} thrown / ${t.loaded} loaded`).join(', ');
	ok(`every animation name, renamed: ${summary}`, tally.size >= 3 && wrong.length === 0, wrong.slice(0, 3).join(' | '));

	const firstAnimation = (d) => Object.values(d.animations ?? {})[0];
	const namesOf = (d, kind) => (kind === 'bones' ? d.bones : (d[kind] ?? [])).map((c) => c.name);
	/** A timeline the loader reads for each kind: a first key present. */
	const keyed = { ik: () => [{}], transform: () => [{}], path: () => ({ mix: [{}] }), physics: () => ({ inertia: [{}] }) };
	// label → [name the check must give, mutate]; mutate returns falsy when it does not apply, or a
	// string to name instead.
	const breaks = {
		...Object.fromEntries(['bones', ...CONSTRAINT_KINDS].map((list) => [`a skin lists ${list === 'bones' ? 'a bone' : `${aKind(list)} constraint`} that does not exist`, ['ghost-ref', (d) => {
			const skin = d.skins?.[0];
			if (skin) skin[list] = [...namesOf(d, list), 'ghost-ref'];
			return skin;
		}]])),
		...Object.fromEntries(CONSTRAINT_KINDS.map((kind) => [`an animation keys ${aKind(kind)} constraint that does not exist`, ['ghost-ref', (d) => {
			const map = firstAnimation(d);
			if (map) map[kind] = { ...map[kind], 'ghost-ref': keyed[kind]() };
			return map;
		}]])),
		'an event an animation keys is no longer defined': [null, (d) => {
			const name = Object.values(d.animations ?? {}).flatMap((a) => a.events ?? []).find((e) => e.name)?.name;
			if (name) delete d.events[name];
			return name;
		}],
		// Only the kinds some checked-in rig keys (none keys an IK or physics constraint yet).
		...Object.fromEntries(CONSTRAINT_KINDS.filter((kind) => rigs.some(({ doc }) => Object.values(doc.animations ?? {}).some((a) => a[kind]))).map((kind) => [`${aKind(kind)} constraint an animation keys is renamed`, [null, (d) => {
			const name = Object.values(d.animations ?? {}).flatMap((a) => Object.keys(a[kind] ?? {})).find((n) => n);
			if (!name || !namesOf(d, kind).includes(name)) return null;
			for (const c of d[kind]) if (c.name === name) c.name = 'moved';
			for (const skin of d.skins ?? []) if (skin[kind]) skin[kind] = skin[kind].map((n) => (n === name ? 'moved' : n));
			for (const map of Object.values(d.animations)) if (map[kind]?.[name]) map[kind][name] = keyed[kind]();
			return name;
		}]])),
	};
	for (const [label, [named, mutate]] of Object.entries(breaks)) {
		let applied = 0;
		const failed = [];
		for (const { file, doc } of rigs) {
			const d = clone(doc);
			const got = mutate(d);
			if (!got) continue;
			applied++;
			const loaderErr = loads(d, anyArt);
			const ours = M.irigDocProblem(d);
			if (loaderErr === null || !ours?.includes(`"${named ?? got}"`)) failed.push(`${file}: loader=${loaderErr} check=${ours}`);
		}
		ok(`${label}: the loader throws AND the check names it, on all ${applied} rigs it applies to`, applied > 0 && failed.length === 0, failed.slice(0, 3).join(' | '));
	}
	const fine = {
		'a skin lists every bone and constraint the rig defines': (d) => {
			const skin = d.skins?.[0];
			if (skin) for (const list of ['bones', ...CONSTRAINT_KINDS]) skin[list] = namesOf(d, list);
			return skin;
		},
		'an animation keys every constraint the rig defines': (d) => {
			const map = firstAnimation(d);
			if (map) for (const kind of CONSTRAINT_KINDS) for (const name of namesOf(d, kind)) map[kind] = { ...map[kind], [name]: keyed[kind]() };
			return map;
		},
		'IK / transform keys with no first key, and a physics "" key, name nothing the loader looks up': (d) => {
			const map = firstAnimation(d);
			if (map) Object.assign(map, { ik: { 'ghost-ref': [] }, transform: { ...map.transform, 'ghost-ref': [] }, physics: { '': keyed.physics() } });
			return map;
		},
	};
	for (const [label, mutate] of Object.entries(fine)) {
		let applied = 0;
		const failed = [];
		for (const { file, doc } of rigs) {
			const d = clone(doc);
			if (!mutate(d)) continue;
			applied++;
			const loaderErr = loads(d, anyArt);
			const ours = M.irigDocProblem(d);
			if (loaderErr !== null || ours !== null) failed.push(`${file}: loader=${loaderErr} check=${ours}`);
		}
		ok(`${label}: the loader accepts it AND so does the check, on all ${applied} rigs it applies to`, applied > 0 && failed.length === 0, failed.slice(0, 3).join(' | '));
	}
}

console.log('\n8. ＋ New rig → Apply saved rig: resolveRigSkeletonBody refuses a library rig that would not load');
{
	const store = (id, skeleton) => r2.objects.set(M.sharedRigKey(id), { text: JSON.stringify({ schemaVersion: 1, id, name: id, skeleton }), etag: '"lib"' });
	store('fine', good());
	const broken = good();
	broken.skins[0].attachments.cape.flap.parent = 'ghost';
	store('broken', broken);
	const applied = await M.resolveRigSkeletonBody('fine');
	ok('a library rig that loads is applied', M.irigDocProblem(applied) === null && applied.skeleton.spine === '4.2');
	let thrown = null;
	try { await M.resolveRigSkeletonBody('broken'); } catch (e) { thrown = e; }
	ok('one that would not load is a 422 naming why', thrown?.status === 422 && /would not load .*"ghost"/.test(thrown?.body?.message ?? ''), thrown ? `${thrown.status} ${thrown.body?.message}` : 'did not throw');
	ok('no rig applied is the blank skeleton, which passes', M.irigDocProblem(await M.resolveRigSkeletonBody('')) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
