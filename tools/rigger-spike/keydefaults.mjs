// Omitted-default spike — prove the Rigger reads a key that leaves a value to the format's default
// as engine-rig plays it.
//   node tools/rigger-spike/keydefaults.mjs <skeleton.json> <skeleton.atlas>
//
// Runs the SHIPPED code out of view.html: the load-time `normalizeKeys` (`normalizeKeyTimes` +
// `fillKeyDefaults` over `KEY_DEFAULTS`), `poseAtTime` with the samplers under it, and `keyIk`.
//
// The regression it guards: rig JSON leaves out a key's value when it equals the default, and not
// every default is 0 (scale 1, IK mix 1, transform/path mixes 1 with mixY ← mixX and
// mixScaleY ← mixScaleX). The Rigger read every omitted value as 0, or as the constraint's setup
// value, so `anticipation1_intro`'s `glow` (scale keys `[{"x":0.6},{"time":0.6667}]`) previewed
// at scaleY 0 for the whole clip while the game played it at 1.
//
//   0. TABLE        `KEY_DEFAULTS` fills exactly the fields engine-rig reads (`RUNTIME_FIELDS`,
//                   written out by hand from its readers, so a dropped row cannot pass by being
//                   read back from the table), and the open / clip-import / rig-merge paths all
//                   run `normalizeKeys`.
//   1. MEANING      the filled document loads into the SAME timelines as the file (frames,
//                   curve types and sampled beziers identical), so saving a filled rig changes
//                   nothing it plays. Filling twice changes nothing, and nothing outside the
//                   animations is touched.
//   2. THE RIG      every clip of the given rig, posed by `poseAtTime` from the filled document,
//                   matches engine-rig's pose of the file: each keyed bone channel and each path
//                   constraint's position / spacing / mixes.
//   3. CONSTRAINTS  a fixture on the same rig (an IK, a transform and a physics constraint, a
//                   path constraint when the rig has one) whose keys leave out every defaulted
//                   field, against setup values that differ from the defaults. Its constraint
//                   tracks start after 0, so the setup they hold before their first key counts too.
//   4. WRITER       a key ◆ Key IK writes carries all five IK fields and poses as it plays.
//   5. SHARP        the fixture posed WITHOUT `fillKeyDefaults` misses, so the gate would catch
//                   the old reading.
//
// Before a track's first key the runtime holds the setup values. A constraint track does so in the
// Rigger too, and is compared there; a bone channel still holds its first key (docs/status/rigger.md
// open item 16), so it is compared only from its first key on. The Rigger does not pose the split
// bone channels (translatex …) or slot alpha, so (0) and (1) alone cover those rows of the table. A
// mass key of 0 (its default) is degenerate (the runtime sets massInverse = 1/0), so the fixture
// never leaves mass out.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, MixBlend, MixDirection } =
	await import(RIG_CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/keydefaults.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}

