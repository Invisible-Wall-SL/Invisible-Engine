// Fuzz parity: generates random skeletons that use every Spine 4.2 feature the repo's exported rigs
// do not (IK, local/relative transform constraints, every path mode, physics, all inherit modes,
// linked meshes, sequences, skin-required bones/constraints, every timeline kind) and compares the
// Invisible rig runtime with the reference runtime on them, as parity.mjs does for real rigs.
//
//   node tools/rig-parity/fuzz.mjs [--seeds N] [--seed S] [--verbose]
import { SPINE_CORE } from '../rigger-spike/spine.mjs';
import { loadRig } from './load.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
const SEEDS = opt('--seeds', 400);
const ONLY = args.includes('--seed') ? opt('--seed', 0) : null;
const verbose = args.includes('--verbose');

const RIG = await loadRig();
const REF = await import(SPINE_CORE);

function mulberry32(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function generator(seed) {
	const r = mulberry32(seed);
	const range = (a, b) => a + (b - a) * r();
	const int = (a, b) => Math.floor(range(a, b + 1));
	const pick = (list) => list[Math.floor(r() * list.length)];
	const chance = (p) => r() < p;
	const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
	const hex = (n) => Array.from({ length: n }, () => int(0, 255).toString(16).padStart(2, '0')).join('');
	return { r, range, int, pick, chance, round, hex };
}

const INHERITS = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];

