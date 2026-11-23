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
//  - fingers: each finger bone sits on its tracked joint in the frame's pose, the hand is one mesh
//    weighted to its fingers, and a fist, a spread, the thumb in and out pose it finite with no crack
//    and no fold, each fingertip drawn folding toward its knuckle;
//  - props: each taken prop hangs from a bone of its own at its pivot, a child of the bone its host
//    is drawn on (the glasses and earring on `head_image`, the watch on its forearm's image), a ✗ one
//    has none; ⤢ Fit to a capture still stretches an image bone that carries a prop;
//  - sources: a part taken from another frame (per-part frames) is placed by that frame's fit and an
//    arm segment takes its length there, while the rig still poses as this frame;
//  - stretch: ⤢ Fit stretches a limb's art at most ×1.5 (and says so), and the create report names an
//    arm segment the frame draws foreshortened;
//  - head: the head turns on the drawn neck's top, each part's drawn joint stays on its bone at setup,
//    in the frame and through a 3D import onto `frame`, which draws the head as onto a new clip;
//  - skin: every part a mesh skinned across its joints, bound in the frame's pose (drawn as cut),
//    crack-free and finite under a shrug, a raised arm, bent elbows and a head turn, the torso's
//    shoulder line and armpit pulled by the shoulder and the arm;
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
const SHIPPED = /(rigFrameFit|rigTemplates|rigTemplateFit|rigCaptureFit|rig)\.ts$/;
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
				"export { refitIrig, MAX_ART_STRETCH } from '../rigCaptureFit.ts';",
				"export { authoringOf, importClip3d } from '../rig3dImport.ts';",
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
const LABELS = await sharp(join(PARTS, 'labels.png'))
	.extractChannel(0)
	.raw()
	.toBuffer({ resolveWithObject: true });
/** The parts request the route sends for `cut`: its taken props at their pivots on the label map. */
const requestOf = (M, cut = CUT, track = TRACK, sources = {}) =>
	M.framePartsRequest(
		M.HALF_BODY,
		cut,
		track,
		M.propPivots(new Uint8Array(LABELS.data), LABELS.info.width, cut),
		sources,
	);
/** The fixture's track with its left elbow (pose 14) brought `by` of the way to its shoulder: the
 *  left upper arm drawn short, as a frame pointing it at the camera draws it. */
function shortArm(track, by) {
	const out = structuredClone(track);
	const [s, e] = [out.pose.landmarks[12], out.pose.landmarks[14]];
	out.pose.landmarks[14] = [e[0] + (s[0] - e[0]) * by, e[1] + (s[1] - e[1]) * by, ...e.slice(2)];
	return out;
}
const OTHER = 'f2r-fixture-0002';
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
	const got = requestOf(M, CUT, track);
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
		if (att instanceof RIG.MeshAttachment) {
			drawMesh(slot, att, r, sample, A, C, w, h);
			continue;
		}
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

/** A mesh drawn into the frame's pixels as `draw` draws a region: each triangle by its uvs. */
function drawMesh(slot, att, r, sample, A, C, w, h) {
	const n = att.worldVerticesLength;
	const v = new Float32Array(n);
	att.computeWorldVertices(slot, 0, n, v, 0, 2);
	const P = [];
	for (let i = 0; i < n; i += 2) P.push(toFrame(r, v[i], v[i + 1]));
	const uv = att.uvs;
	const tris = att.triangles;
	for (let k = 0; k < tris.length; k += 3) {
		const [a, b, c] = [tris[k], tris[k + 1], tris[k + 2]];
		const [p0, p1, p2] = [P[a], P[b], P[c]];
		const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
		if (Math.abs(det) < 1e-9) continue;
		const x0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
		const x1 = Math.min(w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
		const y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
		const y1 = Math.min(h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
		for (let py = y0; py <= y1; py++)
			for (let px = x0; px <= x1; px++) {
				const qx = px + 0.5;
				const qy = py + 0.5;
				const l1 = ((qx - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (qy - p0[1])) / det;
				const l2 = ((p1[0] - p0[0]) * (qy - p0[1]) - (qx - p0[0]) * (p1[1] - p0[1])) / det;
				const l0 = 1 - l1 - l2;
				if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
				const sx = (l0 * uv[a * 2] + l1 * uv[b * 2] + l2 * uv[c * 2]) * PAGE.w - 0.5;
				const sy = (l0 * uv[a * 2 + 1] + l1 * uv[b * 2 + 1] + l2 * uv[c * 2 + 1]) * PAGE.h - 0.5;
				const al = sample(sx, sy, 3);
				if (al <= 0) continue;
				const i = py * w + px;
				for (let ch = 0; ch < 3; ch++)
					C[i * 3 + ch] = sample(sx, sy, ch) * 255 + C[i * 3 + ch] * (1 - al);
				A[i] = al + A[i] * (1 - al);
			}
	}
}

/** Each digit's three bones at these hand landmarks; its tip is TIPS'. */
const DIGIT_JOINTS = {
	thumb: [1, 2, 3],
	index: [5, 6, 7],
	middle: [9, 10, 11],
	ring: [13, 14, 15],
	pinky: [17, 18, 19],
};
/** The share of a hand's drawn area a pose may fold over itself: a thumb folded in lies over its
 *  palm, which one mesh can only draw as a fold (measured 2.2%; a fist 0.9%). */
const FOLD_MAX = 0.03;
const TIPS = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Channel `id` of template `t` at `v` on `skel`: each drive from its bone's pose, sets passed on. */
function applyChannel(skel, t, id, v) {
	const ch = t.channels.find((c) => c.id === id);
	for (const d of ch.drives ?? []) {
		const b = skel.findBone(d.bone);
		if (d.prop === 'rotate') b.rotation += v * d.per;
		else if (d.prop === 'x' || d.prop === 'y') b[d.prop] += v * d.per;
		else b[d.prop] *= 1 + v * d.per;
	}
	for (const st of ch.sets ?? []) applyChannel(skel, t, st.channel, v * st.per);
}

/** The made rig in the frame's pose with `chans` ({ channel: value }) on top. */
function posedWith(rig, t, chans) {
	const data = rig.skel.data;
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	data
		.findAnimation('frame')
		.apply(skel, 0, 0, false, [], 1, RIG.MixBlend.setup, RIG.MixDirection.mixIn);
	for (const [id, v] of Object.entries(chans)) applyChannel(skel, t, id, v);
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}

/** A hand's mesh in `skel`: its world vertices (frame pixels) and triangles. */
function handMesh(skel, r, s) {
	const slot = skel.findSlot(`hand_${s}`);
	const att = slot.getAttachment();
	const n = att.worldVerticesLength;
	const v = new Float32Array(n);
	att.computeWorldVertices(slot, 0, n, v, 0, 2);
	const pts = [];
	for (let i = 0; i < n; i += 2) pts.push(toFrame(r, v[i], v[i + 1]));
	return { pts, tris: att.triangles, slot, att };
}

/** The hand alone drawn as a mask, and the pixels a 2-px closing of it adds (its gaps). */
function handGaps(skel, r, s) {
	const { w, h } = FRAME;
	const A = new Float32Array(w * h);
	const C = new Float32Array(w * h * 3);
	const { slot, att } = handMesh(skel, r, s);
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
			acc += wgt * (c === 3 ? PAGE.data[(py * PAGE.w + px) * 4 + 3] : 0);
		}
		return acc / 255;
	};
	drawMesh(slot, att, r, sample, A, C, w, h);
	const m = Uint8Array.from(A, (a) => (a > 0.5 ? 1 : 0));
	const step = (src, grow) => {
		const out = new Uint8Array(src.length);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				let v = grow ? 0 : 1;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const yy = Math.min(h - 1, Math.max(0, y + dy));
						const xx = Math.min(w - 1, Math.max(0, x + dx));
						v = grow ? v | src[yy * w + xx] : v & src[yy * w + xx];
					}
				out[y * w + x] = v;
			}
		return out;
	};
	const closed = step(step(step(step(m, true), true), false), false);
	let gaps = 0;
	for (let i = 0; i < m.length; i++) if (closed[i] && !m[i]) gaps++;
	return gaps;
}

