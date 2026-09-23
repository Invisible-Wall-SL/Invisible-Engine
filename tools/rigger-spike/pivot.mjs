// Verify the ✥ slot-pivot contract headlessly, against the OFFICIAL spine-core loader and
// against the code that actually ships: the pivot functions are extracted verbatim out of
// `static/rigger/view.html` and run in a vm sandbox with the editor's globals stubbed, so a
// drift between this test and the tool is impossible.
//
// The contract, in three parts:
//   (a) setting a pivot does NOT move the art — every world vertex is where it was;
//   (b) the slot's bone origin lands exactly on the requested point;
//   (c) rotating that bone afterwards turns the art AROUND the pivot — the pivot is the one
//       fixed point of the rotation (which is the whole reason for the feature).
// Plus the structural rules: a shared bone grows one `<slot>-pivot` child and nothing else in
// the rig moves; an exclusive bone is re-used on the next placement instead of piling up bones;
// weighted geometry is left alone; and the loader accepts the result every time.
//
//   node tools/rigger-spike/pivot.mjs <skeleton.json> <skeleton.atlas>
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// A git worktree has no node_modules of its own, so walk up to the first checkout that does —
// the spike has to be runnable from wherever the branch is checked out.
const SUB = 'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js';
const SPINE_CORE = (() => {
	for (let up = 2; up <= 8; up++) {
		const u = new URL('../'.repeat(up) + SUB, import.meta.url);
		if (existsSync(fileURLToPath(u))) return u.href;
	}
	console.error(`✗ spine-core 4.2.74 not found — run pnpm install (looked for ${SUB})`);
	process.exit(2);
})();
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Vector2, Physics, RegionAttachment, MeshAttachment } =
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
const START = '// ---- ✥ slot pivot ---';
const END = '// Pivot panel (Setup mode)';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) {
	console.error('✗ could not find the ✥ slot pivot block in view.html — the markers moved');
	process.exit(2);
}
const shipped = html.slice(a, b);
for (const fn of ['slotPivotCtx', 'slotArtQuad', 'rebaseSlotAttachments', 'setSlotPivotWorld']) {
	if (!shipped.includes('function ' + fn)) {
		console.error(`✗ extracted block is missing ${fn}() — the markers moved`);
		process.exit(2);
	}
}

// The editor globals those functions close over. rebuildFromRawDoc mirrors the real one: re-read
// the doc through the official loader and re-pose it, which is exactly what makes this a round-trip.
const sandbox = {
	SPINE: { Vector2, RegionAttachment, MeshAttachment },
	isRegionAtt: (x) => x instanceof RegionAttachment,
	roundN: (v, n) => { const f = Math.pow(10, n); return Math.round(v * f) / f; },
	uniqueName: (base, existing) => { let n = 1; while (existing.has(base + n)) n++; return base + n; },
	markDirty() { sandbox.dirty = true; },
	selectSlot() {},
	renderSlotDetail() {},
	rebuildFromRawDoc() {
		const r = posed(sandbox.rawDoc);
		sandbox.skeletonData = r.sd;
		sandbox.skeleton = r.sk;
		sandbox.rebuilds++;
	},
	rawDoc: null, skeleton: null, skeletonData: null, selSlot: null,
	pivotMode: false, editMode: true, dirty: false, rebuilds: 0,
};
vm.createContext(sandbox);
vm.runInContext(shipped, sandbox, { filename: 'view.html#slot-pivot' });

// ---- helpers ---------------------------------------------------------------------------
let pass = true;
const log = (ok, msg) => { console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };

// Every world vertex of a slot's setup attachment, for the "did the art move?" comparison.
function artWorld(sk, sd, slotName) {
	const i = sd.slots.findIndex((s) => s.name === slotName);
	if (i < 0) return null;
	const attName = sd.slots[i].attachmentName;
	const att = attName ? sk.getAttachment(i, attName) : null;
	if (!att) return null;
	const slot = sk.slots[i];
	if (att instanceof RegionAttachment) {
		const out = new Array(8).fill(0);
		att.computeWorldVertices(slot, out, 0, 2);
		return out;
	}
	if (!att.worldVerticesLength) return null;
	const out = new Array(att.worldVerticesLength).fill(0);
	att.computeWorldVertices(slot, 0, att.worldVerticesLength, out, 0, 2);
	return out;
}
const maxDrift = (p, q) => {
	if (!p || !q || p.length !== q.length) return Infinity;
	let m = 0;
	for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i]));
	return m;
};
const boneOrigin = (sk, name) => { const b = sk.findBone(name); return b ? { x: b.worldX, y: b.worldY } : null; };
// The pivot is stored as a bone-local offset snapped to 2 decimals (so the x/y fields stay
// readable), so the most it can miss the click by is that snap carried out through the bone's
// world scale — half a hundredth on each axis, magnified. Anything beyond that is a real error.
function landingTolerance(sk, name) {
	const b = sk.findBone(name);
	if (!b) return 0.02;
	const scale = Math.max(Math.hypot(b.a, b.c), Math.hypot(b.b, b.d), 1);
	return 0.008 * scale + 0.005;
}
const slotBoneName = (doc, slotName) => (doc.slots.find((s) => s.name === slotName) || {}).bone;

