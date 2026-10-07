// Gate for a mesh made from an image: it must draw the pixels the image drew — on a TRIMMED atlas
// region, on one packed at 90 / 180 / 270°, and on an image SEQUENCE — and every tool that makes or
// re-points a mesh must keep a sequence's frames. Rendered, not reasoned about: the shipped actions
// are pulled out of view.html and run (on the vendored rig runtime the page loads, invisible-rig.js),
// and the rigs they leave are drawn by that same runtime's WebGL renderer in a real Chromium and
// compared pixel by pixel.
//
// Why it broke (rigger.md, open items 10 and 12): a RegionAttachment's quad covers only the trimmed
// ink, but a MeshAttachment's `uvs` are a fraction of the UNTRIMMED image — its updateRegion() adds
// the trim back and undoes the pack's rotation. ▸ Convert to mesh and ✎ Draw mesh laid UVs 0..1
// across the ink's quad as if it were the image, squeezing the whole image (and whatever the atlas
// packs beside the ink) into the ink's box. And ▸ Convert / ✎ Draw / ＋ Linked mesh on a sequence
// dropped its `sequence`, leaving a mesh that names the frames' stem, which no region carries.
//
// The synthetic atlas: every texel of the page says what it is. An image's pixel at (x, y) of its
// untrimmed canvas is (x+1, y+1, image id, 255); the rest of the page is (px, py, 250, 255), so a
// pixel sampled from beside the ink reads as that; an untrimmed, unrotated twin of each image draws
// the truth. Packed the way MeshAttachment.updateRegion() reads a region, and checked against the
// RegionAttachment's own (independent) mapping on the 0 and 90° packs before anything else.
//
// Checked:
//   1. the base rig: each 0 / 90° region draws exactly its untrimmed twin (the atlas is right);
//   2. ▸ Convert to mesh and ✎ Draw mesh (its four corners) on each image, placed plain, shifted,
//      turned 90° and scaled ×2, and under a flipped, turned bone: the mesh draws exactly what the
//      region drew, and what the untrimmed twin draws (the only reference on a 180 / 270° pack,
//      which a RegionAttachment itself does not undo); its UVs agree with the region's through the
//      game's runtime core too;
//   3. sequences: Convert keeps the frames (same trim: every frame identical to the region's; trimmed
//      differently: the author is asked, and every pixel of every frame's ink still draws), the setup
//      frame and a keyed sequence timeline still drive it; ＋ Linked mesh onto it shows the same
//      frames, keyed ones included; switching a linked mesh's source to and from a sequence mesh
//      gives and takes the frames (and its own sequence keys), and the rig loads strictly each time;
//   4. repair of rigs saved before the fix: a mesh the old Convert / Draw made from a trimmed image,
//      unweighted or bound to its slot's bone, is offered, and 🩹 Repair makes it draw the region's
//      pixels; a linked mesh made without its sequence parent's frames gets them. Not offered: the
//      fixed meshes, a Spine-style whole-image quad, a mesh reshaped since, an untrimmed one, and any
//      mesh of the 153 checked-in rigs;
//   5. the UV panel draws the image where the mesh's UVs find it (it stretched the ink over the box).
//
// Run it against another page with RIGGER_VIEW_HTML=<path> (the pre-fix view.html fails it).
//   node tools/rigger-spike/trimmesh.mjs
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';
import vm from 'node:vm';
import { launchChrome } from './chrome.mjs';
import { RIG_CORE } from './spine.mjs';

const ROOT = new URL('../../', import.meta.url);
const STATIC = fileURLToPath(new URL('apps/launcher-api/static/', ROOT));
const VIEW = process.env.RIGGER_VIEW_HTML || join(STATIC, 'rigger/view.html');
const html = readFileSync(VIEW, 'utf8').replace(/\r\n/g, '\n');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- the two runtimes ------------------------------------------------------------------------
const vendored = readFileSync(join(STATIC, 'spine/vendor/invisible-rig.js'), 'utf8');
const CORE = await import(RIG_CORE);

// ---- the synthetic atlas ---------------------------------------------------------------------
const PAGE = 256, NOISE = 250;
// [name, image w, h, ink x, y (from the top), w, h, pack rotation]
const IMAGES = [
	['flat', 40, 40, 7, 13, 20, 10, 0],
	['turn', 40, 40, 7, 13, 20, 10, 90],
	['wide', 36, 24, 1, 17, 30, 6, 90],
	['tall', 22, 38, 3, 2, 9, 31, 0],
	['half', 40, 40, 10, 10, 20, 20, 0], // the ink shares the image's aspect
	['full', 32, 32, 0, 0, 32, 32, 0], // untrimmed
	['flip', 40, 40, 7, 13, 20, 10, 180],
	['back', 36, 24, 1, 17, 30, 6, 270],
	['sq_1', 30, 30, 5, 6, 14, 12, 0], // a sequence trimmed alike
	['sq_2', 30, 30, 5, 6, 14, 12, 90],
	['sd_1', 30, 30, 5, 6, 14, 12, 0], // a sequence trimmed frame by frame
	['sd_2', 30, 30, 2, 3, 20, 22, 90],
	['sd_3', 30, 30, 20, 2, 8, 8, 0], // reaches past the others: the mesh covers more than any one frame
].map(([name, W, H, ix, iy, iw, ih, deg], i) => ({ name, id: i + 1, W, H, ix, iy, iw, ih, deg }));
const STILLS = IMAGES.filter((im) => !/^s[qd]_/.test(im.name));

