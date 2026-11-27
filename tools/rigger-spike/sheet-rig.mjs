// 🗺 From my sheet — the gate (docs/design/frame-to-rig.md §13): an artist's own sheet, its regions
// oddly named and drawn in their own pose and scale, mapped onto a rig template and made a rig that
// motion capture drives. Headless, on the SHIPPED code: the page's matcher and joint guesses
// (apps/launcher-api/src/lib/rigSheetMap.ts, which `vendor/rigger-motion.js` bundles), the launcher's
// fit (`server/rigSheetFit.ts`, as `/api/rigger/new` runs it), `templateRig` over the sheet, the
// `.atlas` ＋ New rig writes, the store's pose check, the page's motion keying and engine-rig posing
// the rig as a game does.
//
// The sheet (`fixtures/sheet-rig/`) is made from the F1 fixture (services/atlas-tool/fixtures/
// rig_from_frame: a half-body character drawn for the gates, so no licence question): each part the
// F2 gate made whole is turned (the left arm hanging, the right arm lying out as in a T-pose, the
// head tilted, the torso leaning), drawn 1.6× bigger, trimmed to its ink and named as an artist might
// (`L_arm_upper`, `arm_lower_left`, `ArmR1`, `HandL`, `head_front`, `Body_Main`, …), beside regions
// that are no part at all. Its true joints are the bones the parts were made on, carried the same way.
// Asserted:
//  - suggest: every body part is matched to its region by name, the props to their hosts, and the
//    regions that are no part to none;
//  - swap: the sheet named the character's way (⇄ Swap sides) maps each drawing onto the part it is,
//    its props onto the same hosts, and its rig poses through a capture as the template-named one;
//  - guess: each joint guessed from its drawing's shape lands within its tolerance of the true one,
//    and the head's from the face found on it;
//  - fit: the rig's limb lengths are the drawn ones at the sheet's scale (the frame's own fit's, for
//    the same joints), and every part's joints, carried on its drawing, sit on their bones at rest;
//  - finite: the fitted template passes the store's pose check (every control at its ends and rest,
//    every starter clip) and the rig the `.irig` save check;
//  - skin: drawn apart, each part is rigid on its own bone across every joint to another drawing; the
//    torso bends only at its waist and shoulder lines, the head only over the face's bones; a drawing
//    by angle bends as its slot's main drawing does;
//  - redraw: posed as the frame (the frame's own fit's turns), the rig draws the frame's character
//    again — the parts meet where the frame has them;
//  - capture: a motion capture solved and keyed as 🎥 Motion keys it moves every part with its bone:
//    each part's middle and its joints stay within a few pixels of where their bones carry them,
//    while the arms and the body move tens of pixels;
//  - props: each prop hangs from a bone of its own where it sits on its host's drawing, drawn just
//    over it, and rides it through the capture;
//  - sidecar: the mapping reads back as written (`sheet.json`), and a bad one is refused with why;
//  - arrange: the sheet arranged on the canvas as the F2 fixture's frame (each drawing where the
//    frame has its part: the truth carried through the frame fit's pose) makes a rig with a `frame`
//    clip that, posed by it, draws the frame again; each chain bone turned as the frame's; every
//    part's first joint on the joint it snaps to; an arrangement read off the preview at rest
//    changes nothing; a prop turned against its host drawn so;
//  - frame joints: posed by its `frame` clip, every part's joints sit on their bones — arranged as
//    the frame, the whole character turned on the canvas, or with parts left unarranged (they ride
//    their bones into the pose); the face's bones on the drawn face;
//  - capture (also on the arranged rig): the capture moves every part with its bone from the setup;
//  - the owner's sheet shape (`ownerSheet`: Photoshop Export Layers names, arranged, props worn on
//    and behind the torso, a face drawn in parts beside the head):
//    - partialface: a brow or a mouth drawing makes the rig (it was a bare 500), each face drawing
//      drawn where placed and bent on its bones from there, the starred parts left out listed;
//    - proportions: every drawing where it was arranged, at the sheet's scale; at rest and with every
//      chain bone turned it rides its own bone whole, and the torso, neck and head fold nowhere;
//    - headturn: turning the head turns the head's drawing, its face, the nose and the brows with it;
//    - faceturn: a face capture's head turn on a head drawn without its face turns the head with it —
//      its middle under the features drawn apart moving as they do, its outline staying, nothing
//      folding at a 3D import's farthest slide, a roll on top turning it whole (trimmed too); a face
//      found on the head does not slide off it;
//    - draworder: the mapped slots in the template's order, a prop behind its part where the layers
//      put it there, a part's props in the layers' order, the head's props over its face, under the
//      front hair (🗺 Layers: sheet-layers.mjs);
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-rig.mjs [--only <guard>] [--no-mutants] [--mutants <guard>] [--write]
//   (--mutants: only that guard's mutants.)
//   (--write: make the sheet from the F2 fixture's parts again.)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';
import * as P3 from './performer3d.mjs';
import { dir as dirOf, track as performer } from './performer3d.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const APP = join(ROOT, 'apps/launcher-api');
const LIB = join(APP, 'src/lib');
const SERVER = join(LIB, 'server');
const F1 = join(ROOT, 'services/atlas-tool/fixtures/rig_from_frame');
const FIX = fileURLToPath(new URL('./fixtures/sheet-rig/', import.meta.url));
const PAGE_SRC = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const sharp = createRequire(join(APP, 'package.json'))('sharp');

