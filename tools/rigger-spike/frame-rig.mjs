// Frame to rig, phase F2b — the F2 gate (docs/design/frame-to-rig.md §10): a cut becomes a rig that
// redraws its frame. Headless, on the SHIPPED code: the fit and the frame's placements
// (apps/launcher-api/src/lib/server/rigFrameFit.ts, as `/api/rigger/from-frame/sheet` runs them),
// `templateRig` with the fit, the `.atlas` ＋ New rig writes (`regionsToRigAtlas`), the store's pose
// check, and engine-rig's loader posing the rig as a game does. The frame is atlas-tool's committed
// fixture (services/atlas-tool/fixtures/rig_from_frame/: a half-body character drawn for the gate,
// so no licence question), cut by the F1 job with its props (`parts/cut.json`, `parts/labels.png`).
// Asserted:
//  - request: the parts request the launcher sends atlas-tool for that cut (the scale, origin, each
//    part's and prop's frame-pose matrix, the draw order) is `parts/request.json`, the one the
//    committed sheet was made from — so the sheet below is this code's;
//  - joints: the rig made from the sheet, posed by its `frame` clip, puts both shoulders, elbows and
//    wrists and the eyes' middle within 0.5 px of the cut's joints;
//  - redraw: that rig drawn from the sheet's pixels covers the frame's character at alpha IoU ≥ 0.99
//    (and its colours within 6/255 on average): every part is turned to rest on its bone and comes
//    back where the frame has it;
//  - finite: the fitted template with the cut's props passes the store's pose check (every control at
//    min / rest / max and every starter clip at its start, middle and end pose finite, every part and
//    only the needed ones) and the made rig passes the `.irig` save check; the parts it lacks are the
//    face block's and the hand poses, never a cut part;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/frame-rig.mjs [--only <guard>] [--png <dir>] [--write]
//   (--write: make parts/request.json from the cut; then `py test_rig_frame_parts.py --write` in
//   services/atlas-tool makes the sheet from it. --png: the rig drawn over the frame.)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const SERVER = join(APP, 'src/lib/server');
const FIX = join(ROOT, 'services/atlas-tool/fixtures/rig_from_frame');
const PARTS = join(FIX, 'parts');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const sharp = createRequire(join(APP, 'package.json'))('sharp');

const dir = mkdtempSync(join(tmpdir(), 'frame-rig-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let bundles = 0;
const SHIPPED = /(rigFrameFit|rigTemplates|rigTemplateFit|rig)\.ts$/;
/** The shipped server modules, with `mutate` ([file, from, to]) swapped into their source first. */
async function load(mutate = []) {
	const out = join(dir, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './rigFrameFit.ts';",
				"export * from './rigTemplates.ts';",
				"export * from './rigTemplateFit.ts';",
				"export { rigTemplateSaveProblem } from './rigTemplateCheck.ts';",
				"export { irigDocProblem } from './riggerIrig.ts';",
				"export { regionsToRigAtlas } from './rig.ts';",
			].join('\n'),
			resolveDir: SERVER,
			loader: 'ts',
			sourcefile: 'frame-rig-entry.ts',
		},
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'silent',
		plugins: [
			{
				name: 'stubs-and-mutants',
				setup(build) {
					build.onResolve({ filter: /^\$env\/dynamic\/private$/ }, () => ({
						path: 'env',
						namespace: 'stub',
					}));
					build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
						contents: 'export const env = {};',
						loader: 'js',
					}));
					// `rig.ts` reaches R2, sharp and the page store; `regionsToRigAtlas` reads none of them.
					build.onResolve({ filter: /.*/ }, (args) =>
						/[\\/]rig\.ts$/.test(args.importer) && !args.path.startsWith('engine-')
							? { path: args.path, namespace: 'rig-deps' }
							: undefined,
					);
					build.onLoad({ filter: /.*/, namespace: 'rig-deps' }, () => ({
						contents: 'module.exports = {};',
						loader: 'js',
					}));
					build.onLoad({ filter: SHIPPED }, (args) => {
						let text = readFileSync(args.path, 'utf8');
						for (const [file, from, to] of mutate) {
							if (!args.path.replaceAll('\\', '/').endsWith(`/${file}`)) continue;
							if (!text.includes(from)) throw new Error(`mutant: "${from}" is not in ${file}`);
							text = text.replace(from, to);
						}
						return { contents: text, loader: 'ts' };
					});
				},
			},
		],
	});
	return import(pathToFileURL(out).href);
}

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return true;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
	return false;
};