const page = new Uint8ClampedArray(PAGE * PAGE * 4);
for (let y = 0; y < PAGE; y++) for (let x = 0; x < PAGE; x++) page.set([x, y, NOISE, 255], (y * PAGE + x) * 4);
const regions = []; // atlas entries
let shelfX = 2, shelfY = 2, shelfH = 0;
const place = (w, h) => {
	if (shelfX + w + 2 > PAGE) { shelfX = 2; shelfY += shelfH + 3; shelfH = 0; }
	const at = [shelfX, shelfY];
	shelfX += w + 3; shelfH = Math.max(shelfH, h);
	if (shelfY + h > PAGE) throw new Error('synthetic page overflow');
	return at;
};
// Where MeshAttachment.updateRegion() reads an image's (U, V) — v down, of the untrimmed image.
function readAt(r, U, V) {
	let u = r.x / PAGE, v = r.y / PAGE;
	const { w, h, ox, oy, ow, oh } = r;
	switch (r.deg) {
		case 90: u -= (oh - oy - h) / PAGE; v -= (ow - ox - w) / PAGE; return [u + (V * oh) / PAGE, v + ((1 - U) * ow) / PAGE];
		case 180: u -= (ow - ox - w) / PAGE; v -= oy / PAGE; return [u + ((1 - U) * ow) / PAGE, v + ((1 - V) * oh) / PAGE];
		case 270: u -= oy / PAGE; v -= ox / PAGE; return [u + ((1 - V) * oh) / PAGE, v + (U * ow) / PAGE];
		default: u -= ox / PAGE; v -= (oh - oy - h) / PAGE; return [u + (U * ow) / PAGE, v + (V * oh) / PAGE];
	}
}
const inkColor = (im, x, y) => [x + 1, y + 1, im.id, 255];
for (const im of IMAGES) {
	const turned = im.deg === 90 || im.deg === 270;
	const [x, y] = place(turned ? im.ih : im.iw, turned ? im.iw : im.ih);
	const r = { name: im.name, x, y, w: im.iw, h: im.ih, ox: im.ix, oy: im.H - im.iy - im.ih, ow: im.W, oh: im.H, deg: im.deg };
	const pw = turned ? r.h : r.w, ph = turned ? r.w : r.h;
	for (let cy = im.iy; cy < im.iy + im.ih; cy++)
		for (let cx = im.ix; cx < im.ix + im.iw; cx++) {
			const [u, v] = readAt(r, (cx + 0.5) / im.W, (cy + 0.5) / im.H);
			const tx = Math.floor(u * PAGE), ty = Math.floor(v * PAGE);
			if (tx < x || ty < y || tx >= x + pw || ty >= y + ph) throw new Error(`${im.name}: (${cx},${cy}) packs outside its rect`);
			page.set(inkColor(im, cx, cy), (ty * PAGE + tx) * 4);
		}
	regions.push(r);
	// its untrimmed, unrotated twin — transparent where the ink is not
	const [tx0, ty0] = place(im.W, im.H);
	for (let cy = 0; cy < im.H; cy++)
		for (let cx = 0; cx < im.W; cx++) {
			const ink = cx >= im.ix && cx < im.ix + im.iw && cy >= im.iy && cy < im.iy + im.ih;
			page.set(ink ? inkColor(im, cx, cy) : [0, 0, 0, 0], ((ty0 + cy) * PAGE + tx0 + cx) * 4);
		}
	regions.push({ name: 'T_' + im.name, x: tx0, y: ty0, w: im.W, h: im.H, ox: 0, oy: 0, ow: im.W, oh: im.H, deg: 0 });
}
const ATLAS = ['page.png', `size:${PAGE},${PAGE}`, 'filter:Nearest,Nearest', 'repeat:none',
	...regions.flatMap((r) => [r.name, `bounds:${r.x},${r.y},${r.w},${r.h}`, `offsets:${r.ox},${r.oy},${r.ow},${r.oh}`, ...(r.deg ? [`rotate:${r.deg}`] : [])]),
	''].join('\n');

// ---- the rigs --------------------------------------------------------------------------------
// Each case is a slot on its own bone at the middle of a 160 × 160 frame, drawn alone; its twin slot
// (`T.` + slot) shows the untrimmed twin placed alike.
const PLACINGS = {
	a: { bone: {}, att: {} },
	b: { bone: {}, att: { x: 4, y: -3 } },
	c: { bone: {}, att: { rotation: 90, scaleX: 2, scaleY: 2 } },
	d: { bone: { rotation: 90, scaleX: -1 }, att: { x: 2, scaleY: 2 } },
};
const CASES = STILLS.flatMap((im) => Object.keys(PLACINGS).map((p) => ({ slot: `${im.name}.${p}`, im, p })));
function stillsRig() {
	const doc = { skeleton: { spine: '4.2.00' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} };
	const bag = doc.skins[0].attachments;
	for (const c of CASES) {
		const { bone, att } = PLACINGS[c.p];
		doc.bones.push({ name: 'b.' + c.slot, parent: 'root', x: 80, y: 80, ...bone });
		for (const [slot, path] of [[c.slot, c.im.name], ['T.' + c.slot, 'T_' + c.im.name]]) {
			doc.slots.push({ name: slot, bone: 'b.' + c.slot, attachment: path });
			bag[slot] = { [path]: { width: c.im.W, height: c.im.H, ...att } };
		}
	}
	return doc;
}
const SEQS = [
	{ slot: 'same', base: 'sq_', seq: { count: 2 } },
	{ slot: 'diff', base: 'sd_', seq: { count: 3, setup: 1 } },
	{ slot: 'keyed', base: 'sq_', seq: { count: 2 } },
];
function seqRig() {
	const doc = { skeleton: { spine: '4.2.00' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} };
	for (const s of SEQS) {
		doc.bones.push({ name: 'b.' + s.slot, parent: 'root', x: 80, y: 80 });
		doc.slots.push({ name: s.slot, bone: 'b.' + s.slot, attachment: s.base });
		doc.skins[0].attachments[s.slot] = { [s.base]: { width: 30, height: 30, sequence: clone(s.seq) } };
	}
	// frame 2 from the first key on
	doc.animations.frame2 = { attachments: { default: { keyed: { sq_: { sequence: [{ mode: 'hold', index: 1 }] } } } } };
	return doc;
}