// Load the sandbox with a fresh copy of the rig, opened on `slotName`.
function open(doc, slotName) {
	sandbox.rawDoc = clone(doc);
	sandbox.selSlot = slotName;
	sandbox.rebuildFromRawDoc();
	sandbox.rebuilds = 0;
	sandbox.dirty = false;
}

// Does ANY skin give this slot a linked mesh? Same rule slotPivotCtx uses — such a slot is
// refused outright, so the tests must not pick one expecting a placement.
function slotIsLinked(doc, slotName) {
	return (doc.skins || []).some((sk) => {
		const bag = sk.attachments && sk.attachments[slotName];
		return !!bag && Object.values(bag).some((d) => d && d.type === 'linkedmesh');
	});
}

// A slot whose setup attachment is a region or an UNWEIGHTED mesh — the two the pivot applies to.
function pickSlot(doc, sd, sk, want) {
	for (let i = 0; i < sd.slots.length; i++) {
		const attName = sd.slots[i].attachmentName;
		if (!attName) continue;
		const name = sd.slots[i].name;
		if (slotIsLinked(doc, name)) continue;
		const att = sk.getAttachment(i, attName);
		if (!att) continue;
		const weighted = !!(att.bones && att.bones.length);
		if (want === 'region' && att instanceof RegionAttachment) return name;
		if (want === 'mesh' && att instanceof MeshAttachment && !weighted && !att.getParentMesh?.()) return name;
	}
	return null;
}

const raw0 = JSON.parse(readFileSync(jsonPath, 'utf8'));
const base = posed(raw0);
console.log(`\n=== ✥ slot pivot (shipped code, official loader): ${jsonPath} ===`);

