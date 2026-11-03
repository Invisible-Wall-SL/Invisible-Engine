/**
 * Offline gate for irig v1 (docs/design/irig-format.md, Phase 0). Run:
 * pnpm exec tsx packages/engine-rig/src/irig/irig.fixture.ts
 *
 * For EVERY skeleton in the repo (de-duplicated by content):
 *  1. importing it loses nothing but keys the 4.2 reader ignores (IGNORED below, each with its why);
 *  2. write → read gives back the same document;
 *  3. the internal 4.2 writer gives back the original file, key order included, minus those keys;
 *  4. the runtime's own reader turns the original and the round-tripped file into identical
 *     `SkeletonData` — the proof the dropped keys meant nothing.
 * Then a rig carrying every extension, and the refusals the reader and importer owe.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BoundingBoxAttachment,
	ClippingAttachment,
	MeshAttachment,
	PathAttachment,
	PointAttachment,
	RegionAttachment,
} from '../attachments.ts';
import type { AttachmentLoader } from '../atlas.ts';
import { SkeletonJson } from '../skeletonJson.ts';
import {
	exportSpine42Json,
	importSpine42Json,
	readIrig,
	writeIrig,
	type IrigIssue,
} from './irig.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SKIP = [
	'node_modules',
	'.git',
	'.turbo',
	'.svelte-kit',
	'.cache',
	'build',
	'dist',
	'.claude',
];

/** Keys an import may drop, because the 4.2 reader never reads them. */
const IGNORED: Array<{ path: RegExp; why: string }> = [
	{
		path: /^bones\[\d+\]\.transform$/,
		why: "a 4.1 export's name for `inherit`; the 4.2 reader reads only `inherit`",
	},
];

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string): void {
	checks++;
	if (!ok) {
		failures++;
		console.error(`  ✗ ${what}`);
	}
}

const stubLoader: AttachmentLoader = {
	newRegionAttachment: (_skin, name, path) => new RegionAttachment(name, path),
	newMeshAttachment: (_skin, name, path) => new MeshAttachment(name, path),
	newBoundingBoxAttachment: (_skin, name) => new BoundingBoxAttachment(name),
	newPathAttachment: (_skin, name) => new PathAttachment(name),
	newPointAttachment: (_skin, name) => new PointAttachment(name),
	newClippingAttachment: (_skin, name) => new ClippingAttachment(name),
};

/** Everything the runtime built, in build order; a repeated object prints as a back-reference. A
 * vertex attachment's `id` is a process-wide counter, so it differs between any two reads: it is
 * left out, and where a timeline's property id embeds it (`28|slot|id`), it is renumbered in order
 * of first appearance. */
function snapshot(json: object): string {
	const data = new SkeletonJson(stubLoader).readSkeletonData(structuredClone(json));
	const seen = new Map<object, number>();
	const ids = new Map<string, number>();
	return JSON.stringify(data, (key, value: unknown) => {
		if (key === 'id' && typeof value === 'number') return undefined;
		if (key === 'propertyIds' && Array.isArray(value))
			return value.map((p: string) => {
				const [kind, slot, id] = p.split('|');
				if (id === undefined) return p;
				if (!ids.has(id)) ids.set(id, ids.size);
				return `${kind}|${slot}|@${ids.get(id)}`;
			});
		if (!value || typeof value !== 'object') return value;
		if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
		const id = seen.get(value);
		if (id !== undefined) return `#${id}`;
		seen.set(value, seen.size);
		if (value instanceof Map) return [...value.entries()];
		return value;
	});
}

/** Paths where `a` and `b` differ, key order included. */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
		else a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out));
		return out;
	}
	const isObj = (v: unknown): v is Record<string, unknown> =>
		!!v && typeof v === 'object' && !Array.isArray(v);
	if (isObj(a) && isObj(b)) {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		for (const k of ka) if (!(k in b)) out.push(path ? `${path}.${k}` : k);
		for (const k of kb) if (!(k in a)) out.push(`${path ? `${path}.${k}` : k} (added)`);
		const shared = ka.filter((k) => k in b);
		if (shared.join('\0') !== kb.filter((k) => k in a).join('\0')) out.push(`${path}: key order`);
		for (const k of shared) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
		return out;
	}
	if (!Object.is(a, b)) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
	return out;
}

