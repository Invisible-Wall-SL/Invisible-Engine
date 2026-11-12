/**
 * The 3.8 → 4.2 skeleton upgrader (`src/lib/server/spine38Upgrade.ts`) against an independent 3.8
 * evaluator: for every timeline of a 3.8 file, the value 3.8 plays at time t, computed here from the
 * 3.8 rules (one normalised Bézier shared by the key's values, `curve` + `c2`–`c4` or a 4-number
 * array, rotation stepping the short way round) with an exact Bézier solve, so it shares no code
 * with the converter or with either runtime's curve sampler. Compared with what `engine-rig` poses
 * from the upgraded file: bone rotate / translate / scale / shear, slot colour and dark colour,
 * attachment keys, IK / transform / path constraint keys and mesh deform.
 *
 * Runs on a synthetic 3.8 rig covering every converted field. Set `SPINE38_DIR` to a folder of 3.8
 * `.json` exports to run the same comparison over them as well (not in CI: third-party files).
 */
import { readdirSync, readFileSync } from 'node:fs';
import {
	BoundingBoxAttachment,
	ClippingAttachment,
	Color,
	Inherit,
	MeshAttachment,
	MixBlend,
	MixDirection,
	PathAttachment,
	PointAttachment,
	RegionAttachment,
	Skeleton,
	SkeletonJson,
	Skin,
	importSpine42Json,
	type AttachmentLoader,
} from 'engine-rig';
import { isUpgradableSpine3, upgradeSpine38Json } from '../src/lib/server/spine38Upgrade.ts';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const entries = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v) : []);

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

// ── The 3.8 rules ───────────────────────────────────────────────────────────────────────────────

/** The normalised Bézier `[cx1, cy1, cx2, cy2]` at x = p, by bisection on its x. */
function bezier(p: number, c: number[]): number {
	const at = (s: number, a: number, b: number) =>
		3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
	let lo = 0,
		hi = 1;
	for (let i = 0; i < 60; i++) {
		const mid = (lo + hi) / 2;
		if (at(mid, c[0], c[2]) < p) lo = mid;
		else hi = mid;
	}
	return at((lo + hi) / 2, c[1], c[3]);
}

/** 3.8's progress through the key segment holding `t`: the segment and its eased fraction. */
function segment38(keys: Json[], t: number): { f: number; p: number } | null {
	if (!keys.length || t < num(keys[0].time, 0)) return null;
	const last = keys.length - 1;
	if (t >= num(keys[last].time, 0)) return { f: last, p: 0 };
	let f = 0;
	while (t >= num(keys[f + 1].time, 0)) f++;
	const t1 = num(keys[f].time, 0);
	const t2 = num(keys[f + 1].time, 0);
	const linear = (t - t1) / (t2 - t1);
	const c = keys[f].curve;
	if (c === 'stepped') return { f, p: 0 };
	if (typeof c === 'number')
		return {
			f,
			p: bezier(linear, [c, num(keys[f].c2, 0), num(keys[f].c3, 1), num(keys[f].c4, 1)]),
		};
	if (Array.isArray(c)) return { f, p: bezier(linear, c as number[]) };
	return { f, p: linear };
}

const wrap180 = (d: number) => d - 360 * Math.round(d / 360);

/** What 3.8 plays at `t`, and the size of the key step it is part of (0 past the last key). */
interface Ref {
	v: number;
	span: number;
}
function value38(keys: Json[], t: number, of: (k: Json) => number, rotation = false): Ref | null {
	const s = segment38(keys, t);
	if (!s) return null;
	const v1 = of(keys[s.f]);
	if (s.f === keys.length - 1) return { v: v1, span: 0 };
	let d = of(keys[s.f + 1]) - v1;
	if (rotation) d = wrap180(d);
	return { v: v1 + d * s.p, span: Math.abs(d) };
}

/**
 * How far `got` is from what 3.8 plays, as a fraction of the key step. The runtime samples each
 * Bézier on a few segments while the reference solves it, so the honest error scales with the step.
 */