// ---- the SHIPPED code, out of view.html --------------------------------------------------
const html = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url),
	'utf8',
);
const balanced = (s) => {
	let n = 0;
	for (const c of s) {
		if (c === '{') n++;
		else if (c === '}') n--;
	}
	return n === 0;
};
// A top-level declaration is either wholly on one line or closed by `}` / `};` at column 0.
function pull(head, close) {
	const i = html.indexOf('\n' + head);
	if (i < 0) {
		console.error(`✗ "${head}" not found in view.html — the markers moved`);
		process.exit(2);
	}
	const first = html.slice(i, html.indexOf('\n', i + 1));
	if (balanced(first) && first.includes(head.endsWith('(') ? '{' : '=')) return first;
	const end = html.indexOf(close, i);
	return html.slice(i, end + close.length);
}
const fn = (name) => pull(`function ${name}(`, '\n}');
const konst = (name) => pull(`const ${name} = `, '\n};');
const CONSTS = [
	'KEY_DEFAULTS',
	'TC_MIXES',
	'PC_MIXES',
	'PC_SIM',
	'PC_VAL_CHANS',
	'animOf',
	'hexToRGBA',
	'roundN',
];
const sandbox = {
	rawDoc: null,
	skeleton: null,
	skeletonData: null,
	meshCtx: null,
	// keyIk's surroundings: the open clip and playhead, and the UI it refreshes.
	animMode: true,
	curAnim: null,
	animTime: 0,
	animsDirty: false,
	ensureCurAnim: () => sandbox.curAnim,
	ikByName: (n) => (sandbox.rawDoc.ik || []).find((c) => c.name === n) || null,
	selected: null,
	markDirty() {},
	refreshAnimCounts() {},
	buildInspector() {},
};
vm.createContext(sandbox);
vm.runInContext(
	[
		...CONSTS.map(konst),
		...[
			'normalizeKeyTimes',
			'fillKeyFields',
			'fillKeyDefaults',
			'normalizeKeys',
			'bezierValue',
			'sampleChannel',
			'sampleColor',
			'sampleColor2',
			'hexToRGB',
			'reconstructDrawOrder',
			'poseAtTime',
			'upsertKey',
			'keyIk',
		].map(fn),
		`Object.assign(globalThis, { ${CONSTS.join(', ')} });`,
	].join('\n'),
	sandbox,
	{ filename: 'view.html#keydefaults' },
);
const { normalizeKeyTimes, normalizeKeys, poseAtTime, keyIk, KEY_DEFAULTS } = sandbox;