function makeRig(seed) {
	const g = generator(seed);
	const { range, int, pick, chance, round, hex } = g;

	// Atlas: one page of regions, some rotated 90° and some trimmed.
	const regions = [];
	let atlas = 'page.png\nsize:2048,2048\nfilter:Linear,Linear\n';
	const addRegion = (name) => {
		const w = int(20, 160);
		const h = int(20, 160);
		const rotate = chance(0.3);
		const trimmed = chance(0.4);
		const ow = trimmed ? w + int(1, 30) : w;
		const oh = trimmed ? h + int(1, 30) : h;
		const ox = trimmed ? int(0, ow - w) : 0;
		const oy = trimmed ? int(0, oh - h) : 0;
		atlas += `${name}\nbounds:${int(0, 1800)},${int(0, 1800)},${w},${h}\n`;
		if (trimmed) atlas += `offsets:${ox},${oy},${ow},${oh}\n`;
		if (rotate) atlas += 'rotate:90\n';
		regions.push({ name, w: ow, h: oh });
		return regions[regions.length - 1];
	};

	const bones = [{ name: 'root' }];
	const boneCount = int(5, 14);
	for (let i = 1; i < boneCount; i++) {
		const parent = bones[int(0, i - 1)].name;
		const b = { name: `b${i}`, parent, length: round(range(0, 120)), x: round(range(-80, 80)), y: round(range(-80, 80)) };
		if (chance(0.6)) b.rotation = round(range(-180, 180));
		if (chance(0.4)) b.scaleX = round(range(-1.6, 1.6));
		if (chance(0.4)) b.scaleY = round(range(-1.6, 1.6));
		if (chance(0.25)) b.shearX = round(range(-30, 30));
		if (chance(0.25)) b.shearY = round(range(-30, 30));
		if (chance(0.3)) b.inherit = pick(INHERITS.slice(1));
		bones.push(b);
	}
	// A guaranteed normal chain for 2-bone IK: chainA → chainB → chainC.
	bones.push({ name: 'chainA', parent: pick(bones).name, length: round(range(40, 100)), x: round(range(-40, 40)), rotation: round(range(-90, 90)) });
	bones.push({ name: 'chainB', parent: 'chainA', length: round(range(40, 100)), x: round(range(30, 90)), rotation: round(range(-60, 60)) });
	bones.push({ name: 'chainC', parent: 'chainB', length: round(range(20, 60)), x: round(range(30, 90)) });
	if (chance(0.5)) bones[bones.length - 2].scaleX = round(range(0.5, 1.5));
	bones.push({ name: 'target1', parent: 'root', x: round(range(-150, 150)), y: round(range(-150, 150)) });
	bones.push({ name: 'target2', parent: pick(bones.slice(0, boneCount)).name, x: round(range(-150, 150)), y: round(range(-150, 150)) });
	bones.push({ name: 'skinBone', parent: 'root', skin: true, x: round(range(-50, 50)), length: 50 });
	bones.push({ name: 'phys', parent: pick(bones.slice(0, boneCount)).name, length: round(range(30, 90)), rotation: round(range(-90, 90)) });
	bones.push({ name: 'physChild', parent: 'phys', length: 40, x: round(range(20, 60)) });
	const boneNames = bones.map((b) => b.name);
	const plain = boneNames.filter((n) => !['skinBone'].includes(n));

	const slots = [];
	const skin = {};
	const altSkin = {};
	const slotNames = [];
	const addSlot = (bone, attachments, setup, extra = {}) => {
		const name = `s${slots.length}`;
		const slot = { name, bone, ...extra };
		if (setup) slot.attachment = setup;
		if (chance(0.4)) slot.color = hex(4);
		if (chance(0.2)) slot.dark = hex(3);
		if (chance(0.2)) slot.blend = pick(['additive', 'multiply', 'screen']);
		slots.push(slot);
		slotNames.push(name);
		skin[name] = attachments;
		return name;
	};

	const meshFor = (region, weighted) => {
		const cols = int(1, 3);
		const rows = int(1, 3);
		const uvs = [];
		const vertices = [];
		for (let y = 0; y <= rows; y++)
			for (let x = 0; x <= cols; x++) {
				const u = x / cols;
				const v = y / rows;
				uvs.push(u, v);
				const px = round((u - 0.5) * region.w + range(-5, 5));
				const py = round((0.5 - v) * region.h + range(-5, 5));
				if (!weighted) vertices.push(px, py);
				else {
					const n = int(1, 3);
					vertices.push(n);
					let left = 1;
					for (let k = 0; k < n; k++) {
						const w = k === n - 1 ? left : round(left * range(0.2, 0.8), 3);
						left = round(left - w, 3);
						vertices.push(int(0, plain.length - 1), round(px + range(-20, 20)), round(py + range(-20, 20)), w);
					}
				}
			}
		const triangles = [];
		for (let y = 0; y < rows; y++)
			for (let x = 0; x < cols; x++) {
				const i = y * (cols + 1) + x;
				triangles.push(i, i + 1, i + cols + 1, i + 1, i + cols + 2, i + cols + 1);
			}
		return { type: 'mesh', uvs, vertices, triangles, hull: (cols + rows) * 2, width: region.w, height: region.h, color: chance(0.3) ? hex(4) : undefined };
	};

	// Region and mesh slots.
	const meshSlots = [];
	const regionNames = [];
	for (let i = 0; i < int(3, 7); i++) {
		const region = addRegion(`r${i}`);
		regionNames.push(region.name);
		const bone = pick(plain);
		if (chance(0.5)) {
			const weighted = chance(0.5);
			const att = meshFor(region, weighted);
			const name = addSlot(bone, { [region.name]: att, alt: { ...meshFor(region, weighted), path: region.name } }, region.name);
			meshSlots.push({ slot: name, att: region.name, weighted, count: att.uvs.length / 2, influences: weighted ? countInfluences(att.vertices) : 0 });
			if (chance(0.5)) altSkin[name] = { [region.name]: { type: 'linkedmesh', parent: region.name, skin: 'default', timelines: chance(0.5), path: region.name } };
		} else {
			const att = { width: region.w, height: region.h, x: round(range(-20, 20)), y: round(range(-20, 20)) };
			if (chance(0.5)) att.rotation = round(range(-180, 180));
			if (chance(0.3)) att.scaleX = round(range(0.5, 1.5));
			if (chance(0.3)) att.color = hex(4);
			const name = addSlot(bone, { [region.name]: att, other: { ...att, path: region.name, x: 5 } }, chance(0.8) ? region.name : null);
			if (chance(0.4)) altSkin[name] = { [region.name]: { ...att, x: att.x + 10, path: region.name } };
		}
	}
	// A sequence slot.
	const seqCount = int(2, 5);
	const seqStart = int(0, 2);
	for (let i = 0; i < seqCount; i++) addRegion(`seq${String(seqStart + i).padStart(2, '0')}`);
	const seqSlot = addSlot(pick(plain), { seq: { width: 40, height: 40, sequence: { count: seqCount, start: seqStart, digits: 2, setup: int(0, seqCount - 1) } } }, 'seq');
	// Point, bounding box, and a clipping slot.
	addSlot(pick(plain), { pt: { type: 'point', x: round(range(-30, 30)), y: round(range(-30, 30)), rotation: round(range(0, 360)) } }, 'pt');
	addSlot(pick(plain), { bb: { type: 'boundingbox', vertexCount: 4, vertices: [-20, -20, 20, -20, 25, 20, -20, 20] } }, 'bb');
	const skinSlot = addSlot('skinBone', { sk: { width: 30, height: 30 } }, null);
	altSkin[skinSlot] = { sk: { width: 30, height: 30, path: regionNames[0] } };
	skin[skinSlot] = {};
	// Path slot.
	const curves = int(1, 3);
	const closed = chance(0.4);
	const vertexCount = closed ? 3 * curves : 3 * (curves + 1);
	const pathVerts = [];
	for (let i = 0; i < vertexCount * 2; i++) pathVerts.push(round(range(-200, 200)));
	const lengths = [];
	for (let i = 0, acc = 0; i < vertexCount / 3; i++) lengths.push(round((acc += range(50, 200))));
	const pathSlot = addSlot(pick(plain), { path: { type: 'path', closed, constantSpeed: chance(0.6), vertexCount, vertices: pathVerts, lengths } }, 'path');

	for (const [, map] of Object.entries(skin)) for (const k of Object.keys(map)) if (map[k]?.color === undefined) delete map[k].color;

	// Constraints, with unique orders.
	const orders = [];
	let nextOrder = 0;
	const order = () => {
		orders.push(nextOrder);
		return nextOrder++;
	};
	const ik = [];
	const oneBone = pick(plain.filter((n) => n !== 'root' && !n.startsWith('target') && !n.startsWith('chain') && !n.startsWith('phys')));
	if (oneBone)
		ik.push({ name: 'ik1', order: order(), bones: [oneBone], target: 'target1', mix: round(range(0.3, 1)), compress: chance(0.5), stretch: chance(0.5), uniform: chance(0.5), bendPositive: chance(0.5) });
	ik.push({ name: 'ik2', order: order(), bones: ['chainA', 'chainB'], target: 'target2', mix: round(range(0.3, 1)), softness: chance(0.5) ? round(range(0, 40)) : 0, stretch: chance(0.5), uniform: chance(0.5), bendPositive: chance(0.5) });
	ik.push({ name: 'ikSkin', order: order(), skin: true, bones: ['chainC'], target: 'target1', mix: 0.5 });

	const transform = [];
	for (let i = 0; i < int(1, 3); i++) {
		const candidates = plain.filter((n) => !['root', 'target1', 'target2', 'phys', 'physChild'].includes(n) && !n.startsWith('chain'));
		const bone = pick(candidates);
		const target = pick(['target1', 'target2']);
		transform.push({
			name: `tc${i}`,
			order: order(),
			bones: [bone],
			target,
			local: chance(0.5),
			relative: chance(0.5),
			rotation: round(range(-45, 45)),
			x: round(range(-20, 20)),
			y: round(range(-20, 20)),
			scaleX: round(range(-0.3, 0.3)),
			scaleY: round(range(-0.3, 0.3)),
			shearY: round(range(-20, 20)),
			mixRotate: round(range(0, 1)),
			mixX: round(range(0, 1)),
			mixY: round(range(0, 1)),
			mixScaleX: round(range(0, 1)),
			mixScaleY: round(range(0, 1)),
			mixShearY: round(range(0, 1)),
		});
	}

	const pathBones = plain.filter((n) => /^b\d+$/.test(n)).slice(0, int(1, 3));
	const path = [
		{
			name: 'pc',
			order: order(),
			bones: pathBones,
			target: pathSlot,
			positionMode: pick(['fixed', 'percent']),
			spacingMode: pick(['length', 'fixed', 'percent', 'proportional']),
			rotateMode: pick(['tangent', 'chain', 'chainScale']),
			rotation: chance(0.5) ? round(range(-45, 45)) : 0,
			position: round(range(-0.2, 1.2)),
			spacing: round(range(0, 0.4)),
			mixRotate: round(range(0, 1)),
			mixX: round(range(0, 1)),
			mixY: round(range(0, 1)),
		},
	];

	const physics = [
		{
			name: 'ph',
			order: order(),
			bone: 'phys',
			x: round(range(0, 1)),
			y: round(range(0, 1)),
			rotate: round(range(0, 1)),
			scaleX: round(range(0, 1)),
			shearX: round(range(0, 1)),
			limit: round(range(500, 5000)),
			fps: pick([30, 60, 120]),
			inertia: round(range(0.2, 1)),
			strength: round(range(20, 200)),
			damping: round(range(0.5, 1)),
			mass: round(range(0.5, 3)),
			wind: round(range(-5, 5)),
			gravity: round(range(-5, 5)),
			mix: round(range(0.3, 1)),
			inertiaGlobal: chance(0.5),
			windGlobal: chance(0.5),
			gravityGlobal: chance(0.5),
			mixGlobal: chance(0.5),
		},
	];

	// Constraint orders are shuffled so sorting by order is exercised.
	const all = [...ik, ...transform, ...path, ...physics];
	const shuffled = all.map((c) => c.order).sort(() => g.r() - 0.5);
	all.forEach((c, i) => (c.order = shuffled[i]));

	const events = { ev1: { int: int(0, 9) }, ev2: { float: round(range(0, 1)), string: 'hello' }, ev3: {} };

	const curve = (n) => {
		const p = g.r();
		if (p < 0.2) return 'stepped';
		if (p < 0.5) return undefined;
		const out = [];
		for (let i = 0; i < n; i++) out.push(round(range(0, 0.5)), round(range(-50, 50)), round(range(0.5, 1)), round(range(-50, 50)));
		return out;
	};
	const keys = (count, value) => {
		let t = round(range(0, 0.3));
		const out = [];
		for (let i = 0; i < count; i++) {
			const k = { time: t, ...value() };
			if (t === 0 && chance(0.5)) delete k.time;
			const c = curve(Object.keys(value()).length || 1);
			if (c !== undefined && i < count - 1) k.curve = c;
			out.push(k);
			t = round(t + range(0.1, 0.6));
		}
		return out;
	};

	const animation = () => {
		const a = { bones: {}, slots: {}, ik: {}, transform: {}, path: {}, physics: {}, attachments: { default: {} } };
		for (const b of g.r() < 1 ? plain.filter(() => chance(0.5)) : []) {
			const tl = {};
			if (chance(0.6)) tl.rotate = keys(int(1, 4), () => ({ value: round(range(-270, 270)) }));
			if (chance(0.4)) tl.translate = keys(int(1, 4), () => ({ x: round(range(-60, 60)), y: round(range(-60, 60)) }));
			if (chance(0.2)) tl.translatex = keys(int(1, 3), () => ({ value: round(range(-60, 60)) }));
			if (chance(0.2)) tl.translatey = keys(int(1, 3), () => ({ value: round(range(-60, 60)) }));
			if (chance(0.4)) tl.scale = keys(int(1, 4), () => ({ x: round(range(-2, 2)), y: round(range(-2, 2)) }));
			if (chance(0.2)) tl.scalex = keys(int(1, 3), () => ({ value: round(range(-2, 2)) }));
			if (chance(0.2)) tl.scaley = keys(int(1, 3), () => ({ value: round(range(-2, 2)) }));
			if (chance(0.3)) tl.shear = keys(int(1, 3), () => ({ x: round(range(-40, 40)), y: round(range(-40, 40)) }));
			if (chance(0.15)) tl.shearx = keys(int(1, 3), () => ({ value: round(range(-40, 40)) }));
			if (chance(0.15)) tl.sheary = keys(int(1, 3), () => ({ value: round(range(-40, 40)) }));
			if (chance(0.15)) tl.inherit = keys(int(1, 3), () => ({ inherit: pick(INHERITS) })).map(({ curve: _c, ...k }) => k);
			if (Object.keys(tl).length) a.bones[b] = tl;
		}
		for (const s of slotNames) {
			const tl = {};
			if (chance(0.3)) tl.rgba = keys(int(1, 3), () => ({ color: hex(4) }));
			if (chance(0.15)) tl.rgb = keys(int(1, 3), () => ({ color: hex(3) }));
			if (chance(0.2)) tl.alpha = keys(int(1, 3), () => ({ value: round(range(0, 1)) }));
			const slot = slots.find((x) => x.name === s);
			if (slot.dark && chance(0.4)) tl[pick(['rgba2', 'rgb2'])] = keys(int(1, 3), () => ({ light: hex(tl.rgb2 ? 3 : 4), dark: hex(3) }));
			if (tl.rgba2) tl.rgba2.forEach((k) => (k.light = k.light.length === 6 ? k.light + 'ff' : k.light));
			if (tl.rgb2) tl.rgb2.forEach((k) => (k.light = k.light.slice(0, 6)));
			const names = Object.keys(skin[s]);
			if (chance(0.3) && names.length)
				tl.attachment = keys(int(1, 4), () => ({ name: chance(0.2) ? null : pick(names) })).map(({ curve: _c, ...k }) => k);
			if (Object.keys(tl).length) a.slots[s] = tl;
		}
		if (chance(0.7))
			a.ik.ik2 = keys(int(1, 3), () => ({ mix: round(range(0, 1)), softness: round(range(0, 30)), bendPositive: chance(0.5), stretch: chance(0.5), compress: chance(0.5) }));
		if (chance(0.5) && ik.find((c) => c.name === 'ik1')) a.ik.ik1 = keys(int(1, 3), () => ({ mix: round(range(0, 1)) }));
		for (const tc of transform)
			if (chance(0.5))
				a.transform[tc.name] = keys(int(1, 3), () => ({ mixRotate: round(range(0, 1)), mixX: round(range(0, 1)), mixY: round(range(0, 1)), mixScaleX: round(range(0, 1)), mixShearY: round(range(0, 1)) }));
		if (chance(0.5)) a.path.pc = { position: keys(int(1, 3), () => ({ value: round(range(-0.2, 1.2)) })) };
		if (chance(0.4)) (a.path.pc ??= {}).spacing = keys(int(1, 3), () => ({ value: round(range(0, 0.5)) }));
		if (chance(0.4)) (a.path.pc ??= {}).mix = keys(int(1, 3), () => ({ mixRotate: round(range(0, 1)), mixX: round(range(0, 1)) }));
		const physName = chance(0.5) ? 'ph' : '';
		for (const field of ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'])
			if (chance(0.25)) (a.physics[physName] ??= {})[field] = keys(int(1, 3), () => ({ value: round(field === 'mass' ? range(0.5, 3) : field === 'strength' ? range(20, 200) : range(0, 1)) }));
		if (chance(0.3)) (a.physics[physName] ??= {}).reset = keys(int(1, 2), () => ({})).map(({ curve: _c, ...k }) => k);
		for (const m of meshSlots)
			if (chance(0.5)) {
				const len = m.weighted ? m.influences * 2 : m.count * 2;
				(a.attachments.default[m.slot] ??= {})[m.att] = {
					deform: keys(int(1, 3), () => {
						if (chance(0.15)) return {};
						const offset = int(0, Math.max(0, len - 2));
						const n = int(1, len - offset);
						return { offset, vertices: Array.from({ length: n }, () => round(range(-15, 15))) };
					}),
				};
			}
		if (chance(0.6))
			(a.attachments.default[seqSlot] ??= {}).seq = {
				sequence: keys(int(1, 3), () => ({ mode: pick(['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse']), index: int(0, seqCount - 1), delay: round(range(0.03, 0.2)) })).map(({ curve: _c, ...k }) => k),
			};
		if (chance(0.5))
			a.drawOrder = keys(int(1, 3), () => {
				if (chance(0.2)) return {};
				const picked = slotNames.filter(() => chance(0.3)).slice(0, 3);
				const offsets = [];
				for (const s of picked.sort((x, y) => slotNames.indexOf(x) - slotNames.indexOf(y))) {
					const idx = slotNames.indexOf(s);
					const offset = int(-idx, slotNames.length - 1 - idx);
					offsets.push({ slot: s, offset });
				}
				return offsets.length ? { offsets } : {};
			}).map(({ curve: _c, ...k }) => k);
		if (chance(0.7))
			a.events = keys(int(1, 4), () => ({ name: pick(Object.keys(events)), ...(chance(0.3) ? { int: int(0, 5) } : {}), ...(chance(0.3) ? { string: 'x' } : {}) })).map(({ curve: _c, ...k }) => k);
		for (const k of Object.keys(a)) if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && !Object.keys(a[k]).length) delete a[k];
		if (a.attachments && !Object.keys(a.attachments.default).length) delete a.attachments;
		return a;
	};

	// Drop invalid draw orders (two slots landing on the same position).
	const fixDrawOrder = (a) => {
		if (!a.drawOrder) return;
		for (const k of a.drawOrder) {
			if (!k.offsets) continue;
			const taken = new Set();
			let ok = true;
			for (const o of k.offsets) {
				const target = slotNames.indexOf(o.slot) + o.offset;
				if (taken.has(target)) ok = false;
				taken.add(target);
			}
			if (!ok) delete k.offsets;
		}
	};
	const animations = {};
	for (let i = 0; i < int(2, 4); i++) {
		const a = animation();
		fixDrawOrder(a);
		animations[`anim${i}`] = a;
	}

	const skeleton = {
		skeleton: { spine: '4.2.36', x: -100, y: -100, width: 200, height: 200, referenceScale: 100 },
		bones,
		slots,
		ik,
		transform,
		path,
		physics,
		skins: [
			{ name: 'default', attachments: skin },
			{ name: 'alt', bones: ['skinBone'], ik: ['ikSkin'], attachments: altSkin },
		],
		events,
		animations,
	};
	return { json: JSON.stringify(skeleton), atlas };
}