// One full placement, asserted against whichever branch the rig's own shape selects: an EXCLUSIVE
// bone is moved in place, a SHARED one grows the slot a `<slot>-pivot` child. Both must leave the
// art and the rest of the rig exactly where they were.
function runPivotCase(doc, slotName, label) {
	open(doc, slotName);
	const ctx = sandbox.slotPivotCtx();
	if (!ctx) { log(false, `${label}: no pivot context for "${slotName}"`); return null; }
	console.log(`${label}: slot "${slotName}" on bone "${ctx.boneName}" (${ctx.exclusive ? 'exclusive → move it' : 'shared → new pivot bone'})`);
	const before = artWorld(sandbox.skeleton, sandbox.skeletonData, slotName);
	const bonesBefore = sandbox.rawDoc.bones.length;
	const originalBone = ctx.boneName;
	const othersBefore = sandbox.rawDoc.bones.map((b) => ({ name: b.name, ...boneOrigin(sandbox.skeleton, b.name) }));
	// bottom-centre of the art quad = [BL, UL, UR, BR]
	const target = { x: (before[0] + before[6]) / 2, y: (before[1] + before[7]) / 2 };

	sandbox.setSlotPivotWorld(target.x, target.y);

	const after = artWorld(sandbox.skeleton, sandbox.skeletonData, slotName);
	const pivotBone = slotBoneName(sandbox.rawDoc, slotName);
	const origin = boneOrigin(sandbox.skeleton, pivotBone);
	const tol = landingTolerance(sandbox.skeleton, pivotBone);
	const off = origin ? Math.hypot(origin.x - target.x, origin.y - target.y) : Infinity;
	log(!!sandbox.skeletonData, 'the official loader accepts the rig after the pivot move');
	log(maxDrift(before, after) < 0.02, `the art did not move (max drift ${maxDrift(before, after).toFixed(4)}px)`);
	log(off < tol, `the pivot landed on the requested point (off ${off.toFixed(4)}px, snap tolerance ${tol.toFixed(4)})`);
	if (ctx.exclusive) {
		log(pivotBone === originalBone, `the slot's own bone "${originalBone}" was moved, not replaced`);
		log(sandbox.rawDoc.bones.length === bonesBefore, `no bone was added (${bonesBefore})`);
	} else {
		log(pivotBone === slotName + '-pivot', `the shared bone gave the slot its own "${pivotBone}"`);
		log(sandbox.rawDoc.bones.length === bonesBefore + 1, `exactly one bone was added (${bonesBefore} → ${sandbox.rawDoc.bones.length})`);
	}
	// Nothing else in the rig may have shifted — the pivot bone itself is the one allowed to.
	let moved = [];
	for (const b of othersBefore) {
		if (b.name === pivotBone) continue;
		const now = boneOrigin(sandbox.skeleton, b.name);
		if (!now || Math.hypot(now.x - b.x, now.y - b.y) > 0.02) moved.push(b.name);
	}
	log(moved.length === 0, `no other bone in the rig moved${moved.length ? ' (moved: ' + moved.slice(0, 4).join(', ') + ')' : ''}`);
	log(sandbox.dirty, 'the edit is marked dirty (Save is armed)');

	// The payoff: the pivot is the ONE fixed point of a rotation of that bone.
	{
		const spunDoc = clone(sandbox.rawDoc);
		const rb = spunDoc.bones.find((b) => b.name === pivotBone);
		rb.rotation = (rb.rotation || 0) + 90;
		const r = posed(spunDoc);
		const spun = artWorld(r.sk, r.sd, slotName);
		const o = boneOrigin(r.sk, pivotBone);
		log(o && Math.hypot(o.x - target.x, o.y - target.y) < tol, 'after a 90° turn the pivot itself has not moved');
		const bc = { x: (spun[0] + spun[6]) / 2, y: (spun[1] + spun[7]) / 2 }; // the art's own bottom-centre rode the turn
		log(Math.hypot(bc.x - target.x, bc.y - target.y) < tol * 2,
			`the art turned AROUND the pivot — its bottom-centre is still on it (off ${Math.hypot(bc.x - target.x, bc.y - target.y).toFixed(4)}px)`);
		let far = 0;
		for (let i = 0; i < 8; i += 2) far = Math.max(far, Math.hypot(spun[i] - after[i], spun[i + 1] - after[i + 1]));
		log(far > 1, `the art really did turn (furthest corner moved ${far.toFixed(2)}px)`);
	}

	// A second placement must REUSE the pivot bone rather than stack another on top.
	{
		const bonesNow = sandbox.rawDoc.bones.length;
		const art = artWorld(sandbox.skeleton, sandbox.skeletonData, slotName);
		const t2 = { x: art[2], y: art[3] }; // upper-left corner
		sandbox.setSlotPivotWorld(t2.x, t2.y);
		const art2 = artWorld(sandbox.skeleton, sandbox.skeletonData, slotName);
		const o2 = boneOrigin(sandbox.skeleton, slotBoneName(sandbox.rawDoc, slotName));
		log(sandbox.rawDoc.bones.length === bonesNow, 'moving the pivot again adds NO second bone (the slot owns this one now)');
		log(slotBoneName(sandbox.rawDoc, slotName) === pivotBone, `the slot still hangs off "${pivotBone}"`);
		log(maxDrift(art, art2) < 0.02, `the art still did not move (max drift ${maxDrift(art, art2).toFixed(4)}px)`);
		log(o2 && Math.hypot(o2.x - t2.x, o2.y - t2.y) < landingTolerance(sandbox.skeleton, pivotBone),
			`the pivot moved to the new point (off ${o2 ? Math.hypot(o2.x - t2.x, o2.y - t2.y).toFixed(4) : 'n/a'}px)`);
	}

	// The rest of the document is untouched.
	log(JSON.stringify(doc.animations || {}) === JSON.stringify(sandbox.rawDoc.animations || {}), 'every animation is byte-unchanged');
	log(JSON.stringify((doc.slots || []).map((s) => s.name)) === JSON.stringify(sandbox.rawDoc.slots.map((s) => s.name)),
		'no slot gained or lost, draw order unchanged');
	return ctx;
}

const regionSlot = pickSlot(raw0, base.sd, base.sk, 'region');
if (!regionSlot) console.log('  (no region attachment — skipping the region tests)');
else {
	// (1) the rig as the artist left it — whichever branch its own shape selects.
	runPivotCase(raw0, regionSlot, 'as-authored');
	// (2) the OTHER branch, forced. A brand-new slot lands on the root bone, which is shared by
	// definition — the exact case the feature was asked for — so park the slot there and re-run.
	const onRoot = clone(raw0);
	const rootName = onRoot.bones[0].name;
	const sdRaw = onRoot.slots.find((s) => s.name === regionSlot);
	if (sdRaw && sdRaw.bone !== rootName) {
		sdRaw.bone = rootName;
		console.log('');
		runPivotCase(onRoot, regionSlot, 'slot parked on the root bone (a new slot\'s case)');
	}
}

