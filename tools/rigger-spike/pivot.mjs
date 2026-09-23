// Verify the ✥ IMAGE PIVOT contract headlessly, against the OFFICIAL spine-core loader and against
// the code that actually ships: the pivot functions are extracted verbatim out of
// `static/rigger/view.html` and run in a vm sandbox with the editor's globals stubbed, so a drift
// between this test and the tool is impossible.
//
// The contract:
//   (a) the pivot belongs to the IMAGE — setting it touches no bone, no slot, and does not move
//       the art by a single pixel;
//   (b) it PERSISTS: `pivot: [u,v]` rides the attachment through a full round-trip of the official
//       4.2 loader, which ignores the non-standard key, so the .irig still opens in Spine and the
//       rendered geometry is byte-identical;
//   (c) it is HONOURED: changing rotation / scaleX / scaleY turns the image about the pivot — the
//       pivot is the one point of the image that does not move;
//   (d) a CENTRED pivot is a no-op, so every image authored before this feature is unchanged;
//   (e) the stray `<slot>-pivot` bone the first version of this feature created folds back, with
//       the art staying exactly where it is.
//
//   node tools/rigger-spike/pivot.mjs <skeleton.json> <skeleton.atlas>
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// A git worktree has no node_modules of its own, so walk up to the first checkout that does.
const SUB = 'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js';
const SPINE_CORE = (() => {
	for (let up = 2; up <= 8; up++) {
		const u = new URL('../'.repeat(up) + SUB, import.meta.url);
		if (existsSync(fileURLToPath(u))) return u.href;
	}
	console.error(`✗ spine-core 4.2.74 not found — run pnpm install (looked for ${SUB})`);
	process.exit(2);
})();
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Vector2, Physics, RegionAttachment } =
	await import(SPINE_CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/pivot.mjs <skeleton.json> <skeleton.atlas>');
	process.exit(2);
}
const atlasText = readFileSync(atlasPath, 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

function loadData(obj) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) {
		p.width = 2048;
		p.height = 2048;
		try { p.setTexture(stub); } catch { p.texture = stub; }
	}
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(obj);
}
function posed(obj) {
	const sd = loadData(clone(obj));
	const sk = new Skeleton(sd);
	sk.setToSetupPose();
	try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); }
	return { sd, sk };
}

// ---- pull the SHIPPED pivot code out of view.html -------------------------------------
const VIEW = new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url);
const html = readFileSync(VIEW, 'utf8');
const START = '// ---- ✥ image pivot ---';
const END = '// Reorder a slot in the draw order';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) {
	console.error('✗ could not find the ✥ image pivot block in view.html — the markers moved');
	process.exit(2);
}
const shipped = html.slice(a, b);
for (const fn of ['pivotEditable', 'pivotUV', 'pivotBonePos', 'setPivotWorld', 'setPivotUV', 'strayPivotBone', 'foldPivotBoneBack']) {
	if (!shipped.includes('function ' + fn)) {
		console.error(`✗ extracted block is missing ${fn}() — the markers moved`);
		process.exit(2);
	}
}
// `applyAttachmentEdit` is the other half of the contract (it holds the pivot while rotating) and
// lives outside the block — pull it on its own so the test drives the real one.
const AE = 'function applyAttachmentEdit(key, value){';
const ai = html.indexOf(AE);
if (ai < 0) { console.error('✗ applyAttachmentEdit not found'); process.exit(2); }
const shippedEdit = html.slice(ai, html.indexOf('\n}', ai) + 2);

const sandbox = {
	SPINE: { Vector2, RegionAttachment },
	isRegionAtt: (x) => x instanceof RegionAttachment,
	roundN: (v, n) => { const f = Math.pow(10, n); return Math.round(v * f) / f; },
	markDirty() { sandbox.dirty = true; },
	renderSlotDetail() {},
	selectSlot() {},
	rebuildFromRawDoc() {
		const r = posed(sandbox.rawDoc);
		sandbox.skeletonData = r.sd;
		sandbox.skeleton = r.sk;
	},
	rawDoc: null, skeleton: null, skeletonData: null, selSlot: null,
	pivotMode: false, editMode: true, dirty: false,
	meshAddMode: false, meshRemoveMode: false, meshEdgeMode: false, meshHullMode: false,
	weightBrush: false, edgePickFirst: null, pathAddMode: false, polyAddMode: false, placePointMode: false,
};
vm.createContext(sandbox);
vm.runInContext(shipped + '\n' + shippedEdit, sandbox, { filename: 'view.html#image-pivot' });