const off = (got: number, ref: Ref, rotation = false): number => {
	const d = Math.abs(rotation ? wrap180(got - ref.v) : got - ref.v);
	// The runtime keeps keys and setup values as 32-bit floats: below that is not an error.
	if (d <= 1e-4 + 1e-6 * Math.abs(ref.v)) return 0;
	return d / Math.max(ref.span, 1e-9);
};

const channels = (hex: unknown): number[] => {
	const c = Color.fromString(typeof hex === 'string' ? hex : 'ffffffff');
	return [c.r, c.g, c.b, c.a];
};

// ── The comparison ──────────────────────────────────────────────────────────────────────────────

const stub: AttachmentLoader = {
	newRegionAttachment: (_s, n, p) => new RegionAttachment(n, p),
	newMeshAttachment: (_s, n, p) => new MeshAttachment(n, p),
	newBoundingBoxAttachment: (_s, n) => new BoundingBoxAttachment(n),
	newPathAttachment: (_s, n) => new PathAttachment(n),
	newPointAttachment: (_s, n) => new PointAttachment(n),
	newClippingAttachment: (_s, n) => new ClippingAttachment(n),
};

/** Per kind, the largest error (a fraction of the key step) between 3.8 and engine-rig posing the
 *  upgraded file. */
function compare(raw: Json): Record<string, number> {
	const data = new SkeletonJson(stub).readSkeletonData(upgradeSpine38Json(raw));
	const sk = new Skeleton(data);
	// Every skin at once, so skin-bound attachments and constraints are live as in some skin.
	const all = new Skin('all');
	for (const skin of data.skins) all.addSkin(skin);
	sk.setSkin(all);
	const worst: Record<string, number> = {};
	const note = (kind: string, d: number) => {
		worst[kind] = Math.max(worst[kind] ?? 0, Number.isNaN(d) ? Infinity : d);
	};

	for (const [name, rawAnim] of entries(raw.animations)) {
		const anim = data.findAnimation(name)!;
		const a = rawAnim as Json;
		const pose = (t: number, before?: () => void) => {
			sk.setToSetupPose();
			before?.();
			anim.apply(sk, t, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
		};
		const times = [...Array(Math.ceil(anim.duration * 97) + 1).keys()].map((i) => i / 97);
		for (const t of times) {
			pose(t);
			for (const [boneName, tl] of entries(a.bones)) {
				const bone = sk.findBone(boneName)!;
				const bd = bone.data;
				for (const [kind, keysRaw] of entries(tl)) {
					const keys = list(keysRaw);
					if (kind === 'rotate') {
						const r = value38(keys, t, (k) => num(k.angle, 0), true);
						if (r) note('rotate', off(bone.rotation - bd.rotation, r, true));
					} else if (kind === 'translate' || kind === 'shear' || kind === 'scale') {
						const d = kind === 'scale' ? 1 : 0;
						const x = value38(keys, t, (k) => num(k.x, d));
						const y = value38(keys, t, (k) => num(k.y, d));
						if (!x || !y) continue;
						const [ax, ay] =
							kind === 'translate'
								? [bone.x - bd.x, bone.y - bd.y]
								: kind === 'shear'
									? [bone.shearX - bd.shearX, bone.shearY - bd.shearY]
									: [bone.scaleX / bd.scaleX, bone.scaleY / bd.scaleY];
						note(kind, Math.max(off(ax, x), off(ay, y)));
					}
				}
			}
			for (const [slotName, tl] of entries(a.slots)) {
				const slot = sk.findSlot(slotName)!;
				const t2 = tl as Json;
				const light = [slot.color.r, slot.color.g, slot.color.b, slot.color.a];
				const color = list(t2.color);
				for (let i = 0; i < 4 && color.length; i++) {
					const r = value38(color, t, (k) => channels(k.color)[i]);
					if (r) note('colour', off(light[i], r));
				}
				const two = list(t2.twoColor);
				const dark = slot.darkColor;
				for (let i = 0; i < 7 && two.length && dark; i++) {
					const r = value38(two, t, (k) => [...channels(k.light), ...channels(k.dark)][i]);
					if (r) note('two colour', off([...light, dark.r, dark.g, dark.b][i], r));
				}
				const att = list(t2.attachment);
				const s = segment38(att, t);
				if (s) {
					// A 3.x attachment may carry a `name` other than its skin key: compare what the key resolves to.
					const key = (att[s.f].name as string | null | undefined) ?? null;
					const want = key === null ? null : sk.getAttachmentByName(slotName, key);
					note('attachment', slot.attachment === want ? 0 : Infinity);
				}
			}
			for (const [cName, keysRaw] of entries(a.ik)) {
				const c = sk.findIkConstraint(cName)!;
				const keys = list(keysRaw);
				const mix = value38(keys, t, (k) => num(k.mix, 1));
				const soft = value38(keys, t, (k) => num(k.softness, 0));
				if (mix && soft) note('ik', Math.max(off(c.mix, mix), off(c.softness, soft)));
			}
			for (const [cName, keysRaw] of entries(a.transform)) {
				const c = sk.findTransformConstraint(cName)!;
				const keys = list(keysRaw);
				const [r, tr, sc, sh] = ['rotateMix', 'translateMix', 'scaleMix', 'shearMix'].map((n) =>
					value38(keys, t, (k) => num(k[n], 1)),
				);
				if (!r || !tr || !sc || !sh) continue;
				note(
					'transform mix',
					Math.max(
						off(c.mixRotate, r),
						off(c.mixX, tr),
						off(c.mixY, tr),
						off(c.mixScaleX, sc),
						off(c.mixScaleY, sc),
						off(c.mixShearY, sh),
					),
				);
			}
			for (const [cName, tl] of entries(a.path)) {
				const c = sk.findPathConstraint(cName)!;
				const t2 = tl as Json;
				const pos = value38(list(t2.position), t, (k) => num(k.position, 0));
				if (pos) note('path position', off(c.position, pos));
				const sp = value38(list(t2.spacing), t, (k) => num(k.spacing, 0));
				if (sp) note('path spacing', off(c.spacing, sp));
				const mixKeys = list(t2.mix);
				const r = value38(mixKeys, t, (k) => num(k.rotateMix, 1));
				const tr = value38(mixKeys, t, (k) => num(k.translateMix, 1));
				if (r && tr)
					note('path mix', Math.max(off(c.mixRotate, r), off(c.mixX, tr), off(c.mixY, tr)));
			}
		}

		// Deform: the vertices at t lie the eased fraction of the way between the two keys' vertices.
		for (const [skinName, slots] of entries(a.deform)) {
			for (const [slotName, atts] of entries(slots)) {
				for (const [attName, keysRaw] of entries(atts)) {
					const keys = list(keysRaw);
					const slot = sk.findSlot(slotName)!;
					const attachment = data.findSkin(skinName)?.getAttachment(slot.data.index, attName);
					if (!attachment) continue;
					const deformAt = (t: number) => {
						pose(t, () => slot.setAttachment(attachment));
						return slot.attachment === attachment ? [...slot.deform] : null;
					};
					for (const t of times) {
						const s = segment38(keys, t);
						if (!s || s.f === keys.length - 1) continue;
						const t1 = num(keys[s.f].time, 0);
						const t2 = num(keys[s.f + 1].time, 0);
						if (t - t1 < 1e-4 || t2 - t < 1e-4) continue;
						// Just inside each key: a float32 key time can round a sample at the key out of the segment.
						const [v, v1, v2] = [t, t1 + 1e-6, t2 - 1e-6].map(deformAt);
						if (!v || !v1 || !v2) continue;
						note(
							'deform',
							Math.max(
								0,
								...v.map((x, i) =>
									off(x, { v: v1[i] + (v2[i] - v1[i]) * s.p, span: Math.abs(v2[i] - v1[i]) }),
								),
							),
						);
					}
				}
			}
		}
	}
	return worst;
}

/**
 * The runtime samples each Bézier at a handful of points, the reference solves it exactly: on a
 * near-vertical curve start (raptor's roar, cx1 0.056 to cy1 0.99) that is 3.2% of the key step.
 * A conversion mistake is far above this (eight mutants of the upgrader: 44% and up).
 * An attachment must match exactly.
 */
const TOLERANCE = 0.05;

function compareAll(label: string, raw: Json): Record<string, number> {
	const worst = compare(raw);
	for (const [kind, d] of Object.entries(worst))
		check(
			`${label}: ${kind} plays as 3.8 plays it`,
			kind === 'attachment' ? d === 0 : d <= TOLERANCE,
			`off by ${(d * 100).toFixed(3)}% of a key step`,
		);
	return worst;
}

// ── A synthetic 3.8 rig using every converted field ─────────────────────────────────────────────

const rig38: Json = {
	skeleton: { hash: 'h', spine: '3.8.75', width: 10, height: 10 },
	bones: [
		{ name: 'root' },
		{ name: 'a', parent: 'root', length: 50, rotation: 30, x: 5, scaleX: 1.5 },
		{ name: 'b', parent: 'a', length: 40, x: 50, transform: 'noScale' },
		{ name: 'c', parent: 'root', y: 20 },
	],
	slots: [
		{ name: 's1', bone: 'a', attachment: 'img' },
		{ name: 's2', bone: 'b', attachment: 'img', dark: '102030' },
		{ name: 's3', bone: 'c', attachment: 'mesh' },
		{ name: 'p', bone: 'root', attachment: 'path' },
	],
	ik: [{ name: 'ik1', order: 0, bones: ['b'], target: 'c', mix: 0.75 }],
	transform: [
		{
			name: 'tc',
			order: 1,
			bones: ['c'],
			target: 'a',
			rotateMix: 0.5,
			translateMix: 0.25,
			scaleMix: 0,
			shearMix: 0.4,
		},
	],
	path: [
		{
			name: 'pc',
			order: 2,
			bones: ['c'],
			target: 'p',
			rotateMix: 0.3,
			translateMix: 0.6,
			spacing: 4,
		},
	],
	skins: [
		{
			name: 'default',
			attachments: {
				s1: { img: { width: 10, height: 10 } },
				s2: { img: { width: 10, height: 10 } },
				s3: {
					mesh: {
						type: 'mesh',
						uvs: [0, 0, 1, 0, 1, 1],
						triangles: [0, 1, 2],
						vertices: [0, 0, 10, 0, 10, 10],
						hull: 3,
						width: 10,
						height: 10,
					},
					linked: {
						type: 'linkedmesh',
						parent: 'mesh',
						skin: 'default',
						deform: false,
						width: 10,
						height: 10,
					},
				},
				p: {
					path: { type: 'path', lengths: [100], vertexCount: 3, vertices: [0, 0, 50, 50, 100, 0] },
				},
			},
		},
	],
	animations: {
		all: {
			bones: {
				a: {
					rotate: [
						{ angle: 350, curve: 0.25, c3: 0.75 },
						{ time: 0.5, angle: 10, curve: 'stepped' },
						{ time: 0.7, angle: 15 },
						{ time: 1, angle: -150, curve: 0.9, c2: 0.1, c3: 0.1, c4: 0.9 },
						{ time: 1.4, angle: 200 },
					],
					translate: [{ curve: [0.1, 0.9, 0.2, 1] }, { time: 1, x: 100, y: -50 }],
					scale: [
						{ time: 0.2, x: 2, curve: 0.5, c2: 0.1, c3: 0.5, c4: 0.9 },
						{ time: 0.8, x: 0.5, y: 3 },
					],
					shear: [{ x: 10 }, { time: 1, y: 20 }],
				},
			},
			slots: {
				s1: {
					color: [
						{ color: 'ff000080', curve: 0.3, c2: 0.7, c3: 0.6, c4: 0.2 },
						{ time: 1, color: '00ff00ff' },
					],
					attachment: [
						{ time: 0.5, name: null },
						{ time: 0.75, name: 'img' },
					],
				},
				s2: {
					twoColor: [
						{ light: 'ffffffff', dark: '000000', curve: 0.5, c3: 0.5 },
						{ time: 1, light: '80808040', dark: 'ff8000' },
					],
				},
			},
			ik: {
				ik1: [
					{ curve: 0.2, c2: 0.8, c3: 0.8, c4: 0.2 },
					{ time: 1, mix: 0.25, softness: 30, bendPositive: false },
				],
			},
			transform: {
				tc: [
					{ translateMix: 0, curve: 0.4, c3: 0.6 },
					{ time: 1, rotateMix: 0.5, translateMix: 1, scaleMix: 0.2, shearMix: 0 },
				],
			},
			path: {
				pc: {
					position: [
						{ curve: 0.3, c2: 0.6, c3: 0.7, c4: 0.4 },
						{ time: 1, position: 0.8 },
					],
					spacing: [{ spacing: 5 }, { time: 1, spacing: 20 }],
					mix: [
						{ rotateMix: 0, curve: 'stepped' },
						{ time: 0.5, translateMix: 0.3 },
					],
				},
			},
			deform: {
				default: {
					s3: {
						mesh: [
							{ curve: 0.25, c2: 0.1, c3: 0.25 },
							{ time: 1, offset: 2, vertices: [5, 5] },
						],
					},
				},
			},
			drawOrder: [{ time: 0.5, offsets: [{ slot: 's1', offset: 1 }] }],
		},
	},
};

check(
	'a 3.8 export is upgradable, a 3.7 or a 4.x one is not',
	[
		isUpgradableSpine3(rig38),
		isUpgradableSpine3({ skeleton: { spine: '3.7.94' } }),
		isUpgradableSpine3({ skeleton: { spine: '4.1.0' } }),
	].join() === 'true,false,false',
);

const upgraded = upgradeSpine38Json(rig38);
const text = JSON.stringify(upgraded);
check(
	'the input is left as it was',
	JSON.stringify(rig38).includes('"rotateMix"') && JSON.stringify(rig38).includes('"angle"'),
);
for (const gone of [
	'rotateMix',
	'translateMix',
	'scaleMix',
	'shearMix',
	'twoColor',
	'"angle"',
	'"c2"',
	'"deform":false',
	'"transform":"noScale"',
	'"position":0.8',
])
	check(`no 3.x field is left: ${gone}`, !text.includes(gone));
check('the version reads 4.2', (upgraded.skeleton as Json).spine === '4.2');

const imported = importSpine42Json(upgraded);
check(
	'the upgraded file imports as irig dropping nothing the reader reads',
	imported.issues.every((i) => i.reason === 'not an irig field'),
	JSON.stringify(imported.issues.filter((i) => i.reason !== 'not an irig field')),
);
const data = new SkeletonJson(stub).readSkeletonData(upgraded);
check(
	'bone transform "noScale" is read as inherit noScale',
	data.findBone('b')!.inherit === Inherit.NoScale,
);
check(
	'setup mixes keep their values',
	JSON.stringify([
		data.transformConstraints[0].mixRotate,
		data.transformConstraints[0].mixX,
		data.transformConstraints[0].mixY,
		data.transformConstraints[0].mixScaleX,
		data.transformConstraints[0].mixShearY,
		data.pathConstraints[0].mixRotate,
		data.pathConstraints[0].mixX,
	]) === JSON.stringify([0.5, 0.25, 0.25, 0, 0.4, 0.3, 0.6]),
);
const linked = data.defaultSkin!.getAttachment(
	data.findSlot('s3')!.index,
	'linked',
) as MeshAttachment;
check('a linked mesh with deform:false keeps its own deform', linked.timelineAttachment === linked);

const kinds = Object.keys(compareAll('synthetic', rig38));
const expected = [
	'rotate',
	'translate',
	'scale',
	'shear',
	'colour',
	'two colour',
	'attachment',
	'ik',
	'transform mix',
	'path position',
	'path spacing',
	'path mix',
	'deform',
];
check(
	'every kind was compared',
	expected.every((k) => kinds.includes(k)),
	`compared ${kinds.join(', ')}`,
);

const extra = process.env.SPINE38_DIR;
if (extra) {
	for (const file of readdirSync(extra).filter((f) => f.endsWith('.json'))) {
		const raw = JSON.parse(readFileSync(`${extra}/${file}`, 'utf8')) as Json;
		if (!isUpgradableSpine3(raw)) continue;
		const worst = compareAll(file, raw);
		const shown = Object.entries(worst).map(([k, d]) => `${k} ${(d * 100).toFixed(2)}%`);
		console.log(`  ${file}: ${shown.join(', ')}`);
	}
}

if (failures) {
	console.error(`${failures} of ${checks} spine 3.8 upgrade checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} spine 3.8 upgrade checks pass`);