function countInfluences(vertices) {
	let n = 0;
	for (let i = 0; i < vertices.length; ) {
		const c = vertices[i++];
		n += c;
		i += c * 4;
	}
	return n;
}

const ABS = 2e-3;
const REL = 2e-4;
const close = (a, b) => {
	if (a === b) return true;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b);
	return Math.abs(a - b) <= ABS + REL * Math.max(Math.abs(a), Math.abs(b));
};

const stub = { getImage() {}, setFilters() {}, setWraps() {}, dispose() {} };
function load(X, json, atlasText) {
	const atlas = new X.TextureAtlas(atlasText);
	for (const p of atlas.pages) p.setTexture(stub);
	return new X.SkeletonJson(new X.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(json));
}

function snapshot(X, sk, clipper) {
	const nums = [];
	const keys = [];
	const strs = [];
	const add = (key, ...values) => values.forEach((v, i) => (nums.push(v), keys.push(values.length > 1 ? `${key}[${i}]` : key)));
	for (const b of sk.bones) {
		add(`bone ${b.data.name} abcdxy`, b.a, b.b, b.c, b.d, b.worldX, b.worldY);
		strs.push(`${b.data.name} active=${b.active} inherit=${b.inherit}`);
	}
	for (const c of sk.ikConstraints) add(`ik ${c.data.name}`, c.mix, c.softness, c.bendDirection, c.compress ? 1 : 0, c.stretch ? 1 : 0, c.active ? 1 : 0);
	for (const c of sk.transformConstraints) add(`tc ${c.data.name}`, c.mixRotate, c.mixX, c.mixY, c.mixScaleX, c.mixScaleY, c.mixShearY);
	for (const c of sk.pathConstraints) add(`pc ${c.data.name}`, c.position, c.spacing, c.mixRotate, c.mixX, c.mixY);
	for (const c of sk.physicsConstraints) add(`ph ${c.data.name}`, c.inertia, c.strength, c.damping, c.massInverse, c.wind, c.gravity, c.mix);
	for (const s of sk.slots) {
		add(`slot ${s.data.name} rgba`, s.color.r, s.color.g, s.color.b, s.color.a);
		if (s.darkColor) add(`slot ${s.data.name} dark`, s.darkColor.r, s.darkColor.g, s.darkColor.b);
		add(`slot ${s.data.name} seq`, s.sequenceIndex);
		strs.push(`${s.data.name}=${s.attachment ? s.attachment.name : '-'}`);
		const a = s.attachment;
		if (!a || !s.bone.active) continue;
		const v = [];
		if (a instanceof X.RegionAttachment) {
			a.computeWorldVertices(s, v, 0, 2);
			add(`slot ${s.data.name} uvs`, ...a.uvs);
		} else if (a instanceof X.MeshAttachment) {
			a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2);
			add(`slot ${s.data.name} uvs`, ...a.uvs);
		} else if (a instanceof X.VertexAttachment) a.computeWorldVertices(s, 0, a.worldVerticesLength, v, 0, 2);
		else if (a instanceof X.PointAttachment) {
			const p = a.computeWorldPosition(s.bone, new X.Vector2());
			v.push(p.x, p.y, a.computeWorldRotation(s.bone));
		}
		add(`slot ${s.data.name} verts`, ...v);
	}
	strs.push('order:' + sk.drawOrder.map((s) => s.data.index).join(','));
	const off = new X.Vector2();
	const size = new X.Vector2();
	sk.getBounds(off, size, [], clipper);
	if (Number.isFinite(off.x)) add('bounds', off.x, off.y, size.x, size.y);
	return { nums, keys, strs };
}