function findSkeletons(): Array<{ rel: string; json: Record<string, unknown> }> {
	const found: Array<{ rel: string; json: Record<string, unknown> }> = [];
	const seen = new Set<string>();
	(function walk(dir: string): void {
		for (const name of readdirSync(dir)) {
			if (SKIP.includes(name)) continue;
			const p = join(dir, name);
			const s = statSync(p);
			if (s.isDirectory()) {
				walk(p);
				continue;
			}
			if (!/\.(json|irig)$/.test(name) || s.size < 200 || s.size > 20e6) continue;
			const text = readFileSync(p, 'utf8');
			let json: unknown;
			try {
				json = JSON.parse(text);
			} catch {
				continue;
			}
			const rec = json as Record<string, unknown>;
			if (!rec?.skeleton || !rec.bones) continue;
			const hash = createHash('sha1').update(text).digest('hex');
			if (seen.has(hash)) continue;
			seen.add(hash);
			found.push({ rel: relative(ROOT, p).replace(/\\/g, '/'), json: rec });
		}
	})(ROOT);
	return found;
}

const ignored = (i: IrigIssue): boolean =>
	i.reason === 'not an irig field' && IGNORED.some((g) => g.path.test(i.path));

// ── Every repo rig ────────────────────────────────────────────────────────────────────────────────
const rigs = findSkeletons();
// 155 skeleton files on 2026-11-03, 33 distinct: the dev games share copies.
check(rigs.length >= 30, `found only ${rigs.length} distinct repo skeletons — is the walk broken?`);
let droppedKeys = 0;
for (const { rel, json } of rigs) {
	const before = failures;
	const { doc, issues } = importSpine42Json(json);
	const unexpected = issues.filter((i) => !ignored(i));
	check(
		unexpected.length === 0,
		`${rel}: import lost ${unexpected
			.slice(0, 3)
			.map((i) => `${i.path} (${i.reason})`)
			.join(', ')}`,
	);
	droppedKeys += issues.length - unexpected.length;

	const reread = readIrig(writeIrig(doc));
	check(
		JSON.stringify(reread) === JSON.stringify(doc),
		`${rel}: write → read changed the document`,
	);

	const back = exportSpine42Json(reread);
	const differences = diff(json, back).filter(
		(d) => !issues.some((i) => d === i.path && ignored(i)),
	);
	check(
		differences.length === 0,
		`${rel}: 4.2 out ≠ 4.2 in: ${differences.slice(0, 3).join(', ')}`,
	);

	let same = false;
	try {
		same = snapshot(json) === snapshot(back);
	} catch (e) {
		console.error(`  ${rel}: the runtime refused it: ${(e as Error).message}`);
	}
	check(same, `${rel}: the runtime reads the round-tripped file differently`);
	if (failures > before) console.error(`  in ${rel}`);
}
console.log(`${rigs.length} repo skeletons round-trip (${droppedKeys} ignored keys dropped)`);

// ── A rig carrying every extension ────────────────────────────────────────────────────────────────
const fx = {
	effectId: 'burst',
	bone: 'root',
	slot: 'body',
	continuous: true,
	alpha: 0.5,
	scale: 2,
	delay: 0.1,
	duration: 1,
	speed: 1.5,
};
const flipbook = {
	clipId: 'sparkle',
	bone: 'root',
	slot: 'body',
	continuous: true,
	loop: false,
	flipX: true,
	flipY: false,
	direction: 'pingpong',
	alpha: 1,
	scale: 0.5,
	delay: 0,
	duration: 2,
	fps: 24,
};
const extended = {
	skeleton: { hash: 'h', spine: '4.2.36', x: -10, y: -10, width: 20, height: 20 },
	bones: [{ name: 'root' }, { name: 'arm', parent: 'root', inherit: 'noScale', length: 5 }],
	slots: [{ name: 'body', bone: 'root', attachment: 'body', blend: 'additive' }],
	skins: [
		{
			name: 'default',
			attachments: {
				body: {
					body: { width: 20, height: 20, pivot: [0.5, 1] },
					tip: { type: 'point', x: 1, y: 2 },
				},
			},
		},
	],
	events: { hit: { int: 1, string: 'x' } },
	animations: {
		idle: {
			bones: {
				arm: {
					rotate: [
						{ value: 10, curve: [0.2, 10, 0.8, 20] },
						{ time: 1, value: 20 },
					],
				},
			},
			events: [{ time: 0.5, name: 'hit', fx, flipbook }],
		},
	},
};
{
	const { doc, issues } = importSpine42Json(extended);
	check(issues.length === 0, `extensions: import reported ${JSON.stringify(issues)}`);
	const reread = readIrig(writeIrig(doc));
	const region = reread.skins?.[0].attachments?.body.body;
	check(
		JSON.stringify(region && 'pivot' in region ? region.pivot : null) === '[0.5,1]',
		'extensions: the pivot did not survive',
	);
	const event = reread.animations?.idle.events?.[0];
	check(JSON.stringify(event?.fx) === JSON.stringify(fx), 'extensions: the FX binding changed');
	check(
		JSON.stringify(event?.flipbook) === JSON.stringify(flipbook),
		'extensions: the Flipbook binding changed',
	);
	check(reread.skeleton?.importedFrom === '4.2.36', 'extensions: the source version was not kept');
	check(diff(extended, exportSpine42Json(reread)).length === 0, 'extensions: 4.2 out ≠ 4.2 in');
}