/** The track with 3D world points: its picture at 1 m per 1000 px, flat, but `push` ({ landmark: z }). */
function withWorld(track, push = {}) {
	const [w, h] = CUT.size;
	return {
		...track,
		pose: {
			...track.pose,
			world: track.pose.landmarks.map((p, k) => [
				(p[0] * w) / 1000,
				(p[1] * h) / 1000,
				push[k] ?? 0,
			]),
		},
	};
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

// ---- the head on its neck, and a 3D import onto the frame clip --------------------------------------
/** The jaw's middle in the face mesh (its corners and the chin): the top of the drawn neck. */
const JAW = [172, 397, 152];
/** How far a part's drawn joint may lie from the bone it turns on: this share of the eyes-to-jaw drop. */
const ATTACH = 0.25;
/**
 * The fixture's track with its face drawn `k` its size about the eyes (a face shorter than the
 * template's, as NellyAnimTest's is: its jaw 0.68 of the template's height below the eyes), then
 * turned `deg` about the shoulders' middle: the head drawn leaning on its neck.
 */
function leanHead(track, deg, k = 1) {
	const out = structuredClone(track);
	const [w, h] = CUT.size;
	const px = out.face.landmarks.map((p) => [p[0] * w, p[1] * h]);
	const e = [0, 1].map((i) => [33, 133, 263, 362].reduce((s, n) => s + px[n][i], 0) / 4);
	const [a, b] = [out.pose.landmarks[11], out.pose.landmarks[12]];
	const c = [((a[0] + b[0]) / 2) * w, ((a[1] + b[1]) / 2) * h];
	const [cs, sn] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
	out.face.landmarks = out.face.landmarks.map((p, i) => {
		const [x, y] = [e[0] + (px[i][0] - e[0]) * k - c[0], e[1] + (px[i][1] - e[1]) * k - c[1]];
		return [(c[0] + x * cs - y * sn) / w, (c[1] + x * sn + y * cs) / h, ...p.slice(2)];
	});
	return out;
}
const PAGE_SRC = [
	...readFileSync(join(APP, 'static/rigger/view.html'), 'utf8').matchAll(
		/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
	),
]
	.map((m) => m[1])
	.join('\n');
/** The page's own list of the 2D timelines a 3D import clears (view.html `face3dReplaced`). */
const face3dReplaced = new Function(
	[
		PAGE_SRC.match(/\nconst FACE_TIMELINE = [^\n]*/)[0],
		PAGE_SRC.slice(
			PAGE_SRC.indexOf('\nfunction face3dReplaced('),
			PAGE_SRC.indexOf('\n}\n', PAGE_SRC.indexOf('\nfunction face3dReplaced(')) + 2,
		),
		'return face3dReplaced;',
	].join('\n'),
)();
/** A turn as a quaternion [w, x, y, z]: `yaw` about the up axis, then `pitch`, then `roll` in the picture. */
function quat(yaw, pitch, roll) {
	const h = (d) => (d * Math.PI) / 360;
	const mul = (p, q) => [
		p[0] * q[0] - p[1] * q[1] - p[2] * q[2] - p[3] * q[3],
		p[0] * q[1] + p[1] * q[0] + p[2] * q[3] - p[3] * q[2],
		p[0] * q[2] - p[1] * q[3] + p[2] * q[0] + p[3] * q[1],
		p[0] * q[3] + p[1] * q[2] - p[2] * q[1] + p[3] * q[0],
	];
	const z = [Math.cos(h(roll)), 0, 0, Math.sin(h(roll))];
	const y = [Math.cos(h(yaw)), 0, Math.sin(h(yaw)), 0];
	const x = [Math.cos(h(pitch)), Math.sin(h(pitch)), 0, 0];
	return mul(z, mul(y, x));
}
/** A head and body turning in 3D for 2 s, as a 🎥 Motion import keys them. */
const TURNS = {
	spine: [quat(0, 0, 0), quat(8, 0, 4), quat(-8, 0, -4)],
	chest: [quat(0, 0, 0), quat(10, 0, 3), quat(-10, 0, -3)],
	head: [quat(0, 0, 0), quat(30, 10, 12), quat(-30, -10, -12)],
};
/** The made rig with that import written into `clip` (`frame`, or a new one), as the page does. */
function imported(M, rig, r, clip) {
	const irig = JSON.parse(JSON.stringify(rig.rigged.skeleton));
	if (!irig.animations?.[clip]) irig.animations = { ...irig.animations, [clip]: {} };
	const tpl = M.fitTemplate(M.HALF_BODY, r.fit);
	const { animation, orient } = M.authoringOf(irig, null, clip);
	const keys = Object.fromEntries(
		Object.entries(TURNS).map(([b, qs]) => [
			b,
			{ orient: qs.map((value, i) => ({ time: i, value })) },
		]),
	);
	const out = M.importClip3d({
		irig,
		doc: null,
		stem: 'fixture',
		template: tpl.rig3d,
		clip,
		animation,
		orient,
		keys,
		at: 0,
		length: TURNS.head.length - 1,
		replaced: face3dReplaced(tpl),
	});
	const atlas = new RIG.TextureAtlas(rig.atlasText);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		out.irig,
	);
	return (t) => {
		const skel = new RIG.Skeleton(data);
		skel.setToSetupPose();
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, clip, false);
		state.update(t);
		state.apply(skel);
		skel.updateWorldTransform(RIG.Physics.update);
		return skel;
	};
}
/** A slot's image in the world: its vertices and triangles (a region as two), or null. */
function corners(skel, slotName) {
	const slot = skel.findSlot(slotName);
	const att = slot?.getAttachment();
	if (att instanceof RIG.RegionAttachment) {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		return { v, tris: [0, 1, 2, 2, 3, 0], uvs: att.uvs };
	}
	if (att instanceof RIG.MeshAttachment) {
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return { v, tris: att.triangles, uvs: att.uvs };
	}
	return null;
}
/** Point `p` on an image: the triangle it lies in (or nearest inside) and its barycentric shares. */
function carriedOn({ v, tris }, p) {
	let best = null;
	for (let k = 0; k < tris.length; k += 3) {
		const [i, j, l] = [tris[k], tris[k + 1], tris[k + 2]];
		const [ax, ay, bx, by, cx, cy] = [
			v[i * 2],
			v[i * 2 + 1],
			v[j * 2],
			v[j * 2 + 1],
			v[l * 2],
			v[l * 2 + 1],
		];
		const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
		if (Math.abs(det) < 1e-12) continue;
		const b1 = ((p[0] - ax) * (cy - ay) - (cx - ax) * (p[1] - ay)) / det;
		const b2 = ((bx - ax) * (p[1] - ay) - (p[0] - ax) * (by - ay)) / det;
		const worst = Math.min(1 - b1 - b2, b1, b2);
		if (!best || worst > best.worst) best = { worst, i, j, l, b1, b2 };
	}
	return best;
}
const placedOn = ({ v }, { i, j, l, b1, b2 }) =>
	[0, 1].map((c) => (1 - b1 - b2) * v[i * 2 + c] + b1 * v[j * 2 + c] + b2 * v[l * 2 + c]);