let failures = 0;
let checks = 0;
const failedSeeds = [];
function compare(label, a, b) {
	checks++;
	const problem = (() => {
		if (a.strs.length !== b.strs.length || a.nums.length !== b.nums.length) return `shape ${a.nums.length}/${a.strs.length} vs ${b.nums.length}/${b.strs.length}`;
		for (let i = 0; i < a.strs.length; i++) if (a.strs[i] !== b.strs[i]) return `${a.strs[i]} ≠ ${b.strs[i]}`;
		for (let i = 0; i < a.nums.length; i++) if (!close(a.nums[i], b.nums[i])) return `${a.keys[i]}: ${a.nums[i]} ≠ ${b.nums[i]}`;
		return null;
	})();
	if (!problem) return true;
	failures++;
	if (verbose || failedSeeds.length < 25) console.log(`✗ ${label} — ${problem}`);
	return false;
}

function recorder(log) {
	const tag = (e) => `${e.trackIndex}:${e.animation ? e.animation.name : '?'}`;
	return {
		start: (e) => log.push('start ' + tag(e)),
		interrupt: (e) => log.push('interrupt ' + tag(e)),
		end: (e) => log.push('end ' + tag(e)),
		dispose: (e) => log.push('dispose ' + tag(e)),
		complete: (e) => log.push('complete ' + tag(e)),
		event: (e, ev) => log.push(`event ${tag(e)} ${ev.data.name}@${ev.time.toFixed(4)} ${ev.intValue} ${ev.floatValue} ${ev.stringValue}`),
	};
}

