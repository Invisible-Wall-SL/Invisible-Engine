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
//  - guess: each joint guessed from its drawing's shape lands within its tolerance of the true one,
//    and the head's from the face found on it;
//  - fit: the rig's limb lengths are the drawn ones at the sheet's scale (the frame's own fit's, for
//    the same joints), and every part's joints, carried on its drawing, sit on their bones at rest;
//  - finite: the fitted template passes the store's pose check (every control at its ends and rest,
//    every starter clip) and the rig the `.irig` save check;
//  - skin: every body part is a mesh skinned across its joints with the parts beside it, the head
//    over the face's bones; the hand poses and angles in its slot bend as it does;
//  - redraw: posed as the frame (the frame's own fit's turns), the rig draws the frame's character
//    again — the parts meet where the frame has them;
//  - capture: a motion capture solved and keyed as 🎥 Motion keys it moves every part with its bone:
//    each part's middle and its joints stay within a few pixels of where their bones carry them,
//    while the arms and the body move tens of pixels;
//  - props: each prop hangs from a bone of its own where it sits on its host's drawing, drawn just
//    over it, and rides it through the capture;
//  - sidecar: the mapping reads back as written (`sheet.json`), and a bad one is refused with why;
//  - every guard is mutation-checked: a planted mutant of the shipped code turns its check red.
//   node tools/rigger-spike/sheet-rig.mjs [--only <guard>] [--no-mutants] [--write]
//   (--write: make the sheet from the F2 fixture's parts again.)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';
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
	/[\\/](rigSheetMap|rigSheetFit|rigFrameFit|rigFrameFace|rigTemplates|rigTemplateFit|rigCutEdits|rigIndex)\.ts$/;
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
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
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
	const sized = regions.map(({ name, w, h, origW, origH }) => ({ name, w, h, origW, origH }));
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

// ---- the guards ------------------------------------------------------------------------------------
const TPL_PARTS = (M) => M.HALF_BODY.parts.map((p) => p.name);
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
/** How far the redrawn frame may differ: alpha IoU of the parts mapped. */
const REDRAW_IOU = 0.98;
/** A trimmed region redraws within this IoU of itself untrimmed. */
const TRIM_IOU = 0.03;
/** Through the capture: a part's middle and joints off where their bones carry them, share of its length. */
const RIDES = { centre: 0.1, joint: 0.06 };
/** Each arm part moves at least this far through the capture (rig units): the check is not vacuous. */
const MOVES = 40;

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

	/** Every body part a mesh skinned across its joints; the head over the face; the alternate too. */
	skin(M, log) {
		let good = true;
		const rig = made(M);
		const skel = posed(rig);
		const bones = rig.rigged.skeleton.bones.map((b) => b.name);
		const skinned = {};
		for (const { part, slot } of [...bodyParts(M), { part: ALTERNATE.part, slot: 'hand_l' }]) {
			const att = skel.getAttachmentByName(slot, part);
			const weighted = att instanceof RIG.MeshAttachment && !!att.bones;
			good = ok(`skin: ${part} is a weighted mesh`, weighted) && good;
			if (!weighted) continue;
			const raw = rig.rigged.skeleton.skins[0].attachments[slot][part];
			const named = new Set();
			let sumOff = 0;
			for (let i = 0; i < raw.vertices.length;) {
				const n = raw.vertices[i++];
				let sum = 0;
				for (let k = 0; k < n; k++, i += 4) {
					named.add(bones[raw.vertices[i]]);
					sum += raw.vertices[i + 3];
				}
				sumOff = Math.max(sumOff, Math.abs(sum - 1));
			}
			skinned[part] = [...named];
			good = ok(`skin: ${part}'s weights sum to 1`, sumOff < 1e-6, `${sumOff}`) && good;
		}
		const has = (part, ...want) =>
			ok(
				`skin: ${part} blends into ${want.join(', ')}`,
				want.every((b) => skinned[part]?.includes(b)),
				JSON.stringify(skinned[part]),
			) && good;
		good = has('torso', 'upper_arm_l_image', 'upper_arm_r_image', 'neck', 'spine', 'clavicle_l');
		good = has('upper_arm_l', 'torso_image', 'lower_arm_l_image');
		good = has('lower_arm_r', 'upper_arm_r_image', 'hand_r');
		good = has('hand_l', 'lower_arm_l_image');
		good = has('neck', 'torso_image', 'head_image');
		good = has(ALTERNATE.part, 'lower_arm_l_image');
		const face = new Set([
			'jaw',
			'lid_upper_l',
			'lid_upper_r',
			'mouth_corner_l',
			'brow_out_l',
			'pupil_r',
		]);
		good = has('head', 'neck', ...face);
		const bare = made(M, mappingOf(M, { face: false }));
		const plain = bare.rigged.skeleton.skins[0].attachments.head.head;
		const faced = new Set();
		for (let i = 0; i < plain.vertices.length;) {
			const n = plain.vertices[i++];
			for (let k = 0; k < n; k++, i += 4)
				faced.add(bare.rigged.skeleton.bones[plain.vertices[i]].name);
		}
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
		const { labels, cut } = FRAME;
		/** Alpha IoU of the rig posed as the frame against the frame's `parts`. */
		const iouOf = (rig, parts) => {
			const cover = raster(posed(rig, anim, 0), parts);
			const drawn = new Set(parts.map((n) => cut.names.indexOf(n)));
			let [both, either] = [0, 0];
			for (let i = 0; i < cover.length; i++) {
				const a = cover[i] >= 0.5;
				const b = drawn.has(labels[i]) && FRAME.frame.data[i * 4 + 3] >= 128;
				if (a && b) both++;
				if (a || b) either++;
			}
			return both / either;
		};
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

	/** A capture keyed as 🎥 Motion keys it moves every part with its bone, and moves the arms. */
	capture(M, log) {
		let good = true;
		const rig = made(M);
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
				pts.length > 1
					? d2(pts[0], pts[1])
					: Math.hypot(dr.att.width ?? 0, dr.att.height ?? 0) || 1;
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
					`capture: ${part} moves (≥ ${MOVES})`,
					moved[part] >= MOVES,
					`${moved[part]?.toFixed(1)}`,
				) && good;
		good =
			ok(
				`capture: every part's middle rides its bone (≤ ${RIDES.centre} of its length)`,
				worst.centre <= RIDES.centre,
				`${worst.centre.toFixed(4)} (${worst.cwhat})`,
			) && good;
		good =
			ok(
				`capture: every joint stays on its bone (≤ ${RIDES.joint} of its length)`,
				worst.joint <= RIDES.joint,
				`${worst.joint.toFixed(4)} (${worst.jwhat})`,
			) && good;
		log(
			`${length.toFixed(2)} s keyed; parts moved ${Object.entries(moved)
				.filter(([p]) => !p.startsWith('prop'))
				.map(([p, d]) => `${p} ${d.toFixed(0)}`)
				.join(
					', ',
				)}; worst middle ${worst.centre.toFixed(4)} (${worst.cwhat}), worst joint ${worst.joint.toFixed(4)} (${worst.jwhat}) of its length`,
		);
		return good;
	},

	/** Each prop on a bone of its own where it sits on its host, drawn just over it. */
	props(M, log) {
		let good = true;
		const rig = made(M);
		const skel = posed(rig);
		const order = skel.drawOrder.map((s) => s.data.name);
		for (const p of rig.mapping.props) {
			const bone = skel.findBone(p.name);
			good =
				ok(`props: ${p.name} hangs from ${p.bone}`, bone?.parent?.data.name === p.bone) && good;
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
			// Over its host, or over its arm's last slot (a watch over the fingers), as frame to rig draws one.
			const side = /^(hand|lower_arm)_([lr])$/.exec(hostSlot)?.[2];
			const slots = M.HALF_BODY.slots.map((x) => x.name);
			const over = side
				? slots
						.slice(slots.indexOf('hair_front'))
						.filter((n) => n.endsWith(`_${side}`))
						.pop()
				: hostSlot;
			good =
				ok(
					`props: ${p.name} drawn just over ${over}`,
					order.indexOf(p.name) > order.indexOf(over) &&
						order.indexOf(p.name) <= order.indexOf(over) + rig.mapping.props.length,
					order.slice(order.indexOf(over), order.indexOf(over) + 4).join(' '),
				) && good;
		}
		log(`${rig.mapping.props.length} props on bones of their own`);
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
		good =
			ok(
				'sidecar: sheet.json is a bundle sidecar, not a skeleton',
				M.isBundleSidecar(M.SHEET_SIDECAR) && M.SHEET_SIDECAR === 'sheet.json',
			) && good;
		log(`${bad.length + misfits.length} bad mappings refused`);
		return good;
	},
};