// ---- the fixture ---------------------------------------------------------------------------------
async function rgbaOf(path) {
	const { data, info } = await sharp(path)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, w: info.width, h: info.height };
}
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const FRAME = await rgbaOf(join(FIX, 'frame.png'));
const TRACK = read(join(FIX, 'track.json'));
const CUT = read(join(PARTS, 'cut.json'));
const WRITE = process.argv.includes('--write');
const REQUEST = WRITE ? null : read(join(PARTS, 'request.json'));
const SHEET = WRITE ? null : read(join(PARTS, 'sheet.json'));
const PAGE = WRITE ? null : await rgbaOf(join(PARTS, 'sheet.png'));
/** What `rig_frame_parts.py` is sent for the fixture: the launcher's request with a job and a sheet. */
const payloadOf = (r) => ({
	job: CUT.job,
	sheet: 'Fixture_parts',
	scale: r.scale,
	origin: r.origin,
	parts: r.parts,
	order: r.order,
	fill: 'cpu',
	fit: r.fit,
});

function sameNumbers(a, b, path = '') {
	if (typeof a === 'number' && typeof b === 'number')
		return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) ? null : `${path}: ${a} ≠ ${b}`;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length}`;
		for (let i = 0; i < a.length; i++) {
			const d = sameNumbers(a[i], b[i], `${path}[${i}]`);
			if (d) return d;
		}
		return null;
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		for (const k of keys) {
			const d = sameNumbers(a[k], b[k], `${path}.${k}`);
			if (d) return d;
		}
		return null;
	}
	return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

// ---- the rig, made and posed as ＋ New rig and a game do ---------------------------------------------
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function made(M, request) {
	const regions = SHEET.regions.map((r) => ({ ...r }));
	const atlasText = M.regionsToRigAtlas('sheet.png', SHEET.width, SHEET.height, regions);
	const rigged = M.templateRig(M.HALF_BODY, regions, request.fit);
	const atlas = new RIG.TextureAtlas(atlasText);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(rigged.skeleton)),
	);
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
	state.setAnimation(0, 'frame', false);
	state.update(0);
	state.apply(skel);
	skel.updateWorldTransform(RIG.Physics.update);
	return { rigged, skel, atlasText };
}
/** The rig's world (rig units, y up) to the frame's pixels. */
const toFrame = (r, x, y) => [x / r.scale + r.origin[0], -y / r.scale + r.origin[1]];

/** How far the rig made for `track`, posed by its `frame` clip, puts each joint from the track's. */
function jointErrors(M, track) {
	const got = M.framePartsRequest(M.HALF_BODY, CUT, track);
	if (!got.ok) return { px: { fit: Infinity }, eyeLineDeg: Infinity };
	const r = got.value;
	const rig = made(M, r);
	const j = M.frameJoints(track, CUT.size[0], CUT.size[1]).value;
	const bone = (n) => {
		const b = rig.skel.findBone(n);
		return toFrame(r, b.worldX, b.worldY);
	};
	const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	const eyeOf = (a, b) => [(j.face[a][0] + j.face[b][0]) / 2, (j.face[a][1] + j.face[b][1]) / 2];
	const err = {};
	for (const s of ['l', 'r']) {
		err[`shoulder_${s}`] = d(bone(`upper_arm_${s}`), j.shoulder[s]);
		err[`elbow_${s}`] = d(bone(`lower_arm_${s}`), j.elbow[s]);
		err[`wrist_${s}`] = d(bone(`hand_${s}`), M.wristOf(j, s));
	}
	const eyes = [
		(bone('eye_l')[0] + bone('eye_r')[0]) / 2,
		(bone('eye_l')[1] + bone('eye_r')[1]) / 2,
	];
	const el = eyeOf(33, 133);
	const er = eyeOf(263, 362);
	err.eyes_middle = d(eyes, [(el[0] + er[0]) / 2, (el[1] + er[1]) / 2]);
	// The face block keeps its own eye spacing, so each eye is off; the eyes' line is the head's turn.
	const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
	const turn = ang(bone('eye_l'), bone('eye_r')) - ang(el, er);
	return {
		px: err,
		eyeLineDeg: Math.abs((Math.atan2(Math.sin(turn), Math.cos(turn)) * 180) / Math.PI),
	};
}

/** The track turned `deg` about the frame's middle and scaled by `k` (its normalised points). */
function turnTrack(track, deg, k) {
	const [w, h] = CUT.size;
	const c = Math.cos((deg * Math.PI) / 180);
	const s = Math.sin((deg * Math.PI) / 180);
	const move = (p) => {
		if (!p) return p;
		const x = (p[0] - 0.5) * w;
		const y = (p[1] - 0.5) * h;
		return [(k * (x * c - y * s)) / w + 0.5, (k * (x * s + y * c)) / h + 0.5, ...p.slice(2)];
	};
	return {
		...track,
		pose: { ...track.pose, landmarks: track.pose.landmarks.map(move) },
		hands: track.hands.map((hd) => ({ ...hd, landmarks: hd.landmarks.map(move) })),
		face: { ...track.face, landmarks: track.face.landmarks.map(move) },
	};
}

/** The rig drawn over the frame's pixels from the sheet: alpha and colour, premultiplied, in order. */
function draw(rig, r) {
	const { w, h } = FRAME;
	const A = new Float32Array(w * h);
	const C = new Float32Array(w * h * 3);
	const v = new Float32Array(8);
	const sample = (x, y, c) => {
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		let acc = 0;
		for (const [dx, dy] of [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		]) {
			const px = x0 + dx;
			const py = y0 + dy;
			if (px < 0 || py < 0 || px >= PAGE.w || py >= PAGE.h) continue;
			const wgt = (dx ? x - x0 : 1 - (x - x0)) * (dy ? y - y0 : 1 - (y - y0));
			const i = (py * PAGE.w + px) * 4;
			acc += wgt * (c === 3 ? PAGE.data[i + 3] : (PAGE.data[i + c] * PAGE.data[i + 3]) / 255);
		}
		return acc / 255;
	};
	for (const slot of rig.skel.drawOrder) {
		const att = slot.getAttachment();
		if (!(att instanceof RIG.RegionAttachment)) continue;
		att.computeWorldVertices(slot, v, 0, 2);
		const [bl, tl, , br] = [0, 2, 4, 6].map((i) => toFrame(r, v[i], v[i + 1]));
		const e1 = [br[0] - bl[0], br[1] - bl[1]];
		const e2 = [tl[0] - bl[0], tl[1] - bl[1]];
		const det = e1[0] * e2[1] - e1[1] * e2[0];
		const reg = att.region;
		const [pu, pv, pu2, pv2] = [reg.u * PAGE.w, reg.v * PAGE.h, reg.u2 * PAGE.w, reg.v2 * PAGE.h];
		const xs = [bl[0], tl[0], br[0], tl[0] + e1[0]];
		const ys = [bl[1], tl[1], br[1], tl[1] + e1[1]];
		for (
			let py = Math.max(0, Math.floor(Math.min(...ys)));
			py < Math.min(h, Math.ceil(Math.max(...ys)));
			py++
		)
			for (
				let px = Math.max(0, Math.floor(Math.min(...xs)));
				px < Math.min(w, Math.ceil(Math.max(...xs)));
				px++
			) {
				const qx = px + 0.5 - bl[0];
				const qy = py + 0.5 - bl[1];
				const s = (qx * e2[1] - qy * e2[0]) / det;
				const t = (e1[0] * qy - e1[1] * qx) / det;
				if (s < 0 || s > 1 || t < 0 || t > 1) continue;
				const sx = pu + s * (pu2 - pu) - 0.5;
				const sy = pv2 + t * (pv - pv2) - 0.5;
				const a = sample(sx, sy, 3);
				if (a <= 0) continue;
				const i = py * w + px;
				for (let c = 0; c < 3; c++) C[i * 3 + c] = sample(sx, sy, c) * 255 + C[i * 3 + c] * (1 - a);
				A[i] = a + A[i] * (1 - a);
			}
	}
	return { A, C };
}

function measure(drawn) {
	const { w, h, data } = FRAME;
	let inter = 0;
	let union = 0;
	let err = 0;
	let both = 0;
	for (let i = 0; i < w * h; i++) {
		const f = data[i * 4 + 3] > 127;
		const g = drawn.A[i] > 0.5;
		if (f && g) {
			inter++;
			both++;
			for (let c = 0; c < 3; c++)
				err += Math.abs(drawn.C[i * 3 + c] / drawn.A[i] - data[i * 4 + c]) / 3;
		}
		if (f || g) union++;
	}
	return { iou: inter / union, colour: err / Math.max(1, both) };
}

// ---- guards: each returns true when it holds ------------------------------------------------------
const GUARDS = {
	request(M, log) {
		const got = M.framePartsRequest(M.HALF_BODY, CUT, TRACK);
		if (!ok('the cut fits the template', got.ok, got.problem)) return false;
		const r = got.value;
		log(
			`scale ${r.scale.toFixed(4)} rig units/px, origin (${r.origin.map((v) => v.toFixed(1))}), ${r.parts.length} images`,
		);
		const want = payloadOf(r);
		const diff = sameNumbers(want, REQUEST);
		const taken = CUT.props.filter((p) => p.take !== false).map((p) => p.name);
		const off = {
			...CUT,
			props: CUT.props.map((p) => (p.name === 'prop_chain' ? { ...p, take: false } : p)),
		};
		const without = M.framePartsRequest(M.HALF_BODY, off, TRACK).value;
		return (
			ok(
				'the parts request is the one the committed sheet was made from',
				!diff,
				`${diff} (node frame-rig.mjs --write, then py test_rig_frame_parts.py --write)`,
			) &
			ok(
				'every cut part and taken prop is placed, the props as slots of the fit',
				r.parts.length === CUT.names.length &&
					taken.every((n) => r.fit.props?.some((p) => p.name === n)),
			) &
			ok(
				'a prop left ✗ is neither placed nor a slot (its host draws it)',
				!without.parts.some((p) => p.name === 'prop_chain') &&
					!without.fit.props.some((p) => p.name === 'prop_chain') &&
					without.parts.length === r.parts.length - 1,
			)
		);
	},
	joints(M, log) {
		const level = jointErrors(M, TRACK);
		// The fixture stands level: the same frame turned 14° and drawn at 0.8 its size turns the
		// chest, the head and every limb against the template.
		const turned = jointErrors(M, turnTrack(TRACK, 14, 0.8));
		const worst = (e) => Math.max(...Object.values(e.px));
		log(
			`joints off by ${Object.entries(level.px)
				.map(([k, v]) => `${k} ${v.toFixed(4)}`)
				.join(', ')}; the eyes' line ${level.eyeLineDeg.toFixed(4)}°`,
		);
		log(
			`turned 14° at 0.8: worst ${worst(turned).toFixed(4)} px, the eyes' line ${turned.eyeLineDeg.toFixed(4)}°`,
		);
		return (
			ok(
				"every joint and the eyes' middle within 0.5 px of the cut's",
				worst(level) <= 0.5,
				`worst ${worst(level).toFixed(3)} px`,
			) &
			ok('… and on the frame turned and scaled', worst(turned) <= 0.5, JSON.stringify(turned.px)) &
			ok(
				"the head turned to the eyes' line (within 0.05°)",
				Math.max(level.eyeLineDeg, turned.eyeLineDeg) <= 0.05,
				`${turned.eyeLineDeg}°`,
			)
		);
	},
	redraw(M, log) {
		const r = M.framePartsRequest(M.HALF_BODY, CUT, TRACK).value;
		const rig = made(M, r);
		const m = measure(draw(rig, r));
		log(
			`the rig in the frame's pose over the frame: alpha IoU ${m.iou.toFixed(4)}, colour off ${m.colour.toFixed(2)}/255`,
		);
		if (PNG) writePng(rig, r);
		return (
			ok('the rig redraws the frame (alpha IoU ≥ 0.99)', m.iou >= 0.99, `IoU ${m.iou.toFixed(4)}`) &
			ok('in its colours (≤ 6/255 on average)', m.colour <= 6, `${m.colour.toFixed(2)}`)
		);
	},
	finite(M, log) {
		const r = M.framePartsRequest(M.HALF_BODY, CUT, TRACK).value;
		const fitted = M.fitTemplate(M.HALF_BODY, r.fit);
		const problem = M.rigTemplateSaveProblem(fitted);
		const rig = made(M, r);
		const saved = M.irigDocProblem(rig.rigged.skeleton);
		const cutParts = CUT.names;
		const lacks = rig.rigged.missingRequired;
		log(
			`${fitted.channels.length} controls and ${fitted.clips.length} clips posed; missing ${rig.rigged.missing.length} parts (${lacks.length} needed: ${lacks.join(', ')})`,
		);
		return (
			ok(
				'every control at min / rest / max and every clip poses finite on the fitted template',
				problem === null,
				problem,
			) &
			ok('the made rig passes the save check', saved === null, saved) &
			ok(
				'no cut part is reported missing',
				!rig.rigged.missing.some((n) => cutParts.includes(n)),
				rig.rigged.missing.join(', '),
			)
		);
	},
};