function runSeed(seed) {
	const { json, atlas } = makeRig(seed);
	let refData;
	try {
		refData = load(REF, json, atlas);
	} catch (e) {
		if (verbose) console.log(`seed ${seed}: reference rejects it (${e.message})`);
		return true;
	}
	let rigData;
	try {
		rigData = load(RIG, json, atlas);
	} catch (e) {
		failures++;
		console.log(`✗ seed ${seed} load — ${e.stack}`);
		return false;
	}
	const g = generator(seed * 7919 + 1);
	const runs = [REF, RIG].map((X, i) => {
		const data = i === 0 ? refData : rigData;
		const sk = new X.Skeleton(data);
		if (seed % 3 === 0) sk.setSkinByName('alt');
		if (seed % 4 === 1) {
			sk.scaleX = -1.2;
			sk.scaleY = 0.8;
		}
		if (seed % 5 === 2) sk.yDown = true;
		const sd = new X.AnimationStateData(data);
		sd.defaultMix = 0.15;
		const state = new X.AnimationState(sd);
		const log = [];
		state.addListener(recorder(log));
		return { X, data, sk, state, log, clipper: new X.SkeletonClipping() };
	});
	// Skeleton.yDown is static on the reference; mirror it on both for this seed.
	REF.Skeleton.yDown = seed % 5 === 2;
	const anims = refData.animations.map((a) => a.name);

	// Direct poses of each animation at sampled times.
	for (const name of anims) {
		const d = refData.findAnimation(name).duration || 1;
		let last = -1;
		for (let k = 0; k <= 9; k++) {
			const t = (d * k) / 7;
			for (const r of runs) {
				r.sk.setToSetupPose();
				r.data.findAnimation(name).apply(r.sk, last, t, true, (r.events = []), 1, r.X.MixBlend.setup, r.X.MixDirection.mixIn);
				r.sk.updateWorldTransform(r.X.Physics.pose);
			}
			if (!compare(`seed ${seed} ${name} @${t.toFixed(3)}`, snapshot(REF, runs[0].sk), snapshot(RIG, runs[1].sk))) return false;
			const ea = runs[0].events.map((e) => e.data.name + e.time).join();
			const eb = runs[1].events.map((e) => e.data.name + e.time).join();
			checks++;
			if (ea !== eb) {
				failures++;
				console.log(`✗ seed ${seed} ${name} @${t} events ${ea} ≠ ${eb}`);
				return false;
			}
			last = t;
		}
	}

	// A random AnimationState session with physics running.
	for (const r of runs) {
		r.sk.setToSetupPose();
		r.sk.updateWorldTransform(r.X.Physics.reset);
	}
	const script = [];
	for (let f = 0; f < 200; f++) {
		if (!g.chance(0.12)) continue;
		const track = g.chance(0.7) ? 0 : g.int(1, 2);
		const anim = g.pick(anims);
		const op = g.pick(['set', 'set', 'add', 'add', 'empty', 'addEmpty', 'clear', 'setEmpties']);
		script.push({
			f,
			track,
			anim,
			op,
			loop: g.chance(0.5),
			delay: g.pick([0, -0.1, 0.2, 0.5]),
			mix: g.pick([0, 0.1, 0.3]),
			alpha: g.pick([1, 1, 0.5]),
			blend: track > 0 ? g.pick([1, 2, 3]) : 2,
			hold: g.chance(0.2),
			reverse: g.chance(0.1),
			shortest: g.chance(0.2),
			timeScale: g.pick([1, 1, 0.5, 2]),
			eventThreshold: g.pick([0, 0.5]),
			attachThreshold: g.pick([0, 0.5]),
			drawThreshold: g.pick([0, 0.5]),
		});
	}
	const dt = 1 / 60;
	for (let f = 0; f < 200; f++) {
		for (const r of runs) {
			for (const s of script.filter((x) => x.f === f)) {
				let e = null;
				if (s.op === 'set') e = r.state.setAnimation(s.track, s.anim, s.loop);
				else if (s.op === 'add') e = r.state.addAnimation(s.track, s.anim, s.loop, s.delay);
				else if (s.op === 'empty') e = r.state.setEmptyAnimation(s.track, s.mix);
				else if (s.op === 'addEmpty') e = r.state.addEmptyAnimation(s.track, s.mix, s.delay);
				else if (s.op === 'clear') r.state.clearTrack(s.track);
				else r.state.setEmptyAnimations(s.mix);
				if (e && (s.op === 'set' || s.op === 'add')) {
					e.alpha = s.alpha;
					e.mixBlend = s.blend;
					e.holdPrevious = s.hold;
					e.reverse = s.reverse;
					e.shortestRotation = s.shortest;
					e.timeScale = s.timeScale;
					e.eventThreshold = s.eventThreshold;
					e.mixAttachmentThreshold = s.attachThreshold;
					e.mixDrawOrderThreshold = s.drawThreshold;
					if (s.mix) e.mixDuration = s.mix;
				}
			}
			r.state.update(dt);
			r.state.apply(r.sk);
			r.sk.x = Math.sin(f / 10) * 40;
			r.sk.y = Math.cos(f / 13) * 25;
			r.sk.update(dt);
			r.sk.updateWorldTransform(r.X.Physics.update);
		}
		if (!compare(`seed ${seed} state frame ${f}`, snapshot(REF, runs[0].sk, runs[0].clipper), snapshot(RIG, runs[1].sk, runs[1].clipper))) return false;
	}
	checks++;
	const A = runs[0].log;
	const B = runs[1].log;
	if (A.join('\n') !== B.join('\n')) {
		let i = 0;
		while (i < A.length && A[i] === B[i]) i++;
		failures++;
		console.log(`✗ seed ${seed} listeners — first difference at #${i}: ${A[i]} ≠ ${B[i]}`);
		return false;
	}
	return true;
}

const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SEEDS }, (_, i) => i + 1);
for (const seed of seeds) {
	let ok;
	try {
		ok = runSeed(seed);
	} catch (e) {
		failures++;
		ok = false;
		console.log(`✗ seed ${seed} threw — ${e.stack}`);
	}
	if (!ok) failedSeeds.push(seed);
}
REF.Skeleton.yDown = false;
console.log(`${failures ? '✗' : '✓'} rig fuzz parity: ${seeds.length} seeds, ${checks} checks, ${failures} failures${failedSeeds.length ? ` (seeds ${failedSeeds.slice(0, 20).join(', ')}${failedSeeds.length > 20 ? ', …' : ''})` : ''}`);
process.exit(failures ? 1 : 0);