// ── Object-form skins import as the list form, meaning unchanged ──────────────────────────────────
{
	const objectSkins = { ...extended, skins: { default: extended.skins[0].attachments } };
	const { doc, issues } = importSpine42Json(objectSkins);
	check(
		issues.length === 0 && Array.isArray(doc.skins),
		'object-form skins: not imported as a list',
	);
	check(
		snapshot(objectSkins) === snapshot(exportSpine42Json(doc)),
		'object-form skins: the runtime reads them differently after import',
	);
}

// ── What the importer must report, and what the reader must refuse ───────────────────────────────
const issuesOf = (json: object): IrigIssue[] => importSpine42Json(json).issues;
const throws = (fn: () => unknown, what: string): void => {
	let threw = false;
	try {
		fn();
	} catch {
		threw = true;
	}
	check(threw, what);
};
{
	const wrongType = importSpine42Json({ ...extended, bones: [{ name: 'root', x: '5' }] });
	check(
		wrongType.issues.length === 1 &&
			wrongType.issues[0].path === 'bones[0].x' &&
			JSON.stringify(wrongType.doc.bones) === '[{"name":"root"}]',
		`a string where a number belongs is reported and dropped: ${JSON.stringify(wrongType.issues)}`,
	);
	const badItem = importSpine42Json({ ...extended, slots: [extended.slots[0], 7] });
	check(
		badItem.issues.length === 2 && badItem.doc.slots === undefined,
		`a bad list item drops the whole list, never shifts it: ${JSON.stringify(badItem.issues)}`,
	);
	const badBlend = issuesOf({
		...extended,
		slots: [{ name: 'body', bone: 'root', blend: 'glow' }],
	});
	check(badBlend[0]?.path === 'slots[0].blend', 'an unknown blend mode is reported');
	const badType = issuesOf({
		...extended,
		skins: [{ name: 'default', attachments: { body: { body: { type: 'sprite' } } } }],
	});
	check(
		badType[0]?.path === 'skins[0].attachments.body.body',
		'an unknown attachment type is reported',
	);
	const noTarget = issuesOf({ ...extended, ik: [{ name: 'reach', bones: ['arm'] }] });
	check(noTarget[0]?.reason === 'missing target', 'an IK constraint with no target is reported');
	const badPivot = issuesOf({
		...extended,
		skins: [{ name: 'default', attachments: { body: { body: { pivot: [0.5] } } } }],
	});
	check(
		badPivot[0]?.path === 'skins[0].attachments.body.body.pivot',
		'a one-number pivot is reported',
	);

	const { doc } = importSpine42Json(extended);
	throws(() => readIrig(JSON.stringify({ ...doc, irig: 2 })), 'a newer irig version is refused');
	throws(() => readIrig(JSON.stringify(extended)), 'a 4.2 file is not read as irig');
	throws(() => readIrig(JSON.stringify({ ...doc, extra: 1 })), 'an unknown key is refused');
	throws(
		() => readIrig(JSON.stringify({ ...doc, bones: [{ name: 'root', x: '1' }] })),
		'a wrong-typed value is refused',
	);
	throws(() => importSpine42Json('[]'), 'a list is not a skeleton');
	throws(() => importSpine42Json({ skeleton: {} }), 'a skeleton with no bones is refused');
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