// ---- runtime -------------------------------------------------------------------------------
const atlasText = readFileSync(atlasPath, 'utf8');
function loadData(doc) {
	const atlas = new TextureAtlas(atlasText);
	const stub = {
		getImage: () => ({ width: 2048, height: 2048 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) {
		p.width = 2048;
		p.height = 2048;
		try {
			p.setTexture(stub);
		} catch {
			p.texture = stub;
		}
	}
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
}
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};

console.log(`\n=== Omitted key defaults: the Rigger vs engine-rig: ${jsonPath} ===`);

// ---- 0. TABLE: what engine-rig reads from a key -------------------------------------------
// Read off packages/engine-rig/src/skeletonJson.ts by hand: readTimeline1 (`value`) and
// readTimeline2 (`x`, `y`) for bone, slot-alpha, path position / spacing and physics timelines;
// the IK, transform and path-mix readers name their fields. In reading order, which is the order a
// fallback (mixY ← mixX, mixScaleY ← mixScaleX) needs. The VALUES are held by (1).
const V = ['value'];
const XY = ['x', 'y'];
const RUNTIME_FIELDS = {
	bones: {
		rotate: V,
		translate: XY,
		translatex: V,
		translatey: V,
		scale: XY,
		scalex: V,
		scaley: V,
		shear: XY,
		shearx: V,
		sheary: V,
	},
	slots: { alpha: V },
	ik: ['mix', 'softness', 'bendPositive', 'compress', 'stretch'],
	transform: ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'],
	path: { position: V, spacing: V, mix: ['mixRotate', 'mixX', 'mixY'] },
	physics: { inertia: V, strength: V, damping: V, mass: V, wind: V, gravity: V, mix: V },
};
// group[.channel] → its field names, from either table.
const fieldLists = (table) => {
	const out = {};
	const names = (l) => l.map((x) => (Array.isArray(x) ? x[0] : x));
	for (const [g, d] of Object.entries(table))
		if (Array.isArray(d)) out[g] = names(d);
		else for (const [ch, l] of Object.entries(d)) out[`${g}.${ch}`] = names(l);
	return out;
};
{
	const want = fieldLists(RUNTIME_FIELDS);
	const got = fieldLists(KEY_DEFAULTS);
	const off = [...new Set([...Object.keys(want), ...Object.keys(got)])]
		.filter((id) => JSON.stringify(want[id]) !== JSON.stringify(got[id]))
		.map(
			(id) =>
				`${id}: fills ${JSON.stringify(got[id] ?? [])}, engine-rig reads ${JSON.stringify(want[id] ?? [])}`,
		);
	log(off.length === 0, `table: KEY_DEFAULTS fills exactly the fields engine-rig reads`);
	for (const o of off) console.log('       ' + o);
	// Keys reach the open rig on open, clip import (clipboard / library) and rig-library merge.
	for (const where of ['buildSkeleton', 'importAnimation', 'importRig']) {
		const i = html.search(new RegExp(`\\n(async )?function ${where}\\(`));
		const body = i < 0 ? '' : html.slice(i, html.indexOf('\n}', i));
		log(body.includes('normalizeKeys('), `${where} runs normalizeKeys on the keys it brings in`);
	}
}

// ---- 1. MEANING: the filled document is the file ----------------------------------------
const timelineDump = (data) =>
	data.animations.map((a) => ({
		name: a.name,
		duration: a.duration,
		timelines: a.timelines.map((t) => ({
			kind: t.constructor.name,
			// A deform or sequence timeline's property id carries the attachment's load-order id.
			ids: t.attachment ? [t.slotIndex, t.attachment.name] : t.propertyIds,
			frames: Array.from(t.frames),
			curveTypes: t.curveTypes,
			beziers: t.beziers && t.beziers.map((b) => (b ? Array.from(b) : null)),
		})),
	}));
function sameMeaning(label, file) {
	const filled = clone(file);
	normalizeKeys(filled);
	const a = JSON.stringify(timelineDump(loadData(file)));
	const b = JSON.stringify(timelineDump(loadData(filled)));
	log(a === b, `${label}: the filled document loads into the same timelines as the file`);
	const again = clone(filled);
	normalizeKeys(again);
	log(JSON.stringify(again) === JSON.stringify(filled), `${label}: filling again changes nothing`);
	log(
		JSON.stringify({ ...file, animations: undefined }) ===
			JSON.stringify({ ...filled, animations: undefined }),
		`${label}: nothing outside the animations changes`,
	);
	return filled;
}

// ---- 2/3/5. poseAtTime vs engine-rig ------------------------------------------------------
// Each compared quantity, in the channel's KEYED units (an offset from setup, or for scale a
// multiplier of it), so one tolerance rule fits all: 2% of the values the channel's keys and
// bezier controls span — the runtime plays a bezier as straight pieces, the Rigger solves it.
const BONE_READS = {
	rotate: [['rotation', (b) => b.rotation - b.data.rotation]],
	translate: [
		['x', (b) => b.x - b.data.x],
		['y', (b) => b.y - b.data.y],
	],
	scale: [
		['x', (b) => (b.data.scaleX ? b.scaleX / b.data.scaleX : b.scaleX)],
		['y', (b) => (b.data.scaleY ? b.scaleY / b.data.scaleY : b.scaleY)],
	],
	shear: [
		['x', (b) => b.shearX - b.data.shearX],
		['y', (b) => b.shearY - b.data.shearY],
	],
};
const SPLIT = ['translatex', 'translatey', 'scalex', 'scaley', 'shearx', 'sheary'];
const IK_READS = [
	['mix', (c) => c.mix],
	['softness', (c) => c.softness],
	['bendPositive', (c) => (c.bendDirection > 0 ? 1 : 0), true],
	['compress', (c) => (c.compress ? 1 : 0), true],
	['stretch', (c) => (c.stretch ? 1 : 0), true],
];
const PHYS_READ = (ch) => (c) => (ch === 'mass' ? 1 / c.massInverse : c[ch]);

// Every quantity an animation keys: { label, first (time of the first key), span, read(skeleton),
// before (compared before the first key too: a constraint track) }.
function quantities(doc, animName) {
	const a = doc.animations[animName];
	const out = [];
	const spanOf = (keys, field, vi) => {
		const vals = [];
		for (const k of keys) {
			if (typeof k[field] === 'number') vals.push(k[field]);
			if (Array.isArray(k.curve)) vals.push(k.curve[vi * 4 + 1], k.curve[vi * 4 + 3]);
		}
		return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
	};
	const add = (label, keys, field, vi, read, exact, before = true) =>
		keys &&
		keys.length &&
		out.push({
			label,
			first: keys[0].time ?? 0,
			span: exact ? 0 : spanOf(keys, field, vi),
			read,
			before,
		});
	for (const [bone, chans] of Object.entries(a.bones || {})) {
		if (SPLIT.some((c) => c in chans)) continue;
		for (const [ch, reads] of Object.entries(BONE_READS))
			reads.forEach(([field, read], vi) =>
				add(
					`bone ${bone} ${ch}.${field}`,
					chans[ch],
					ch === 'rotate' ? 'value' : field,
					vi,
					(sk) => read(sk.findBone(bone)),
					false,
					false,
				),
			);
	}
	for (const [name, keys] of Object.entries(a.ik || {}))
		IK_READS.forEach(([field, read, exact], vi) =>
			add(
				`ik ${name}.${field}`,
				keys,
				field,
				vi,
				(sk) => read(sk.ikConstraints.find((c) => c.data.name === name)),
				exact,
			),
		);
	for (const [name, keys] of Object.entries(a.transform || {}))
		RUNTIME_FIELDS.transform.forEach((field, vi) =>
			add(
				`transform ${name}.${field}`,
				keys,
				field,
				vi,
				(sk) => sk.transformConstraints.find((c) => c.data.name === name)[field],
			),
		);
	for (const [name, chans] of Object.entries(a.path || {})) {
		const pc = (sk) => sk.pathConstraints.find((c) => c.data.name === name);
		add(`path ${name}.position`, chans.position, 'value', 0, (sk) => pc(sk).position);
		add(`path ${name}.spacing`, chans.spacing, 'value', 0, (sk) => pc(sk).spacing);
		RUNTIME_FIELDS.path.mix.forEach((field, vi) =>
			add(`path ${name}.${field}`, chans.mix, field, vi, (sk) => pc(sk)[field]),
		);
	}
	for (const [name, chans] of Object.entries(a.physics || {}))
		for (const ch of Object.keys(RUNTIME_FIELDS.physics))
			add(`physics ${name}.${ch}`, chans[ch], 'value', 0, (sk) =>
				PHYS_READ(ch)(sk.physicsConstraints.find((c) => c.data.name === name)),
			);
	return out;
}

// Pose `posed`'s clips with the shipped poser over a skeleton of the FILE's data, and the file's
// clips with the runtime; return every quantity that disagrees, worst first. What is read, when,
// and each tolerance come from `filled`, so a run on an unfilled document is held to the same bar.
function compare(file, filled, animNames, posed = filled) {
	const data = loadData(file);
	const runtime = new Skeleton(data);
	const rigger = new Skeleton(data);
	Object.assign(sandbox, { rawDoc: posed, skeleton: rigger, skeletonData: data });
	const misses = [];
	let checked = 0;
	for (const name of animNames) {
		const anim = data.findAnimation(name);
		const qs = quantities(filled, name);
		// Every key time (where an end key is read as is) plus an even spread between them.
		const times = new Set(Array.from({ length: 21 }, (_, i) => (anim.duration * i) / 20));
		const walk = (node) => {
			if (!node || typeof node !== 'object') return;
			if (typeof node.time === 'number') times.add(node.time);
			for (const v of Object.values(node)) walk(v);
		};
		walk(filled.animations[name]);
		const worst = new Map();
		for (const t of [...times].filter((x) => x <= anim.duration).sort((x, y) => x - y)) {
			// The runtime stores key times in single precision, so at a key's exact instant it can
			// still be on the segment before it; 10 µs later it is on the key, as the Rigger is.
			runtime.setToSetupPose();
			anim.apply(
				runtime,
				0,
				Math.min(t + 1e-5, anim.duration),
				false,
				null,
				1,
				MixBlend.setup,
				MixDirection.mixIn,
			);
			rigger.setToSetupPose();
			poseAtTime(name, t);
			for (const q of qs) {
				if (t < q.first && !q.before) continue;
				checked++;
				const want = q.read(runtime);
				const got = q.read(rigger);
				const d = Math.abs(got - want);
				const tol = 0.02 * q.span + 1e-4;
				// A reading that is not a number (an unfilled key) is the worst miss of all.
				const over = Number.isFinite(d) ? d / tol : Infinity;
				if (!(d <= tol) && !(worst.get(q.label)?.over >= over))
					worst.set(q.label, { anim: name, label: q.label, t, got, want, over });
			}
		}
		misses.push(...worst.values());
	}
	return { misses: misses.sort((a, b) => b.over - a.over), checked };
}
const num = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
const show = (m) =>
	`${m.anim} / ${m.label} @${m.t.toFixed(3)}s: Rigger ${num(m.got)}, engine-rig ${num(m.want)}`;

// ---- run ------------------------------------------------------------------------------------
const file = JSON.parse(readFileSync(jsonPath, 'utf8'));

// The rig itself.
const filledRig = sameMeaning('rig', file);
const names = Object.keys(file.animations || {});
{
	const { misses, checked } = compare(file, filledRig, names);
	log(
		misses.length === 0,
		`rig: ${names.length} clip(s) posed as engine-rig plays them (${checked} readings, ${misses.length} miss)`,
	);
	for (const m of misses.slice(0, 8)) console.log('       ' + show(m));
	const timesOnly = clone(file);
	normalizeKeyTimes(timesOnly);
	const old = compare(file, filledRig, names, timesOnly).misses;
	console.log(`  ·  without fillKeyDefaults the rig misses on ${old.length} channel(s), worst:`);
	for (const m of old.slice(0, 3)) console.log('       ' + show(m));
	const glow = old.find((m) => m.anim === 'anticipation1_intro' && m.label === 'bone glow scale.y');
	if (glow) console.log(`  ·  the reported case: ${show(glow)}`);
}

// The fixture: constraints whose setup differs from every format default, and keys that leave
// each defaulted field out. It needs a two-bone chain and four more bones; a rig too small for it
// skips (3)–(5), which the rig check:all runs (anticipation) never does.
function buildFixture() {
	const byName = Object.fromEntries(file.bones.map((b) => [b.name, b]));
	const tip = file.bones.find((b) => b.parent && byName[b.parent]?.parent);
	if (!tip) return null;
	const taken = [tip.parent, tip.name];
	const spare = () => {
		const b = file.bones.find((x) => x.parent && !taken.includes(x.name));
		if (b) taken.push(b.name);
		return b?.name;
	};
	const [target, tcBone, physBone, splitBone] = [spare(), spare(), spare(), spare()];
	if (!splitBone) return null;
	const order = ['ik', 'transform', 'path', 'physics'].reduce(
		(n, g) => n + (file[g] || []).length,
		0,
	);
	const doc = clone(file);
	doc.ik = [
		...(file.ik || []),
		{
			name: 'kdIk',
			order,
			bones: [tip.parent, tip.name],
			target,
			mix: 0.5,
			softness: 12,
			bendPositive: false,
			compress: true,
			stretch: true,
		},
	];
	doc.transform = [
		...(file.transform || []),
		{
			name: 'kdTc',
			order: order + 1,
			bones: [tcBone],
			target,
			mixRotate: 0.3,
			mixX: 0.4,
			mixY: 0.6,
			mixScaleX: 0.2,
			mixScaleY: 0.7,
			mixShearY: 0.5,
		},
	];
	doc.physics = [
		...(file.physics || []),
		{
			name: 'kdPhys',
			order: order + 2,
			bone: physBone,
			x: 1,
			rotate: 1,
			inertia: 0.5,
			strength: 80,
			damping: 0.9,
			mass: 2,
			wind: 3,
			gravity: 4,
			mix: 0.8,
		},
	];
	const pathName = (doc.path || [])[0]?.name;
	if (pathName) Object.assign(doc.path[0], { position: 15, spacing: 25 });
	const slot = (file.slots || [])[0]?.name;
	const kd = {
		bones: {
			[tip.name]: {
				rotate: [{ time: 0.1 }, { time: 1, value: 45 }],
				translate: [{ x: 10 }, { time: 1, y: -20 }],
				scale: [{ x: 0.6 }, { time: 0.6667 }],
				shear: [{ y: 15 }, { time: 1 }],
			},
			[splitBone]: {
				translatex: [{ time: 0.2 }, { time: 1, value: 5 }],
				translatey: [{ value: 3 }, { time: 1 }],
				scalex: [{ time: 0 }, { time: 1, value: 2 }],
				scaley: [{ value: 0.5 }, { time: 1 }],
				shearx: [{ time: 0 }, { time: 1, value: 10 }],
				sheary: [{ value: 4 }, { time: 1 }],
			},
		},
		ik: {
			kdIk: [
				{ time: 0.15, mix: 0.2 },
				{ time: 0.4 },
				{ time: 0.8, mix: 0.6, softness: 30, bendPositive: false, compress: true },
			],
		},
		transform: {
			kdTc: [
				{ time: 0.1, mixX: 0.5, mixScaleX: 0.25 },
				{ time: 0.5, mixRotate: 0.2 },
				{ time: 1, mixY: 0.1, mixScaleY: 0.9, mixShearY: 0 },
			],
		},
		physics: {
			kdPhys: {
				inertia: [{ time: 0.3 }, { time: 1, value: 0.9 }],
				strength: [{ time: 0.1, value: 50 }, { time: 1 }],
				damping: [{ time: 0 }, { time: 1, value: 0.5 }],
				mass: [{ value: 1 }, { time: 1, value: 3 }],
				wind: [{ time: 0 }, { time: 1, value: 10 }],
				gravity: [{ time: 0.2, value: 6 }, { time: 0.5 }],
				mix: [{ time: 0.25 }, { time: 0.75, value: 1 }],
			},
		},
	};
	if (slot) kd.slots = { [slot]: { alpha: [{ time: 0 }, { time: 1, value: 0.5 }] } };
	if (pathName)
		kd.path = {
			[pathName]: {
				position: [{ time: 0.2 }, { time: 0.9, value: 40 }],
				spacing: [{ time: 0.05, value: 5 }, { time: 1 }],
				mix: [{ time: 0.1, mixX: 0.3 }, { time: 0.5, mixRotate: 0.4, mixX: 0.8 }, { time: 1 }],
			},
		};
	doc.animations = { ...(file.animations || {}), kdFixture: kd };
	console.log(
		`  ·  fixture: IK [${tip.parent},${tip.name}] → ${target}, transform ${tcBone}, physics ${physBone}, split channels ${splitBone}` +
			(pathName ? `, path ${pathName}` : ' (the rig has no path constraint)'),
	);
	return { doc, kd, tip: tip.name, pathName, slot };
}

const fx = buildFixture();
if (!fx)
	console.log(
		'  ·  fixture skipped: the rig has no two-bone chain plus four more bones to hang it on',
	);
else {
	const { doc: fixture, kd, tip, pathName, slot } = fx;
	// Every defaulted field of every group is left out by at least one fixture key.
	const left = [];
	const each = (group, keysOf) => {
		const defs = RUNTIME_FIELDS[group];
		for (const [ch, fields] of Array.isArray(defs) ? [[null, defs]] : Object.entries(defs))
			for (const field of fields)
				if (!keysOf(ch).some((k) => k[field] === undefined))
					left.push(`${group}${ch ? '.' + ch : ''}.${field}`);
	};
	each('bones', (ch) => Object.values(kd.bones).flatMap((c) => c[ch] || []));
	each('ik', () => kd.ik.kdIk);
	each('transform', () => kd.transform.kdTc);
	each('physics', (ch) => kd.physics.kdPhys[ch]);
	if (slot) each('slots', (ch) => kd.slots[slot][ch]);
	if (pathName) each('path', (ch) => kd.path[pathName][ch]);
	const unleft = left.filter((f) => f !== 'physics.mass.value'); // degenerate, see the header
	log(
		unleft.length === 0,
		`fixture: leaves out every defaulted field but mass` +
			(unleft.length ? ` — not: ${unleft.join(', ')}` : ''),
	);

	const filledFixture = sameMeaning('fixture', fixture);
	const { misses, checked } = compare(fixture, filledFixture, ['kdFixture']);
	log(
		misses.length === 0,
		`fixture: posed as engine-rig plays it (${checked} readings, ${misses.length} miss)`,
	);
	for (const m of misses) console.log('       ' + show(m));
	// Unfilled, every field whose default is not 0, or that fell back to the setup's value, misses.
	// (A bone channel's omitted 0 was always read right.)
	const timesOnly = clone(fixture);
	normalizeKeyTimes(timesOnly);
	const old = new Set(
		compare(fixture, filledFixture, ['kdFixture'], timesOnly).misses.map((m) => m.label),
	);
	const expected = [
		`bone ${tip} scale.x`,
		`bone ${tip} scale.y`,
		...['mix', 'softness', 'bendPositive'].map((f) => `ik kdIk.${f}`),
		...RUNTIME_FIELDS.transform.map((f) => `transform kdTc.${f}`),
		...Object.keys(RUNTIME_FIELDS.physics)
			.filter((ch) => ch !== 'mass')
			.map((ch) => `physics kdPhys.${ch}`),
		...(pathName
			? ['position', 'spacing', ...RUNTIME_FIELDS.path.mix].map((f) => `path ${pathName}.${f}`)
			: []),
	];
	const uncaught = expected.filter((l) => !old.has(l));
	log(
		uncaught.length === 0,
		`fixture: without fillKeyDefaults all ${expected.length} of those fields read wrong — the gate catches the old reading` +
			(uncaught.length ? ` (but not: ${uncaught.join(', ')})` : ''),
	);

	// ---- 4. WRITER: ◆ Key IK ----------------------------------------------------------------
	const keyed = clone(filledFixture);
	keyed.animations.kdFixture.ik.kdIk = [
		{ time: 0, mix: 0.1, softness: 0, bendPositive: true, compress: false, stretch: false },
	];
	Object.assign(sandbox, { rawDoc: keyed, curAnim: 'kdFixture', animTime: 0.6 });
	keyIk('kdIk');
	const k = keyed.animations.kdFixture.ik.kdIk.find((x) => Math.abs(x.time - 0.6) < 1e-6);
	const fields = RUNTIME_FIELDS.ik;
	log(
		!!k && fields.every((f) => k[f] !== undefined),
		`◆ Key IK writes ${fields.join(', ')} (${k ? JSON.stringify(k) : 'no key'})`,
	);
	const after = compare(keyed, keyed, ['kdFixture']).misses;
	log(
		after.length === 0,
		`◆ Key IK: the clip it leaves poses as engine-rig plays it (${after.length} miss)`,
	);
	for (const m of after) console.log('       ' + show(m));
}

console.log(pass ? '\n✅ PASS — every omitted default reads as the runtime plays it.' : '\n✗ FAIL');
process.exit(pass ? 0 : 1);