// ---- helpers ---------------------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

function artWorld(sk, sd, slotName) {
	const i = sd.slots.findIndex((s) => s.name === slotName);
	if (i < 0) return null;
	const attName = sd.slots[i].attachmentName;
	const att = attName ? sk.getAttachment(i, attName) : null;
	if (!(att instanceof RegionAttachment)) return null;
	const out = new Array(8).fill(0);
	att.computeWorldVertices(sk.slots[i], out, 0, 2);
	return out;
}
const maxDrift = (p, q) => {
	if (!p || !q || p.length !== q.length) return Infinity;
	let m = 0;
	for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
	return m;
};
function open(doc, slotName) {
	sandbox.rawDoc = clone(doc);
	sandbox.selSlot = slotName;
	sandbox.rebuildFromRawDoc();
	sandbox.dirty = false;
}
const pivotWorld = () => {
	const ctx = sandbox.pivotEditable();
	return ctx ? sandbox.pivotWorldPos(ctx) : null;
};
// A slot with attachments in a skin but no SETUP attachment renders nothing, so the pivot is not
// offered — until the author picks the image, which is what selectSlotAttachment writes. Do the
// same, or such a rig exercises nothing at all.
function ensureSetupAttachments(doc) {
	let filled = 0;
	for (const slot of doc.slots || []) {
		if (slot.attachment) continue;
		for (const sk of doc.skins || []) {
			const bag = sk.attachments && sk.attachments[slot.name];
			// skip a SEQUENCE attachment: its region is resolved per frame at runtime, so a setup
			// pose has none set and computeWorldVertices throws "Region not set".
			const first = bag && Object.entries(bag).find(([, d]) => d && !d.type && !d.sequence);
			if (first) { slot.attachment = first[0]; filled++; break; }
		}
	}
	return filled;
}
function pickRegionSlot(sd, sk) {
	for (let i = 0; i < sd.slots.length; i++) {
		const an = sd.slots[i].attachmentName;
		if (!an) continue;
		const att = sk.getAttachment(i, an);
		if (!(att instanceof RegionAttachment) || !att.width || !att.height || !att.region) continue;
		return sd.slots[i].name;
	}
	return null;
}

const raw0 = JSON.parse(readFileSync(jsonPath, 'utf8'));
const filledSetup = ensureSetupAttachments(raw0);
const base = posed(raw0);
console.log(`\n=== ✥ image pivot (shipped code, official loader): ${jsonPath} ===`);
if (filledSetup) console.log(`  (assigned a setup attachment on ${filledSetup} slot(s) that had none, as picking the image does)`);