let PNG = null;
function writePng(rig, r) {
	const { w, h, data } = FRAME;
	const d = draw(rig, r);
	const out = Buffer.alloc(w * 2 * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			const grey = 60;
			const fa = data[i * 4 + 3] / 255;
			for (let c = 0; c < 3; c++) {
				out[(y * w * 2 + x) * 4 + c] = data[i * 4 + c] * fa + grey * (1 - fa);
				out[(y * w * 2 + w + x) * 4 + c] = d.C[i * 3 + c] + grey * (1 - d.A[i]);
			}
			out[(y * w * 2 + x) * 4 + 3] = 255;
			out[(y * w * 2 + w + x) * 4 + 3] = 255;
		}
	sharp(out, { raw: { width: w * 2, height: h, channels: 4 } })
		.png()
		.toFile(join(PNG, 'frame-rig.png'));
}

const M = await load();
if (WRITE) {
	const got = M.framePartsRequest(M.HALF_BODY, CUT, TRACK);
	if (!got.ok) throw new Error(got.problem);
	writeFileSync(join(PARTS, 'request.json'), `${JSON.stringify(payloadOf(got.value), null, 1)}\n`);
	console.log(
		`wrote ${join(PARTS, 'request.json')}; now: py test_rig_frame_parts.py --write (services/atlas-tool)`,
	);
	process.exit(0);
}
if (process.argv.includes('--png')) PNG = process.argv[process.argv.indexOf('--png') + 1];
const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
for (const [id, guard] of Object.entries(GUARDS)) {
	if (ONLY && id !== ONLY) continue;
	console.log(`\n=== ${id}`);
	guard(M, (line) => console.log(`    ${line}`));
}
if (ONLY) {
	console.log(
		`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks (${ONLY} only)`,
	);
	process.exit(fails === 0 ? 0 : 1);
}