// ---- the shipped actions, run on the vendored runtime ------------------------------------------
const TOP = new Map();
for (const m of html.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g)) if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = html.indexOf('\n', at + 1), first = html.slice(at, eol);
	let n = 0; for (const c of first) { if (c === '{' || c === '[') n++; else if (c === '}' || c === ']') n--; }
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	const end = html.indexOf(kind === 'const' ? '\n};' : '\n}', at);
	return html.slice(at, end + (kind === 'const' ? 3 : 2));
}
const STUBS = new Set(['buildInspector', 'selectBone', 'renderBoneDetail', 'refreshArtWarn', 'selectSlot', 'renderSlotDetail', 'markDirty', 'showNotice', 'showErr', 'reselectAttachment']);
const ENTRY = ['rebuildFromRawDoc', 'convertRegionToMesh', 'finishDrawMesh', 'addLinkedMesh', 'setLinkedMeshParent', 'meshRepairs', 'repairMeshes'];
const absent = ENTRY.filter((n) => !TOP.has(n));
const pulled = [], seen = new Set();
for (const q = ENTRY.filter((n) => TOP.has(n)); q.length; ) {
	const name = q.shift();
	if (seen.has(name) || STUBS.has(name)) continue;
	seen.add(name);
	const src = pull(name);
	pulled.push(src);
	for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
		const t = TOP.get(m[1]);
		if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
	}
}
const asked = [];
let answer = true; // the author's answer to a confirm
const sandbox = {
	console, rawDoc: null, skeletonData: null, skeleton: null, animState: null, meshSetupVerts: null, missingArt: [],
	selected: { name: 'rig', atlas_file: 'page.atlas' }, selSlot: null, selBone: null, meshCtx: null,
	rigText: { elements: [] }, drawMeshMode: false, drawPoints: [], selDrawPoint: null, pma: false, gl: null,
	assetMgr: { require: () => sandbox.__atlas },
	$: () => null,
	document: { createElement: () => ({ style: {}, appendChild() {} }) },
	confirm: (msg) => { asked.push(msg); return answer; },
	alert: (msg) => { throw new Error(msg); },
	__atlas: null,
};
for (const s of STUBS) sandbox[s] = () => {};
vm.createContext(sandbox);
vm.runInContext(vendored + '\n;globalThis.SPINE = spine;', sandbox, { filename: 'invisible-rig.js' });
vm.runInContext(pulled.join('\n'), sandbox, { filename: 'view.html#trimmesh' });
const SPINE = sandbox.SPINE;
const stubTexture = { getImage: () => ({ width: PAGE, height: PAGE }), setFilters() {}, setWraps() {}, dispose() {} };
function atlasFor(lib) {
	const a = new lib.TextureAtlas(ATLAS);
	for (const p of a.pages) p.setTexture ? p.setTexture(stubTexture) : (p.texture = stubTexture);
	return a;
}
function open(doc) {
	asked.length = 0;
	Object.assign(sandbox, { rawDoc: clone(doc), skeleton: null, __atlas: atlasFor(SPINE), selSlot: null, selBone: null, meshCtx: null });
	sandbox.rebuildFromRawDoc(null);
}
const act = (fn) => { try { fn(sandbox); return null; } catch (e) { return String((e && e.message) || e); } };
// The loader the game uses: no placeholder for a missing image.
const strictLoad = (doc, lib = CORE) => new lib.SkeletonJson(new lib.AtlasAttachmentLoader(atlasFor(lib))).readSkeletonData(clone(doc));
const loadProblem = (doc) => { try { strictLoad(doc); return null; } catch (e) { return String(e.message || e); } };
const defIn = (doc, slot, name, skin = 'default') => doc.skins.find((s) => s.name === skin)?.attachments?.[slot]?.[name];
// The image's world corners BL, UL, UR, BR, as the stage has it.
function stageQuad(slot) {
	const si = sandbox.skeletonData.slots.findIndex((s) => s.name === slot);
	const att = sandbox.skeleton.getAttachment(si, sandbox.skeletonData.slots[si].attachmentName);
	const q = new Array(8).fill(0);
	att.computeWorldVertices(sandbox.skeleton.slots[si], q, 0, 2);
	return q;
}
// A frame of the stage: drawing an image of a sequence gives it its frame's region.
function drawStage() {
	for (const slot of sandbox.skeleton.slots) {
		const a = slot.getAttachment();
		if (a && a.sequence) a.sequence.apply(slot, a);
	}
}
const convert = (slot) => { drawStage(); return act((s) => { s.selSlot = slot; s.convertRegionToMesh(); }); };
const draw = (slot) => {
	const q = stageQuad(slot);
	return act((s) => {
		s.selSlot = slot; s.drawMeshMode = true;
		s.drawPoints = [0, 1, 2, 3].map((i) => ({ x: q[i * 2], y: q[i * 2 + 1] }));
		s.finishDrawMesh();
	});
};