/** The rig made for `track` and where its drawn joints are, in rig units. */
function headCase(M, track) {
	const r = requestOf(M, CUT, track).value;
	const rig = made(M, r);
	const j = M.frameJoints(track, CUT.size[0], CUT.size[1]).value;
	const R = ([x, y]) => [(x - r.origin[0]) * r.scale, -(y - r.origin[1]) * r.scale];
	const avg = (ks) => [0, 1].map((c) => ks.reduce((s, k) => s + j.face[k][c], 0) / ks.length);
	const jaw = avg(JAW);
	const eyes = avg([33, 133, 263, 362]);
	// Each part's drawn joint (the frame's), carried on its image, and the bone it turns on.
	const drawn = [['head', 'head', R(jaw)]];
	for (const s of ['l', 'r'])
		drawn.push(
			[`upper_arm_${s}`, `upper_arm_${s}`, R(j.shoulder[s])],
			[`lower_arm_${s}`, `lower_arm_${s}`, R(j.elbow[s])],
		);
	const joints = drawn.map(([slot, bone, p]) => ({
		slot,
		bone,
		at: carriedOn(corners(rig.skel, slot), p),
	}));
	return { r, rig, jaw, tol: ATTACH * dist(eyes, jaw) * r.scale, joints };
}
/** The farthest any part's drawn joint lies from its bone in `skel` (rig units), and which. */
function jointDrift(c, skel) {
	let worst = { d: 0, slot: '' };
	for (const { slot, bone, at } of c.joints) {
		const p = placedOn(corners(skel, slot), at);
		const b = skel.findBone(bone);
		const d = Math.hypot(p[0] - b.worldX, p[1] - b.worldY);
		if (!(d <= worst.d)) worst = { d, slot };
	}
	return worst;
}
const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 10);

// ---- every part skinned across its joints ---------------------------------------------------------
/** The joints two parts share, by the part holding the joint and the bone it hands over to. */
const SEAMS = [
	['torso', 'neck', 'neck'],
	['neck', 'head', 'head_image'],
	...['l', 'r'].flatMap((s) => [
		['torso', `upper_arm_${s}`, `upper_arm_${s}_image`],
		[`upper_arm_${s}`, `lower_arm_${s}`, `lower_arm_${s}_image`],
		[`lower_arm_${s}`, `hand_${s}`, `hand_${s}`],
	]),
];
/** The poses the owner named: a shoulder raised, an elbow bent, the head turned (on the frame's). */
const SKIN_POSES = [
	['shoulder raised', { shrug_l: 1 }],
	['arm raised', { arm_l: 0.3 }],
	['shoulder dropped', { shrug_r: -0.3, arm_r: -0.2 }],
	['elbow bent', { elbow_l: 0.5, elbow_r: -0.5 }],
	['head turned', { head_tilt: 10, head_nod: 10 }],
	['head turned back', { head_tilt: -10, head_nod: -10 }],
];
/** The page's alpha under an image's point. */
function alphaOn(img, c) {
	const uv = [0, 1].map(
		(k) =>
			(1 - c.b1 - c.b2) * img.uvs[c.i * 2 + k] +
			c.b1 * img.uvs[c.j * 2 + k] +
			c.b2 * img.uvs[c.l * 2 + k],
	);
	const [x, y] = [Math.floor(uv[0] * PAGE.w), Math.floor(uv[1] * PAGE.h)];
	return x < 0 || y < 0 || x >= PAGE.w || y >= PAGE.h ? 0 : PAGE.data[(y * PAGE.w + x) * 4 + 3];
}
/**
 * The pixels two parts both draw near the joint they share, carried on each part's mesh in the
 * frame's pose: each pose then shows how far apart the two copies come (a crack).
 */