console.log('\n=== mutants of the shipped code: each must turn its check red');
const FF = 'rigFrameFit.ts';
const FIT = 'rigTemplateFit.ts';
const MUTANTS = [
	[
		'joints',
		'the scale off by 2%',
		[
			FF,
			'const k = len(shoulders) / len(framed);',
			'const k = (len(shoulders) / len(framed)) * 0.98;',
		],
	],
	[
		'joints',
		"the picture's y not flipped",
		[FF, '-k * (p[1] - origin[1])', 'k * (p[1] - origin[1])'],
	],
	[
		'joints',
		'a key not relative to its parent',
		[FF, '- deg([child.x, child.y]) - pw);', '- deg([child.x, child.y]));'],
	],
	[
		'joints',
		'the forearms keep the template length',
		[
			FF,
			"const LENGTHS = ['chest', 'head', ...SIDES.flatMap((s) => [`lower_arm_${s}`, `hand_${s}`])];",
			"const LENGTHS = ['chest', 'head'];",
		],
	],
	[
		'redraw',
		'the hand turned to its wrist, not its knuckle',
		[FF, 'const KNUCKLE = 9;', 'const KNUCKLE = 5;'],
	],
	[
		'joints',
		'the chest off the shoulder line',
		[FF, 'const tc = deg(sub(S.r, S.l)) - deg(shoulders);', 'const tc = 0;'],
	],
	[
		'joints',
		"the head off the eyes' line",
		[
			FF,
			"const tau = deg(sub(eye('r'), eye('l'))) - deg(sub(w0('eye_r'), w0('eye_l')));",
			'const tau = 0;',
		],
	],
	[
		'redraw',
		'the head placed on the eyes',
		[
			FF,
			"const Hd = sub(mid(eye('l'), eye('r')), rot(tau, sub(mid(w0('eye_l'), w0('eye_r')), w0('head'))));",
			"const Hd = mid(eye('l'), eye('r'));",
		],
	],
	[
		'redraw',
		'the region bounds read transposed',
		[
			'rig.ts',
			'out.push(`bounds:${Math.round(r.x)},${Math.round(r.y)},${w},${h}`);',
			'out.push(`bounds:${Math.round(r.x)},${Math.round(r.y)},${h},${w}`);',
		],
	],
	[
		'request',
		'the placements read off the wrong corner',
		[
			FF,
			'const u: P = [(v[6] - v[0]) / PLACEHOLDER, (v[7] - v[1]) / PLACEHOLDER];',
			'const u: P = [(v[4] - v[2]) / PLACEHOLDER, (v[5] - v[1]) / PLACEHOLDER];',
		],
	],
	[
		'request',
		'the draw order front to back',
		[
			FF,
			'(a, b) => (slotOf.get(partSlot.get(a)!) ?? 0) - (slotOf.get(partSlot.get(b)!) ?? 0),',
			'(a, b) => (slotOf.get(partSlot.get(b)!) ?? 0) - (slotOf.get(partSlot.get(a)!) ?? 0),',
		],
	],
	[
		'request',
		'a ✗ prop placed anyway',
		[
			FF,
			'const props = (cut.props ?? []).filter((p) => p.take !== false);',
			'const props = cut.props ?? [];',
		],
	],
	[
		'finite',
		'a fitted shortening runs away',
		[FIT, '? { ...d, per: d.per * ratio.get(d.bone)! }', '? { ...d, per: d.per * Infinity }'],
	],
];
for (const [guard, what, mutation] of MUTANTS) {
	const before = fails;
	const mutant = await load([mutation]);
	const quiet = console.error;
	console.error = () => {};
	let red;
	try {
		red = !GUARDS[guard](mutant, () => {}) || fails > before;
	} catch {
		red = true;
	} finally {
		console.error = quiet;
	}
	fails = before;
	ok(`mutant caught by "${guard}": ${what}`, red);
	console.log(`    ${red ? 'red  ' : 'GREEN'} ${guard}: ${what}`);
}

console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
process.exit(fails === 0 ? 0 : 1);
