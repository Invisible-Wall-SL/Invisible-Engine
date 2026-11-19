// Rig templates T6: what `services/atlas-tool/rig_parts.py` (the Bust-with-face part cutter)
// assumes about a template rig, checked on the shipped code — the real `bust-face` template built by
// the server's `templateRig` and posed by the official engine-rig loader:
//  - `services/atlas-tool/rig_templates/bust-face.json` (the cutter's copy of the parts and of each
//    bone's setup-pose world position) matches the TypeScript template — `--write` regenerates it;
//  - a part image is drawn CENTRED on its slot's bone, image-up = rig-up, at its untrimmed size, so
//    a canvas centred on the bone puts its art where the cutter painted it — also when the atlas
//    packer trimmed the transparent margin away;
//  - with `--parts <dir>` (a cutter output folder), the rig made from those images: every required
//    part attaches, and each one lands where `parts.json` says.
//   node tools/rigger-spike/template-art.mjs [--write] [--parts <dir>]
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const JSON_PATH = fileURLToPath(new URL('services/atlas-tool/rig_templates/bust-face.json', ROOT));
const esbuild = await import(ESBUILD);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Physics } = await import(
	RIG_CORE
);

const out = join(mkdtempSync(join(tmpdir(), 'template-art-')), 'templates.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/server/rigTemplates.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const { BUST_FACE, templateRig } = await import(pathToFileURL(out).href);

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const round4 = (v) => Math.round(v * 1e4) / 1e4 || 0;

/** Pose a template rig over `regions` ({name, w, h, origW?, origH?, ox?, oy?}). */
function pose(regions) {
	const { skeleton, missing, missingRequired } = templateRig(BUST_FACE, regions);
	const lines = ['page.png', 'size:8192,8192', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		if (r.origW) lines.push(`offsets:${r.ox},${r.oy},${r.origW},${r.origH}`);
		x += r.w;
	}
	const atlas = new TextureAtlas(lines.join('\n') + '\n');
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(skeleton)),
	);
	const skel = new Skeleton(data);
	skel.updateWorldTransform(Physics.update);
	return { skel, missing, missingRequired };
}

/** The drawn quad of `part` on its slot: {x0, y0, x1, y1, upIsUp}. */
function quad(skel, slotName, part) {
	const slot = skel.findSlot(slotName);
	const att = skel.getAttachmentByName(slotName, part);
	let xs;
	let ys;
	let upIsUp;
	if (att.regionUVs) {
		// A bending part (a weighted mesh): its setup vertices, and the image's top row above its bottom.
		const n = att.worldVerticesLength;
		const v = new Float32Array(n);
		att.computeWorldVertices(slot, 0, n, v, 0, 2);
		xs = v.filter((_, i) => i % 2 === 0);
		ys = v.filter((_, i) => i % 2 === 1);
		const uv = att.regionUVs;
		const row = (want) => ys.filter((_, i) => Math.abs(uv[2 * i + 1] - want) < 1e-6);
		upIsUp = Math.min(...row(0)) > Math.max(...row(1));
	} else {
		const v = new Float32Array(8);
		att.computeWorldVertices(slot, v, 0, 2);
		xs = [v[0], v[2], v[4], v[6]];
		ys = [v[1], v[3], v[5], v[7]];
		// Vertex 1 carries the texture's top-left (u, v): the image's top must be the rig's up.
		upIsUp = v[3] > v[1];
	}
	return {
		x0: Math.min(...xs),
		y0: Math.min(...ys),
		x1: Math.max(...xs),
		y1: Math.max(...ys),
		upIsUp,
	};
}