function seamPoints(rig, r) {
	const out = [];
	for (const [a, b, bone] of SEAMS) {
		const j = r.fit.bends?.[a]?.skin?.find((x) => x.bone === bone);
		const [ia, ib] = [corners(rig.skel, a), corners(rig.skel, b)];
		if (!j || !ia || !ib) continue;
		const pts = [];
		const step = Math.max(1, j.reach / 12);
		for (let dx = -j.reach; dx <= j.reach; dx += step)
			for (let dy = -j.reach; dy <= j.reach; dy += step) {
				if (Math.hypot(dx, dy) > j.reach) continue;
				const p = [j.at[0] + dx, j.at[1] + dy];
				const [ca, cb] = [carriedOn(ia, p), carriedOn(ib, p)];
				if (ca.worst < 0 || cb.worst < 0 || alphaOn(ia, ca) < 128 || alphaOn(ib, cb) < 128)
					continue;
				pts.push([ca, cb]);
			}
		out.push({ a, b, pts });
	}
	return out;
}

// ---- guards: each returns true when it holds ------------------------------------------------------
const GUARDS = {
	request(M, log) {
		const got = requestOf(M);
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
		const without = requestOf(M, off).value;
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
	head(M, log) {
		let held = true;
		// The fixture stands with its head upright and the template's proportions; the same frame with
		// the head leaning on its neck (20°), and leaning with a shorter face, as the owner's
		// NellyAnimTest frames draw it.
		for (const [what, track] of [
			['upright', TRACK],
			['leaning', leanHead(TRACK, 20)],
			['leaning, a shorter face', leanHead(TRACK, -20, 0.7)],
		]) {
			const c = headCase(M, track);
			const hb = c.rig.skel.findBone('head');
			const off = dist(toFrame(c.r, hb.worldX, hb.worldY), c.jaw);
			const setup = new RIG.Skeleton(c.rig.skel.data);
			setup.setToSetupPose();
			setup.updateWorldTransform(RIG.Physics.update);
			const onto = imported(M, c.rig, c.r, 'frame');
			const fresh = imported(M, c.rig, c.r, 'imp');
			let drift = jointDrift(c, setup);
			const posed = [c.rig.skel, ...SAMPLES.map((t) => onto(t))];
			for (const skel of posed) {
				const d = jointDrift(c, skel);
				if (d.d > drift.d) drift = d;
			}
			let apart = 0;
			for (const t of SAMPLES) {
				const [a, b] = [onto(t), fresh(t)];
				for (const s of ['torso', 'neck', 'head', 'prop_glasses', 'prop_earring_l']) {
					const [va, vb] = [corners(a, s)?.v, corners(b, s)?.v];
					if (!va || !vb) continue;
					for (let i = 0; i < va.length; i += 2)
						apart = Math.max(apart, Math.hypot(va[i] - vb[i], va[i + 1] - vb[i + 1]) / c.r.scale);
				}
			}
			const tol = c.tol / c.r.scale;
			log(
				`${what}: the neck keyed ${c.r.fit.frame.neck.rotate.toFixed(1)}° in the frame; the head turns ${off.toFixed(1)} px from the drawn neck's top; a part's drawn joint at most ${(drift.d / c.r.scale).toFixed(1)} px off its bone (${drift.slot}) at setup, in the frame and through a 3D import onto it; the head drawn ${apart.toFixed(2)} px apart onto \`frame\` and onto a new clip (tolerance ${tol.toFixed(1)} px)`,
			);
			held &=
				ok(`${what}: the head turns on the drawn neck's top`, off <= tol, `${off.toFixed(1)} px`) &
				ok(
					`${what}: each part's drawn joint stays on its bone through setup, the frame and a 3D import`,
					drift.d <= c.tol,
					`${drift.slot} ${(drift.d / c.r.scale).toFixed(1)} px`,
				) &
				ok(
					`${what}: a 3D import draws the head the same onto the frame clip as onto a new one`,
					apart <= 0.5,
					`${apart.toFixed(2)} px`,
				);
		}
		return held;
	},
	skin(M, log) {
		const r = requestOf(M).value;
		const rig = made(M, r);
		const t = M.fitTemplate(M.HALF_BODY, r.fit);
		const names = rig.skel.data.bones.map((b) => b.name);
		const parts = CUT.parts.map((p) => p.name);
		// 1. Each part a mesh, each vertex weighted to its own bone and the ones its joints hand to,
		//    named by their index in the rig, its weights summing to 1.
		let badIndex = '';
		let unmeshed = parts.filter((p) => !(corners(rig.skel, p) && r.fit.bends?.[p]?.skin?.length));
		for (const p of parts) {
			const att = rig.skel.findSlot(p)?.getAttachment();
			if (!(att instanceof RIG.MeshAttachment) || !att.bones) {
				if (!unmeshed.includes(p)) unmeshed = [...unmeshed, p];
				continue;
			}
			const own = new Set(r.fit.bends[p].bones.map((b) => b.bone));
			for (let i = 0, v = 0; i < att.bones.length; v++) {
				const n = att.bones[i];
				let sum = 0;
				for (let k = 1; k <= n; k++) {
					const name = names[att.bones[i + k]];
					if (!own.has(name)) badIndex ||= `${p} vertex ${v} on ${name}`;
					sum += att.vertices[(i - v + k - 1) * 3 + 2];
				}
				if (Math.abs(sum - 1) > 1e-3) badIndex ||= `${p} vertex ${v} weighs ${sum}`;
				i += n + 1;
			}
		}
		// 2. In the frame's pose every vertex lies where the cut image does (its placement matrix).
		const sizes = new Map(SHEET.regions.map((g) => [g.name, [g.origW ?? g.w, g.origH ?? g.h]]));
		let asCut = 0;
		for (const part of r.parts) {
			const img = corners(rig.skel, part.name);
			const [w, h] = sizes.get(part.name) ?? [0, 0];
			if (!img || !(img.v.length > 8) || !w) continue;
			const att = rig.skel.findSlot(part.name).getAttachment();
			const reg = att.region;
			const m = part.matrix;
			for (let i = 0; i < img.v.length; i += 2) {
				const [u, v] = [
					(img.uvs[i] - reg.u) / (reg.u2 - reg.u),
					(img.uvs[i + 1] - reg.v) / (reg.v2 - reg.v),
				];
				const [x, y] = [(u - 0.5) * w, (0.5 - v) * h];
				const want = [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
				asCut = Math.max(asCut, dist(want, [img.v[i], img.v[i + 1]]) / r.scale);
			}
		}
		// 3. The owner's poses: finite, no crack where two parts meet, and the torso pulled by its
		//    shoulders: its shoulder line rides a shrug, its armpit a raised arm.
		const seams = seamPoints(rig, r);
		const sh = rig.skel.findBone('upper_arm_l');
		const torsoAt = (p) => carriedOn(corners(rig.skel, 'torso'), p);
		const armpitJoint = r.fit.bends.torso?.skin?.find((j) => j.bone === 'upper_arm_l_image');
		const S = [sh.worldX, sh.worldY];
		const pit = armpitJoint
			? [
					S[0] + 0.5 * armpitJoint.width * armpitJoint.dir[0],
					S[1] + 0.5 * armpitJoint.width * armpitJoint.dir[1],
				]
			: S;
		const [onS, onPit] = [torsoAt(S), torsoAt(pit)];
		const upperAt = carriedOn(corners(rig.skel, 'upper_arm_l'), pit);
		let finite = true;
		let crack = { d: 0, where: '' };
		let rigid = 0;
		const pulls = {};
		const frameImg = Object.fromEntries(
			seams.flatMap((s) => [s.a, s.b]).map((p) => [p, corners(rig.skel, p)]),
		);
		/** A point carried rigidly by a part's own bone from the frame's pose into `skel`'s. */
		const onBone = (skel, part, p) => {
			const name = rig.skel.findSlot(part).bone.data.name;
			const [f, b] = [rig.skel.findBone(name), skel.findBone(name)];
			const l = f.worldToLocal(new RIG.Vector2(p[0], p[1]));
			const w = b.localToWorld(new RIG.Vector2(l.x, l.y));
			return [w.x, w.y];
		};
		for (const [what, chans] of SKIN_POSES) {
			const skel = posedWith(rig, t, chans);
			for (const s of skel.slots) {
				const img = corners(skel, s.data.name);
				if (img && !img.v.every(Number.isFinite)) finite = false;
			}
			for (const { a, b, pts } of seams) {
				const [ia, ib] = [corners(skel, a), corners(skel, b)];
				for (const [ca, cb] of pts) {
					const d = dist(placedOn(ia, ca), placedOn(ib, cb)) / r.scale;
					if (d > crack.d) crack = { d, where: `${a} / ${b}, ${what}` };
					const p = placedOn(frameImg[a], ca);
					rigid = Math.max(rigid, dist(onBone(skel, a, p), onBone(skel, b, p)) / r.scale);
				}
			}
			if (what === 'shoulder raised') {
				const nb = skel.findBone('upper_arm_l');
				const torso = corners(skel, 'torso');
				const moved = dist([nb.worldX, nb.worldY], S);
				pulls.line = moved > 1e-6 ? dist(placedOn(torso, onS), S) / moved : 0;
			}
			if (what === 'arm raised') {
				const torso = corners(skel, 'torso');
				const arm = placedOn(corners(skel, 'upper_arm_l'), upperAt);
				const armMoved = dist(arm, pit);
				pulls.armpit = armMoved > 1e-6 ? dist(placedOn(torso, onPit), pit) / armMoved : 0;
			}
		}
		const counted = seams.map((s) => `${s.a}/${s.b} ${s.pts.length}`).join(', ');
		log(
			`${parts.length - unmeshed.length} of ${parts.length} parts skinned; in the frame's pose every vertex ${asCut.toFixed(4)} px from the cut image; shared pixels (${counted}) at most ${crack.d.toFixed(2)} px apart (${crack.where}; rigid parts ${rigid.toFixed(1)} px); a shrug carries the torso's shoulder ${(100 * pulls.line).toFixed(0)}% of the shoulder's move, a raised arm its armpit ${(100 * pulls.armpit).toFixed(0)}% of the arm's`,
		);
		return (
			ok(
				'every cut part is a weighted mesh skinned across its joints',
				!unmeshed.length,
				unmeshed.join(', '),
			) &
			ok(
				"each vertex's weights name its own bone and its joints' by index, summing to 1",
				!badIndex,
				badIndex,
			) &
			ok(
				"in the frame's pose every vertex is where the cut image is (≤ 0.01 px)",
				asCut <= 0.01,
				`${asCut} px`,
			) &
			ok('a shoulder raise, an elbow bend and a head turn pose every vertex finite', finite) &
			ok(
				'two parts at a joint draw their shared pixels together (≤ 2 px apart, the mesh grid)',
				seams.every((s) => s.pts.length > 0) && crack.d <= 2,
				`${crack.d.toFixed(2)} px at ${crack.where}; ${counted}`,
			) &
			ok(
				"a shrug carries the torso's shoulder line (≥ 75% of the shoulder's move)",
				pulls.line >= 0.75,
				`${pulls.line}`,
			) &
			ok(
				"a raised arm pulls the torso's armpit (≥ 50% of the arm's move there)",
				pulls.armpit >= 0.5,
				`${pulls.armpit}`,
			)
		);
	},
	redraw(M, log) {
		const r = requestOf(M).value;
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
	fingers(M, log) {
		const r = requestOf(M).value;
		const rig = made(M, r);
		const t = M.fitTemplate(M.HALF_BODY, r.fit);
		const j = M.frameJoints(TRACK, CUT.size[0], CUT.size[1]).value;
		const sides = ['l', 'r'].filter((s) => j.hands[s]);
		let worst = 0;
		let weighted = true;
		for (const s of sides) {
			for (const [d, ks] of Object.entries(DIGIT_JOINTS))
				ks.forEach((k, n) => {
					const b = rig.skel.findBone(`${d}_${n + 1}_${s}`);
					worst = Math.max(worst, dist(toFrame(r, b.worldX, b.worldY), j.hands[s][k]));
				});
			const att = rig.skel.findSlot(`hand_${s}`).getAttachment();
			const used = new Set();
			for (let i = 0; att.bones && i < att.bones.length; i += att.bones[i] + 1)
				for (let k = 1; k <= att.bones[i]; k++)
					used.add(rig.skel.bones[att.bones[i + k]].data.name);
			weighted &&=
				att instanceof RIG.MeshAttachment &&
				Object.entries(DIGIT_JOINTS).every(([d]) =>
					[1, 2, 3].every((n) => used.has(`${d}_${n}_${s}`)),
				);
		}
		const poses = sides.flatMap((s) => [
			{ [`curl_${s}`]: 1 },
			{ [`curl_${s}`]: 0.5 },
			{ [`spread_${s}`]: 1 },
			{ [`spread_${s}`]: -0.3 },
			{ [`thumb_${s}`]: 1 },
			{ [`thumb_${s}`]: -0.5 },
		]);
		const rest = posedWith(rig, t, {});
		let finite = true;
		let folds = 0;
		let cracks = 0;
		const area = (p, tr, k) => {
			const [a, b, c] = [p[tr[k]], p[tr[k + 1]], p[tr[k + 2]]];
			return (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
		};
		const each = [];
		for (const chans of poses) {
			const [id, value] = Object.entries(chans)[0];
			const s = id.slice(-1);
			const skel = posedWith(rig, t, chans);
			const at = handMesh(skel, r, s);
			const base = handMesh(rest, r, s);
			finite &&= at.pts.every((p) => p.every(Number.isFinite));
			// A fold only where the hand is drawn: the mesh's grid runs over its canvas's empty corners.
			const uv = at.att.uvs;
			let folded = 0;
			let drawn = 0;
			for (let k = 0; k < at.tris.length; k += 3) {
				const [u, v] = [0, 1].map(
					(c) =>
						(uv[at.tris[k] * 2 + c] + uv[at.tris[k + 1] * 2 + c] + uv[at.tris[k + 2] * 2 + c]) / 3,
				);
				const px = Math.min(PAGE.w - 1, Math.floor(u * PAGE.w));
				const py = Math.min(PAGE.h - 1, Math.floor(v * PAGE.h));
				if (!PAGE.data[(py * PAGE.w + px) * 4 + 3]) continue;
				const a0 = area(base.pts, base.tris, k);
				const a1 = area(at.pts, at.tris, k);
				drawn += Math.abs(a0);
				if (Math.abs(a0) > 0.5 && Math.sign(a1) !== Math.sign(a0)) folded += Math.abs(a1);
			}
			const f = folded / drawn;
			// A spread parts the fingers and a thumb stuck out its web, by design: a crack is a gap a
			// curl or a thumb folded in opens.
			const c =
				id.startsWith('spread') || value < 0
					? 0
					: Math.max(0, handGaps(skel, r, s) - handGaps(rest, r, s));
			folds = Math.max(folds, f);
			cracks += c;
			each.push(`${id} ${value}: ${(f * 100).toFixed(2)}% folded, ${c} px`);
		}
		log(each.join('; '));
		// A fist: each finger's tip, as drawn, comes in toward its knuckle.
		const folding = [];
		for (const s of sides) {
			const base = handMesh(rest, r, s);
			const fist = handMesh(posedWith(rig, t, { [`curl_${s}`]: 1 }), r, s);
			for (const d of ['index', 'middle', 'ring', 'pinky']) {
				const tip = j.hands[s][TIPS[d]];
				let near = 0;
				base.pts.forEach((p, i) => {
					if (dist(p, tip) < dist(base.pts[near], tip)) near = i;
				});
				const knuckle = j.hands[s][DIGIT_JOINTS[d][0]];
				folding.push(dist(fist.pts[near], knuckle) / dist(base.pts[near], knuckle));
			}
		}
		log(
			`${sides.length} hands: finger bones ${worst.toFixed(4)} px off their joints; ${poses.length} poses: at most ${(folds * 100).toFixed(2)}% of the hand folded over, ${cracks} px of new gaps; a fist brings each fingertip to ${Math.min(...folding).toFixed(2)}–${Math.max(...folding).toFixed(2)} of its reach`,
		);
		return (
			ok('the fixture has both hands tracked', sides.length === 2) &
			ok(
				"each finger bone sits on its tracked joint in the frame's pose (≤ 0.5 px)",
				worst <= 0.5,
				`${worst}`,
			) &
			ok('each hand is one mesh weighted to all its fingers', weighted) &
			ok('a fist, a spread, the thumb in and out pose it finite', finite) &
			ok('crack-free: no gap opens in a curl or a thumb folded in', cracks === 0, `${cracks} px`) &
			ok(
				'and under 3% of the drawn hand folds over itself (a thumb in over the palm)',
				folds < FOLD_MAX,
				`${(folds * 100).toFixed(2)}%`,
			) &
			ok(
				'each fingertip as drawn folds toward its knuckle in a fist (to under 0.8 of its reach)',
				folding.length === 8 && folding.every((f) => f < 0.8),
				folding.map((f) => f.toFixed(2)).join(' '),
			)
		);
	},
	props(M, log) {
		const r = requestOf(M).value;
		const rig = made(M, r);
		const pivots = M.propPivots(new Uint8Array(LABELS.data), LABELS.info.width, CUT);
		const hosts = {
			prop_glasses: 'head_image',
			prop_earring_l: 'head_image',
			prop_chain: 'torso_image',
			prop_wrist_r: 'lower_arm_r_image',
		};
		let worst = 0;
		const wrong = [];
		for (const p of CUT.props.filter((q) => q.take !== false)) {
			const b = rig.skel.findBone(p.name);
			if (!b || rig.skel.findSlot(p.name).bone !== b) {
				wrong.push(`${p.name} has no bone of its own`);
				continue;
			}
			if (b.parent.data.name !== hosts[p.name])
				wrong.push(`${p.name} hangs from ${b.parent.data.name}`);
			worst = Math.max(worst, dist(toFrame(r, b.worldX, b.worldY), pivots[p.name]));
		}
		const off = {
			...CUT,
			props: CUT.props.map((p) => (p.name === 'prop_chain' ? { ...p, take: false } : p)),
		};
		const untaken = made(M, requestOf(M, off).value).skel.findBone('prop_chain') === null;
		const doc = JSON.parse(JSON.stringify(rig.rigged.skeleton));
		const fore = doc.bones.find((b) => b.name === 'hand_r');
		const refit = M.refitIrig(doc, { hand_r: Math.hypot(fore.x ?? 0, fore.y ?? 0) * 1.2 });
		const img = doc.bones.find((b) => b.name === 'lower_arm_r_image');
		log(
			`${Object.keys(hosts).length} props, each on its own bone ${worst.toFixed(4)} px off its pivot; ⤢ a 1.2× forearm stretches its image (carrying the watch) ×${(img.scaleY ?? 1).toFixed(3)}`,
		);
		return (
			ok(
				'each taken prop hangs from a bone of its own, a child of the bone its host is drawn on',
				wrong.length === 0,
				wrong.join('; '),
			) &
			ok("… at its pivot in the frame's pose (≤ 0.5 px)", worst <= 0.5, `${worst}`) &
			ok('a prop left ✗ has no bone', untaken) &
			ok(
				'⤢ Fit to a capture still stretches an image bone that carries a prop',
				Math.abs((img.scaleY ?? 1) - 1.2) < 1e-3 &&
					refit.stretched.some((x) => x.bone === 'lower_arm_r_image'),
				JSON.stringify(refit.stretched),
			)
		);
	},
	sources(M, log) {
		// This frame draws the left upper arm at 0.6 of its length; another frame (the fixture turned
		// 14° at 0.8 its size) draws it whole.
		const short = shortArm(TRACK, 0.4);
		const turned = turnTrack(TRACK, 14, 0.8);
		const thereReq = requestOf(M, CUT, turned).value;
		const alone = requestOf(M, CUT, short).value;
		const got = requestOf(M, CUT, short, {
			upper_arm_l: { job: OTHER, cut: CUT, track: turned },
		});
		if (!ok('a part taken from another frame fits', got.ok, got.problem)) return false;
		const r = got.value;
		const whole = REQUEST.fit.bones.lower_arm_l;
		const length = (b) => Math.hypot(b.x, b.y);
		const taken = r.parts.find((p) => p.name === 'upper_arm_l');
		const there = thereReq.parts.find((p) => p.name === 'upper_arm_l').matrix;
		// The rig poses as this frame: every joint where this frame has it.
		const rig = made(M, r);
		const j = M.frameJoints(short, CUT.size[0], CUT.size[1]).value;
		const at = (n) => {
			const b = rig.skel.findBone(n);
			return toFrame(r, b.worldX, b.worldY);
		};
		const off = Math.max(
			...['l', 'r'].flatMap((s) => [
				dist(at(`upper_arm_${s}`), j.shoulder[s]),
				dist(at(`lower_arm_${s}`), j.elbow[s]),
				dist(at(`hand_${s}`), M.wristOf(j, s)),
			]),
		);
		const same = r.parts
			.filter((p) => p.name !== 'upper_arm_l')
			.every((p) => {
				const q = alone.parts.find((x) => x.name === p.name);
				return !p.source && q && p.matrix.every((v, i) => Math.abs(v - q.matrix[i]) < 1e-6);
			});
		log(
			`the left upper arm from another frame: length ${length(r.fit.bones.lower_arm_l).toFixed(2)} (this frame ${length(alone.fit.bones.lower_arm_l).toFixed(2)}, that one ${length(whole).toFixed(2)}); this frame's joints ${off.toFixed(4)} px off`,
		);
		return (
			ok(
				"the arm takes its length from the frame that draws it whole, not this frame's short one",
				Math.abs(length(r.fit.bones.lower_arm_l) - length(whole)) < 1e-6 &&
					length(alone.fit.bones.lower_arm_l) < 0.7 * length(whole),
			) &
			ok(
				'the part is read off that frame, by its place there, and sent with that cut',
				taken.source?.job === OTHER &&
					Math.abs(taken.source.scale - thereReq.scale) < 1e-9 &&
					there.some(
						(v, i) => Math.abs(v - alone.parts.find((x) => x.name === 'upper_arm_l').matrix[i]) > 1,
					) &&
					taken.matrix.every((v, i) => Math.abs(v - there[i]) < 1e-6),
				JSON.stringify(taken),
			) &
			ok('the rig still poses as this frame: every joint within 0.5 px', off <= 0.5, `${off}`) &
			ok("… and every other part comes back where this frame's own cut puts it", same)
		);
	},
	stretch(M, log) {
		const r = requestOf(M).value;
		const rig = made(M, r);
		const fit = (k) => {
			const doc = JSON.parse(JSON.stringify(rig.rigged.skeleton));
			const fore = doc.bones.find((b) => b.name === 'hand_r');
			const len = Math.hypot(fore.x ?? 0, fore.y ?? 0);
			const refit = M.refitIrig(doc, { hand_r: len * k });
			const img = doc.bones.find((b) => b.name === 'lower_arm_r_image');
			const after = doc.bones.find((b) => b.name === 'hand_r');
			return { refit, by: img.scaleY ?? 1, length: Math.hypot(after.x ?? 0, after.y ?? 0) / len };
		};
		const far = fit(3);
		const near = fit(1.2);
		const [w, h] = CUT.size;
		const lm = TRACK.pose.landmarks;
		// The left forearm (pose 14 → 16) pointed at the camera: its 3D length twice its drawn one.
		const drawn = Math.hypot((lm[16][0] - lm[14][0]) * w, (lm[16][1] - lm[14][1]) * h) / 1000;
		const flat = M.foreshortened(withWorld(TRACK), w, h);
		const short = M.foreshortened(withWorld(TRACK, { 16: Math.sqrt(3) * drawn }), w, h);
		log(
			`⤢ a forearm 3× its length: bone ×${far.length.toFixed(2)}, art ×${far.by.toFixed(2)} (held: ${far.refit.held.length}); 1.2×: art ×${near.by.toFixed(2)}; foreshortened: ${JSON.stringify(short)}`,
		);
		return (
			ok(
				'⤢ Fit stretches a limb’s art at most ×1.5 and says so; the bone takes its whole length',
				Math.abs(far.by - 1.5) < 1e-3 &&
					Math.abs(far.length - 3) < 1e-3 &&
					far.refit.held.some((x) => x.bone === 'lower_arm_r' && Math.abs(x.wanted - 3) < 1e-6),
				JSON.stringify({ by: far.by, held: far.refit.held }),
			) &
			ok(
				'… and a sane stretch whole, saying nothing',
				Math.abs(near.by - 1.2) < 1e-3 && near.refit.held.length === 0,
			) &
			ok(
				'the create report names an arm segment the frame draws foreshortened, and only it',
				flat.length === 0 &&
					short.length === 1 &&
					short[0].part === 'lower_arm_l' &&
					Math.abs(short[0].ratio - 0.5) < 0.011 &&
					Array.isArray(r.foreshortened),
				JSON.stringify({ flat, short }),
			)
		);
	},
	finite(M, log) {
		const r = requestOf(M).value;
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
	const got = requestOf(M);
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
		[FF, "'face', ...SIDES.flatMap((s) => [`lower_arm_${s}`, `hand_${s}`])];", "'face'];"],
	],
	[
		'joints',
		"the face keeps the template's height above the head",
		[FF, "const LENGTHS = ['chest', 'head', 'face',", "const LENGTHS = ['chest', 'head',"],
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
			'const Hd = sub(Fc, rot(tau, [0, drop >= MIN_DROP * rest ? drop : rest]));',
			"const Hd = mid(eye('l'), eye('r'));",
		],
	],
	[
		'head',
		"the head placed from the eyes at the template's face height, not on the drawn neck (the owner's)",
		[
			FF,
			'const Hd = sub(Fc, rot(tau, [0, drop >= MIN_DROP * rest ? drop : rest]));',
			'const Hd = sub(Fc, rot(tau, [0, rest]));',
		],
	],
	[
		'head',
		"a 3D import keeps the neck's own turn under the head's",
		['rigTemplates.ts', "\t\t\t'head_nod',", ''],
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
			'(a, b) => (slotIndex.get(partSlot.get(a)!) ?? 0) - (slotIndex.get(partSlot.get(b)!) ?? 0),',
			'(a, b) => (slotIndex.get(partSlot.get(b)!) ?? 0) - (slotIndex.get(partSlot.get(a)!) ?? 0),',
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
MUTANTS.push(
	[
		'skin',
		"the skin bound in the setup's pose, not the frame's",
		[
			'rigTemplates.ts',
			'const bind = frameWorld(ft.bones, fit?.frame);',
			'const bind = frameWorld(ft.bones, {});',
		],
	],
	[
		'skin',
		"a weight naming the bone after its own (the rig's bone order off by one)",
		[
			'rigTemplates.ts',
			'vertices.push(index.get(a.bone)!, round4(lx), round4(ly), wts[i]);',
			'vertices.push(index.get(a.bone)! + 1, round4(lx), round4(ly), wts[i]);',
		],
	],
	[
		'skin',
		'a joint skinned from one side only (the part beyond it rigid there)',
		[FF, 'joint(b[0], a[1], J, [-dir[0], -dir[1]], width, reach);', ''],
	],
	[
		'skin',
		"the torso's shoulder line left on the chest (no clavicle joint)",
		[FF, "if (c) joint('torso', c.bone, c.at, c.dir, c.width, c.reach);", ''],
	],
	[
		'skin',
		"the torso's armpit left on the chest (no upper arm joint)",
		[FF, "joint('torso', `upper_arm_${s}_image`, Ss, dir, width, width);", ''],
	],
	[
		'skin',
		'the upper arm hands its shoulder to the torso whole, not split as the torso splits it',
		[
			FF,
			"joint(`upper_arm_${s}`, 'torso_image', Ss, [-dir[0], -dir[1]], width, width, clav);",
			"joint(`upper_arm_${s}`, 'torso_image', Ss, [-dir[0], -dir[1]], width, width);",
		],
	],
	[
		'sources',
		"a part taken from another frame keeps this frame's length",
		[FF, '			lengthened.bones[lb] = L;', ''],
	],
	[
		'sources',
		'the frame clip not bringing the joint in to where this frame draws it',
		[FF, 'lengthened.frame![lb] = { ...at, x: L.x * (f - 1), y: L.y * (f - 1) };', ''],
	],
	[
		'sources',
		"a part taken from another frame placed by this frame's fit",
		[
			FF,
			'const there = framePlacements(t, f2.value.fit, [part]);',
			'const there = framePlacements(t, base, [part]);',
		],
	],
	[
		'fingers',
		'the fingers left where the template has them (a rigid hand)',
		[FF, 'if (Object.keys(fingers).length) Object.assign(fit, { fingers, bends });', ''],
	],
	[
		'fingers',
		"a finger placed turned the hand's way, not back to rest",
		[FF, 'rot(-turn, sub(hand[k]', 'rot(turn, sub(hand[k]'],
	],
	[
		'fingers',
		'every vertex weighted along the first branch (the thumb)',
		[
			FIT,
			'Math.max(0, 1 - (d - near[best]) / Math.max(1e-6, 0.5 * chains[i].ramp[0])),',
			'i === 0 ? 1 : 0,',
		],
	],
	[
		'props',
		'a prop on the bone the cut named, not the one its host is drawn on',
		[FF, 'if (!drawn) return p.bone;', 'return p.bone;'],
	],
	[
		'props',
		'a prop bone at its parent, not its pivot',
		[
			FF,
			'const pivot = pivots[p.name] ? R(pivots[p.name]) : undefined;',
			'const pivot = undefined;',
		],
	],
	[
		'props',
		'⤢ Fit takes an image bone carrying a prop for a joint',
		[
			'rigCaptureFit.ts',
			'bones.every((c) => c.parent !== b.name || leaf(c)) &&',
			'!bones.some((c) => c.parent === b.name) &&',
		],
	],
	[
		'stretch',
		'⤢ Fit stretches the art without a bound',
		[
			'rigCaptureFit.ts',
			'export const MAX_ART_STRETCH = 1.5;',
			'export const MAX_ART_STRETCH = Infinity;',
		],
	],
	[
		'stretch',
		'a foreshortened segment never reported',
		[FF, 'export const FORESHORTENED = 0.8;', 'export const FORESHORTENED = 0;'],
	],
);
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