const ONLY = process.argv.includes('--only')
	? process.argv[process.argv.indexOf('--only') + 1]
	: null;
for (const [id, guard] of Object.entries(GUARDS)) {
	if (ONLY && id !== ONLY) continue;
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
const MUTANTS = [
	['suggest', "an artist's left read as the right", [MAP, "left: ['l'],", "left: ['r'],"]],
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
		[FIT, 'mains, neckWidth, drawn?.spots);', 'mains, neckWidth, undefined);'],
	],
	[
		'skin',
		"a hand pose not bending as its slot's main drawing",
		[FIT, 'if (main) bends[x.part] = structuredClone(bends[main.part]);', ''],
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
		[FIT, 'bone: p.bone,\n\t\t\tafter:', "bone: 'root',\n\t\t\tafter:"],
	],
	[
		'props',
		"a prop drawn on its host's middle, not where it sits",
		[
			FIT,
			'matrix: compose(art[host.part].matrix, [1, 0, 0, 1, ...pivot])',
			'matrix: art[host.part].matrix',
		],
	],
	[
		'props',
		"a watch drawn under its hand's fingers",
		[
			FIT,
			'const beside = side ? armTail(slots, side) : host.slot.name;',
			'const beside = host.slot.name;',
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
			"const extra = extraKey(raw, ['sheet', 'manifestKey', 'template', 'parts', 'props', 'scale']);",
			'const extra = undefined;',
		],
	],
	[
		'sidecar',
		'a prop on a part not mapped',
		[FIT, 'if (!m.parts[p.host]) return', 'if (false) return'],
	],
	['sidecar', 'sheet.json taken for a skeleton', ['rigIndex.ts', '\tSHEET_SIDECAR,\n', '']],
];
/** Where each mutated file is, so a mutant is known planted before it counts. */
const SOURCES = {
	[MAP]: join(LIB, MAP),
	[FIT]: join(SERVER, FIT),
	[TPL]: join(SERVER, TPL),
	'rigIndex.ts': join(SERVER, 'rigIndex.ts'),
	'view.html': join(APP, 'static/rigger/view.html'),
};
for (const [guard, what, mutation] of MUTANTS) {
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