let rs = pickRegionSlot(base.sd, base.sk);
if (!rs) {
	// A rig of nothing but meshes and SEQUENCE attachments has no image for a pivot to act on, so
	// the run would assert nothing at all. Give it one, sampling a region straight from the atlas
	// (an attachment name will not do — a sequence carries a base like `expl/` and the atlas only
	// holds its numbered frames).
	const probe = (() => { try { return new TextureAtlas(atlasText).regions[0].name; } catch { return null; } })();
	if (probe && raw0.slots.length && raw0.skins.length) {
		rs = raw0.slots[0].name;
		raw0.skins[0].attachments = raw0.skins[0].attachments || {};
		raw0.skins[0].attachments[rs] = raw0.skins[0].attachments[rs] || {};
		raw0.skins[0].attachments[rs][probe] = { width: 64, height: 64 };
		raw0.slots[0].attachment = probe;
		const re = posed(raw0);
		base.sd = re.sd; base.sk = re.sk;
		console.log(`  (no image in this rig — added a probe region "${probe}" on slot "${rs}" so the contract is still exercised)`);
	}
}
if (!rs) console.log('  (no region attachment — skipping)');
else {
	console.log(`region slot "${rs}"`);

	// ---- (a) setting a pivot touches nothing but the pivot ----
	open(raw0, rs);
	{
		const beforeArt = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		const bones = JSON.stringify(sandbox.rawDoc.bones);
		const slots = JSON.stringify(sandbox.rawDoc.slots);
		sandbox.setPivotUV(0.5, 1); // bottom centre
		sandbox.rebuildFromRawDoc();
		const afterArt = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		log(maxDrift(beforeArt, afterArt) === 0, `the art did not move (drift ${maxDrift(beforeArt, afterArt).toFixed(4)}px)`);
		log(JSON.stringify(sandbox.rawDoc.bones) === bones, 'NO bone was added, moved or renamed');
		log(JSON.stringify(sandbox.rawDoc.slots) === slots, 'no slot was re-pointed');
		log(JSON.stringify(sandbox.pivotUV(sandbox.pivotEditable())) === '[0.5,1]', 'the pivot is stored on the image as [u,v]');
	}

	// ---- (b) it survives the official loader, inert ----
	{
		let accepted = true, why = '';
		try { loadData(clone(sandbox.rawDoc)); } catch (e) { accepted = false; why = ' — ' + e.message; }
		log(accepted, 'the official 4.2 loader reads the rig with a `pivot` key on the attachment' + why);
		const reopened = posed(sandbox.rawDoc);
		log(maxDrift(artWorld(reopened.sk, reopened.sd, rs), artWorld(sandbox.skeleton, sandbox.skeletonData, rs)) === 0,
			'the key is inert — rendered geometry is byte-identical');
		log(JSON.stringify(sandbox.pivotUV(sandbox.pivotEditable())) === '[0.5,1]', 'and the pivot is still there after the round-trip');
	}

	// ---- (c) rotation turns the image AROUND the pivot ----
	{
		const held = pivotWorld();
		const before = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		sandbox.applyAttachmentEdit('rotation', 37);
		sandbox.rebuildFromRawDoc();
		const now = pivotWorld();
		const after = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		const off = Math.hypot(now.x - held.x, now.y - held.y);
		let far = 0;
		for (let i = 0; i < 8; i += 2) far = Math.max(far, Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1]));
		log(off < 0.05, `after a 37° turn the PIVOT has not moved (off ${off.toFixed(4)}px)`);
		log(far > 1, `but the image really did turn (furthest corner moved ${far.toFixed(2)}px)`);
	}

	// ---- (c2) …and so does scale ----
	{
		const held = pivotWorld();
		sandbox.applyAttachmentEdit('scaleX', 1.6);
		sandbox.rebuildFromRawDoc();
		const now = pivotWorld();
		const off = Math.hypot(now.x - held.x, now.y - held.y);
		log(off < 0.05, `scaling holds the pivot too (off ${off.toFixed(4)}px)`);
	}

	// ---- (d) a CENTRED pivot is a no-op — every pre-existing image is unchanged ----
	{
		open(raw0, rs);
		const ctx = sandbox.pivotEditable();
		const def = sandbox.pivotRawDef(ctx);
		const x0 = def.x || 0, y0 = def.y || 0;
		sandbox.applyAttachmentEdit('rotation', (ctx.att.rotation || 0) + 23);
		log((def.x || 0) === x0 && (def.y || 0) === y0,
			'with no pivot set, rotating leaves x/y exactly as before (unchanged behaviour)');
		log(def.pivot === undefined, 'and no `pivot` key is written for a centred pivot');
	}

	// ---- (e) the stray <slot>-pivot bone from the first version folds back ----
	{
		const doc = clone(raw0);
		const slot = doc.slots.find((x) => x.name === rs);
		const parentBone = slot.bone;
		const boneName = rs + '-pivot';
		// reproduce exactly what the old code wrote: a child bone at (px,py), the same offset taken
		// back out of the attachment
		const px = 31, py = -17;
		doc.bones.push({ name: boneName, parent: parentBone, x: px, y: py });
		slot.bone = boneName;
		for (const sk of doc.skins || []) {
			const bag = sk.attachments && sk.attachments[rs];
			for (const d of Object.values(bag || {})) if (d && !d.type) { d.x = (d.x || 0) - px; d.y = (d.y || 0) - py; }
		}
		open(doc, rs);
		const before = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		const found = sandbox.strayPivotBone();
		log(!!found && found.name === boneName, `the stray bone "${boneName}" is detected`);
		sandbox.foldPivotBoneBack();
		const after = artWorld(sandbox.skeleton, sandbox.skeletonData, rs);
		log(!sandbox.rawDoc.bones.some((x) => x.name === boneName), 'folding it back removes the bone');
		log(sandbox.rawDoc.slots.find((x) => x.name === rs).bone === parentBone, `and re-points the slot to "${parentBone}"`);
		log(maxDrift(before, after) < 0.02, `with the art staying exactly where it was (drift ${maxDrift(before, after).toFixed(4)}px)`);
	}
}

if (!checks) { console.log('  ✗ this rig exercised NO assertion — every block skipped'); pass = false; }
console.log(pass ? `\nPASS (${checks} checks)\n` : `\nFAIL (${checks} checks)\n`);
process.exit(pass ? 0 : 1);