// ---- (4) unweighted mesh: vertices are rebased, so the art holds still there too ----
{
	const meshSlot = pickSlot(raw0, base.sd, base.sk, 'mesh');
	if (!meshSlot) console.log('  (no unweighted mesh — skipping the mesh test)');
	else {
		console.log(`unweighted mesh slot "${meshSlot}"`);
		open(raw0, meshSlot);
		const before = artWorld(sandbox.skeleton, sandbox.skeletonData, meshSlot);
		let minX = Infinity, minY = Infinity;
		for (let i = 0; i < before.length; i += 2) { minX = Math.min(minX, before[i]); minY = Math.min(minY, before[i + 1]); }
		sandbox.setSlotPivotWorld(minX, minY);
		const after = artWorld(sandbox.skeleton, sandbox.skeletonData, meshSlot);
		const o = boneOrigin(sandbox.skeleton, slotBoneName(sandbox.rawDoc, meshSlot));
		log(maxDrift(before, after) < 0.05, `the mesh did not move (max drift ${maxDrift(before, after).toFixed(4)}px)`);
		const mtol = landingTolerance(sandbox.skeleton, slotBoneName(sandbox.rawDoc, meshSlot));
		log(o && Math.hypot(o.x - minX, o.y - minY) < mtol,
			`the pivot landed on the mesh corner (off ${o ? Math.hypot(o.x - minX, o.y - minY).toFixed(4) : 'n/a'}px, tolerance ${mtol.toFixed(4)})`);
	}
}

// ---- (5) weighted geometry and linked meshes are refused / left alone ----
{
	// a weighted mesh's vertices live in its WEIGHT bones' spaces — rebaseSlotAttachments must
	// not touch them, or the art would be double-moved.
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
	let weighted = null, linkedSlot = null;
	for (const sk of raw.skins || []) {
		for (const [slotName, bag] of Object.entries(sk.attachments || {})) {
			for (const [, def] of Object.entries(bag)) {
				if (def && def.type === 'linkedmesh') linkedSlot = linkedSlot || slotName;
				if (def && def.type === 'mesh' && Array.isArray(def.vertices) && Array.isArray(def.uvs)
					&& def.vertices.length !== def.uvs.length) weighted = weighted || { slotName, def };
			}
		}
	}
	if (!weighted) console.log('  (no weighted mesh — skipping the weighted test)');
	else {
		sandbox.rawDoc = raw;
		sandbox.selSlot = weighted.slotName;
		const copy = JSON.stringify(weighted.def.vertices);
		sandbox.rebaseSlotAttachments(weighted.slotName, 37, -19);
		log(JSON.stringify(weighted.def.vertices) === copy, `a weighted mesh's vertices are left untouched ("${weighted.slotName}")`);
	}
	// No shipped rig uses a linked mesh, so synthesise one: it borrows its geometry from another
	// mesh, which means there is no vertex array on this slot to take the pivot move back out of —
	// the refusal is the only thing standing between that and art that silently jumps.
	let doc = raw0, synthetic = false;
	if (!linkedSlot) {
		let host = null;
		for (const sk of raw.skins || []) {
			for (const [slotName, bag] of Object.entries(sk.attachments || {})) {
				for (const [attName, def] of Object.entries(bag)) {
					if (def && def.type === 'mesh' && !host) host = { skin: sk.name, slotName, attName, def };
				}
			}
		}
		if (host) {
			doc = clone(raw0);
			linkedSlot = 'pivot-linked-probe';
			doc.slots.push({ name: linkedSlot, bone: doc.bones[0].name, attachment: host.attName });
			const sk = doc.skins.find((s) => s.name === host.skin);
			sk.attachments[linkedSlot] = {
				[host.attName]: {
					type: 'linkedmesh', parent: host.attName, skin: host.skin, deform: true,
					path: host.def.path || host.attName,
					width: host.def.width || 1, height: host.def.height || 1,
				},
			};
			synthetic = true;
		}
	}
	if (!linkedSlot) console.log('  (no mesh to link from — skipping the linked-mesh refusal)');
	else {
		open(doc, linkedSlot);
		const ctx = sandbox.slotPivotCtx();
		const before = JSON.stringify(sandbox.rawDoc);
		sandbox.setSlotPivotWorld(11, 22);
		log(!!(ctx && ctx.linked), `a linked-mesh slot is flagged ("${linkedSlot}"${synthetic ? ', synthesised' : ''})`);
		log(JSON.stringify(sandbox.rawDoc) === before, 'and setting a pivot on it changes nothing');
	}
}

console.log(pass ? '\nPASS\n' : '\nFAIL\n');
process.exit(pass ? 0 : 1);