// ---- a real Chromium, drawing through the vendored rig runtime's WebGL renderer -----------------
const server = createServer((req, res) => {
	const p = new URL(req.url, 'http://x').pathname;
	if (p === '/spine/vendor/invisible-rig.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(vendored); }
	res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
	res.end('<!doctype html><meta charset="utf-8"><script src="/spine/vendor/invisible-rig.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launchChrome({ name: 'trimmesh', url: `http://127.0.0.1:${server.address().port}/`, cdpTimeoutMs: 60000 });
const { evaluate } = browser;
for (let t0 = Date.now(); !(await evaluate('!!window.spine').catch(() => false)); ) {
	if (Date.now() - t0 > 20000) throw new Error('the vendored rig runtime never loaded');
	await new Promise((r) => setTimeout(r, 100));
}
const FRAME = 160;
// The page side: a 160 × 160 WebGL canvas drawn by the runtime's SceneRenderer, one slot at a time,
// with the page texture NEAREST-sampled so a pixel is a texel, and read back. The camera maps world
// (0..FRAME) onto the canvas, pixel for pixel.
function harness(pageB64, atlasText, FRAME, panelSrc) {
	const bytes = Uint8ClampedArray.from(atob(pageB64), (c) => c.charCodeAt(0));
	const pageCanvas = document.createElement('canvas');
	pageCanvas.width = pageCanvas.height = Math.sqrt(bytes.length / 4);
	pageCanvas.getContext('2d').putImageData(new ImageData(bytes, pageCanvas.width, pageCanvas.height), 0, 0);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = FRAME;
	const ctx = new spine.ManagedWebGLRenderingContext(canvas, { alpha: true, antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
	const tex = new spine.GLTexture(ctx, pageCanvas);
	const renderer = new spine.SceneRenderer(canvas, ctx);
	const cam = renderer.camera;
	cam.position.x = cam.position.y = FRAME / 2;
	cam.viewportWidth = cam.viewportHeight = FRAME;
	cam.zoom = 1;
	const atlas = () => { const a = new spine.TextureAtlas(atlasText); for (const p of a.pages) p.setTexture(tex); return a; };
	const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
	window.renderJobs = (doc, jobs) => {
		const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas())).readSkeletonData(doc);
		return jobs.map((job) => {
			const sk = new spine.Skeleton(data);
			sk.setSkinByName('default'); sk.setToSetupPose();
			for (const slot of sk.slots) {
				if (slot.data.name !== job.slot) slot.setAttachment(null);
				else if (job.attachment) slot.setAttachment(sk.getAttachment(slot.data.index, job.attachment));
			}
			if (job.anim) {
				const st = new spine.AnimationState(new spine.AnimationStateData(data));
				st.setAnimation(0, job.anim, false); st.update(0); st.apply(sk);
			}
			if (job.frame != null) sk.findSlot(job.slot).sequenceIndex = job.frame;
			sk.updateWorldTransform(spine.Physics.update);
			const gl = ctx.gl;
			gl.viewport(0, 0, FRAME, FRAME); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
			renderer.begin(); renderer.drawSkeleton(sk, false); renderer.end();
			const px = new Uint8Array(FRAME * FRAME * 4);
			gl.readPixels(0, 0, FRAME, FRAME, gl.RGBA, gl.UNSIGNED_BYTE, px);
			return b64(px);
		});
	};
	// the UV panel's art, drawn by the shipped helpers into a box 4 px per image pixel
	(0, eval)(panelSrc);
	window.drawPanel = (name) => {
		const r = atlas().findRegion(name);
		const cv = document.createElement('canvas');
		cv.width = 4 * r.originalWidth; cv.height = 4 * r.originalHeight;
		const c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = false;
		const box = computeUvFit(uvArtAspect(r), cv.width, cv.height);
		drawRegionUpright(c2, r, box);
		return { w: cv.width, h: cv.height, box, px: b64(new Uint8Array(c2.getImageData(0, 0, cv.width, cv.height).data.buffer)) };
	};
	return true;
}
const panelNames = ['uvArtAspect', 'computeUvFit', 'drawRegionUpright', ...(TOP.has('regionInkUVs') ? ['regionInkUVs'] : [])];
await evaluate(`(${harness})(${JSON.stringify(Buffer.from(page).toString('base64'))}, ${JSON.stringify(ATLAS)}, ${FRAME}, ${JSON.stringify(panelNames.map(pull).join('\n'))})`);
const render = async (doc, jobs) => (await evaluate(`renderJobs(${JSON.stringify(doc)}, ${JSON.stringify(jobs)})`)).map((s) => new Uint8Array(Buffer.from(s, 'base64')));

// ---- comparing what was drawn ----------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; if (!ok) { console.log('  ✗ ' + msg); pass = false; } return ok; };
const imageById = Object.fromEntries(IMAGES.map((im) => [im.id, im.name]));
const what = (px, i) => (px[i + 3] === 0 ? 'nothing' : px[i + 2] === NOISE ? `atlas (${px[i]},${px[i + 1]})` : `${imageById[px[i + 2]] ?? '?'} (${px[i] - 1},${px[i + 1] - 1})`);
// Every pixel of `got` against `want`: '' when identical, else how many differ, and one of them.
function diff(got, want) {
	let n = 0, first = null, beside = 0;
	for (let i = 0; i < got.length; i += 4) {
		const same = got[i + 3] === 0 && want[i + 3] === 0 ? true : got[i] === want[i] && got[i + 1] === want[i + 1] && got[i + 2] === want[i + 2] && got[i + 3] === want[i + 3];
		if (same) continue;
		n++;
		if (got[i + 3] && got[i + 2] === NOISE) beside++;
		first ??= `at (${(i / 4) % FRAME},${Math.floor(i / 4 / FRAME)}) drew ${what(got, i)} for ${what(want, i)}`;
	}
	return n ? `${n} pixels differ (${beside} drawn from beside the ink), e.g. ${first}` : '';
}
// every pixel `want` draws, `got` draws the same (it may draw more)
function covers(got, want) {
	let n = 0, first = null;
	for (let i = 0; i < got.length; i += 4) {
		if (!want[i + 3]) continue;
		if (got[i] === want[i] && got[i + 1] === want[i + 1] && got[i + 2] === want[i + 2] && got[i + 3] === want[i + 3]) continue;
		n++; first ??= `at (${(i / 4) % FRAME},${Math.floor(i / 4 / FRAME)}) drew ${what(got, i)} for ${what(want, i)}`;
	}
	return n ? `${n} ink pixels lost, e.g. ${first}` : '';
}
const inked = (px) => { let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++; return n; };
const regionReadsRight = (c) => c.im.deg === 0 || c.im.deg === 90; // a RegionAttachment undoes a 90° pack only

// 1. the base rig: the atlas is packed the way the runtime reads it
const base = stillsRig();
const baseJobs = CASES.flatMap((c) => [{ slot: c.slot }, { slot: 'T.' + c.slot }]);
const basePx = await render(base, baseJobs);
const regionPx = {}, truthPx = {};
CASES.forEach((c, i) => { regionPx[c.slot] = basePx[i * 2]; truthPx[c.slot] = basePx[i * 2 + 1]; });
for (const c of CASES) {
	log(inked(truthPx[c.slot]) === c.im.iw * c.im.ih * (c.p === 'c' || c.p === 'd' ? (c.p === 'c' ? 4 : 2) : 1), `base: the untrimmed twin of ${c.slot} draws ${inked(truthPx[c.slot])} pixels`);
	if (regionReadsRight(c)) log(!diff(regionPx[c.slot], truthPx[c.slot]), `base: the region ${c.slot} ≠ its untrimmed twin — ${diff(regionPx[c.slot], truthPx[c.slot])}`);
}
console.log(`  base rig: ${CASES.length} placings of ${STILLS.length} images, each region and its untrimmed twin drawn`);

// 2. ▸ Convert to mesh and ✎ Draw mesh on every still
for (const [label, run] of [['▸ Convert to mesh', convert], ['✎ Draw mesh', draw]]) {
	open(base);
	const errs = [];
	for (const c of CASES) { const e = run(c.slot); if (e) errs.push(`${c.slot}: ${e}`); }
	if (!log(!errs.length, `${label}: ${errs.join('; ')}`)) continue;
	const doc = clone(sandbox.rawDoc);
	log(!loadProblem(doc), `${label}: the rig no longer loads — ${loadProblem(doc)}`);
	for (const c of CASES) log(defIn(doc, c.slot, c.im.name)?.type === 'mesh', `${label}: ${c.slot} is not a mesh`);
	const px = await render(doc, CASES.map((c) => ({ slot: c.slot })));
	CASES.forEach((c, i) => {
		if (regionReadsRight(c)) log(!diff(px[i], regionPx[c.slot]), `${label} on ${c.slot} (${c.im.deg}° pack): the mesh ≠ the region — ${diff(px[i], regionPx[c.slot])}`);
		log(!diff(px[i], truthPx[c.slot]), `${label} on ${c.slot} (${c.im.deg}° pack): the mesh ≠ the untrimmed image — ${diff(px[i], truthPx[c.slot])}`);
	});
	// the runtime core's own math: at each vertex the mesh samples the texel the region sampled there
	const coreBase = strictLoad(base), coreMesh = strictLoad(doc);
	for (const c of CASES.filter(regionReadsRight)) {
		const find = (data, name) => data.defaultSkin.getAttachment(data.findSlot(c.slot).index, name);
		const reg = find(coreBase, c.im.name), mesh = find(coreMesh, c.im.name);
		const q = reg.offset, uv = reg.uvs, n = mesh.regionUVs.length / 2;
		let worst = 0;
		for (let k = 0; k < n; k++) {
			const [x, y] = [mesh.vertices[k * 2], mesh.vertices[k * 2 + 1]];
			const ux = q[4] - q[2], uy = q[5] - q[3], vx = q[0] - q[2], vy = q[1] - q[3], dx = x - q[2], dy = y - q[3];
			const det = ux * vy - vx * uy, s = (dx * vy - vx * dy) / det, t = (ux * dy - dx * uy) / det;
			const want = [uv[2] + s * (uv[4] - uv[2]) + t * (uv[0] - uv[2]), uv[3] + s * (uv[5] - uv[3]) + t * (uv[1] - uv[3])];
			worst = Math.max(worst, Math.abs(mesh.uvs[k * 2] - want[0]), Math.abs(mesh.uvs[k * 2 + 1] - want[1]));
		}
		log(worst < 1e-6, `${label} on ${c.slot}: through the runtime core the mesh samples up to ${(worst * PAGE).toFixed(2)} texels off the region's`);
	}
	console.log(`  ${label}: ${CASES.length} meshes drawn against their region (0/90°) and the untrimmed image (all four packs), UVs through the runtime core`);
}

// 3. sequences
const seqBase = seqRig();
const seqBasePx = await render(seqBase, [
	{ slot: 'same', frame: 0 }, { slot: 'same', frame: 1 },
	{ slot: 'diff', frame: 0 }, { slot: 'diff', frame: 1 }, { slot: 'diff', frame: 2 }, { slot: 'diff' },
	{ slot: 'keyed', anim: 'frame2' },
]);
log(!diff(seqBasePx[5], seqBasePx[3]), 'sequence base: the setup frame is not frame 2');
log(!diff(seqBasePx[6], seqBasePx[1]), 'sequence base: the key does not show frame 2');
open(seqBase);
{
	const errs = SEQS.map((s) => [s.slot, convert(s.slot)]).filter(([, e]) => e);
	const doc = clone(sandbox.rawDoc);
	log(!errs.length, `▸ Convert to mesh on a sequence: ${errs.map((e) => e.join(': ')).join('; ')}`);
	{
		for (const s of SEQS) {
			const def = defIn(doc, s.slot, s.base);
			log(def?.type === 'mesh' && JSON.stringify(def.sequence) === JSON.stringify(s.seq), `▸ Convert to mesh on sequence ${s.slot}: its declaration is ${JSON.stringify(def?.sequence)}, expected ${JSON.stringify(s.seq)}`);
		}
		log(asked.length === 1 && /trimmed differently/.test(asked[0]), `▸ Convert to mesh on a sequence: asked ${asked.length} time(s), expected once, for the frames trimmed differently`);
		log(!loadProblem(doc), `▸ Convert to mesh on a sequence: the rig no longer loads — ${loadProblem(doc)}`);
		if (!loadProblem(doc)) {
			const px = await render(doc, [
				{ slot: 'same', frame: 0 }, { slot: 'same', frame: 1 },
				{ slot: 'diff', frame: 0 }, { slot: 'diff', frame: 1 }, { slot: 'diff', frame: 2 }, { slot: 'diff' },
				{ slot: 'keyed', anim: 'frame2' },
			]);
			for (const f of [0, 1]) log(!diff(px[f], seqBasePx[f]), `sequence trimmed alike, frame ${f + 1}: the mesh ≠ the region — ${diff(px[f], seqBasePx[f])}`);
			for (const f of [0, 1, 2]) log(!covers(px[2 + f], seqBasePx[2 + f]), `sequence trimmed frame by frame, frame ${f + 1}: ${covers(px[2 + f], seqBasePx[2 + f])}`);
			log(!covers(px[5], seqBasePx[5]) && !diff(px[5], px[3]), `sequence trimmed frame by frame: the setup frame is not frame 2 — ${covers(px[5], seqBasePx[5]) || diff(px[5], px[3])}`);
			log(!diff(px[6], seqBasePx[6]), `keyed sequence: the mesh does not follow the key — ${diff(px[6], seqBasePx[6])}`);
		}
	}
}
// ✎ Draw mesh on frames trimmed differently, answered No: nothing written, still drawing, the outline kept
open(seqBase);
{
	drawStage();
	answer = false;
	const before = clone(sandbox.rawDoc), e = draw('diff');
	answer = true;
	log(!e && asked.length === 1 && JSON.stringify(sandbox.rawDoc) === JSON.stringify(before) && sandbox.drawMeshMode && sandbox.drawPoints.length === 4,
		`✎ Draw mesh on a sequence, No to the question: ${e || `asked ${asked.length}, drawing ${sandbox.drawMeshMode}, ${sandbox.drawPoints.length} points kept`}`);
	sandbox.drawMeshMode = false; sandbox.drawPoints = [];
}
// ✎ Draw mesh on a sequence trimmed alike: its four corners
open(seqBase);
{
	drawStage();
	const e = draw('same'), doc = clone(sandbox.rawDoc), def = defIn(doc, 'same', 'sq_');
	if (log(!e && def?.type === 'mesh' && JSON.stringify(def.sequence) === '{"count":2}' && !loadProblem(doc), `✎ Draw mesh on a sequence: ${e || loadProblem(doc) || JSON.stringify(def?.sequence)}`)) {
		const px = await render(doc, [{ slot: 'same', frame: 0 }, { slot: 'same', frame: 1 }]);
		for (const f of [0, 1]) log(!diff(px[f], seqBasePx[f]), `✎ Draw mesh on a sequence, frame ${f + 1}: the mesh ≠ the region — ${diff(px[f], seqBasePx[f])}`);
	}
}
// ＋ Linked mesh onto sequence meshes (the ink's quad of frames trimmed alike, mapped onto the image)
const SEQ_MESH = { type: 'mesh', path: 'sq_', sequence: { count: 2 }, uvs: [5 / 30, 18 / 30, 5 / 30, 6 / 30, 19 / 30, 6 / 30, 19 / 30, 18 / 30], triangles: [0, 1, 2, 2, 3, 0], vertices: [-10, -3, -10, 9, 4, 9, 4, -3], hull: 4, width: 30, height: 30 };
const seqMeshes = seqRig();
for (const s of ['same', 'keyed']) seqMeshes.skins[0].attachments[s].sq_ = clone(SEQ_MESH);
{
	const px = await render(seqMeshes, [{ slot: 'same', frame: 0 }, { slot: 'same', frame: 1 }, { slot: 'keyed', anim: 'frame2' }]);
	log(!diff(px[0], seqBasePx[0]) && !diff(px[1], seqBasePx[1]) && !diff(px[2], seqBasePx[6]), 'the sequence mesh fixture does not draw its frames like the region');
	open(seqMeshes);
	const linkErrs = [];
	for (const s of ['same', 'keyed']) {
		const e = act((sb) => { sb.selSlot = s; sb.addLinkedMesh('sq_', 'default', defIn(sb.rawDoc, s, 'sq_')); });
		if (e) linkErrs.push(`${s}: ${e}`);
	}
	const linked = clone(sandbox.rawDoc);
	const childOf = (slot) => Object.keys(linked.skins[0].attachments[slot]).find((n) => n !== 'sq_');
	if (log(!linkErrs.length, `＋ Linked mesh onto a sequence mesh: ${linkErrs.join('; ')}`)) {
		for (const s of ['same', 'keyed']) log(JSON.stringify(defIn(linked, s, childOf(s))?.sequence) === JSON.stringify({ count: 2 }), `＋ Linked mesh onto sequence ${s}: its declaration is ${JSON.stringify(defIn(linked, s, childOf(s))?.sequence)}`);
		log(!loadProblem(linked), `＋ Linked mesh onto a sequence mesh: the rig no longer loads — ${loadProblem(linked)}`);
		if (!loadProblem(linked)) {
			const px = await render(linked, [
				{ slot: 'same', attachment: childOf('same'), frame: 0 }, { slot: 'same', attachment: childOf('same'), frame: 1 },
				{ slot: 'keyed', attachment: childOf('keyed'), anim: 'frame2' },
			]);
			for (const f of [0, 1]) log(!diff(px[f], seqBasePx[f]), `＋ Linked mesh onto a sequence, frame ${f + 1}: ≠ its source's — ${diff(px[f], seqBasePx[f])}`);
			log(!diff(px[2], seqBasePx[6]), `＋ Linked mesh onto a keyed sequence: does not follow its source's key — ${diff(px[2], seqBasePx[6])}`);
		}
	}
	// its source switched from a plain mesh to a sequence mesh, and back
	const sw = clone(seqMeshes);
	sw.skins[0].attachments.same.plain = { type: 'mesh', path: 'full', uvs: [0, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 2, 3, 0], vertices: [-16, -16, -16, 16, 16, 16, 16, -16], hull: 4, width: 32, height: 32 };
	sw.skins[0].attachments.same.kid = { type: 'linkedmesh', parent: 'plain', path: 'full', width: 32, height: 32 };
	open(sw);
	const pick = (name, parent) => act((sb) => { sb.selSlot = 'same'; sb.meshCtx = { attName: name }; sb.setLinkedMeshParent(parent, 'default', defIn(sb.rawDoc, 'same', parent)); });
	let e = pick('kid', 'sq_');
	const toSeq = clone(sandbox.rawDoc);
	if (log(!e && !loadProblem(toSeq), `linked mesh source switched to a sequence mesh: ${e || loadProblem(toSeq)}`)) {
		const px = await render(toSeq, [{ slot: 'same', attachment: 'kid', frame: 1 }]);
		log(!diff(px[0], seqBasePx[1]), `linked mesh source switched to a sequence mesh: frame 2 ≠ its source's — ${diff(px[0], seqBasePx[1])}`);
		// a key of its own, then back to the plain mesh: the frames and the key go
		sandbox.rawDoc.animations.own = { attachments: { default: { same: { kid: { sequence: [{ index: 1 }] } } } } };
		e = pick('kid', 'plain');
		const back = clone(sandbox.rawDoc);
		log(!e && !defIn(back, 'same', 'kid')?.sequence && !back.animations.own.attachments && !loadProblem(back), `linked mesh source switched back to a plain mesh: ${e || loadProblem(back) || JSON.stringify(defIn(back, 'same', 'kid'))}`);
	}
	console.log('  sequences: ▸ Convert to mesh on 3 (trimmed alike, frame by frame, keyed), ＋ Linked mesh onto 2, a source switched to and from one — every frame drawn');
}

// 4. repairing what the old tools saved
// What the pre-fix ▸ Convert to mesh wrote: the ink's quad, UVs 0..1 across it.
const baseData = strictLoad(base, SPINE);
function oldConvert(doc, c, bind = false) {
	const v = Array.from(baseData.defaultSkin.getAttachment(baseData.findSlot(c.slot).index, c.im.name).offset);
	const bone = doc.bones.findIndex((b) => b.name === 'b.' + c.slot);
	doc.skins[0].attachments[c.slot][c.im.name] = { type: 'mesh', path: c.im.name, uvs: [0, 1, 0, 0, 1, 0, 1, 1], triangles: [0, 1, 2, 2, 3, 0],
		vertices: bind ? [0, 1, 2, 3].flatMap((k) => [1, bone, v[k * 2], v[k * 2 + 1], 1]) : v, hull: 4, width: c.im.W, height: c.im.H };
	return v;
}
// Not wrong: a Spine-style whole-image quad (on an ink of the image's aspect, and of another), an
// old mesh reshaped since, an untrimmed one. Wrong but not told apart from a mesh traced that way
// on purpose, so left alone: an image scaled unevenly, or evenly on an ink of the image's aspect.
const NOT_WRONG = ['half.a', 'flat.a', 'tall.c', 'full.a'];
const stillWrong = (c) => regionReadsRight(c) && c.im.name !== 'full' && !NOT_WRONG.includes(c.slot);
const UNTOLD = CASES.filter((c) => stillWrong(c) && (c.p === 'd' || (c.im.name === 'half' && c.p === 'c')));
const repairable = CASES.filter((c) => stillWrong(c) && !UNTOLD.includes(c));
const stale = clone(base);
[...repairable, ...UNTOLD].forEach((c, i) => oldConvert(stale, c, i % 2 === 1));
// ✎ Draw mesh, pre-fix: five clicks, UVs across the ink's quad
const drawnOld = CASES.find((c) => c.slot === 'wide.b');
{
	const v = oldConvert(stale, drawnOld), def = stale.skins[0].attachments[drawnOld.slot][drawnOld.im.name];
	const lerp = (s, t) => [v[2] + s * (v[4] - v[2]) + t * (v[0] - v[2]), v[3] + s * (v[5] - v[3]) + t * (v[1] - v[3])];
	const st = [[0, 0], [1, 0], [1, 1], [0.4, 1], [0, 1]];
	def.vertices = st.flatMap(([s, t]) => lerp(s, t)); def.uvs = st.flat(); def.hull = 5; def.triangles = [0, 1, 2, 0, 2, 3, 0, 3, 4];
}
for (const slot of ['half.a', 'flat.a']) {
	const c = CASES.find((x) => x.slot === slot), W = c.im.W / 2, H = c.im.H / 2;
	stale.skins[0].attachments[slot][c.im.name] = { type: 'mesh', path: c.im.name, uvs: [1, 1, 0, 1, 0, 0, 1, 0], triangles: [1, 2, 3, 1, 3, 0], vertices: [W, -H, -W, -H, -W, H, W, H], hull: 4, width: c.im.W, height: c.im.H };
}
oldConvert(stale, CASES.find((c) => c.slot === 'tall.c'));
// two opposite corners moved alike: the best affine fit keeps the ink's scale, only its flatness fails
stale.skins[0].attachments['tall.c'].tall.vertices[0] += 3;
stale.skins[0].attachments['tall.c'].tall.vertices[4] += 3;
oldConvert(stale, CASES.find((c) => c.slot === 'full.a'));
// a linked mesh made onto a sequence mesh (the ink's quad of frames trimmed alike) without its frames
stale.bones.push({ name: 'b.seq', parent: 'root', x: 80, y: 80 });
stale.slots.push({ name: 'seq', bone: 'b.seq', attachment: 'kid' });
stale.skins[0].attachments.seq = {
	sq_: { type: 'mesh', path: 'sq_', sequence: { count: 2 }, uvs: [5 / 30, 18 / 30, 5 / 30, 6 / 30, 19 / 30, 6 / 30, 19 / 30, 18 / 30], triangles: [0, 1, 2, 2, 3, 0], vertices: [-10, -3, -10, 9, 4, 9, 4, -3], hull: 4, width: 30, height: 30 },
	kid: { type: 'linkedmesh', parent: 'sq_', path: 'sq_', width: 30, height: 30 },
};
const notStale = [...NOT_WRONG, ...UNTOLD.map((c) => c.slot)];
const wantRepairs = [...repairable.map((c) => `${c.slot}/${c.im.name}`), 'seq/kid'].sort();
if (log(!absent.includes('meshRepairs'), 'repair: nothing finds a mesh the old tools mapped wrong (no meshRepairs)')) {
	open(stale);
	const found = sandbox.meshRepairs().map((r) => `${r.slot}/${r.name}`).sort();
	log(JSON.stringify(found) === JSON.stringify(wantRepairs), `repair: offered [${found}], expected [${wantRepairs}]`);
	for (const n of notStale) log(!found.some((f) => f.startsWith(n + '/')), `repair: offered ${n}, which is not wrong`);
	// one mesh on its own: only that one changes
	const one = sandbox.meshRepairs()[0], before = clone(sandbox.rawDoc);
	const e1 = act((s) => s.repairMeshes([vm.runInContext('repairKey', s)(one)]));
	const changed = sandbox.rawDoc.skins[0].attachments;
	const moved = Object.keys(changed).filter((slot) => JSON.stringify(changed[slot]) !== JSON.stringify(before.skins[0].attachments[slot]));
	log(!e1 && JSON.stringify(moved) === JSON.stringify([one.slot]), `🩹 Repair on ${one.slot} alone changed [${moved}]${e1 ? ' — ' + e1 : ''}`);
	open(stale);
	const e = act((s) => s.repairMeshes());
	const fixed = clone(sandbox.rawDoc);
	if (log(!e && !loadProblem(fixed), `🩹 Repair: ${e || loadProblem(fixed)}`)) {
		log(!sandbox.meshRepairs().length, `🩹 Repair: still offers ${sandbox.meshRepairs().length} after repairing`);
		const px = await render(fixed, [...repairable.map((c) => ({ slot: c.slot })), { slot: 'seq', frame: 1 }]);
		repairable.forEach((c, i) => log(!diff(px[i], regionPx[c.slot]), `🩹 Repair on ${c.slot}: the mesh ≠ the region — ${diff(px[i], regionPx[c.slot])}`));
		log(JSON.stringify(defIn(fixed, 'seq', 'kid').sequence) === '{"count":2}' && !diff(px[repairable.length], seqBasePx[1]), `🩹 Repair on the linked mesh: ${JSON.stringify(defIn(fixed, 'seq', 'kid').sequence)}, frame 2 ${diff(px[repairable.length], seqBasePx[1])}`);
		for (const n of notStale) {
			const [slot] = n.split('.'), c = CASES.find((x) => x.slot === n);
			log(JSON.stringify(defIn(fixed, n, c.im.name)) === JSON.stringify(defIn(stale, n, c.im.name)), `🩹 Repair changed ${n} (${slot}), which was not wrong`);
		}
	}
	// the fixed tools' meshes are not offered
	open(base);
	for (const c of CASES) convert(c.slot);
	log(!sandbox.meshRepairs().length, `repair: offered [${sandbox.meshRepairs().map((r) => r.slot)}] on meshes the fixed ▸ Convert to mesh made`);
	open(base);
	for (const c of CASES) draw(c.slot);
	log(!sandbox.meshRepairs().length, `repair: offered [${sandbox.meshRepairs().map((r) => r.slot)}] on meshes the fixed ✎ Draw mesh made`);
	// …nor any mesh of a checked-in rig (all Spine-made)
	const rigs = [];
	const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.json') && /[\\/]spines[\\/]/.test(p)) rigs.push(p); } };
	walk(fileURLToPath(new URL('apps/', ROOT)));
	let opened = 0, meshes = 0;
	for (const rig of rigs) {
		const dir = dirname(rig), atlases = readdirSync(dir).filter((n) => n.endsWith('.atlas'));
		let doc; try { doc = JSON.parse(readFileSync(rig, 'utf8')); } catch { continue; }
		if (!doc.skins || !atlases.length) continue;
		const atlas = new SPINE.TextureAtlas(atlases.map((a) => readFileSync(join(dir, a), 'utf8')).join('\n\n'));
		for (const p of atlas.pages) { p.width ||= 2048; p.height ||= 2048; p.setTexture(stubTexture); }
		Object.assign(sandbox, { rawDoc: doc, __atlas: atlas, selSlot: null, meshCtx: null });
		try { sandbox.rebuildFromRawDoc(null); } catch { continue; }
		opened++;
		meshes += doc.skins.reduce((n, s) => n + Object.values(s.attachments || {}).reduce((m, b) => m + Object.values(b).filter((a) => a && (a.type === 'mesh' || a.type === 'linkedmesh')).length, 0), 0);
		const found = sandbox.meshRepairs();
		log(!found.length, `repair: offered ${found.length} on the checked-in ${basename(dir)}/${basename(rig)}: ${found.slice(0, 3).map((r) => r.slot + '/' + r.name)}`);
	}
	log(opened >= 150, `repair: only ${opened} checked-in rigs opened`);
	console.log(`  repair: ${wantRepairs.length} stale meshes offered and repaired; none offered on the fixed tools' meshes or on ${meshes} meshes of ${opened} checked-in rigs`);
}

// 5. the UV panel draws the image where the mesh's UVs find it
for (const im of STILLS) {
	const { w, h, box, px: b64 } = await evaluate(`drawPanel(${JSON.stringify(im.name)})`);
	const px = Buffer.from(b64, 'base64');
	let bad = 0, first = null;
	// the middle of each 4 × 4 block is one image pixel
	for (let cy = 0; cy < im.H; cy++)
		for (let cx = 0; cx < im.W; cx++) {
			const x = Math.round(box.ox) + cx * 4 + 1, y = Math.round(box.oy) + cy * 4 + 1;
			for (const [dx, dy] of [[0, 0], [1, 1]]) {
				const i = ((y + dy) * w + x + dx) * 4;
				const ink = cx >= im.ix && cx < im.ix + im.iw && cy >= im.iy && cy < im.iy + im.ih;
				const want = ink ? inkColor(im, cx, cy) : [0, 0, 0, 0];
				const ok = ink ? want.every((v, k) => px[i + k] === v) : px[i + 3] === 0;
				if (!ok) { bad++; first ??= `image (${cx},${cy}) shows ${px[i + 3] ? `(${px[i]},${px[i + 1]},${px[i + 2]})` : 'nothing'}`; }
			}
		}
	log(!bad && w === 4 * im.W && h === 4 * im.H, `UV panel, ${im.name} (${im.deg}° pack): ${bad} of ${im.W * im.H * 2} samples wrong, e.g. ${first}`);
}
console.log(`  UV panel: ${STILLS.length} images drawn by the shipped helpers and read back`);

// ---- done -------------------------------------------------------------------------------------
server.close();
await browser.close();
if (absent.length) console.log(`  (not in this view.html: ${absent.join(', ')})`);
console.log(pass ? `\n✅ PASS — ${checks} checks` : `\n✗ FAIL (${checks} checks)`);
process.exit(pass ? 0 : 1);