// 1. The cutter's copy of the template.
const sized = BUST_FACE.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
const full = pose(sized);
const slotBone = Object.fromEntries(BUST_FACE.slots.map((s) => [s.name, s.bone]));
const bones = Object.fromEntries(
	BUST_FACE.bones.map((b) => {
		const bone = full.skel.findBone(b.name);
		return [b.name, [round4(bone.worldX), round4(bone.worldY)]];
	}),
);
const fresh = {
	template: BUST_FACE.id,
	version: BUST_FACE.version,
	generatedBy: 'tools/rigger-spike/template-art.mjs --write',
	bones,
	parts: BUST_FACE.parts.map((p) => ({
		name: p.name,
		slot: p.slot,
		bone: slotBone[p.slot],
		required: p.required,
	})),
};
const freshText = JSON.stringify(fresh, null, '\t') + '\n';
if (process.argv.includes('--write')) {
	writeFileSync(JSON_PATH, freshText);
	console.log(`wrote ${JSON_PATH}`);
}
let stored = '';
try {
	stored = readFileSync(JSON_PATH, 'utf8').replace(/\r\n/g, '\n');
} catch {
	/* reported below */
}
ok(
	'rig_templates/bust-face.json matches the TypeScript template',
	stored === freshText,
	'regenerate: node tools/rigger-spike/template-art.mjs --write',
);
ok(
	'every bone is unrotated (the cutter places parts axis-aligned)',
	BUST_FACE.bones.every((b) => !b.rotation),
);

// 2. A part is drawn centred on its bone, image-up = rig-up, at its untrimmed size.
for (const p of BUST_FACE.parts) {
	const q = quad(full.skel, p.slot, p.name);
	const [bx, by] = bones[slotBone[p.slot]];
	ok(
		`${p.name}: centred on bone ${slotBone[p.slot]}`,
		near((q.x0 + q.x1) / 2, bx) && near((q.y0 + q.y1) / 2, by),
		`quad ${JSON.stringify(q)} vs bone ${bx},${by}`,
	);
	ok(`${p.name}: full size`, near(q.x1 - q.x0, p.size[0]) && near(q.y1 - q.y0, p.size[1]));
	ok(`${p.name}: image top is rig up`, q.upIsUp);
}

// A trimmed region (the packer cut a 100×60 canvas down to its 10×10 content, which sat at the
// canvas's left edge, 20 px from its top) still draws that content where the canvas put it.
const trimmed = sized.map((r) =>
	r.name === 'nose' ? { name: 'nose', w: 10, h: 10, ox: 0, oy: 30, origW: 100, origH: 60 } : r,
);
{
	const q = quad(pose(trimmed).skel, 'nose', 'nose');
	const [bx, by] = bones.nose;
	ok(
		'trimmed part: content drawn where its canvas had it',
		near(q.x0, bx - 50) && near(q.x1, bx - 40) && near(q.y1, by + 10) && near(q.y0, by),
		JSON.stringify(q),
	);
}

// 3. A cutter output folder, through the rig.
const at = process.argv.indexOf('--parts');
if (at !== -1) {
	const dir = process.argv[at + 1];
	const report = JSON.parse(readFileSync(join(dir, 'parts.json'), 'utf8'));
	const pngSize = (file) => {
		const b = readFileSync(file);
		return [b.readUInt32BE(16), b.readUInt32BE(20)];
	};
	const regions = readdirSync(dir)
		.filter((f) => f.endsWith('.png') && f !== 'sheet.png')
		.map((f) => {
			const [w, h] = pngSize(join(dir, f));
			return { name: f.slice(0, -4), w, h };
		});
	const rig = pose(regions);
	console.log(
		`${dir}: ${regions.length} images · missing ${rig.missing.length} (${rig.missing.join(', ') || '—'})`,
	);
	ok(
		'every required part attaches',
		rig.missingRequired.length === 0,
		rig.missingRequired.join(', '),
	);
	for (const r of regions) {
		const entry = report.parts[r.name];
		ok(`${r.name}: in parts.json`, !!entry);
		if (!entry) continue;
		const q = quad(rig.skel, entry.slot, r.name);
		const [bx, by] = bones[entry.bone];
		ok(
			`${r.name}: on bone ${entry.bone}`,
			near((q.x0 + q.x1) / 2, bx) && near((q.y0 + q.y1) / 2, by) && near(q.x1 - q.x0, r.w),
		);
	}
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