const tmp = mkdtempSync(join(tmpdir(), 'sheet-rig-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let bundles = 0;
const SHIPPED =
	/[\\/](rigSheetMap|rigSlotOrder|rigSheetFit|rigFrameFit|rigFrameFace|rigTemplates|rigTemplateFit|rigCutEdits|rigIndex)\.ts$/;
/** The shipped modules, with `mutate` ([file, from, to]) swapped into their source (LF) first. */
async function load(mutate = []) {
	const out = join(tmp, `m${bundles++}.mjs`);
	await esbuild.build({
		stdin: {
			contents: [
				"export * from './server/rigSheetFit.ts';",
				"export * from './rigSheetMap.ts';",
				"export * from './server/rigFrameFit.ts';",
				"export * from './server/rigTemplates.ts';",
				"export * from './server/rigTemplateFit.ts';",
				"export { rigTemplateSaveProblem } from './server/rigTemplateCheck.ts';",
				"export { irigDocProblem } from './server/riggerIrig.ts';",
				"export { regionsToRigAtlas } from './server/rig.ts';",
				"export { isBundleSidecar } from './server/rigIndex.ts';",
				"export { solveMotion } from './rigMotion.ts';",
			].join('\n'),
			resolveDir: LIB,
			loader: 'ts',
			sourcefile: 'sheet-rig-entry.ts',
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
					// `rig.ts` and `rigIndex.ts` reach R2, sharp and the page store; what is read here uses none.
					build.onResolve({ filter: /.*/ }, (args) =>
						/[\\/](rig|rigIndex)\.ts$/.test(args.importer) &&
						!args.path.startsWith('engine-') &&
						!/rigTemplates|rigSidecars|rigSheetMap|rig3d|rigControls/.test(args.path)
							? { path: args.path, namespace: 'rig-deps' }
							: undefined,
					);
					build.onLoad({ filter: /.*/, namespace: 'rig-deps' }, () => ({
						contents: 'module.exports = {};',
						loader: 'js',
					}));
					build.onLoad({ filter: SHIPPED }, (args) => {
						let text = readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n');
						for (const [file, from, to] of mutate.filter(([f]) => f !== 'view.html')) {
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
	const mod = await import(pathToFileURL(out).href);
	return { ...mod, PAGE_MUTATIONS: mutate.filter(([file]) => file === 'view.html') };
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
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;

// ---- the sheet, made from the F2 fixture's parts -----------------------------------------------------
/** The sheet is drawn this much bigger than the rig's rest. */
const SHEET_SCALE = 1.6;
/**
 * Each part: its region's name and how it is laid on the sheet, turned from its rest (°, clockwise on
 * the page): the left arm hanging (a little off straight), the right arm lying out to the picture's
 * right as in a T-pose, the head tilted, the torso leaning; a prop turned as its host is.
 */
const LAYOUT = [
	{ part: 'torso', name: 'Body_Main', turn: -5 },
	{ part: 'neck', name: 'Neck01', turn: 0 },
	{ part: 'head', name: 'head_front', turn: 9 },
	{ part: 'upper_arm_l', name: 'L_arm_upper', turn: 6 },
	{ part: 'lower_arm_l', name: 'arm_lower_left', turn: -4 },
	{ part: 'hand_l', name: 'HandL', turn: 3 },
	{ part: 'upper_arm_r', name: 'ArmR1', turn: -97 },
	{ part: 'lower_arm_r', name: 'ArmR2', turn: -85 },
	{ part: 'hand_r', name: 'hand-right', turn: -90 },
	{ part: 'prop_glasses', name: 'Sunglasses', with: 'head' },
	{ part: 'prop_earring_l', name: 'earring_L', with: 'head' },
	{ part: 'prop_chain', name: 'gold_chain', with: 'torso' },
	{ part: 'prop_wrist_r', name: 'watch_R', with: 'lower_arm_r' },
];
/** Regions that are no part: they must map to nothing. */
const DECOYS = [
	{ name: 'shadow_blob', w: 120, h: 40, rgba: [0, 0, 0, 90] },
	{ name: 'bg_glow', w: 90, h: 90, rgba: [255, 230, 120, 120] },
];
/** The bone each joint of a part is, at rest (`_s` the part's side). */
const TRUE_BONES = {
	torso: { hips: 'root', neck: 'neck', shoulder_l: 'upper_arm_l', shoulder_r: 'upper_arm_r' },
	neck: { base: 'neck', top: 'head' },
	head: { neck: 'head', face: 'face' },
	upper_arm: { shoulder: 'upper_arm_s', elbow: 'lower_arm_s' },
	lower_arm: { elbow: 'lower_arm_s', wrist: 'hand_s' },
	hand: { wrist: 'hand_s', knuckle: 'middle_1_s' },
};

/**
 * `--write`: the sheet, its regions and their true joints. The source is the F2 gate's parts sheet
 * (services/atlas-tool/fixtures/rig_from_frame/parts: each part made whole, turned to its bone's rest
 * and centred on it, one pixel a rig unit), so every joint is a bone of the rig it was made for, at
 * rest; and the face the tracker found on the frame, carried onto the head's drawing.
 */
async function writeSheet(M) {
	const parts = read(join(F1, 'parts/sheet.json'));
	const request = read(join(F1, 'parts/request.json'));
	const src = await sharp(join(F1, 'parts/sheet.png'))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const track = read(join(F1, 'track.json'));
	const cut = read(join(F1, 'parts/cut.json'));
	const fitted = M.fitTemplate(M.HALF_BODY, request.fit);
	const W = M.frameWorld(fitted.bones);
	const at = (n) => [W.get(n)[4], W.get(n)[5]];
	const slotBone = (part) =>
		fitted.slots.find((s) => s.name === slotOf(M, part) || s.name === part).bone;
	const S = SHEET_SCALE;
	const regions = [];
	for (const L of LAYOUT) {
		const r = parts.regions.find((x) => x.name === L.part);
		const turn = LAYOUT.find((x) => x.part === (L.with ?? L.part)).turn;
		const rad = (turn * Math.PI) / 180;
		const [co, si] = [Math.cos(rad), Math.sin(rad)];
		const c = [r.w / 2, r.h / 2];
		// A canvas pixel (y down) on the page before the crop.
		const fwd = (p) => [
			S * (co * (p[0] - c[0]) - si * (p[1] - c[1])),
			S * (si * (p[0] - c[0]) + co * (p[1] - c[1])),
		];
		const corners = [
			[0, 0],
			[r.w, 0],
			[0, r.h],
			[r.w, r.h],
		].map(fwd);
		const ox = Math.floor(Math.min(...corners.map((p) => p[0])));
		const oy = Math.floor(Math.min(...corners.map((p) => p[1])));
		const cw = Math.ceil(Math.max(...corners.map((p) => p[0]))) - ox;
		const ch = Math.ceil(Math.max(...corners.map((p) => p[1]))) - oy;
		const px = new Uint8ClampedArray(cw * ch * 4);
		const sample = (x, y) => {
			if (x < 0 || y < 0 || x >= r.w || y >= r.h) return [0, 0, 0, 0];
			const i = ((r.y + y) * src.info.width + r.x + x) * 4;
			const a = src.data[i + 3] / 255;
			return [src.data[i] * a, src.data[i + 1] * a, src.data[i + 2] * a, src.data[i + 3]];
		};
		let [x0, y0, x1, y1] = [cw, ch, 0, 0];
		for (let v = 0; v < ch; v++)
			for (let u = 0; u < cw; u++) {
				// The canvas point this page pixel shows (its middle), sampled bilinearly, premultiplied.
				const [qx, qy] = [(u + ox + 0.5) / S, (v + oy + 0.5) / S];
				const fx = co * qx + si * qy + c[0] - 0.5;
				const fy = -si * qx + co * qy + c[1] - 0.5;
				const [ix, iy] = [Math.floor(fx), Math.floor(fy)];
				const [tx, ty] = [fx - ix, fy - iy];
				const acc = [0, 0, 0, 0];
				for (const [dx, dy, wt] of [
					[0, 0, (1 - tx) * (1 - ty)],
					[1, 0, tx * (1 - ty)],
					[0, 1, (1 - tx) * ty],
					[1, 1, tx * ty],
				]) {
					const s = sample(ix + dx, iy + dy);
					for (let k = 0; k < 4; k++) acc[k] += s[k] * wt;
				}
				const o = (v * cw + u) * 4;
				const a = Math.round(acc[3]);
				px[o + 3] = a;
				for (let k = 0; k < 3; k++)
					px[o + k] = a > 0 ? Math.round(Math.min(255, (acc[k] * 255) / acc[3])) : 0;
				if (a >= 8)
					[x0, y0, x1, y1] = [
						Math.min(x0, u),
						Math.min(y0, v),
						Math.max(x1, u + 1),
						Math.max(y1, v + 1),
					];
			}
		// Trimmed to its ink, as an artist's sheet is.
		const pad = 2;
		[x0, y0, x1, y1] = [
			Math.max(0, x0 - pad),
			Math.max(0, y0 - pad),
			Math.min(cw, x1 + pad),
			Math.min(ch, y1 + pad),
		];
		const [rw, rh] = [x1 - x0, y1 - y0];
		const trimmed = new Uint8ClampedArray(rw * rh * 4);
		for (let v = 0; v < rh; v++)
			trimmed.set(px.subarray(((y0 + v) * cw + x0) * 4, ((y0 + v) * cw + x1) * 4), v * rw * 4);
		/** A point of the rig's rest (rig units, y up) on this region's pixels. */
		const home = at(slotBone(L.part));
		const toRegion = ([wx, wy]) => {
			const q = fwd([c[0] + (wx - home[0]), c[1] - (wy - home[1])]);
			return [r1(q[0] - ox - x0), r1(q[1] - oy - y0)];
		};
		/** This region's pixel as a point of the rig's rest. */
		const toRig = ([x, y]) => {
			const [qx, qy] = [(x + x0 + ox) / S, (y + y0 + oy) / S];
			const cx = co * qx + si * qy + c[0];
			const cy = -si * qx + co * qy + c[1];
			return [home[0] + cx - c[0], home[1] - (cy - c[1])];
		};
		const kind = M.sheetKind(slotOf(M, L.part));
		const side = M.sheetSide(slotOf(M, L.part)) ?? 'l';
		const joints = L.with
			? null
			: Object.fromEntries(
					Object.entries(TRUE_BONES[kind]).map(([j, b]) => [
						j,
						toRegion(at(b.replace(/_s$/, `_${side}`))),
					]),
				);
		let face = null;
		if (L.part === 'head') {
			// The frame's face mesh in the rig's frame pose, carried onto the head's drawing at rest.
			const m = request.parts.find((p) => p.name === 'head').matrix;
			const [w, h] = cut.size;
			const det = m[0] * m[3] - m[1] * m[2];
			face = track.face.landmarks.map(([nx, ny]) => {
				const wx = request.scale * (nx * w - request.origin[0]) - m[4];
				const wy = -request.scale * (ny * h - request.origin[1]) - m[5];
				const [u, v] = [(m[3] * wx - m[1] * wy) / det, (m[0] * wy - m[2] * wx) / det];
				return toRegion([home[0] + u, home[1] + v]);
			});
		}
		regions.push({
			name: L.name,
			part: L.part,
			host: L.with,
			w: rw,
			h: rh,
			px: trimmed,
			joints,
			face,
			toRegion,
			toRig,
		});
	}
	for (const r of regions.filter((x) => x.host)) {
		const host = regions.find((x) => x.part === r.host);
		r.on = host.toRegion(r.toRig([r.w / 2, r.h / 2]));
	}
	for (const dcy of DECOYS) {
		const px = new Uint8ClampedArray(dcy.w * dcy.h * 4);
		for (let y = 0; y < dcy.h; y++)
			for (let x = 0; x < dcy.w; x++) {
				const e = ((x + 0.5) / dcy.w - 0.5) ** 2 + ((y + 0.5) / dcy.h - 0.5) ** 2;
				if (e <= 0.25) px.set(dcy.rgba, (y * dcy.w + x) * 4);
			}
		regions.push({ name: dcy.name, w: dcy.w, h: dcy.h, px });
	}
	// Shelf-packed, tallest first, two pixels apart.
	const PAGE_W = 1400;
	let [x, y, row, pageH] = [2, 2, 0, 0];
	for (const r of [...regions].sort((a, b) => b.h - a.h || a.name.localeCompare(b.name))) {
		if (x + r.w + 2 > PAGE_W) [x, y, row] = [2, y + row + 2, 0];
		[r.x, r.y] = [x, y];
		x += r.w + 2;
		row = Math.max(row, r.h);
		pageH = Math.max(pageH, y + r.h + 2);
	}
	const page = Buffer.alloc(PAGE_W * pageH * 4);
	for (const r of regions)
		for (let v = 0; v < r.h; v++)
			page.set(r.px.subarray(v * r.w * 4, (v + 1) * r.w * 4), ((r.y + v) * PAGE_W + r.x) * 4);
	mkdirSync(FIX, { recursive: true });
	await sharp(page, { raw: { width: PAGE_W, height: pageH, channels: 4 } })
		.png({ compressionLevel: 9 })
		.toFile(join(FIX, 'sheet.png'));
	const json = (v) => JSON.stringify(v, null, '\t') + '\n';
	writeFileSync(
		join(FIX, 'sheet.json'),
		json({
			width: PAGE_W,
			height: pageH,
			regions: regions.map(({ name, x: rx, y: ry, w, h }) => ({ name, x: rx, y: ry, w, h })),
		}),
	);
	writeFileSync(
		join(FIX, 'truth.json'),
		json({
			scale: SHEET_SCALE,
			parts: Object.fromEntries(
				regions
					.filter((r) => r.joints)
					.map((r) => [
						r.part,
						{ region: r.name, joints: r.joints, ...(r.face ? { face: r.face } : {}) },
					]),
			),
			props: regions
				.filter((r) => r.host)
				.map((r) => ({ part: r.part, region: r.name, host: r.host, on: r.on })),
		}),
	);
}

const slotOf = (M, part) => M.HALF_BODY.parts.find((p) => p.name === part)?.slot ?? part;
const M0 = await load();
if (process.argv.includes('--write')) {
	await writeSheet(M0);
	console.log(`wrote ${FIX}sheet.png, sheet.json, truth.json`);
	process.exit(0);
}

// ---- the sheet as ＋ New rig reads it ----------------------------------------------------------------
const SHEET = read(join(FIX, 'sheet.json'));
const TRUTH = read(join(FIX, 'truth.json'));
const PAGE = await sharp(join(FIX, 'sheet.png'))
	.ensureAlpha()
	.raw()
	.toBuffer({ resolveWithObject: true });
const REGIONS = SHEET.regions.map(({ name, w, h }) => ({ name, w, h }));
const regionOf = (name) => SHEET.regions.find((r) => r.name === name);
/** A region's alpha, as the page reads its drawing. */
function maskOf(name) {
	const r = regionOf(name);
	const alpha = new Uint8Array(r.w * r.h);
	for (let y = 0; y < r.h; y++)
		for (let x = 0; x < r.w; x++)
			alpha[y * r.w + x] = PAGE.data[((r.y + y) * PAGE.info.width + r.x + x) * 4 + 3];
	return { w: r.w, h: r.h, alpha };
}
const boneOfSlot = (M, slot) => M.HALF_BODY.slots.find((s) => s.name === slot).bone;
/** A hand pose drawn by the same hand: an alternate in its slot. */
const ALTERNATE = { part: 'hand_l_fist', as: 'hand_l' };
/** The mapping the page sends for the sheet: the true joints (or `joints`), the props on their hosts. */
function mappingOf(M, { joints = null, face = true, alternate = true } = {}) {
	const parts = {};
	for (const [part, t] of Object.entries(TRUTH.parts))
		parts[part] = {
			region: t.region,
			joints: joints?.[part] ?? t.joints,
			...(face && t.face ? { face: t.face } : {}),
		};
	if (alternate)
		parts[ALTERNATE.part] = {
			region: parts[ALTERNATE.as].region,
			joints: parts[ALTERNATE.as].joints,
		};
	return {
		sheet: 1,
		manifestKey: 'fixture/manifests/atlas_manifest_Sheet.json',
		template: { id: M.HALF_BODY.id, version: M.HALF_BODY.version },
		parts,
		props: TRUTH.props.map((p) => ({
			name: p.part,
			region: p.region,
			host: p.host,
			bone: boneOfSlot(M, slotOf(M, p.host)),
			at: p.on,
		})),
	};
}

const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
/** The rig's `.atlas` over `regions` (the manifest's, trim and all), as ＋ New rig writes it. */
function loadData(M, skeleton, regions = SHEET.regions) {
	const atlas = new RIG.TextureAtlas(
		M.regionsToRigAtlas('sheet.png', SHEET.width, SHEET.height, regions),
	);
	for (const p of atlas.pages) p.setTexture(stub);
	return new RIG.SkeletonJson(new RIG.AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(skeleton)),
	);
}
/** The rig ＋ New rig makes of `mapping` over the sheet's `regions`, loaded by engine-rig. */
function made(M, mapping = mappingOf(M), regions = SHEET.regions) {
	const sized = regions.map(({ name, w, h, origW, origH, offX, offY }) => ({
		name,
		w,
		h,
		origW,
		origH,
		offX,
		offY,
	}));
	const sr = M.sheetRig(M.HALF_BODY, sized, mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const rigged = M.templateRig(M.HALF_BODY, sized, sr.value.fit, sr.value.art);
	return { M, sr: sr.value, rigged, data: loadData(M, rigged.skeleton, regions), mapping, regions };
}
/**
 * The sheet with `HandL` trimmed as TexturePacker trims (its `offY` from the top), and a mapping
 * whose hand joints sit where the page measures them: on its ink drawn where the rig's `.atlas` puts
 * it, `offY` read from the bottom (`s2rCanvas` in view.html, editorRegions.ts).
 */
const TRIM = { offX: 10, offY: 5, padW: 30, padH: 20 };
function trimmed(M) {
	const r = regionOf('HandL');
	const [origW, origH] = [r.w + TRIM.padW, r.h + TRIM.padH];
	const shift = [TRIM.offX, origH - TRIM.offY - r.h];
	const regions = SHEET.regions.map((x) =>
		x.name === 'HandL' ? { ...x, offX: TRIM.offX, offY: TRIM.offY, origW, origH } : x,
	);
	const mapping = mappingOf(M);
	for (const m of Object.values(mapping.parts))
		if (m.region === 'HandL')
			m.joints = Object.fromEntries(
				Object.entries(m.joints).map(([j, p]) => [j, [p[0] + shift[0], p[1] + shift[1]]]),
			);
	return made(M, mapping, regions);
}
/** The rig posed at `time` of `anim` (an irig animation), or at rest. */
function posed(rig, anim = null, time = 0) {
	const data = anim
		? loadData(rig.M, { ...rig.rigged.skeleton, animations: { a: anim } }, rig.regions)
		: rig.data;
	const skel = new RIG.Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new RIG.AnimationState(new RIG.AnimationStateData(data));
		state.setAnimation(0, 'a', false);
		state.update(time);
		state.apply(skel);
	}
	skel.updateWorldTransform(RIG.Physics.update);
	return skel;
}
/** A slot's drawing in the world: vertices, triangles, its own UVs (0…1 of the image) and page UVs. */
function drawing(skel, slotName, attName) {
	const slot = skel.findSlot(slotName);
	const att = attName ? skel.getAttachmentByName(slotName, attName) : slot?.getAttachment();
	if (att instanceof RIG.MeshAttachment) {
		const v = new Float32Array(att.worldVerticesLength);
		att.computeWorldVertices(slot, 0, v.length, v, 0, 2);
		return { att, v, tris: att.triangles, own: att.regionUVs, page: att.uvs };
	}
	if (att instanceof RIG.RegionAttachment) {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		// Corners: bottom-left, top-left, top-right, bottom-right.
		return { att, v, tris: [0, 1, 2, 2, 3, 0], own: [0, 1, 0, 0, 1, 0, 1, 1], page: att.uvs };
	}
	return null;
}
/** A point of an image (0…1 from its top-left) where the drawing puts it in the world. */
function carried(dr, [u, v]) {
	let best = null;
	for (let k = 0; k < dr.tris.length; k += 3) {
		const [i, j, l] = [dr.tris[k], dr.tris[k + 1], dr.tris[k + 2]];
		const [ax, ay, bx, by, cx, cy] = [
			dr.own[i * 2],
			dr.own[i * 2 + 1],
			dr.own[j * 2],
			dr.own[j * 2 + 1],
			dr.own[l * 2],
			dr.own[l * 2 + 1],
		];
		const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
		if (Math.abs(det) < 1e-12) continue;
		const b1 = ((u - ax) * (cy - ay) - (cx - ax) * (v - ay)) / det;
		const b2 = ((bx - ax) * (v - ay) - (u - ax) * (by - ay)) / det;
		const worst = Math.min(1 - b1 - b2, b1, b2);
		if (!best || worst > best.worst) best = { worst, i, j, l, b1, b2 };
	}
	const { i, j, l, b1, b2 } = best;
	return [0, 1].map(
		(c) => (1 - b1 - b2) * dr.v[i * 2 + c] + b1 * dr.v[j * 2 + c] + b2 * dr.v[l * 2 + c],
	);
}
/** The point of a drawing's image (0…1 from its top-left) the drawing puts at `p` in the world. */
function uvUnder(dr, [x, y]) {
	for (let k = 0; k < dr.tris.length; k += 3) {
		const [i, j, l] = [dr.tris[k], dr.tris[k + 1], dr.tris[k + 2]];
		const [ax, ay, bx, by, cx, cy] = [i, j, l].flatMap((q) => [dr.v[q * 2], dr.v[q * 2 + 1]]);
		const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
		if (Math.abs(det) < 1e-12) continue;
		const b1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / det;
		const b2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / det;
		if (Math.min(b1, b2, 1 - b1 - b2) < -1e-9) continue;
		return [0, 1].map(
			(c) => (1 - b1 - b2) * dr.own[i * 2 + c] + b1 * dr.own[j * 2 + c] + b2 * dr.own[l * 2 + c],
		);
	}
	throw new Error(`no point of the drawing is at (${x}, ${y})`);
}
/** The middle of a drawing's vertices. */
const centreOf = (dr) => {
	const n = dr.v.length / 2;
	let [x, y] = [0, 0];
	for (let i = 0; i < n; i++) [x, y] = [x + dr.v[i * 2], y + dr.v[i * 2 + 1]];
	return [x / n, y / n];
};
/** A region pixel as a point of its image (0…1 from the top-left). */
const uvOf = (region, [x, y]) => {
	const r = regionOf(region);
	return [x / r.w, y / r.h];
};
const boneAt = (skel, n) => {
	const b = skel.findBone(n);
	return [b.worldX, b.worldY];
};
/** The bone each part's joint sits on, by kind (`_s` its side). */
const JOINT_BONES = {
	torso: { shoulder_l: 'upper_arm_l', shoulder_r: 'upper_arm_r', neck: 'neck' },
	neck: { base: 'neck', top: 'head' },
	head: { neck: 'head', face: 'face' },
	upper_arm: { shoulder: 'upper_arm_s', elbow: 'lower_arm_s' },
	lower_arm: { elbow: 'lower_arm_s', wrist: 'hand_s' },
	hand: { wrist: 'hand_s' },
};
function jointBones(M, part) {
	const slot = slotOf(M, part);
	const side = M.sheetSide(slot) ?? 'l';
	return Object.entries(JOINT_BONES[M.sheetKind(slot)] ?? {}).map(([j, b]) => [
		j,
		b.replace(/_s$/, `_${side}`),
	]);
}
/** The body parts and what each is drawn in (slot), as the rig has them. */
const bodyParts = (M) => Object.keys(TRUTH.parts).map((part) => ({ part, slot: slotOf(M, part) }));

// ---- the sheet arranged as the frame ---------------------------------------------------------------
/** `[a, b, c, d, x, y]` maps: `m` after `n`, the inverse, a point through one. */
const compose = (m, n) => [
	m[0] * n[0] + m[1] * n[2],
	m[0] * n[1] + m[1] * n[3],
	m[2] * n[0] + m[3] * n[2],
	m[2] * n[1] + m[3] * n[3],
	m[0] * n[4] + m[1] * n[5] + m[4],
	m[2] * n[4] + m[3] * n[5] + m[5],
];
function invert(m) {
	const det = m[0] * m[3] - m[1] * m[2];
	const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
	return [a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5])];
}
const apply = (m, [x, y]) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
/** The turn and scale (no shear) taking each `from` to its `to` best: least squares, as complex numbers. */
function similarity(pairs) {
	const n = pairs.length;
	const [qc, wc] = [0, 1].map((k) => [0, 1].map((c) => pairs.reduce((s, p) => s + p[k][c], 0) / n));
	let [re, im, nn] = [0, 0, 0];
	for (const [q, w] of pairs) {
		const [qx, qy, wx, wy] = [q[0] - qc[0], q[1] - qc[1], w[0] - wc[0], w[1] - wc[1]];
		re += wx * qx + wy * qy;
		im += wy * qx - wx * qy;
		nn += qx * qx + qy * qy;
	}
	const [a, b] = [re / nn, im / nn];
	return [a, -b, b, a, wc[0] - (a * qc[0] - b * qc[1]), wc[1] - (b * qc[0] + a * qc[1])];
}
/** The joint each of a part's joints is at rest, the torso's hips the root (`TRUE_BONES`). */
const trueBone = (M, part, j) => {
	const slot = slotOf(M, part);
	return TRUE_BONES[M.sheetKind(slot)][j].replace(/_s$/, `_${M.sheetSide(slot) ?? 'l'}`);
};
/** The arrange canvas the frame is laid on: the sheet's 1.6 pixels a rig unit, y down, origin here. */
const CANVAS_ORIGIN = [700, 1100];
/**
 * The sheet arranged as the F2 fixture's frame: each body part's drawing where the frame has its
 * part (its true joints are its bones at the frame fit's rest; the frame clip carries each with its
 * bone), on a canvas at the sheet's scale, then the whole canvas turned `turn` degrees (clockwise on
 * the page) about `about`. `only`: the parts arranged (the rest left to ride their bones).
 */
function arrangedAsFrame(M, { turn = 0, about = CANVAS_ORIGIN, only = null } = {}) {
	const fit = FRAME.ff.fit;
	const fitted = M.fitTemplate(M.HALF_BODY, fit);
	const rest = M.frameWorld(fitted.bones);
	const pose = M.frameWorld(fitted.bones, fit.frame);
	const r = (turn * Math.PI) / 180;
	const spin = [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r), 0, 0];
	spin[4] = about[0] - (spin[0] * about[0] + spin[1] * about[1]);
	spin[5] = about[1] - (spin[2] * about[0] + spin[3] * about[1]);
	const toCanvas = compose(spin, [TRUTH.scale, 0, 0, -TRUTH.scale, ...CANVAS_ORIGIN]);
	const arrange = {};
	for (const [part, t] of Object.entries(TRUTH.parts)) {
		if (only && !only.includes(part)) continue;
		const reg = regionOf(t.region);
		const img = ([x, y]) => [x - reg.w / 2, reg.h / 2 - y];
		const pairs = Object.keys(t.joints).map((j) => {
			const w = rest.get(trueBone(M, part, j));
			return [img(t.joints[j]), [w[4], w[5]]];
		});
		const bone = boneOfSlot(M, slotOf(M, part));
		const F = compose(
			toCanvas,
			compose(pose.get(bone), compose(invert(rest.get(bone)), similarity(pairs))),
		);
		arrange[part] = {
			at: apply(F, [0, 0]).map((v) => Math.round(v * 1e3) / 1e3),
			turn: Math.round(((Math.atan2(F[2], F[0]) * 180) / Math.PI) * 1e4) / 1e4,
		};
	}
	return { ...mappingOf(M), arrange };
}
/** The rig posed by its own `frame` clip. */
const framePosed = (rig) => posed(rig, rig.rigged.skeleton.animations?.frame ?? { bones: {} }, 0);
/** A bone's turn in the world (degrees, y up) in `skel`. */
const worldTurn = (skel, n) => {
	const b = skel.findBone(n);
	return (Math.atan2(b.c, b.a) * 180) / Math.PI;
};
const wrapDeg = (d) => d - 360 * Math.round(d / 360);
/** Each body part's (and the hand pose's) joints off their bones in `skel`: the worst, and which. */
function jointsOff(M, rig, skel) {
	let off = { d: 0, what: '' };
	for (const { part, slot } of [...bodyParts(M), { part: ALTERNATE.part, slot: 'hand_l' }]) {
		const map = rig.mapping.parts[part];
		const dr = drawing(skel, slot, part);
		for (const [j, bone] of jointBones(M, part)) {
			const d = d2(carried(dr, uvOf(map.region, map.joints[j])), boneAt(skel, bone));
			if (d > off.d) off = { d, what: `${part}.${j} → ${bone}` };
		}
	}
	return off;
}

// ---- the page's motion keying ----------------------------------------------------------------------
/** The page's keying of a solved capture (`faceKeyMotion` and what it calls), with `mutations`. */
function pageKeys(mutations = []) {
	let src = PAGE_SRC;
	for (const [, from, to] of mutations) {
		if (!src.includes(from)) throw new Error(`mutant: "${from}" is not in view.html`);
		src = src.replace(from, to);
	}
	const fn = (name) => {
		const at = src.indexOf(`\nfunction ${name}(`);
		if (at === -1) throw new Error(`view.html has no function ${name}`);
		let depth = 0;
		let j = src.indexOf('{', at);
		for (; j < src.length; j++) {
			if (src[j] === '{') depth++;
			else if (src[j] === '}' && --depth === 0) break;
		}
		return src.slice(at, j + 1);
	};
	const cst = (name) => src.match(new RegExp(`\\nconst ${name} = [^\\n]*`))[0];
	const fns = [
		'bezierValue',
		'sampleChannel',
		'upsertKey',
		'upsertBoneKey',
		'faceSwapPart',
		'faceOrderStep',
		'faceOrderAt',
		'faceOrderOffsets',
		'drawOrderOfOffsets',
		'faceOrderOfKey',
		'faceOrderValue',
		'faceOrderKeyAt',
		'faceOrderValues',
		'faceKeyOrder',
		'faceKeyMix',
		'faceIkSetup',
		'faceAttachmentAt',
		'faceShapePart',
		'faceDrawnMouth',
		'faceKeyAttachment',
		'faceKeyChannel',
		'faceShapeControls',
		'faceKeyShape',
		'faceKeyMotion',
	];
	return new Function(
		[
			'const rawDoc = null;',
			...['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'].map(cst),
			...fns.map(fn),
			'return { faceKeyMotion };',
		].join('\n'),
	)();
}

/** A performer raising, swinging and bending both arms and leaning, as 🎥 Motion tracks one. */
const CAPTURE_FPS = 15;
const CAPTURE_FRAMES = 31;
function captureTrack() {
	return performer(CAPTURE_FRAMES, CAPTURE_FPS, (i) => {
		const s = Math.sin((i / (CAPTURE_FRAMES - 1)) * Math.PI * 2);
		const up = (1 - Math.cos((i / (CAPTURE_FRAMES - 1)) * Math.PI * 2)) / 2;
		return {
			pose: {
				body: { lean: 8 * s, yaw: 0 },
				arms: {
					l: { upper: dirOf(-20 - 80 * up), lower: dirOf(-20 - 80 * up - 70 * up) },
					r: { upper: dirOf(20 + 60 * up), lower: dirOf(20 + 60 * up + 50 * Math.abs(s)) },
				},
			},
			opts: {},
		};
	});
}
/** `rig` keyed from 0 with a capture solved on its fitted template, through the page's keying. */
function captured(rig, mutations = rig.M.PAGE_MUTATIONS) {
	const M = rig.M;
	const t = M.fitTemplate(M.HALF_BODY, rig.sr.fit);
	const solved = M.solveMotion(
		{ bones: t.bones, channels: t.channels, motion: t.motion },
		captureTrack(),
		{ face: false, hand: false },
	);
	const skin = rig.rigged.skeleton.skins[0].attachments;
	const has = (slot, part) => !!skin[slot]?.[part];
	const anim = {};
	pageKeys(mutations).faceKeyMotion(
		anim,
		solved.keys,
		0,
		t.channels,
		has,
		rig.rigged.skeleton.slots.map((s) => s.name),
	);
	return { anim, length: solved.length };
}

/** A performer still but for the face: at rest, then turning, nodding and tilting the head. */
const FACE_FRAMES = 31;
const FACE_REST = 8;
function faceTrack() {
	return performer(FACE_FRAMES, CAPTURE_FPS, (i) => {
		const a =
			i < FACE_REST ? 0 : Math.sin(((i - FACE_REST) / (FACE_FRAMES - 1 - FACE_REST)) * Math.PI * 2);
		return { pose: {}, opts: { face: P3.mm(P3.ry(30 * a), P3.mm(P3.rx(10 * a), P3.rz(6 * a))) } };
	});
}
/** `rig` keyed from 0 with a face capture, solved and keyed as 🎥 Motion does. */
function faceCaptured(rig, mutations = rig.M.PAGE_MUTATIONS) {
	const M = rig.M;
	const t = M.fitTemplate(M.HALF_BODY, rig.sr.fit);
	const solved = M.solveMotion(
		{ bones: t.bones, channels: t.channels, motion: t.motion },
		faceTrack(),
		{ face: true, body: false, hand: false },
	);
	const skin = rig.rigged.skeleton.skins[0].attachments;
	const has = (slot, part) => !!skin[slot]?.[part];
	const anim = {};
	pageKeys(mutations).faceKeyMotion(
		anim,
		solved.keys,
		0,
		t.channels,
		has,
		rig.rigged.skeleton.slots.map((s) => s.name),
	);
	return { anim, length: solved.length };
}

/** The fixture's frame: its pixels, its track's fit (scale, origin, the frame pose's turns). */
async function frameCase(M) {
	const frame = await sharp(join(F1, 'frame.png'))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const cut = read(join(F1, 'parts/cut.json'));
	const labels = await sharp(join(F1, 'parts/labels.png')).extractChannel(0).raw().toBuffer();
	const track = read(join(F1, 'track.json'));
	const j = M.frameJoints(track, cut.size[0], cut.size[1]).value;
	const ff = M.frameFit(M.HALF_BODY, j).value;
	return { frame, cut, labels, track, ff };
}
const FRAME = await frameCase(M0);

/**
 * The rig drawn into the frame's pixels (rig world to frame by the frame's fit): its coverage, each
 * drawing's alpha sampled from the sheet's page, front over back.
 */
function raster(skel, only = null) {
	const [w, h] = FRAME.cut.size;
	const { scale: k, origin } = FRAME.ff;
	const cover = new Float32Array(w * h);
	const pw = PAGE.info.width;
	const ph = PAGE.info.height;
	const alphaAt = (u, v) => {
		const [x, y] = [Math.floor(u * pw), Math.floor(v * ph)];
		if (x < 0 || y < 0 || x >= pw || y >= ph) return 0;
		return PAGE.data[(y * pw + x) * 4 + 3] / 255;
	};
	for (const slot of skel.drawOrder) {
		const dr = drawing(skel, slot.data.name);
		if (!dr || (only && !only.includes(dr.att.name))) continue;
		const px = [];
		for (let i = 0; i < dr.v.length; i += 2)
			px.push([dr.v[i] / k + origin[0], -dr.v[i + 1] / k + origin[1]]);
		for (let t = 0; t < dr.tris.length; t += 3) {
			const [a, b, c] = [dr.tris[t], dr.tris[t + 1], dr.tris[t + 2]];
			const [A, B, C] = [px[a], px[b], px[c]];
			const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
			if (Math.abs(det) < 1e-9) continue;
			const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
			const x1 = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
			const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
			const y1 = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
			for (let y = y0; y <= y1; y++)
				for (let x = x0; x <= x1; x++) {
					const [qx, qy] = [x + 0.5, y + 0.5];
					const b1 = ((qx - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (qy - A[1])) / det;
					const b2 = ((B[0] - A[0]) * (qy - A[1]) - (qx - A[0]) * (B[1] - A[1])) / det;
					if (b1 < -1e-6 || b2 < -1e-6 || b1 + b2 > 1 + 1e-6) continue;
					const b0 = 1 - b1 - b2;
					const u = b0 * dr.page[a * 2] + b1 * dr.page[b * 2] + b2 * dr.page[c * 2];
					const v = b0 * dr.page[a * 2 + 1] + b1 * dr.page[b * 2 + 1] + b2 * dr.page[c * 2 + 1];
					const al = alphaAt(u, v);
					const i = y * w + x;
					cover[i] += al * (1 - cover[i]);
				}
		}
	}
	return cover;
}

/** Alpha IoU of `skel` drawn into the frame against the frame's `parts` (the cut's labels). */
function frameIoU(skel, parts) {
	const { labels, cut } = FRAME;
	const cover = raster(skel, parts);
	const drawn = new Set(parts.map((n) => cut.names.indexOf(n)));
	let [both, either] = [0, 0];
	for (let i = 0; i < cover.length; i++) {
		const a = cover[i] >= 0.5;
		const b = drawn.has(labels[i]) && FRAME.frame.data[i * 4 + 3] >= 128;
		if (a && b) both++;
		if (a || b) either++;
	}
	return both / either;
}

/** The capture keyed onto `rig` (as 🎥 Motion keys it): whether every part rides its bone, and what it measured. */
function captureRides(M, rig, label) {
	let good = true;
	const { anim, length } = captured(rig);
	const rest = posed(rig);
	// A prop is measured against the bone it hangs from, not its own (which rides along).
	const parts = [
		...bodyParts(M),
		...rig.mapping.props.map((p) => ({ part: p.name, slot: p.name, on: p.bone })),
	];
	// At rest: each drawing's middle in its bone's frame, its length, and its joints.
	const home = parts.map(({ part, slot, on }) => {
		const dr = drawing(rest, slot, part);
		const bone = on ? rest.findBone(on) : rest.findSlot(slot).bone;
		const c = centreOf(dr);
		const local = bone.worldToLocal(new RIG.Vector2(c[0], c[1]));
		const map = rig.mapping.parts[part];
		const joints = map ? jointBones(M, part) : [];
		const pts = joints.map(([j]) => carried(dr, uvOf(map.region, map.joints[j])));
		const span =
			pts.length > 1 ? d2(pts[0], pts[1]) : Math.hypot(dr.att.width ?? 0, dr.att.height ?? 0) || 1;
		return { part, slot, bone: bone.data.name, local: [local.x, local.y], span, joints, map };
	});
	let worst = { centre: 0, joint: 0, cwhat: '', jwhat: '' };
	const moved = {};
	const steps = 24;
	for (let s = 0; s <= steps; s++) {
		const time = (length * s) / steps;
		const skel = posed(rig, anim, time);
		for (const h of home) {
			const dr = drawing(skel, h.slot, h.part);
			const bone = skel.findBone(h.bone);
			const want = bone.localToWorld(new RIG.Vector2(h.local[0], h.local[1]));
			const dc = d2(centreOf(dr), [want.x, want.y]) / h.span;
			if (dc > worst.centre)
				worst = { ...worst, centre: dc, cwhat: `${h.part} at ${time.toFixed(2)} s` };
			for (const [j, b] of h.joints) {
				const dj = d2(carried(dr, uvOf(h.map.region, h.map.joints[j])), boneAt(skel, b)) / h.span;
				if (dj > worst.joint)
					worst = { ...worst, joint: dj, jwhat: `${h.part}.${j} at ${time.toFixed(2)} s` };
			}
			const c = centreOf(dr);
			const c0 = centreOf(drawing(rest, h.slot, h.part));
			moved[h.part] = Math.max(moved[h.part] ?? 0, d2(c, c0));
		}
	}
	for (const part of ['upper_arm_l', 'lower_arm_l', 'hand_l', 'lower_arm_r', 'hand_r'])
		good =
			ok(
				`${label}capture: ${part} moves (≥ ${MOVES})`,
				moved[part] >= MOVES,
				`${moved[part]?.toFixed(1)}`,
			) && good;
	good =
		ok(
			`${label}capture: every part's middle rides its bone (≤ ${RIDES.centre} of its length)`,
			worst.centre <= RIDES.centre,
			`${worst.centre.toFixed(4)} (${worst.cwhat})`,
		) && good;
	good =
		ok(
			`${label}capture: every joint stays on its bone (≤ ${RIDES.joint} of its length)`,
			worst.joint <= RIDES.joint,
			`${worst.joint.toFixed(4)} (${worst.jwhat})`,
		) && good;
	return [
		good,
		`${length.toFixed(2)} s keyed; parts moved ${Object.entries(moved)
			.filter(([p]) => !p.startsWith('prop'))
			.map(([p, d]) => `${p} ${d.toFixed(0)}`)
			.join(
				', ',
			)}; worst middle ${worst.centre.toFixed(4)} (${worst.cwhat}), worst joint ${worst.joint.toFixed(4)} (${worst.jwhat}) of its length`,
	];
}

// ---- the guards ------------------------------------------------------------------------------------
const TPL_PARTS = (M) => M.HALF_BODY.parts.map((p) => p.name);
/**
 * The fixture's sided regions as the owner names them — the character's own left and right, so each
 * the other way round from the template's — one (`hand_r`, the picture's left hand) exactly as the
 * template names its other side.
 */
const OWNER_NAMES = {
	L_arm_upper: 'R_arm_upper',
	arm_lower_left: 'arm_lower_right',
	HandL: 'hand_r',
	ArmR1: 'ArmL1',
	ArmR2: 'ArmL2',
	'hand-right': 'hand-left',
	earring_L: 'earring_R',
	watch_R: 'watch_L',
};
/** Names an artist writes, and the part each must be read as (null: none). */
const NAMES = [
	['UpperArm.L', 'upper_arm_l'],
	['forearmR', 'lower_arm_r'],
	['ArmL1', 'upper_arm_l'],
	['Arm_L_2', 'lower_arm_l'],
	['brazo_izq_1', 'upper_arm_l'],
	['HandL_Fist', 'hand_l_fist'],
	['hand_r_point', 'hand_r_point'],
	['Head_3q_Left', 'head_3q_l'],
	['cabeza', 'head'],
	['Torso', 'torso'],
	['eyebrow_L', null],
	['shadow', null],
];
/** How far a guessed joint may land from the true one: a share of its drawing's longer side. */
const GUESS_TOLERANCE = 0.12;
/** The same for the head's joints read off the face the tracker finds on it. */
const FACE_TOLERANCE = 0.03;
/** The scale the guessed joints give, against the sheet's own (a share). */
const SCALE_TOLERANCE = 0.1;
/** How far a joint may sit off its bone at rest, rig units (the vertices are written to 1e-4). */
const ON_BONE = 0.05;
/**
 * The same in the `frame` pose: each part placed by its own joints, written to 0.1 sheet pixel, so
 * the chain carries each rounding on to the next part.
 */
const FRAME_ON_BONE = 0.1;
/** How far the redrawn frame may differ: alpha IoU of the parts mapped. */
const REDRAW_IOU = 0.98;
/** A trimmed region redraws within this IoU of itself untrimmed. */
const TRIM_IOU = 0.03;
/** Through the capture: a part's middle and joints off where their bones carry them, share of its length. */
const RIDES = { centre: 0.1, joint: 0.06 };
/** Each arm part moves at least this far through the capture (rig units): the check is not vacuous. */
const MOVES = 40;
/** The chain bones an arrangement turns, each as the frame fit does (its world turn, degrees). */
const ARRANGED_CHAIN = [
	'chest',
	'neck',
	'head',
	...['l', 'r'].flatMap((s) => [`upper_arm_${s}`, `lower_arm_${s}`, `hand_${s}`]),
];
const TURN_TOLERANCE = 0.05;
/** How far an eye bone may sit from the drawn eye's middle (the face mesh's corners), rig units. */
const EYE_ON = 0.5;
/** How far a skin joint may sit from its joint in the frame pose (the rig's offsets are written to 1e-4). */
const SKIN_AT = 0.01;

// ---- a face drawn in parts (the owner's sheet, 2026-11-24) -------------------------------------------
/**
 * Face drawings exported one per Photoshop layer, beside the fixture's body: pupils, upper lids, the
 * half-closed lids, the nose, one mouth shape and one raised brow (the last two bend on their bones),
 * each placed by its pivot (off the middle on the nose and the brow).
 */
const FACE_DRAWN = [
	['pupil_l', '0002s_0002s_0003_PupilL', 38, 38],
	['pupil_r', '0002s_0003s_0003_PupilR', 38, 38],
	['lid_upper_l', '0002s_0002s_0001_UpperEyelidL', 102, 48],
	['lid_upper_r', '0002s_0003s_0002_UpperEyelidR', 102, 48],
	['eyelid_l_half', '0002s_0002s_0002_UnderEyelidL', 99, 67],
	['eyelid_r_half', '0002s_0003s_0001_UnderEyelidR', 99, 67],
	['nose', '0002s_0001s_0000_Nose', 64, 80, [0.5, 0.7]],
	['mouth_smile', '0002s_0004s_0000_MouthSmile', 144, 96],
	['brow_l_up', '0002s_0002s_0000_BrowLUp', 112, 32, [0.35, 0.5]],
].map(([part, layer, w, h, pivot]) => ({
	part,
	region: `NellyAssetBreakdown1_${layer}`,
	w,
	h,
	...(pivot ? { pivot } : {}),
}));
/**
 * The fixture's regions as Photoshop's Export Layers names them: `<file>_<layer>` from the top of
 * the layers panel, a group's layers `<group>s_<layer>`, so a lower number is drawn in front. The
 * hood's back and its lining (the decoys `bg_glow`, `shadow_blob`) are drawn behind the torso, the chain
 * in front of it.
 */
const PSD_LAYERS = {
	HandL: '0000s_0000_HandLPointing',
	arm_lower_left: '0000s_0001_ForeArmL',
	L_arm_upper: '0000s_0002_UpperArmL',
	watch_R: '0001s_0000_WatchR',
	'hand-right': '0001s_0001_HandRPissoff',
	ArmR2: '0001s_0002_ForeArmR',
	ArmR1: '0001s_0003_UpperArmR',
	Sunglasses: '0002s_0000_Glasses',
	earring_L: '0003_EarringL',
	head_front: '0004_Head',
	gold_chain: '0005_Chain',
	Neck01: '0006_Neck',
	Body_Main: '0007_Torso',
	bg_glow: '0008_HoodBack',
	shadow_blob: '0009_HoodLining',
};
const psdName = (name) => (PSD_LAYERS[name] ? `NellyAssetBreakdown1_${PSD_LAYERS[name]}` : name);
/**
 * The owner's sheet shape (2026-11-24): every drawing a Photoshop layer of its own, the body arranged
 * as the F2 frame, its props worn and a hood's back and lining behind the torso, and a face drawn in parts
 * (`FACE_DRAWN`) beside the head (`face: false` — no face found on the head).
 */
function ownerSheet(M, { face = true } = {}) {
	const regions = [
		...SHEET.regions.map((r) => ({ ...r, name: psdName(r.name) })),
		...FACE_DRAWN.map(({ region, w, h }, i) => ({
			name: region,
			x: (i % 4) * 130,
			y: Math.floor(i / 4) * 70,
			w,
			h,
		})),
	];
	const a = arrangedAsFrame(M);
	const parts = {};
	for (const [part, m] of Object.entries(a.parts))
		parts[part] =
			face || !m.face
				? { ...m, region: psdName(m.region) }
				: { region: psdName(m.region), joints: m.joints };
	for (const { part, region, w, h, pivot = [0.5, 0.5] } of FACE_DRAWN)
		parts[part] = { region, joints: { pivot: [pivot[0] * w, pivot[1] * h] } };
	const props = [
		...a.props.map((p) => ({ ...p, region: psdName(p.region) })),
		{
			name: 'prop_hood_back',
			region: psdName('bg_glow'),
			host: 'torso',
			bone: 'chest',
			at: a.parts.torso.joints.neck,
		},
		{
			name: 'prop_hood_lining',
			region: psdName('shadow_blob'),
			host: 'torso',
			bone: 'chest',
			at: a.parts.torso.joints.neck,
		},
	];
	return { regions, mapping: { ...a, parts, props } };
}
/** The template's starred face parts that sheet leaves out: the rig is made, and they are listed. */
const STARRED_LEFT_OUT = [
	'eyelid_l_closed',
	'eyelid_r_closed',
	'brow_l_neutral',
	'brow_r_neutral',
	'mouth_rest',
	'mouth_A',
	'mouth_O',
];
/** How far a face drawing may draw off where its sheet placed it in the frame, rig units. */
const DRAWN_AT = 0.01;
/** How far a bone is nudged to see what of a drawing follows it, rig units. */
const NUDGE = 4;
/** How far a weight may be from inverse squared distance to where the frame puts its bone. */
const WEIGHT_AT = 0.01;
/** How far off the sheet's scale a rigid drawing may be drawn (rig offsets are written to 1e-4). */
const SCALE_KEPT = 0.005;
/**
 * A triangle of a drawing that bends inside itself keeps at least this share of its drawn area,
 * unflipped (a torso bent at its waist squashes its inner side to about a quarter; folded is 0).
 */
const FOLD = 0.1;
/** Degrees the head is turned, and the share of each point's move it may fall short or wide by. */
const HEAD_TURN = 15;
const HEAD_LEFT = 0.01;
/** The face drawings a head drawn without its face must carry along under a head turn. */
const FACE_LOCKED = [
	'pupil_l',
	'pupil_r',
	'lid_upper_l',
	'lid_upper_r',
	'mouth_smile',
	'brow_l_up',
];
/**
 * The share of a feature's move the head under it may slip by — the lids and brows, at the face's
 * corners, lie past its region's whole core and keep about 80% of it (the head's grid a little less)
 * — and how far its outline may move.
 */
const FACE_SLIP = 0.25;
const OUTLINE_KEPT = 0.01;
/** A capture's ±30° head turn slides a face drawn apart at least this far (rig units). */
const TURN_SHOWN = 5;
/**
 * The owner's sheet with its head trimmed as TexturePacker trims it, unevenly (its `offY` from the
 * bottom), the head's joints, the props on it and its place on the arrange canvas moved with its ink.
 */
const HEAD_TRIM = { offX: 12, offY: 4, padW: 40, padH: 120 };
function trimmedHead({ regions, mapping }) {
	const head = mapping.parts.head;
	const r0 = regions.find((x) => x.name === head.region);
	const [origW, origH] = [r0.w + HEAD_TRIM.padW, r0.h + HEAD_TRIM.padH];
	const top = origH - HEAD_TRIM.offY - r0.h;
	const shift = (p) => [p[0] + HEAD_TRIM.offX, p[1] + top];
	const out = structuredClone(mapping);
	out.parts.head = {
		...head,
		joints: Object.fromEntries(Object.entries(head.joints).map(([j, p]) => [j, shift(p)])),
		...(head.face ? { face: head.face.map(shift) } : {}),
	};
	for (const p of out.props) if (p.host === 'head') p.at = shift(p.at);
	const a = out.arrange?.head;
	if (a) {
		// The untrimmed middle, from the ink's: the ink stays where it was arranged.
		const [qx, qy] = [origW / 2 - r0.w / 2 - HEAD_TRIM.offX, origH / 2 - r0.h / 2 - top];
		const t = (a.turn * Math.PI) / 180;
		a.at = [
			a.at[0] + Math.cos(t) * qx - Math.sin(t) * qy,
			a.at[1] + Math.sin(t) * qx + Math.cos(t) * qy,
		];
	}
	return {
		regions: regions.map((x) =>
			x === r0 ? { ...x, offX: HEAD_TRIM.offX, offY: HEAD_TRIM.offY, origW, origH } : x,
		),
		mapping: out,
	};
}

/**
 * Each triangle of a drawing (image `w` × `h` pixels) as drawn: the two stretches (singular values)
 * of its image-to-world map, rig units per image pixel, and its signed area scale (negative: flipped).
 */
function stretches(dr, w, h) {
	const out = [];
	const img = (i) => [(dr.own[i * 2] - 0.5) * w, (0.5 - dr.own[i * 2 + 1]) * h];
	const wld = (i) => [dr.v[i * 2], dr.v[i * 2 + 1]];
	for (let t = 0; t < dr.tris.length; t += 3) {
		const [a, b, c] = [dr.tris[t], dr.tris[t + 1], dr.tris[t + 2]];
		const [e1, e2] = [img(b), img(c)].map((p) => [p[0] - img(a)[0], p[1] - img(a)[1]]);
		const [f1, f2] = [wld(b), wld(c)].map((p) => [p[0] - wld(a)[0], p[1] - wld(a)[1]]);
		const det = e1[0] * e2[1] - e2[0] * e1[1];
		if (Math.abs(det) < 1e-6) continue;
		// A = F · E⁻¹
		const [i00, i01, i10, i11] = [e2[1] / det, -e2[0] / det, -e1[1] / det, e1[0] / det];
		const A = [
			f1[0] * i00 + f2[0] * i10,
			f1[0] * i01 + f2[0] * i11,
			f1[1] * i00 + f2[1] * i10,
			f1[1] * i01 + f2[1] * i11,
		];
		const S = A[0] ** 2 + A[1] ** 2 + A[2] ** 2 + A[3] ** 2;
		const D = A[0] * A[3] - A[1] * A[2];
		const root = Math.sqrt(Math.max(0, S * S - 4 * D * D));
		out.push([Math.sqrt((S + root) / 2), Math.sqrt(Math.max(0, (S - root) / 2)), D]);
	}
	return out;
}
/** What `/api/rigger/new` makes of `raw` over `regions` (`resolveNewRigBody`): throws its refusal. */
function created(M, t, raw, regions) {
	const parsed = M.parseSheetMapping(JSON.parse(JSON.stringify(raw)));
	if ('problem' in parsed) throw new Error(parsed.problem);
	const sized = regions.map(({ name, w, h, origW, origH, offX, offY }) => ({
		name,
		w,
		h,
		origW,
		origH,
		offX,
		offY,
	}));
	const sr = M.sheetRig(t, sized, parsed.mapping);
	if (!sr.ok) throw new Error(sr.problem);
	const misfit = M.templateFitProblem(t, sr.value.fit);
	if (misfit) throw new Error(misfit);
	const rigged = M.templateRig(t, sized, sr.value.fit, sr.value.art);
	const problem = M.irigDocProblem(rigged.skeleton);
	if (problem) throw new Error(problem);
	const data = loadData(M, rigged.skeleton, regions);
	return { M, sr: sr.value, rigged, data, mapping: parsed.mapping, regions };
}
/** Half body as a template made in the Rigger may have it: its brows bend on bones not placed on the image. */
function browsUnplaced(M) {
	const t = structuredClone(M.HALF_BODY);
	for (const p of t.parts)
		if (p.name.startsWith('brow_'))
			p.bend = { ...p.bend, bones: p.bend.bones.map(({ bone }) => ({ bone })) };
	return t;
}
/**
 * A face drawing on a sheet bends on its bones from where it is drawn. With its bones placed on the
 * image (`at`), nudging one carries the drawing's point nearest its place and leaves the points by the
 * others; with them placed only in the rig, each point's weights are by inverse squared distance to
 * where the frame puts each bone on the drawing (`bendMesh`).
 */
function bentFromDrawn(M, rig, skel, t, part, what) {
	const { bend } = t.parts.find((p) => p.name === part);
	const slot = slotOf(M, part);
	const { w, h } = FACE_DRAWN.find((f) => f.part === part);
	const before = drawing(skel, slot, part);
	const n = before.own.length / 2;
	const nearest = ([u, v]) => {
		let best = 0;
		for (let i = 1; i < n; i++)
			if (
				Math.hypot(before.own[i * 2] - u, before.own[i * 2 + 1] - v) <
				Math.hypot(before.own[best * 2] - u, before.own[best * 2 + 1] - v)
			)
				best = i;
		return best;
	};
	const at = (dr, i) => [dr.v[i * 2], dr.v[i * 2 + 1]];
	if (bend.bones.every((b) => b.at)) {
		let good = true;
		for (const b of bend.bones) {
			const was = boneAt(skel, b.bone);
			skel.findBone(b.bone).x += NUDGE;
			skel.updateWorldTransform(RIG.Physics.update);
			const moved = d2(boneAt(skel, b.bone), was);
			const after = drawing(skel, slot, part);
			skel.findBone(b.bone).x -= NUDGE;
			skel.updateWorldTransform(RIG.Physics.update);
			const share = (i) => d2(at(after, i), at(before, i)) / moved;
			const far = bend.bones.filter((c) => Math.hypot(c.at[0] - b.at[0], c.at[1] - b.at[1]) >= 0.6);
			const left = Math.max(0, ...far.map((c) => share(nearest(c.at))));
			good =
				ok(
					`partialface (${what}): ${part} bends on ${b.bone} from where it is drawn`,
					share(nearest(b.at)) >= 0.75 && left <= 0.25,
					`carried ${share(nearest(b.at)).toFixed(3)}, left ${left.toFixed(3)}`,
				) && good;
		}
		return good;
	}
	const att = rig.rigged.skeleton.skins[0].attachments[slot][part];
	const names = rig.rigged.skeleton.bones.map((b) => b.name);
	const onImage = invert(rig.sr.art[part].matrix);
	const anchors = bend.bones.map((b) => ({
		bone: b.bone,
		at: apply(onImage, boneAt(skel, b.bone)),
	}));
	const eps = (0.04 * Math.max(w, h)) ** 2;
	let worst = 0;
	for (let i = 0, k = 0; i < att.uvs.length / 2; i++) {
		const [x, y] = [(att.uvs[i * 2] - 0.5) * w, (0.5 - att.uvs[i * 2 + 1]) * h];
		const raw = anchors.map((a) => 1 / ((x - a.at[0]) ** 2 + (y - a.at[1]) ** 2 + eps));
		const shares = raw
			.map((r) => r / raw.reduce((s, q) => s + q, 0))
			.map((r) => (r >= 0.01 ? r : 0));
		const kept = shares.reduce((s, r) => s + r, 0);
		const got = {};
		for (let j = att.vertices[k++]; j > 0; j--, k += 4)
			got[names[att.vertices[k]]] = att.vertices[k + 3];
		anchors.forEach((a, j) => {
			worst = Math.max(worst, Math.abs((got[a.bone] ?? 0) - shares[j] / kept));
		});
	}
	return ok(
		`partialface (${what}): ${part}'s weights read where the frame puts its bones on the drawing`,
		worst <= WEIGHT_AT,
		`${worst}`,
	);
}

const GUARDS = {
	/** Every body part matched to its region by name; the props to their hosts; the decoys to none. */
	suggest(M, log) {
		let good = true;
		const got = M.suggestSheetMap(
			TPL_PARTS(M),
			REGIONS.map((r) => r.name),
		);
		for (const [part, t] of Object.entries(TRUTH.parts))
			good =
				ok(`suggest: ${t.region} is ${part}`, got[part] === t.region, `got ${got[part]}`) && good;
		const used = new Set(Object.values(got));
		for (const r of REGIONS.filter(
			(x) => !Object.values(TRUTH.parts).some((t) => t.region === x.name),
		))
			good = ok(`suggest: ${r.name} is no part`, !used.has(r.name), JSON.stringify(got)) && good;
		const mapped = new Set(Object.keys(got));
		for (const p of TRUTH.props) {
			const s = M.suggestProp(p.region, mapped);
			good =
				ok(`suggest: ${p.region} is a prop on ${p.host}`, s?.host === p.host, JSON.stringify(s)) &&
				good;
		}
		for (const name of ['shadow_blob', 'bg_glow'])
			good = ok(`suggest: ${name} is no prop`, M.suggestProp(name, mapped) === null) && good;
		for (const [name, part] of NAMES) {
			const one = M.suggestSheetMap(TPL_PARTS(M), [name]);
			const as = Object.entries(one).find(([, r]) => r === name)?.[0] ?? null;
			good =
				ok(`suggest: "${name}" reads as ${part ?? 'nothing'}`, as === part, `got ${as}`) && good;
		}
		good =
			ok(
				'suggest: an arm of the other side is never this side',
				M.nameScore('upper_arm_l', 'ArmR1') === 0,
			) && good;
		log(
			`${Object.keys(got).length} parts suggested from ${REGIONS.length} regions; ${NAMES.length} names read`,
		);
		return good;
	},

	/**
	 * ⇄ Swap sides: the sheet named the owner's way (the character's own left and right: each name's
	 * side the other way round, one named exactly as the template's other side), read with `swap`,
	 * maps each drawing onto the part it is — `ArmL1`, the arm on the picture's right, on
	 * `upper_arm_r`, its joints guessed as that side's — its props onto the same hosts; unswapped it
	 * lands every sided drawing on the wrong side. The rig made from it (the page's suggestion and
	 * guesses) poses through a capture as the one the template's names make.
	 */
	swap(M, log) {
		let good = true;
		const owner = (name) => OWNER_NAMES[name] ?? name;
		const names = REGIONS.map((r) => owner(r.name));
		const drawn = Object.fromEntries(REGIONS.map((r) => [owner(r.name), r.name]));
		const got = M.suggestSheetMap(TPL_PARTS(M), names, true);
		const unswapped = M.suggestSheetMap(TPL_PARTS(M), names);
		for (const [part, t] of Object.entries(TRUTH.parts)) {
			good =
				ok(
					`swap: ${owner(t.region)} is ${part}`,
					drawn[got[part]] === t.region,
					`got ${got[part]}`,
				) && good;
			if (M.sheetSide(slotOf(M, part)))
				good =
					ok(
						`swap: unswapped, ${owner(t.region)} lands on the other side`,
						drawn[unswapped[M.mirroredName(part)]] === t.region,
						`${M.mirroredName(part)} got ${unswapped[M.mirroredName(part)]}`,
					) && good;
		}
		const mapped = new Set(Object.keys(got));
		for (const p of TRUTH.props) {
			const s = M.suggestProp(owner(p.region), mapped, true);
			good =
				ok(
					`swap: ${owner(p.region)} is a prop on ${p.host}`,
					s?.host === p.host,
					JSON.stringify(s),
				) && good;
		}
		/** The mapping the page makes of a sheet: each part suggested by name, its joints guessed. */
		const pageMapping = (regionNames, swapped) => {
			const map = M.suggestSheetMap(TPL_PARTS(M), regionNames, swapped);
			const parts = {};
			for (const [part, region] of Object.entries(map)) {
				const slot = slotOf(M, part);
				parts[part] = {
					region,
					joints: M.guessSheetJoints(
						M.sheetKind(slot),
						M.sheetSide(slot),
						maskOf(drawn[region] ?? region),
					),
				};
			}
			const on = new Set(Object.keys(map));
			const props = [];
			for (const p of TRUTH.props) {
				const region = swapped ? owner(p.region) : p.region;
				const s = M.suggestProp(region, on, swapped);
				if (s)
					props.push({
						name: s.name,
						region,
						host: s.host,
						bone: boneOfSlot(M, slotOf(M, s.host)),
						at: p.on,
					});
			}
			return {
				sheet: 1,
				manifestKey: 'fixture/manifests/atlas_manifest_Sheet.json',
				template: { id: M.HALF_BODY.id, version: M.HALF_BODY.version },
				parts,
				props,
				...(swapped ? { swapSides: true } : {}),
			};
		};
		const a = made(
			M,
			pageMapping(
				REGIONS.map((r) => r.name),
				false,
			),
		);
		const renamed = SHEET.regions.map((r) => ({ ...r, name: owner(r.name) }));
		const b = made(M, pageMapping(names, true), renamed);
		const [ca, cb] = [captured(a), captured(b)];
		// A prop is named after its region: the two rigs' props, paired by the drawing they wear.
		const propIn = new Map(
			a.mapping.props.map((p, i) => [p.name, b.mapping.props[i]?.name ?? p.name]),
		);
		const inB = (name) => propIn.get(name) ?? name;
		good =
			ok(
				'swap: the props are the same drawings on the same hosts',
				a.mapping.props.length === b.mapping.props.length &&
					a.mapping.props.every(
						(p, i) =>
							b.mapping.props[i].host === p.host && drawn[b.mapping.props[i].region] === p.region,
					),
				JSON.stringify([a.mapping.props, b.mapping.props]),
			) && good;
		let off = { d: 0, what: '' };
		for (const t of [0, 0.5, 1, 1.5]) {
			const [sa, sb] = [posed(a, ca.anim, t), posed(b, cb.anim, t)];
			for (const bone of sa.bones) {
				const d = d2(boneAt(sa, bone.data.name), boneAt(sb, inB(bone.data.name)));
				if (d > off.d) off = { d, what: `${bone.data.name} at ${t} s` };
			}
			for (const slot of sa.slots) {
				const [da, db] = [drawing(sa, slot.data.name), drawing(sb, inB(slot.data.name))];
				if (!da || !db) {
					if (da || db) off = { d: Infinity, what: `${slot.data.name} drawn in one rig only` };
					continue;
				}
				for (let i = 0; i < da.v.length; i++) {
					const d = Math.abs(da.v[i] - db.v[i]);
					if (d > off.d) off = { d, what: `${slot.data.name} at ${t} s` };
				}
			}
		}
		good =
			ok(
				"swap: the rig made from the sheet named the owner's way poses as the template-named one",
				off.d <= 1e-4,
				`${off.d} (${off.what})`,
			) && good;
		log(
			`${Object.keys(got).length} parts and ${TRUTH.props.length} props of a sheet named the character's way land on their drawings' parts; its rig poses through a capture within ${off.d.toExponential(1)} of the template-named one`,
		);
		return good;
	},

	/** Each joint guessed from its drawing within its tolerance of the true one; the head's from its face. */
	guess(M, log) {
		let good = true;
		let worst = { share: 0, what: '' };
		const sizeOf = (region) => {
			const m = maskOf(region);
			let [x0, y0, x1, y1] = [m.w, m.h, 0, 0];
			for (let y = 0; y < m.h; y++)
				for (let x = 0; x < m.w; x++)
					if (m.alpha[y * m.w + x] >= 96)
						[x0, y0, x1, y1] = [
							Math.min(x0, x),
							Math.min(y0, y),
							Math.max(x1, x + 1),
							Math.max(y1, y + 1),
						];
			return Math.max(x1 - x0, y1 - y0);
		};
		for (const [part, t] of Object.entries(TRUTH.parts)) {
			const slot = slotOf(M, part);
			const g = M.guessSheetJoints(M.sheetKind(slot), M.sheetSide(slot), maskOf(t.region));
			const span = sizeOf(t.region);
			for (const [j, p] of Object.entries(t.joints)) {
				if (!g[j]) {
					good = ok(`guess: ${part} has its ${j}`, false) && good;
					continue;
				}
				const share = d2(g[j], p) / span;
				if (share > worst.share) worst = { share, what: `${part}.${j}` };
				good =
					ok(
						`guess: ${part}'s ${j} within ${GUESS_TOLERANCE} of its drawing's size`,
						share <= GUESS_TOLERANCE,
						`${share.toFixed(3)} (guessed ${g[j]}, true ${p})`,
					) && good;
			}
		}
		// The scale the guessed shoulders give: the whole rig's size against the template's.
		const guessed = {};
		for (const [part, t] of Object.entries(TRUTH.parts)) {
			const slot = slotOf(M, part);
			guessed[part] = M.guessSheetJoints(M.sheetKind(slot), M.sheetSide(slot), maskOf(t.region));
		}
		const sr = M.sheetRig(M.HALF_BODY, REGIONS, mappingOf(M, { joints: guessed, face: false }));
		const scaleOff = sr.ok ? Math.abs(sr.value.scale * TRUTH.scale - 1) : 1;
		good =
			ok(
				`guess: the guessed joints give the sheet's scale within ${SCALE_TOLERANCE}`,
				scaleOff <= SCALE_TOLERANCE,
				sr.ok ? `${sr.value.scale} (true ${1 / TRUTH.scale})` : sr.problem,
			) && good;
		// From the face the tracker finds on the head: the frame's own fit put its joints there (F2e).
		const head = TRUTH.parts.head;
		const fj = M.faceJoints(head.face);
		const size = sizeOf(head.region);
		const off = fj
			? Math.max(d2(fj.neck, head.joints.neck), d2(fj.face, head.joints.face)) / size
			: 1;
		good =
			ok(
				`guess: the head's joints from its face within ${FACE_TOLERANCE} of its size`,
				off <= FACE_TOLERANCE,
				`${off.toFixed(4)} ${JSON.stringify(fj)}`,
			) && good;
		log(
			`worst shape guess ${worst.share.toFixed(3)} of its drawing's size (${worst.what}); from the face ${off.toFixed(4)}; the guessed scale ${(scaleOff * 100).toFixed(1)}% off`,
		);
		return good;
	},

	/** The drawn lengths at the sheet's scale; every joint, carried on its drawing, on its bone at rest. */
	fit(M, log) {
		let good = true;
		const rig = made(M);
		const ff = FRAME.ff.fit.bones;
		const fitted = M.fitTemplate(M.HALF_BODY, rig.sr.fit);
		const lengthOf = (n) => {
			const b = fitted.bones.find((x) => x.name === n);
			return Math.hypot(b.x, b.y);
		};
		for (const n of ['lower_arm_l', 'lower_arm_r', 'hand_l', 'hand_r']) {
			const want = Math.hypot(ff[n].x, ff[n].y);
			good =
				ok(
					`fit: ${n}'s length is the drawn one (the frame's own fit's)`,
					Math.abs(lengthOf(n) / want - 1) < 0.005,
					`${lengthOf(n)} vs ${want}`,
				) && good;
		}
		good =
			ok(
				'fit: the sheet drawn 1.6× bigger is read at 1 / 1.6 rig units a pixel',
				Math.abs(rig.sr.scale * TRUTH.scale - 1) < 0.002,
				`${rig.sr.scale}`,
			) && good;
		const skel = posed(rig);
		let off = { d: 0, what: '' };
		for (const { part, slot } of [...bodyParts(M), { part: ALTERNATE.part, slot: 'hand_l' }]) {
			const map = rig.mapping.parts[part];
			const dr = drawing(skel, slot, part);
			for (const [j, bone] of jointBones(M, part)) {
				const d = d2(carried(dr, uvOf(map.region, map.joints[j])), boneAt(skel, bone));
				if (d > off.d) off = { d, what: `${part}.${j} → ${bone}` };
			}
		}
		good =
			ok(
				`fit: every joint on its bone at rest (≤ ${ON_BONE})`,
				off.d <= ON_BONE,
				`${off.d} (${off.what})`,
			) && good;
		// A torso drawn with its collar higher than the template's neck: the neck sits there, so a
		// drawn neck meets the body where the torso draws it.
		const raised = mappingOf(M);
		// Up the torso as it is drawn: off its shoulder line a quarter turn (the page's y is down).
		const { shoulder_l: sl, shoulder_r: sr } = raised.parts.torso.joints;
		const across = Math.hypot(sr[0] - sl[0], sr[1] - sl[1]);
		const up = (p) => [
			p[0] + (40 * (sr[1] - sl[1])) / across,
			p[1] - (40 * (sr[0] - sl[0])) / across,
		];
		raised.parts.torso.joints = {
			...raised.parts.torso.joints,
			neck: up(raised.parts.torso.joints.neck),
		};
		const high = made(M, raised);
		const hs = posed(high);
		const collar = d2(
			carried(
				drawing(hs, 'torso', 'torso'),
				uvOf(raised.parts.torso.region, raised.parts.torso.joints.neck),
			),
			boneAt(hs, 'neck'),
		);
		good =
			ok(
				`fit: the neck sits on the torso's collar as drawn (≤ ${ON_BONE})`,
				collar <= ON_BONE,
				`${collar}`,
			) && good;
		log(
			`scale ${rig.sr.scale.toFixed(4)} rig units per sheet px; joints on their bones within ${off.d.toFixed(4)} (${off.what})`,
		);
		return good;
	},

	/** The store's pose check on the fitted template, the save check on the rig, the parts it lacks. */
	finite(M, log) {
		const rig = made(M);
		const fitted = M.fitTemplate(M.HALF_BODY, rig.sr.fit);
		const problem = M.rigTemplateSaveProblem(fitted);
		const saved = M.irigDocProblem(rig.rigged.skeleton);
		const mapped = new Set(Object.keys(rig.mapping.parts));
		const lacks = rig.rigged.missingRequired;
		log(
			`${fitted.channels.length} controls and ${fitted.clips.length} clips posed; ${rig.rigged.missing.length} parts not mapped (${lacks.length} needed: ${lacks.join(', ')})`,
		);
		return (
			ok(
				'finite: every control and clip poses finite on the fitted template',
				problem === null,
				problem ?? '',
			) &&
			ok('finite: the rig passes the .irig save check', saved === null, saved ?? '') &&
			ok('finite: no mapped part is missing', !rig.rigged.missing.some((p) => mapped.has(p)))
		);
	},

	/**
	 * Drawn apart: each part rigid on its own bone across every joint to another drawing, bending
	 * only inside itself — the torso at its waist and shoulder lines, the head over its face.
	 */
	skin(M, log) {
		let good = true;
		const rig = made(M);
		const doc = rig.rigged.skeleton;
		/** The bones a drawing's vertices name (its slot's bone alone for an image). */
		const named = (r, slot, part) => {
			const raw = r.rigged.skeleton.skins[0].attachments[slot][part];
			if (raw.type !== 'mesh')
				return { bones: [r.rigged.skeleton.slots.find((s) => s.name === slot).bone], sumOff: 0 };
			const out = new Set();
			let sumOff = 0;
			for (let i = 0; i < raw.vertices.length;) {
				const n = raw.vertices[i++];
				let sum = 0;
				for (let k = 0; k < n; k++, i += 4) {
					out.add(r.rigged.skeleton.bones[raw.vertices[i]].name);
					sum += raw.vertices[i + 3];
				}
				sumOff = Math.max(sumOff, Math.abs(sum - 1));
			}
			return { bones: [...out], sumOff };
		};
		const skinned = {};
		for (const { part, slot } of [...bodyParts(M), { part: ALTERNATE.part, slot: 'hand_l' }]) {
			const got = named(rig, slot, part);
			skinned[part] = got.bones;
			good = ok(`skin: ${part}'s weights sum to 1`, got.sumOff < 1e-6, `${got.sumOff}`) && good;
		}
		const only = (part, ...allowed) =>
			ok(
				`skin: ${part} bends only into ${allowed.join(', ')}`,
				skinned[part].every((b) => allowed.includes(b)),
				JSON.stringify(skinned[part]),
			) && good;
		for (const part of [
			...['l', 'r'].flatMap((s) => [`upper_arm_${s}`, `lower_arm_${s}`, `hand_${s}`]),
			ALTERNATE.part,
		]) {
			const slot = slotOf(M, part);
			good = only(part, doc.slots.find((s) => s.name === slot).bone);
		}
		good = only('torso', 'torso_image', 'spine', 'clavicle_l', 'clavicle_r');
		// The neck bends along its two bones, its foot into the torso and its top into the head.
		const underHead = (b) => {
			for (
				let x = doc.bones.find((y) => y.name === b);
				x;
				x = doc.bones.find((y) => y.name === x.parent)
			)
				if (x.name === 'head') return true;
			return false;
		};
		good =
			ok(
				'skin: the neck bends along its two bones and at its seams into the torso and the head',
				['neck', 'neck_upper', 'torso_image', 'head_image'].every((b) =>
					skinned.neck.includes(b),
				) &&
					skinned.neck.every(
						(b) => ['neck', 'neck_upper', 'torso_image'].includes(b) || underHead(b),
					),
				JSON.stringify(skinned.neck),
			) && good;
		good =
			ok(
				'skin: the torso bends at its waist and both shoulder lines',
				['spine', 'clavicle_l', 'clavicle_r'].every((b) => skinned.torso.includes(b)),
				JSON.stringify(skinned.torso),
			) && good;
		const face = new Set([
			'jaw',
			'lid_upper_l',
			'lid_upper_r',
			'mouth_corner_l',
			'brow_out_l',
			'pupil_r',
		]);
		good =
			ok(
				'skin: the head bends over its face, not into the neck',
				[...face].every((b) => skinned.head.includes(b)) && !skinned.head.includes('neck'),
				JSON.stringify(skinned.head),
			) && good;
		// The torso drawn by angle (the same drawing as its ¾ view) bends as the torso does.
		const base = mappingOf(M);
		const angled = made(M, { ...base, parts: { ...base.parts, torso_3q_l: base.parts.torso } });
		const threeQuarter = named(angled, 'torso', 'torso_3q_l').bones;
		good =
			ok(
				"skin: the torso drawn by angle bends as its slot's main drawing",
				threeQuarter.length > 1 &&
					threeQuarter.join() === named(angled, 'torso', 'torso').bones.join(),
				JSON.stringify(threeQuarter),
			) && good;
		const bare = made(M, mappingOf(M, { face: false }));
		const faced = new Set(named(bare, 'head', 'head').bones);
		good =
			ok(
				'skin: a head with no face found rides its own bones',
				![...face].some((b) => faced.has(b)),
				JSON.stringify([...faced]),
			) && good;
		log(
			`skinned: ${Object.entries(skinned)
				.map(([p, b]) => `${p} ${b.length}`)
				.join(', ')}; the face moves ${rig.sr.face || 'nothing'}`,
		);
		return good;
	},

	/** Posed as the frame (its own fit's turns), the rig draws the frame's character again. */
	redraw(M, log) {
		const anim = { bones: {} };
		for (const [bone, p] of Object.entries(FRAME.ff.fit.frame))
			anim.bones[bone] = { rotate: [{ time: 0, value: p.rotate }] };
		const iouOf = (rig, parts) => frameIoU(posed(rig, anim, 0), parts);
		const all = [...Object.keys(TRUTH.parts), ...TRUTH.props.map((p) => p.part)];
		const iou = iouOf(made(M), all);
		// A trimmed region: the rig draws its ink where the page measured its joints.
		const hand = iouOf(trimmed(M), ['hand_l']);
		const plainHand = iouOf(made(M), ['hand_l']);
		log(
			`the frame redrawn from the sheet: alpha IoU ${iou.toFixed(4)}; the left hand ${plainHand.toFixed(4)}, trimmed ${hand.toFixed(4)}`,
		);
		// Measured: 0.884 trimmed against 0.900 (its mesh's grid spans the larger untrimmed box); its offY
		// read from the top instead puts the hand 10 sheet pixels off: 0.805.
		return (
			ok(`redraw: alpha IoU ≥ ${REDRAW_IOU}`, iou >= REDRAW_IOU, iou.toFixed(4)) &&
			ok(
				'redraw: a trimmed region draws where the page measured it (its offY read from the bottom)',
				Math.abs(hand - plainHand) < TRIM_IOU,
				`${hand.toFixed(4)} vs ${plainHand.toFixed(4)}`,
			)
		);
	},

	/**
	 * A capture keyed as 🎥 Motion keys it moves every part with its bone, and moves the arms: on the
	 * rig as drawn, and on the rig arranged as the frame (bound in that pose, keyed from its setup).
	 */
	capture(M, log) {
		let good = true;
		for (const [label, rig] of [
			['', made(M)],
			['arranged: ', made(M, arrangedAsFrame(M))],
		]) {
			const [rides, line] = captureRides(M, rig, label);
			good = rides && good;
			log(`${label}${line}`);
		}
		return good;
	},

	/** The sheet arranged as the frame: posed by its own `frame` clip, the rig draws the frame again. */
	arrange(M, log) {
		let good = true;
		const mapping = arrangedAsFrame(M);
		const rig = made(M, mapping);
		const frameClip = rig.rigged.skeleton.animations?.frame;
		good = ok('arrange: the arranged rig has a frame clip', !!frameClip) && good;
		const all = [...Object.keys(TRUTH.parts), ...TRUTH.props.map((p) => p.part)];
		const skel = framePosed(rig);
		const iou = frameIoU(skel, all);
		good =
			ok(
				`arrange: posed by its frame clip, the rig draws the frame (alpha IoU ≥ ${REDRAW_IOU})`,
				iou >= REDRAW_IOU,
				iou.toFixed(4),
			) && good;
		// What the page draws (/api/rigger/from-sheet/preview) is the rig: every drawing as placed,
		// every bone where the frame pose has it.
		const pv = M.sheetPreview(M.HALF_BODY, REGIONS, mapping);
		let pvOff = 0;
		if (pv.ok) {
			for (const a of pv.value.art)
				pvOff = Math.max(
					pvOff,
					...a.matrix.map((v, i) => Math.abs(v - rig.sr.art[a.name].matrix[i])),
				);
			for (const [n, p] of Object.entries(pv.value.bones)) {
				const b = skel.findBone(n);
				pvOff = Math.max(pvOff, b ? d2(p, [b.worldX, b.worldY]) : Infinity);
			}
		}
		good =
			ok(
				'arrange: the preview is the rig: each drawing as placed, each bone as the frame poses it',
				pv.ok &&
					pv.value.frame &&
					pv.value.art.length === Object.keys(rig.sr.art).length &&
					pvOff < 1e-3,
				pv.ok ? `off ${pvOff}` : pv.problem,
			) && good;
		// Each chain bone turned in the world as the frame fit turns it.
		const fitted = M.fitTemplate(M.HALF_BODY, FRAME.ff.fit);
		const want = M.frameWorld(fitted.bones, FRAME.ff.fit.frame);
		let worst = { d: 0, what: '' };
		for (const n of ARRANGED_CHAIN) {
			const w = want.get(n);
			const d = Math.abs(wrapDeg(worldTurn(skel, n) - (Math.atan2(w[2], w[0]) * 180) / Math.PI));
			if (d > worst.d) worst = { d, what: n };
		}
		good =
			ok(
				`arrange: each chain bone turned as the frame's (≤ ${TURN_TOLERANCE}°)`,
				worst.d <= TURN_TOLERANCE,
				`${worst.d.toFixed(4)}° (${worst.what})`,
			) && good;
		// The truth is put together at its joints: each part's first joint on the one it snaps to.
		const onCanvas = (part, j) => {
			const reg = regionOf(mapping.parts[part].region);
			const { at, turn } = mapping.arrange[part];
			const [x, y] = mapping.parts[part].joints[j];
			const r = (turn * Math.PI) / 180;
			const [qx, qy] = [x - reg.w / 2, y - reg.h / 2];
			return [
				at[0] + Math.cos(r) * qx - Math.sin(r) * qy,
				at[1] + Math.sin(r) * qx + Math.cos(r) * qy,
			];
		};
		let gap = { d: 0, what: '', n: 0 };
		for (const part of Object.keys(mapping.arrange)) {
			const slot = slotOf(M, part);
			const target = M.sheetSnapTargets(M.sheetKind(slot), M.sheetSide(slot)).find(
				([p]) => mapping.arrange[p],
			);
			if (!target) continue;
			gap.n++;
			const first = M.SHEET_JOINTS[M.sheetKind(slot)][0];
			const d = d2(onCanvas(part, first), onCanvas(...target));
			if (d > gap.d) gap = { ...gap, d, what: `${part}.${first} → ${target.join('.')}` };
		}
		good =
			ok(
				"arrange: each part's first joint on the joint it snaps to (≤ 1 sheet pixel)",
				gap.n === 8 && gap.d <= 1,
				`${gap.n} snapped, worst ${gap.d.toFixed(3)} (${gap.what})`,
			) && good;
		// The arrangement the page starts from, read off the preview of the rig as drawn: nothing moves.
		const plain = made(M);
		const sp = M.sheetPreview(M.HALF_BODY, REGIONS, mappingOf(M));
		const still = { ...mappingOf(M), arrange: {} };
		if (sp.ok)
			for (const a of sp.value.art) {
				if (!TRUTH.parts[a.name]) continue;
				const m = a.matrix;
				still.arrange[a.name] = {
					at: [
						sp.value.origin[0] + m[4] / sp.value.scale,
						sp.value.origin[1] - m[5] / sp.value.scale,
					],
					turn: (-Math.atan2(m[2], m[0]) * 180) / Math.PI,
				};
			}
		const kept = made(M, still);
		const turns = Object.values(kept.sr.fit.frame ?? {}).map((f) => Math.abs(f.rotate));
		const moved = Math.max(
			...Object.entries(plain.sr.art).map(([n, a]) =>
				Math.max(...a.matrix.map((v, i) => Math.abs(v - kept.sr.art[n].matrix[i]))),
			),
		);
		good =
			ok(
				'arrange: an arrangement read off the preview at rest turns nothing and moves nothing',
				sp.ok && turns.length > 0 && Math.max(...turns) < 1e-6 && moved < 1e-6,
				sp.ok ? `turns ≤ ${Math.max(...turns)}, moved ≤ ${moved}` : sp.problem,
			) && good;
		// A prop turned against its host: drawn so.
		const turned = mappingOf(M);
		turned.props[0].turn = 30;
		const tr = made(M, turned);
		const ts = posed(tr);
		const p = turned.props[0];
		const edge = (dr) => [dr.v[4] - dr.v[2], dr.v[5] - dr.v[3]];
		const hd = drawing(ts, slotOf(M, p.host), p.host);
		const [h0, h1] = [carried(hd, [0, 0]), carried(hd, [1, 0])];
		const mine = edge(drawing(ts, p.name, p.name));
		const against = wrapDeg(
			((Math.atan2(mine[1], mine[0]) - Math.atan2(h1[1] - h0[1], h1[0] - h0[0])) * 180) / Math.PI,
		);
		good =
			ok(
				'arrange: a prop turned 30° on the page against its host is drawn so',
				Math.abs(against + 30) < 0.05,
				`${against.toFixed(3)}°`,
			) && good;
		log(
			`arranged as the frame: IoU ${iou.toFixed(4)}; chain turns within ${worst.d.toFixed(4)}° (${worst.what}); ${gap.n} parts snapped within ${gap.d.toFixed(3)} px; from the preview at rest: turns ≤ ${Math.max(...turns).toExponential(1)}, moved ≤ ${moved.toExponential(1)}`,
		);
		return good;
	},

	/** Posed by its `frame` clip, every part's joints on their bones, however it was arranged. */
	framejoints(M, log) {
		let good = true;
		const lines = [];
		const cases = [
			['arranged as the frame', arrangedAsFrame(M)],
			['the whole character turned 12° on the canvas', arrangedAsFrame(M, { turn: 12 })],
			[
				'the hands and the neck left unarranged',
				arrangedAsFrame(M, {
					turn: 12,
					only: Object.keys(TRUTH.parts).filter((p) => !/^(hand_|neck)/.test(p)),
				}),
			],
		];
		for (const [what, mapping] of cases) {
			const rig = made(M, mapping);
			const skel = framePosed(rig);
			const off = jointsOff(M, rig, skel);
			good =
				ok(
					`frame joints: ${what}, every joint on its bone (≤ ${FRAME_ON_BONE})`,
					off.d <= FRAME_ON_BONE,
					`${off.d.toFixed(4)} (${off.what})`,
				) && good;
			// The face's bones where the drawn face has them: each eye's middle on its eye bone.
			const head = rig.mapping.parts.head;
			const hd = drawing(skel, 'head', 'head');
			let eyes = 0;
			for (const [bone, ks] of [
				['eye_l', [33, 133]],
				['eye_r', [263, 362]],
			]) {
				const m = ks.map((k) => carried(hd, uvOf(head.region, head.face[k])));
				eyes = Math.max(
					eyes,
					d2([(m[0][0] + m[1][0]) / 2, (m[0][1] + m[1][1]) / 2], boneAt(skel, bone)),
				);
			}
			good =
				ok(
					`frame joints: ${what}, the eye bones on the drawn eyes (≤ ${EYE_ON})`,
					eyes <= EYE_ON,
					eyes.toFixed(4),
				) && good;
			// Each prop's bone where it sits on its host's drawing.
			let props = 0;
			for (const p of rig.mapping.props) {
				const host = rig.mapping.parts[p.host];
				const on = carried(drawing(skel, slotOf(M, p.host), p.host), uvOf(host.region, p.at));
				props = Math.max(props, d2(boneAt(skel, p.name), on));
			}
			good =
				ok(
					`frame joints: ${what}, each prop's bone where it sits on its host (≤ ${ON_BONE})`,
					props <= ON_BONE,
					props.toFixed(4),
				) && good;
			// Skinned in that pose: the torso's waist and shoulder lines where the frame pose has them.
			let skinAt = { d: 0, what: '', n: 0 };
			const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			for (const [bone, at] of [
				['spine', boneAt(skel, 'chest')],
				...['l', 'r'].map((s) => [
					`clavicle_${s}`,
					mid(boneAt(skel, `clavicle_${s}`), boneAt(skel, `upper_arm_${s}`)),
				]),
			]) {
				const j = rig.sr.fit.bends?.torso?.skin?.find((x) => x.bone === bone);
				const d = j ? d2(j.at, at) : Infinity;
				skinAt.n++;
				if (d > skinAt.d) skinAt = { ...skinAt, d, what: `torso → ${bone}` };
			}
			good =
				ok(
					`frame joints: ${what}, the torso's waist and shoulder lines skinned where the frame has them (≤ ${SKIN_AT})`,
					skinAt.d <= SKIN_AT,
					`${skinAt.d.toFixed(4)} (${skinAt.what})`,
				) && good;
			lines.push(
				`${what}: joints ${off.d.toFixed(4)} (${off.what}), eyes ${eyes.toFixed(3)}, props ${props.toFixed(4)}, skin joints ${skinAt.d.toFixed(4)}`,
			);
		}
		const turned = framePosed(made(M, cases[1][1]));
		const spine = wrapDeg(worldTurn(turned, 'spine'));
		good =
			ok(
				'frame joints: turned 12° clockwise on the page, the spine leans 12° with it',
				Math.abs(spine + 12) < TURN_TOLERANCE,
				`${spine.toFixed(4)}°`,
			) && good;
		for (const l of lines) log(l);
		return good;
	},

	/**
	 * Each prop on a bone of its own where it sits on its host, drawn just over it (on the head, over
	 * every face part and just under the front hair).
	 */
	props(M, log) {
		let good = true;
		const rig = made(M);
		const skel = posed(rig);
		const order = skel.drawOrder.map((s) => s.data.name);
		for (const p of rig.mapping.props) {
			const bone = skel.findBone(p.name);
			// One worn on the head's drawing hangs from the head itself, at its depth (the head turn).
			const from = rig.sr.fit.props.find((x) => x.name === p.name).bone;
			const hangs = rig.sr.fit.turn && p.host === 'head' ? 'head' : p.bone;
			good =
				ok(
					`props: ${p.name} hangs from ${hangs}`,
					bone?.parent?.data.name === hangs && from === hangs,
				) && good;
			const host = rig.mapping.parts[p.host];
			const hostSlot = slotOf(M, p.host);
			const on = carried(drawing(skel, hostSlot, p.host), uvOf(host.region, p.at));
			good =
				ok(
					`props: ${p.name}'s bone where it sits on ${p.host}`,
					bone && d2(boneAt(skel, p.name), on) <= ON_BONE,
					`${bone && d2(boneAt(skel, p.name), on)}`,
				) && good;
			const mine = drawing(skel, p.name, p.name);
			good =
				ok(
					`props: ${p.name}'s middle at its place`,
					mine && d2(centreOf(mine), on) <= ON_BONE,
					`${mine && d2(centreOf(mine), on)}`,
				) && good;
			// Drawn at the sheet's scale, turned as its host is: its top edge is its region's width long,
			// along its host's drawing's top edge.
			const across = (dr) => [dr.v[4] - dr.v[2], dr.v[5] - dr.v[3]];
			const hostAcross = (() => {
				const hd = drawing(skel, hostSlot, p.host);
				const a = carried(hd, [0, 0]);
				const b = carried(hd, [1, 0]);
				return [b[0] - a[0], b[1] - a[1]];
			})();
			const w = mine ? Math.hypot(...across(mine)) : 0;
			const want = regionOf(p.region).w * rig.sr.scale;
			const turn = mine
				? Math.abs(
						Math.atan2(across(mine)[1], across(mine)[0]) - Math.atan2(hostAcross[1], hostAcross[0]),
					)
				: 1;
			good =
				ok(
					`props: ${p.name} drawn at the sheet's scale, turned as its host`,
					Math.abs(w / want - 1) < 0.002 && Math.min(turn, 2 * Math.PI - turn) < 1e-3,
					`width ${w} vs ${want}, turned ${turn}`,
				) && good;
			// Over its host, or over its arm's last slot (a watch over the fingers), as frame to rig draws
			// one; on the head just under the front hair, over every face part.
			const side = /^(hand|lower_arm)_([lr])$/.exec(hostSlot)?.[2];
			const slots = M.HALF_BODY.slots.map((x) => x.name);
			const over = side
				? slots
						.slice(slots.indexOf('hair_front'))
						.filter((n) => n.endsWith(`_${side}`))
						.pop()
				: hostSlot;
			const onHead = hostSlot === 'head';
			good =
				ok(
					`props: ${p.name} drawn just over ${onHead ? 'the face, under hair_front' : over}`,
					onHead
						? order.indexOf(p.name) < order.indexOf('hair_front') &&
								order.indexOf(p.name) >= order.indexOf('hair_front') - rig.mapping.props.length &&
								order.indexOf(p.name) > order.indexOf('mouth')
						: order.indexOf(p.name) > order.indexOf(over) &&
								order.indexOf(p.name) <= order.indexOf(over) + rig.mapping.props.length,
					order.slice(order.indexOf(over), order.indexOf(over) + 4).join(' '),
				) && good;
		}
		log(`${rig.mapping.props.length} props on bones of their own`);
		return good;
	},

	/**
	 * The owner's first real sheet (2026-11-24): one drawing per Photoshop layer, arranged, props worn
	 * and a face drawn in parts, its rest mouth, neutral brows and closed lids left out. The rig is made
	 * (a brow or a mouth drawing threw a bare 500 here), each face drawing drawn where the sheet put
	 * it in the frame and bent on its bones from there, and the starred parts left out are listed.
	 */
	partialface(M, log) {
		let good = true;
		const cases = [
			['a face on the head', M.HALF_BODY, ownerSheet(M)],
			['no face on the head', M.HALF_BODY, ownerSheet(M, { face: false })],
			[
				"a template's brows bending on bones not placed on the image",
				browsUnplaced(M),
				ownerSheet(M),
			],
		];
		let worst = { d: 0, what: '' };
		for (const [what, t, { regions, mapping }] of cases) {
			let rig;
			try {
				rig = created(M, t, mapping, regions);
			} catch (e) {
				good = ok(`partialface (${what}): the rig is made`, false, e.message) && good;
				continue;
			}
			const doc = rig.rigged.skeleton;
			const skel = framePosed(rig);
			for (const { part, region, w, h } of FACE_DRAWN) {
				const slot = slotOf(M, part);
				const att = doc.skins[0].attachments[slot]?.[part];
				const bends = !!t.parts.find((p) => p.name === part).bend;
				good =
					ok(
						`partialface (${what}): ${part} draws ${region}${bends ? ' as a mesh' : ''}`,
						att?.path === region && (att?.type === 'mesh') === bends,
						JSON.stringify(att && { path: att.path, type: att.type }),
					) && good;
				// In the frame, every point of the drawing where the sheet placed it.
				const dr = drawing(skel, slot, part);
				const m = rig.sr.art[part].matrix;
				let off = 0;
				for (let i = 0; dr && i < dr.v.length / 2; i++) {
					const [u, v] = [dr.own[i * 2], dr.own[i * 2 + 1]];
					off = Math.max(
						off,
						d2(apply(m, [(u - 0.5) * w, (0.5 - v) * h]), [dr.v[i * 2], dr.v[i * 2 + 1]]),
					);
				}
				if (off > worst.d) worst = { d: off, what: `${part}, ${what}` };
				good =
					ok(
						`partialface (${what}): ${part} drawn where the sheet put it`,
						dr && off <= DRAWN_AT,
						`${off}`,
					) && good;
				if (bends) good = bentFromDrawn(M, rig, skel, t, part, what) && good;
			}
			const need = rig.rigged.missingRequired;
			good =
				ok(
					`partialface (${what}): the starred face parts left out are listed, none drawn is`,
					STARRED_LEFT_OUT.every((p) => need.includes(p)) &&
						!FACE_DRAWN.some(({ part }) => rig.rigged.missing.includes(part)),
					need.join(', '),
				) && good;
			good =
				ok(
					`partialface (${what}): arranged (a frame clip) with every prop on its bone`,
					!!doc.animations.frame &&
						mapping.props.every((p) => doc.slots.some((s) => s.name === p.name)),
				) && good;
		}
		log(
			`${FACE_DRAWN.length} face drawings over ${cases.length} cases; drawn where placed within ${worst.d.toExponential(1)} (${worst.what}); left out and listed: ${STARRED_LEFT_OUT.join(', ')}`,
		);
		return good;
	},

	/**
	 * Each drawing of the owner's sheet where the Arranged canvas put it and at its drawn proportions:
	 * in the frame exactly, and in any other pose (rest, every chain bone turned) carried whole by its
	 * own bone. Only the torso and the head bend, inside themselves, and fold nowhere.
	 */
	proportions(M, log) {
		let good = true;
		const { regions, mapping } = ownerSheet(M);
		const rig = created(M, M.HALF_BODY, mapping, regions);
		const k = rig.sr.scale;
		const doc = rig.rigged.skeleton;
		const size = new Map(regions.map((r) => [r.name, [r.origW ?? r.w, r.origH ?? r.h]]));
		const drawings = Object.entries(doc.skins[0].attachments).flatMap(([slot, atts]) =>
			Object.entries(atts).map(([name, att]) => ({
				slot,
				name,
				bone: doc.slots.find((s) => s.name === slot).bone,
				size: size.get(att.path ?? name),
				bends: name === 'torso' || name === 'head' || name === 'neck',
			})),
		);
		const frame = framePosed(rig);
		const turned = framePosed(rig);
		for (const n of ARRANGED_CHAIN) turned.findBone(n).rotation += 25;
		turned.updateWorldTransform(RIG.Physics.update);
		const worst = { at: 0, scale: 0, fold: Infinity, carried: 0 };
		for (const d of drawings) {
			const [w, h] = d.size;
			const inFrame = drawing(frame, d.slot, d.name);
			const m = rig.sr.art[d.name].matrix;
			let at = 0;
			for (let i = 0; i < inFrame.v.length / 2; i++) {
				const [u, v] = [inFrame.own[i * 2], inFrame.own[i * 2 + 1]];
				const want = apply(m, [(u - 0.5) * w, (0.5 - v) * h]);
				at = Math.max(at, d2(want, [inFrame.v[i * 2], inFrame.v[i * 2 + 1]]));
			}
			worst.at = Math.max(worst.at, at);
			good =
				ok(`proportions: ${d.name} drawn where it was arranged`, at <= DRAWN_AT, `${at}`) && good;
			for (const [pose, skel] of [
				['frame', frame],
				['rest', posed(rig)],
				['turned', turned],
			]) {
				const dr = drawing(skel, d.slot, d.name);
				const s = stretches(dr, w, h);
				if (d.bends && pose !== 'frame') {
					const fold = s.reduce((x, [, , D]) => Math.min(x, D / (k * k)), Infinity);
					worst.fold = Math.min(worst.fold, fold);
					good =
						ok(`proportions: ${d.name} folds nowhere (${pose})`, fold >= FOLD, `${fold}`) && good;
					continue;
				}
				const off = s.reduce(
					(x, [a, b]) => Math.max(x, Math.abs(a / k - 1), Math.abs(b / k - 1)),
					0,
				);
				worst.scale = Math.max(worst.scale, off);
				good =
					ok(
						`proportions: ${d.name} at the sheet's scale, its proportions kept (${pose})`,
						off <= SCALE_KEPT,
						`${off}`,
					) && good;
				// Carried whole by its bone from where the frame draws it.
				const B = (x) => {
					const b = x.findBone(d.bone);
					return [b.a, b.b, b.c, b.d, b.worldX, b.worldY];
				};
				const carry = compose(B(skel), invert(B(frame)));
				let off2 = 0;
				for (let i = 0; i < dr.v.length / 2; i++)
					off2 = Math.max(
						off2,
						d2(apply(carry, [inFrame.v[i * 2], inFrame.v[i * 2 + 1]]), [
							dr.v[i * 2],
							dr.v[i * 2 + 1],
						]),
					);
				worst.carried = Math.max(worst.carried, off2);
				good =
					ok(
						`proportions: ${d.name} rides its own bone whole (${pose})`,
						off2 <= DRAWN_AT,
						`${off2}`,
					) && good;
			}
		}
		log(
			`${drawings.length} drawings: where arranged within ${worst.at.toExponential(1)}; scale kept within ${(worst.scale * 100).toFixed(2)}%, carried whole within ${worst.carried.toExponential(1)} at rest and turned 25°; the torso and head keep ≥ ${worst.fold.toFixed(2)} of every triangle's area`,
		);
		return good;
	},

	/**
	 * A face capture's head turn (solved and keyed as 🎥 Motion keys it) on a head drawn without its
	 * face: the head turns with it — its middle, under the features drawn apart, moving as they do,
	 * its outline staying — nothing folding at the face's farthest move (a 3D import's 40° turn and
	 * 25° nod sliding it by its depth), and a head roll on top turning the whole drawing; untrimmed
	 * and trimmed (the ink read from the trim's bottom). A face found on the head keeps its
	 * features' room: there the face does not slide off the head either.
	 */
	faceturn(M, log) {
		let good = true;
		const worst = { slip: 0, outline: 0, fold: Infinity, roll: 0, turn: Infinity };
		const depth = M.HALF_BODY.rig3d.depths.face;
		// ↻ Head turn off: the face over a head that does not turn (on: `sheet-head-turn.mjs`).
		const still = (sh) => ({ ...sh, mapping: { ...sh.mapping, turn: 0 } });
		for (const [what, sheet] of [
			['drawn apart', still(ownerSheet(M, { face: false }))],
			['drawn apart, trimmed', still(trimmedHead(ownerSheet(M, { face: false })))],
			['a face found on the head', still(ownerSheet(M, { face: true }))],
		]) {
			const rig = created(M, M.HALF_BODY, sheet.mapping, sheet.regions);
			const apart = !sheet.mapping.parts.head.face;
			const { anim, length } = faceCaptured(rig);
			const rest = posed(rig, anim, 0);
			const head0 = drawing(rest, 'head', 'head');
			const n = head0.v.length / 2;
			const vtx = (dr, i) => [dr.v[i * 2], dr.v[i * 2 + 1]];
			// The head under the face's middle (drawn apart) and under each feature; its ink's outline.
			const under = [
				...(apart ? [{ what: 'the face', at: (s) => boneAt(s, 'face') }] : []),
				...FACE_LOCKED.map((part) => {
					const slot = slotOf(M, part);
					return { what: part, at: (s) => centreOf(drawing(s, slot, part)) };
				}),
			].map((u) => ({ ...u, uv: uvUnder(head0, u.at(rest)) }));
			const r = sheet.regions.find((x) => x.name === sheet.mapping.parts.head.region);
			const [W, H] = [r.origW ?? r.w, r.origH ?? r.h];
			const [ox, oy] = [r.offX ?? 0, r.origH ? r.origH - (r.offY ?? 0) - r.h : 0];
			const [u0, u1, v0, v1] = [ox / W, (ox + r.w) / W, oy / H, (oy + r.h) / H];
			const outline = [];
			for (let i = 0; i < n; i++) {
				const [u, v] = [head0.own[i * 2], head0.own[i * 2 + 1]];
				if (u <= u0 + 1e-6 || u >= u1 - 1e-6 || v <= v0 + 1e-6 || v >= v1 - 1e-6) outline.push(i);
			}
			let turned = { t: 0, d: 0 };
			for (let t = FACE_REST / CAPTURE_FPS; t <= length + 1e-9; t += 0.1) {
				const s = posed(rig, anim, t);
				const h = drawing(s, 'head', 'head');
				const f = d2(boneAt(s, 'face'), boneAt(rest, 'face'));
				if (f > turned.d) turned = { t, d: f };
				for (const u of under) {
					const [p, q] = [u.at(s), u.at(rest)];
					const want = [p[0] - q[0], p[1] - q[1]];
					const [g, g0] = [carried(h, u.uv), carried(head0, u.uv)];
					const got = [g[0] - g0[0], g[1] - g0[1]];
					const slip = d2(got, want) / Math.max(1, Math.hypot(...want));
					worst.slip = Math.max(worst.slip, slip);
					good =
						ok(
							`faceturn (${what}, ${t.toFixed(1)} s): the head under ${u.what} moves with it`,
							slip <= FACE_SLIP,
							`${slip}`,
						) && good;
				}
				const off = Math.max(0, ...outline.map((i) => d2(vtx(h, i), vtx(head0, i))));
				worst.outline = Math.max(worst.outline, off);
				good =
					ok(
						`faceturn (${what}, ${t.toFixed(1)} s): the head's outline stays on the head`,
						off <= OUTLINE_KEPT,
						`${off}`,
					) && good;
			}
			if (apart) {
				worst.turn = Math.min(worst.turn, turned.d);
				good =
					ok(
						`faceturn (${what}): the capture's head turn slides the face`,
						turned.d >= TURN_SHOWN,
						`${turned.d}`,
					) && good;
			} else
				good =
					ok(
						`faceturn (${what}): the face takes no room from its features, so it does not slide`,
						turned.d <= 0.05,
						`${turned.d}`,
					) && good;
			// The face's farthest move: every way a 3D import turns and nods it, by its depth.
			const [kx, ky] = rig.sr.fit.features?.scale?.face ?? [1, 1];
			const [dx, dy] = [
				depth * kx * Math.sin((40 * Math.PI) / 180),
				depth * ky * Math.sin((25 * Math.PI) / 180),
			];
			for (const [sx, sy] of [
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1],
			]) {
				const s = posed(rig);
				s.findBone('face').x += sx * dx;
				s.findBone('face').y += sy * dy;
				s.updateWorldTransform(RIG.Physics.update);
				const h = drawing(s, 'head', 'head');
				const area = (dr, k) => {
					const [a, b, c] = [dr.tris[k], dr.tris[k + 1], dr.tris[k + 2]];
					return (
						(dr.v[b * 2] - dr.v[a * 2]) * (dr.v[c * 2 + 1] - dr.v[a * 2 + 1]) -
						(dr.v[c * 2] - dr.v[a * 2]) * (dr.v[b * 2 + 1] - dr.v[a * 2 + 1])
					);
				};
				const head = drawing(posed(rig), 'head', 'head');
				for (let k = 0; k < h.tris.length; k += 3) {
					const A = area(head, k);
					if (Math.abs(A) < 1e-9) continue;
					worst.fold = Math.min(worst.fold, h.v.every(Number.isFinite) ? area(h, k) / A : -1);
				}
			}
			good =
				ok(
					`faceturn (${what}): the face's farthest move folds no triangle of the head`,
					worst.fold >= FOLD,
					`${worst.fold}`,
				) && good;
			// A roll on top of the turn: the head's whole drawing turns about the head with it.
			const s = posed(rig, anim, turned.t);
			const before = drawing(s, 'head', 'head');
			const Hd = boneAt(s, 'head');
			s.findBone('head').rotation += HEAD_TURN;
			s.updateWorldTransform(RIG.Physics.update);
			const after = drawing(s, 'head', 'head');
			const [c, sn] = [
				Math.cos((HEAD_TURN * Math.PI) / 180),
				Math.sin((HEAD_TURN * Math.PI) / 180),
			];
			for (let i = 0; i < n; i++) {
				const p = vtx(before, i);
				const want = [
					Hd[0] + c * (p[0] - Hd[0]) - sn * (p[1] - Hd[1]),
					Hd[1] + sn * (p[0] - Hd[0]) + c * (p[1] - Hd[1]),
				];
				worst.roll = Math.max(worst.roll, d2(vtx(after, i), want) / Math.max(1, d2(want, p)));
			}
			good =
				ok(
					`faceturn (${what}): a head roll on the turned face turns the head's whole drawing`,
					worst.roll <= HEAD_LEFT,
					`${worst.roll}`,
				) && good;
		}
		log(
			`a face capture's head turn on a head drawn apart slides its face ≥ ${worst.turn.toFixed(1)} units; the head under the face and ${FACE_LOCKED.join(', ')} within ${(worst.slip * 100).toFixed(1)}% of their move, its outline within ${worst.outline.toExponential(1)}; the face's farthest move keeps ≥ ${worst.fold.toFixed(2)} of every triangle; a roll on top turns it whole within ${(worst.roll * 100).toFixed(2)}% (untrimmed, trimmed, a face found on the head)`,
		);
		return good;
	},

	/** The head turned: the head's drawing, the nose and the brows turn with it, at rest and in the frame. */
	headturn(M, log) {
		let good = true;
		const rows = [];
		for (const face of [true, false]) {
			const { regions, mapping } = ownerSheet(M, { face });
			const rig = created(M, M.HALF_BODY, mapping, regions);
			const head = mapping.parts.head;
			const r = regions.find((x) => x.name === head.region);
			const pts = [
				['the head', 'head', 'head', [0.5, 0.15]],
				["the head's outline", 'head', 'head', [0.5, 0]],
				["the head's face", 'head', 'head', [head.joints.face[0] / r.w, head.joints.face[1] / r.h]],
				['the nose', 'nose', 'nose', [0.5, 0.5]],
				['the brow', 'brow_l', 'brow_l_up', [0.5, 0.5]],
			];
			for (const [pose, skel] of [
				['frame', framePosed(rig)],
				['rest', posed(rig)],
			]) {
				const before = pts.map(([, slot, att, uv]) => carried(drawing(skel, slot, att), uv));
				const H = boneAt(skel, 'head');
				skel.findBone('head').rotation += HEAD_TURN;
				skel.updateWorldTransform(RIG.Physics.update);
				const [c, s] = [
					Math.cos((HEAD_TURN * Math.PI) / 180),
					Math.sin((HEAD_TURN * Math.PI) / 180),
				];
				pts.forEach(([what, slot, att, uv], i) => {
					const p = before[i];
					const want = [
						H[0] + c * (p[0] - H[0]) - s * (p[1] - H[1]),
						H[1] + s * (p[0] - H[0]) + c * (p[1] - H[1]),
					];
					const left = d2(carried(drawing(skel, slot, att), uv), want) / d2(want, p);
					rows.push(left);
					good =
						ok(
							`headturn (${face ? 'a face on the head' : 'no face'}, ${pose}): ${what} turns with the head`,
							left <= HEAD_LEFT,
							`${left}`,
						) && good;
				});
			}
		}
		log(
			`the head turned ${HEAD_TURN}°: the head, its face, the nose and a brow follow within ${(Math.max(...rows) * 100).toFixed(2)}% (face found or not, in the frame and at rest)`,
		);
		return good;
	},

	/**
	 * The rig draws the template's order: every mapped part in the template's relative order (never
	 * the sheet's), each prop just over its part, or just behind it where the artist's Photoshop layers
	 * put it there, and a part's props in the layers' order.
	 */
	draworder(M, log) {
		let good = true;
		const { regions, mapping } = ownerSheet(M);
		const rig = created(M, M.HALF_BODY, mapping, regions);
		const order = rig.rigged.skeleton.slots.map((s) => s.name);
		const tpl = M.HALF_BODY.slots.map((s) => s.name);
		const mappedSlots = [...new Set(Object.keys(mapping.parts).map((p) => slotOf(M, p)))];
		const at = (n) => order.indexOf(n);
		const inverted = [];
		for (const a of mappedSlots)
			for (const b of mappedSlots)
				if (tpl.indexOf(a) < tpl.indexOf(b) && at(a) > at(b)) inverted.push(`${a}/${b}`);
		good =
			ok(
				`draworder: the ${mappedSlots.length} mapped slots in the template's order`,
				inverted.length === 0,
				inverted.join(', '),
			) && good;
		const just = (a, b) => at(a) + 1 === at(b);
		good =
			ok(
				"draworder: the hood's lining and back just behind the torso, back to front as the layers have them",
				just('prop_hood_lining', 'prop_hood_back') && just('prop_hood_back', 'torso'),
				order.slice(at('torso') - 3, at('torso') + 3).join(' '),
			) && good;
		good =
			ok(
				'draworder: the chain (layered over the torso) just over it',
				just('torso', 'prop_chain'),
				order.slice(at('torso'), at('torso') + 3).join(' '),
			) && good;
		good =
			ok(
				"draworder: the head's props over every face part, under the front hair, as listed",
				just('prop_glasses', 'prop_earring_l') &&
					just('prop_earring_l', 'hair_front') &&
					order
						.slice(at('head'), at('prop_glasses'))
						.every((n) => !n.startsWith('prop_') && n !== 'hair_front'),
				order.slice(at('hair_front') - 3, at('hair_front') + 1).join(' '),
			) && good;
		const layer = [
			['NellyAssetBreakdown1_0002s_0003s_0001_UpperEyelidR', ['0002s', '0003s', '0001']],
			['NellyAssetBreakdown1_0004_Head', ['0004']],
			['L_arm_upper', null],
		];
		for (const [name, want] of layer)
			good =
				ok(
					`draworder: ${name} reads as layer ${want?.join('/') ?? 'none'}`,
					JSON.stringify(M.psdLayer(name)) === JSON.stringify(want),
				) && good;
		const behind = [
			['0008_HoodBack', '0007_Torso', true],
			['0005_Chain', '0007_Torso', false],
			['0002s_0000_Glasses', '0004_Head', null],
			['0001s_0000_WatchR', '0001s_0002_ForeArmR', false],
			['0000s_0001_A', '0001s_0002_B', null],
		];
		for (const [a, b, want] of behind)
			good =
				ok(
					`draworder: ${a} is ${want === null ? 'not ordered against' : want ? 'behind' : 'in front of'} ${b}`,
					M.psdBehind(`X_${a}`, `X_${b}`) === want,
				) && good;
		log(
			`${mappedSlots.length} mapped slots in the template's order; ${order.slice(at('torso') - 2, at('torso') + 2).join(' < ')}`,
		);
		return good;
	},

	/** The mapping reads back as written; a bad one is refused, saying why; `sheet.json` is no skeleton. */
	sidecar(M, log) {
		let good = true;
		const m = mappingOf(M);
		const back = M.parseSheetMapping(JSON.parse(JSON.stringify(m)));
		good =
			ok(
				'sidecar: the mapping reads back as written',
				JSON.stringify(back.mapping) === JSON.stringify(m),
			) && good;
		const swapped = { ...m, swapSides: true };
		good =
			ok(
				'sidecar: ⇄ swapSides reads back as written',
				JSON.stringify(M.parseSheetMapping(JSON.parse(JSON.stringify(swapped))).mapping) ===
					JSON.stringify(swapped),
			) && good;
		const bad = [
			['an unknown field', { ...m, extra: 1 }],
			[
				'a joint not a point',
				{
					...m,
					parts: {
						...m.parts,
						torso: { ...m.parts.torso, joints: { ...m.parts.torso.joints, hips: [1] } },
					},
				},
			],
			[
				'a face of 3 points',
				{
					...m,
					parts: {
						...m.parts,
						head: {
							...m.parts.head,
							face: [
								[0, 0],
								[1, 1],
								[2, 2],
							],
						},
					},
				},
			],
			['no version', { ...m, sheet: 2 }],
			['a scale of 0', { ...m, scale: 0 }],
			['a swapSides neither true nor false', { ...m, swapSides: 'yes' }],
			['a prop with no place', { ...m, props: [{ ...m.props[0], at: null }] }],
		];
		for (const [what, raw] of bad)
			good = ok(`sidecar: ${what} is refused`, 'problem' in M.parseSheetMapping(raw)) && good;
		const misfits = [
			['a part the template lacks', { ...m, parts: { ...m.parts, tail: m.parts.torso } }],
			[
				'a region the sheet lacks',
				{ ...m, parts: { ...m.parts, torso: { ...m.parts.torso, region: 'nope' } } },
			],
			[
				'a joint the part lacks',
				{ ...m, parts: { ...m.parts, neck: { ...m.parts.neck, joints: { base: [1, 1] } } } },
			],
			[
				'a face on an arm',
				{
					...m,
					parts: { ...m.parts, upper_arm_l: { ...m.parts.upper_arm_l, face: m.parts.head.face } },
				},
			],
			['a prop on a part not mapped', { ...m, props: [{ ...m.props[0], host: 'pelvis' }] }],
			['a prop on a control', { ...m, props: [{ ...m.props[0], bone: 'hand_ik_l' }] }],
			[
				'a prop named like a part',
				{
					...m,
					props: [
						{ ...m.props[0], name: 'prop_x' },
						{ ...m.props[1], name: 'prop_x' },
					],
				},
			],
			['another template', { ...m, template: { id: 'full-body', version: 1 } }],
		];
		for (const [what, raw] of misfits)
			good =
				ok(
					`sidecar: ${what} is refused`,
					typeof M.sheetMappingProblem(M.HALF_BODY, REGIONS, raw) === 'string',
				) && good;
		// An arrangement and a prop's turn read back; a PR-1 sidecar (neither) still reads; bad ones refused.
		const a = arrangedAsFrame(M);
		a.props[0].turn = -12.5;
		const aBack = M.parseSheetMapping(JSON.parse(JSON.stringify(a)));
		good =
			ok(
				'sidecar: an arrangement and a prop turn read back as written',
				JSON.stringify(aBack.mapping) === JSON.stringify(a),
			) && good;
		const place = a.arrange.torso;
		const badArranged = [
			['an arrangement not an object', { ...a, arrange: [] }],
			['a place with an unknown field', { ...a, arrange: { torso: { ...place, scale: 2 } } }],
			['a place turned by no number', { ...a, arrange: { torso: { ...place, turn: '5' } } }],
			['a place off the canvas', { ...a, arrange: { torso: { ...place, at: [1e9, 0] } } }],
			['a prop turned by no number', { ...a, props: [{ ...a.props[0], turn: null }] }],
		];
		for (const [what, raw] of badArranged)
			good = ok(`sidecar: ${what} is refused`, 'problem' in M.parseSheetMapping(raw)) && good;
		const misArranged = [
			['an arranged part not mapped', { ...a, arrange: { ...a.arrange, pelvis: place } }],
			['an arranged hand pose', { ...a, arrange: { ...a.arrange, [ALTERNATE.part]: place } }],
		];
		for (const [what, raw] of misArranged)
			good =
				ok(
					`sidecar: ${what} is refused`,
					typeof M.sheetMappingProblem(M.HALF_BODY, REGIONS, raw) === 'string',
				) && good;
		good =
			ok(
				'sidecar: sheet.json is a bundle sidecar, not a skeleton',
				M.isBundleSidecar(M.SHEET_SIDECAR) && M.SHEET_SIDECAR === 'sheet.json',
			) && good;
		log(
			`${bad.length + misfits.length + badArranged.length + misArranged.length} bad mappings refused`,
		);
		return good;
	},
};

const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
/** Only the mutants of one guard (the guards not run). */
const MUTANTS_OF = process.argv.includes('--mutants')
	? process.argv[process.argv.indexOf('--mutants') + 1]
	: null;
for (const [id, guard] of Object.entries(GUARDS)) {
	if ((ONLY && id !== ONLY) || MUTANTS_OF) continue;
	console.log(`\n=== ${id}`);
	guard(M0, (line) => console.log(`    ${line}`));
}
if (ONLY || process.argv.includes('--no-mutants')) {
	console.log(`\n${fails === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - fails}/${checks} checks`);
	process.exit(fails === 0 ? 0 : 1);
}

console.log('\n=== mutants of the shipped code: each must turn its check red');
const MAP = 'rigSheetMap.ts';
const FIT = 'rigSheetFit.ts';
const TPL = 'rigTemplates.ts';
const FACE = 'rigFrameFace.ts';
const MUTANTS = [
	['suggest', "an artist's left read as the right", [MAP, "left: ['l'],", "left: ['r'],"]],
	[
		'swap',
		"a sheet's sides never read the other way round",
		[MAP, 'if (!swap) return words;', 'return words;'],
	],
	[
		'swap',
		"an exact name's side not read the other way round",
		[
			MAP,
			'if (plain(part) === plain(region, swap)) return 10;',
			'if (plain(part) === plain(region)) return 10;',
		],
	],
	[
		'swap',
		"a worn thing's side not read the other way round",
		[MAP, 'const words = canonicalWords(region, swap);', 'const words = canonicalWords(region);'],
	],
	[
		'sidecar',
		'⇄ swapSides not kept in sheet.json',
		[FIT, '...(raw.swapSides === true ? { swapSides: true as const } : {}),', ''],
	],
	[
		'suggest',
		"an arm's 1 and 2 not read as its segments",
		[
			MAP,
			"if (limb.length === 1 && digit && !out.has('upper') && !out.has('lower'))",
			'if (false)',
		],
	],
	[
		'suggest',
		'an arm of the other side read as this one',
		[MAP, 'if (other && have.has(other) && !have.has(side!)) return 0;', ''],
	],
	[
		'suggest',
		"a pose's or angle's word not counted against the main drawing",
		[MAP, 'score -= 0.15', 'score -= 0'],
	],
	[
		'guess',
		'a hanging limb read from its bottom',
		[MAP, '? a.cap[1] <= b.cap[1]', '? a.cap[1] >= b.cap[1]'],
	],
	[
		'guess',
		'a limb lying out read from its far end',
		[
			MAP,
			"side === 'r'\n\t\t\t? a.cap[0] <= b.cap[0]",
			"side === 'r'\n\t\t\t? a.cap[0] >= b.cap[0]",
		],
	],
	[
		'guess',
		'the knuckles at the fingertips',
		[MAP, 'const KNUCKLE_SHARE = 0.55;', 'const KNUCKLE_SHARE = 0.95;'],
	],
	[
		'guess',
		'the face bone on the eyes',
		[MAP, 'const FACE_BELOW_EYES = 20 / 90;', 'const FACE_BELOW_EYES = 0;'],
	],
	[
		'guess',
		"the shoulders guessed well in from the torso's corners",
		[MAP, 'const SHOULDER_IN = 0.05;', 'const SHOULDER_IN = 0.17;'],
	],
	[
		'fit',
		'the scale off by 2%',
		[
			FIT,
			'if (drawn > 1e-6) k = len(tplShoulders) / drawn;',
			'if (drawn > 1e-6) k = (len(tplShoulders) / drawn) * 1.02;',
		],
	],
	[
		'fit',
		"the picture's y not flipped",
		[FIT, '(r.origH ?? r.h) / 2 - y,', 'y - (r.origH ?? r.h) / 2,'],
	],
	[
		'fit',
		"the neck left at the template's height, not the torso's collar",
		[
			FIT,
			"const problem = setLength('neck', Math.max(LEAST_LENGTH * tl, along), 'torso');",
			'const problem = null;',
		],
	],
	[
		'fit',
		"a mesh bound where its slot's bone is, not where its drawing sits",
		[
			TPL,
			'affineApply(place ?? bind.get(slotBone)!, offX + x, offY + y)',
			'affineApply(bind.get(slotBone)!, offX + x, offY + y)',
		],
	],
	[
		'finite',
		"a part's attachment not naming its region",
		[
			TPL,
			'const path = placed && placed.region !== p.name ? { path: placed.region } : {};',
			'const path = {};',
		],
	],
	[
		'skin',
		"the head not skinned to the face's bones",
		[FIT, 'turned?.spots ?? drawn?.spots,\n\t\ttrue,', 'undefined,\n\t\ttrue,'],
	],
	[
		'skin',
		"the torso drawn by angle not bending as its slot's main drawing",
		[FIT, 'if (main) bends[x.part] = structuredClone(bends[main.part]);', ''],
	],
	[
		'proportions',
		'parts drawn apart skinned into the parts beside them, as a cut frame is',
		[
			FIT,
			'turned?.spots ?? drawn?.spots,\n\t\ttrue,',
			'turned?.spots ?? drawn?.spots,\n\t\tfalse,',
		],
	],
	[
		'headturn',
		"the head's face mesh hung from the neck",
		[
			'rigFrameFit.ts',
			'out.head ??= { bones: [{ bone: headBone }], grid: SKIN_GRID.face };',
			"out.head ??= { bones: [{ bone: 'neck' }], grid: SKIN_GRID.face };",
		],
	],
	[
		'faceturn',
		"a head drawn without its face left rigid on its bone, the face sliding over it (the owner's)",
		[FIT, '(drawnHead\n\t\t\t? apartFace(', '(false\n\t\t\t? apartFace('],
	],
	[
		'faceturn',
		"the face's move not cut to the room its region leaves on the head (the skin folds)",
		[
			FACE,
			'features: { at: {}, scale: { face: scale.face } },',
			'features: { at: {}, scale: { face: [s, s] } },',
		],
	],
	[
		'faceturn',
		"the face's region not whole over the features drawn on it (they slide over the head)",
		[FACE, 'const FACE_CORE = 0.6;', 'const FACE_CORE = 0.2;'],
	],
	[
		'faceturn',
		"a trimmed head's ink read from the trim's top, not its bottom (its outline moves)",
		[
			FIT,
			'const y0 = (r.offY ?? (h - r.h) / 2) - h / 2;',
			'const y0 = h / 2 - (r.offY ?? (h - r.h) / 2) - r.h;',
		],
	],
	[
		'draworder',
		'a prop the layers put behind its part drawn over it, and one over it drawn behind',
		[MAP, 'host(p.host).region) === true;', 'host(p.host).region) === false;'],
	],
	[
		'draworder',
		"a part's props in the order listed, not the layers'",
		[
			MAP,
			'const backToFront = psdOrdered(props, (p) => p.region);',
			'const backToFront = [...props];',
		],
	],
	[
		'draworder',
		"the slots in the sheet's name order, not the template's",
		[
			TPL,
			'slots: ft.slots.map((s) => ({',
			'slots: [...ft.slots].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({',
		],
	],
	[
		'redraw',
		'the chest not taking the torso drawn between its hips and shoulders',
		[FIT, 'Math.max(LEAST_LENGTH * tl, tl + drawn - tplRise)', 'tl'],
	],
	[
		'redraw',
		'a drawing turned the wrong way onto its bone',
		[FIT, 'const r = angle(wd) - angle(qd);', 'const r = angle(qd) - angle(wd);'],
	],
	[
		'capture',
		'the page keying none of the capture',
		['view.html', 'if (!keys.length) return 0;', 'if (keys.length) return 0;'],
	],
	[
		'capture',
		'a prop hanging from the root, not its bone',
		[FIT, 'props.push({ name: p.name, bone: p.bone,', "props.push({ name: p.name, bone: 'root',"],
	],
	[
		'props',
		"a prop drawn on its host's middle, not where it sits",
		[FIT, 'p.turn ? turnedAt(p.turn, pivot) : [1, 0, 0, 1, ...pivot],', '[1, 0, 0, 1, 0, 0],'],
	],
	[
		'props',
		"a watch drawn under its hand's fingers",
		[
			MAP,
			"const beside = side ? armTail(slots, side) : overHair ? 'hair_front' : slot;",
			"const beside = overHair ? 'hair_front' : slot;",
		],
	],
	[
		'props',
		"a prop's region not turned and scaled on its bone",
		[
			TPL,
			'? onBone(bind.get(ft.slots.find((s) => s.name === p.slot)!.bone)!, placed.matrix)',
			'? {}',
		],
	],
	[
		'sidecar',
		'an unknown field read',
		[
			FIT,
			'if (extra !== undefined) return no(`a sheet mapping has no field',
			'if (false) return no(`a sheet mapping has no field',
		],
	],
	[
		'sidecar',
		'a prop on a part not mapped',
		[FIT, 'if (!m.parts[p.host]) return', 'if (false) return'],
	],
	['sidecar', 'sheet.json taken for a skeleton', ['rigIndex.ts', '\tSHEET_SIDECAR,\n', '']],
	[
		'sidecar',
		'an arranged hand pose let through',
		[FIT, 'if (!partOf(t, part).main)', 'if (false)'],
	],
	[
		'arrange',
		'a drawing turned the wrong way on the canvas',
		[FIT, 'const r = (turn * Math.PI) / 180;', 'const r = (-turn * Math.PI) / 180;'],
	],
	[
		'arrange',
		"the canvas's y not flipped",
		[FIT, '[k, 0, 0, -k, -k * o[0], k * o[1]];', '[k, 0, 0, k, -k * o[0], -k * o[1]];'],
	],
	[
		'arrange',
		'a limb not turned to lie as its drawing does',
		[FIT, 'aims[on[0]] = on[1];', 'void on;'],
	],
	[
		'arrange',
		'no frame clip made of the arrangement',
		[FIT, '...(frame ? { frame } : {}),\n\t\t...(features', '...(features'],
	],
	[
		'arrange',
		"a forearm snapping to its upper arm's shoulder",
		[MAP, "lower_arm: [['upper_arm_s', 'elbow']],", "lower_arm: [['upper_arm_s', 'shoulder']],"],
	],
	[
		'arrange',
		"a prop's turn not drawn",
		[FIT, 'p.turn ? turnedAt(p.turn, pivot) : [1, 0, 0, 1, ...pivot],', '[1, 0, 0, 1, ...pivot],'],
	],
	[
		'arrange',
		"the preview's bones at rest, not in the frame pose",
		[FIT, 'const W = frameWorld(ft.bones, fit.frame);', 'const W = frameWorld(ft.bones);'],
	],
	[
		'framejoints',
		"the torso's spine and chest not turned with it",
		[FIT, 'if (i) aims[chain[i - 1]] = n;', 'void i;'],
	],
	[
		'framejoints',
		'the canvas turned about the root, not the waist',
		[FIT, "(anchor.kind === 'torso' ? at('spine')", "(anchor.kind === 'torso' ? at('root')"],
	],
	[
		'framejoints',
		'a part not arranged left at rest, not riding its bone',
		[
			FIT,
			'? compose(posedW.get(bone)!, compose(invert(W.get(bone)!), rest.get(x.part)!))',
			'? rest.get(x.part)!',
		],
	],
	[
		'framejoints',
		'every part bound at rest, not in the frame',
		[TPL, 'const bind = frameWorld(ft.bones, fit?.frame);', 'const bind = frameWorld(ft.bones);'],
	],
	[
		'framejoints',
		"the face's bones placed at rest",
		[
			FIT,
			'const lengthened: RigFit = { bones, ...(frame ? { frame } : {}) };',
			'const lengthened: RigFit = { bones };',
		],
	],
	[
		'partialface',
		'a brow or a mouth drawn on a sheet refused again (the bare 500)',
		[
			TPL,
			'const offX = place ? 0 : (p.at?.x ?? 0);',
			"if (place && !bend.skin) throw new Error('bends only skinned');\n\tconst offX = place ? 0 : (p.at?.x ?? 0);",
		],
	],
	[
		'partialface',
		'a brow or a mouth drawn on a sheet bound beside its bone, not where it is drawn',
		[TPL, 'bend.skin || place ? affineApply(', 'bend.skin ? affineApply('],
	],
	[
		'partialface',
		"a bend's bones read on a sheet's drawing where the setup has them",
		[TPL, 'if (!place) return [world.get(bone)!', 'if (true) return [world.get(bone)!'],
	],
	[
		'framejoints',
		"a prop's bone placed at rest",
		[
			FIT,
			'fitTemplate(t, { bones, features }).bones, frame)',
			'fitTemplate(t, { bones, features }).bones)',
		],
	],
	[
		'framejoints',
		"the skin's joints read off the rig at rest, not in the frame",
		[
			FIT,
			'const posed = framePose(t, fit, mains);',
			'const posed = framePose(t, { ...fit, frame: undefined }, mains);',
		],
	],
];
/** Where each mutated file is, so a mutant is known planted before it counts. */
const SOURCES = {
	[MAP]: join(LIB, MAP),
	[FIT]: join(SERVER, FIT),
	[TPL]: join(SERVER, TPL),
	'rigIndex.ts': join(SERVER, 'rigIndex.ts'),
	'rigFrameFit.ts': join(SERVER, 'rigFrameFit.ts'),
	[FACE]: join(SERVER, FACE),
	'view.html': join(APP, 'static/rigger/view.html'),
};
for (const [guard, what, mutation] of MUTANTS) {
	if (MUTANTS_OF && guard !== MUTANTS_OF) continue;
	const [file, from] = mutation;
	if (!readFileSync(SOURCES[file], 'utf8').replace(/\r\n/g, '\n').includes(from)) {
		ok(`mutant planted: ${what}`, false, `"${from}" is not in ${file}`);
		continue;
	}
	const before = fails;
	const quiet = console.error;
	console.error = () => {};
	let red;
	try {
		const mutant = await load([mutation]);
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
