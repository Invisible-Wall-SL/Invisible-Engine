// Verify ⊕ CENTRE ORIGIN headlessly, against the engine-rig loader and against the code that
// actually ships: the origin block is extracted verbatim out of `static/rigger/view.html` and run in
// a vm sandbox with the editor's globals stubbed, so a drift between this test and the tool is
// impossible.
//
// WHY: a rig placed on a screen sits by its skeleton ORIGIN (the Scene Editor and the game put it on
// the node's x/y), and a Rigger rig built away from its origin drew offset from wherever it was
// placed. ⊕ Centre origin moves the rig so the centre of its Bounds frame is the origin.
//
// The contract:
//   (a) afterwards the Bounds frame is centred on the origin, at the same size, keeping its lock,
//       and it STAYS centred through the re-fit a save makes of an unlocked frame: the frame
//       centred is the one a save writes, even when the stored one has gone stale or has no x/y;
//   (b) the art keeps its shape: in the setup pose AND mid-animation every attachment moves by
//       exactly the same (dx, dy), also under a rotated, scaled root and with a bone detached to the
//       root level (a second root);
//   (c) the document and the live skeleton agree: the .irig reloads to the pose on stage;
//   (d) an FX / clip binding with no bone and no slot is bound to the first bone (where this view
//       always drew it, and where the game draws it once named); a bone or slot binding is untouched;
//   (e) a second press, or a rig already centred, changes nothing.
//
//   node tools/rigger-spike/origin.mjs <skeleton.json> <skeleton.atlas>
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, Vector2, Physics, MixBlend, MixDirection } =
	await import(RIG_CORE);

const [, , jsonPath, atlasPath] = process.argv;
if (!jsonPath || !atlasPath) {
	console.error('usage: node tools/rigger-spike/origin.mjs <skeleton.json> <skeleton.atlas>');
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
const world = (sk) => { try { sk.updateWorldTransform(Physics.update); } catch { sk.updateWorldTransform(); } };
function posed(obj) {
	const sd = loadData(clone(obj));
	const sk = new Skeleton(sd);
	sk.setToSetupPose();
	world(sk);
	return { sd, sk };
}

// ---- pull the SHIPPED origin code out of view.html ----------------------------------------
const VIEW = new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url);
const html = readFileSync(VIEW, 'utf8');
const START = '// ---- origin (the point a placed rig sits by)';
const END = '// ---- render loop';
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) {
	console.error('✗ could not find the origin block in view.html — the markers moved');
	process.exit(2);
}
const shipped = html.slice(a, b);
for (const fn of ['drawOriginOverlay', 'centreRigOrigin']) {
	if (!shipped.includes('function ' + fn)) {
		console.error(`✗ extracted block is missing ${fn}() — the markers moved`);
		process.exit(2);
	}
}
// The frame it reads and re-fits lives outside the block — pull each on its own so the test drives
// the real ones.
function pullOne(name) {
	const fn = html.indexOf(`\nfunction ${name}(`);
	if (fn < 0) {
		console.error(`✗ ${name} not found in view.html`);
		process.exit(2);
	}
	return html.slice(fn + 1, html.indexOf('\n}', fn) + 2);
}
const shippedOutside = ['rigBoundsRect', 'ensureRigBounds', 'computeRigBounds', 'settleRigBounds']
	.map(pullOne)
	.join('\n');

const sandbox = {
	RIG: { Vector2 },
	historyStep: (fn) => fn(),
	historyFlush() {},
	rigHist: { present: null },
	renderEventDetail() {},
	markDirty() { sandbox.dirty = true; },
	showNotice(msg) { sandbox.notice = msg; },
	fitView() {},
	updateWorld() { world(sandbox.skeleton); },
	poseAtTime() {},
	bindingContentBounds: () => null,
	rawDoc: null, skeleton: null, skeletonData: null, dirty: false, notice: '',
	showBones: true, showBounds: false,
};
vm.createContext(sandbox);
vm.runInContext(shipped + '\n' + shippedOutside, sandbox, { filename: 'view.html#origin' });

// ---- helpers ------------------------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; console.log((ok ? '  ✅ ' : '  ✗ ') + msg); if (!ok) pass = false; };
const near = (p, q, eps = 0.02) => Math.abs(p - q) <= eps;

function open(doc) {
	sandbox.rawDoc = clone(doc);
	const r = posed(sandbox.rawDoc);
	sandbox.skeletonData = r.sd;
	sandbox.skeleton = r.sk;
	sandbox.dirty = false;
	sandbox.notice = '';
}
/** The art's extent in the CURRENT pose of `sk` — every visible attachment, meshes included. */
function extent(sk) {
	const off = new Vector2(), size = new Vector2();
	sk.getBounds(off, size, []);
	return { x: off.x, y: off.y, w: size.x, h: size.y };
}
/** Pose `sk` at `t` seconds into `anim` (over the setup pose), or the setup pose for no anim. */
function poseAt(sk, sd, anim, t) {
	sk.setToSetupPose();
	if (anim) sd.findAnimation(anim).apply(sk, 0, t, false, null, 1, MixBlend.setup, MixDirection.mixIn);
	world(sk);
}
/** Where the art sits before and after, in the same pose: it must have moved by exactly (dx, dy). */
function movedBy(before, after, dx, dy) {
	return near(after.x - before.x, dx) && near(after.y - before.y, dy) && near(after.w, before.w) && near(after.h, before.h);
}
/** A binding on the first animation's first key, of each shape, so (d) has something to rebind. */
function withBindings(doc) {
	const name = Object.keys(doc.animations || {})[0];
	if (!name) return null;
	const boneName = doc.bones[doc.bones.length - 1].name;
	const slotName = doc.slots && doc.slots[0] && doc.slots[0].name;
	doc.events = { ...(doc.events || {}), originSpike: {} };
	doc.animations[name].events = [
		...(doc.animations[name].events || []),
		{ time: 0, name: 'originSpike', fx: { effectId: 'free' }, flipbook: { clipId: 'onBone', bone: boneName } },
		{ time: 0, name: 'originSpike', fx: { effectId: 'onSlot', slot: slotName } },
	];
	return name;
}

const raw0 = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (!(raw0.skeleton && raw0.skeleton.width > 0 && raw0.skeleton.height > 0)) {
	console.error('✗ this check needs a rig with a Bounds frame (skeleton width/height)');
	process.exit(2);
}
const animName = Object.keys(raw0.animations || {})[0];
const animTime = animName ? (posed(raw0).sd.findAnimation(animName).duration || 0) / 2 : 0;

/**
 * A rig whose art sits far from its origin — the reported widget, whose frame centre was ~(-950, 580)
 * from its origin — made from this one by moving its root and its frame together.
 */
function offset(doc, ox, oy, extra = {}) {
	const d = clone(doc);
	d.bones[0] = { ...d.bones[0], x: (d.bones[0].x || 0) + ox, y: (d.bones[0].y || 0) + oy, ...extra };
	d.skeleton = { ...d.skeleton, x: d.skeleton.x + ox, y: d.skeleton.y + oy };
	return d;
}

/** The root moved after the frame was last fitted: the stored frame is stale until a save. */
function stale(doc, ox, oy) {
	const d = clone(doc);
	d.bones[0] = { ...d.bones[0], x: (d.bones[0].x || 0) + ox, y: (d.bones[0].y || 0) + oy };
	return d;
}
/** A bone detached to the root level, as the bone panel's "(root — no parent)" does. */
function secondRoot(doc) {
	const d = clone(doc);
	const leaf = d.bones.find((b, i) => i > 0 && b.parent && !d.bones.some((c) => c.parent === b.name));
	if (leaf) delete leaf.parent;
	return d;
}
/** A header with a size but no x/y, which the engine reads as centred on the origin. */
function noXY(doc) {
	const d = clone(doc);
	delete d.skeleton.x;
	delete d.skeleton.y;
	return d;
}

const cases = [
	['as shipped', raw0],
	['art far from its origin', offset(raw0, -950, 580)],
	['… under a rotated, scaled root', offset(raw0, 400, -300, { rotation: 30, scaleX: 1.5, scaleY: 0.8 })],
	['… with a hand-set (locked) frame', offset({ ...raw0, skeleton: { ...raw0.skeleton, iwLockBounds: true } }, 120, 75)],
	['… with a stale frame (root moved since the last fit)', stale(raw0, 300, -120)],
	['… with a bone detached to the root level', secondRoot(offset(raw0, -500, 260))],
	['… with a frame that has no x/y', noXY(offset(raw0, 200, 90))],
];
console.log(`\n=== ⊕ centre origin (shipped code, official loader): ${jsonPath} ===`);

for (const [label, doc0] of cases) {
	console.log(`— ${label}`);
	const doc = clone(doc0);
	const bound = withBindings(doc);
	open(doc);
	// The frame the button must centre: the one a save would write — a locked frame as stored, an
	// unlocked one re-fitted to the art. Measured without writing, so a press that skips the re-fit
	// is caught.
	const fit = sandbox.rawDoc.skeleton.iwLockBounds ? null : sandbox.computeRigBounds();
	const frame0 = fit ? { x: fit.x, y: fit.y, w: fit.width, h: fit.height } : { ...sandbox.rigBoundsRect() };
	const centred0 = near(frame0.x + frame0.w / 2, 0, 0.005) && near(frame0.y + frame0.h / 2, 0, 0.005);
	const dx = Math.round(-(frame0.x + frame0.w / 2) * 100) / 100;
	const dy = Math.round(-(frame0.y + frame0.h / 2) * 100) / 100;
	const before = { setup: extent(sandbox.skeleton) };
	if (animName) {
		poseAt(sandbox.skeleton, sandbox.skeletonData, animName, animTime);
		before.anim = extent(sandbox.skeleton);
		poseAt(sandbox.skeleton, sandbox.skeletonData, null, 0);
	}
	const lock0 = !!sandbox.rawDoc.skeleton.iwLockBounds;

	sandbox.centreRigOrigin();

	if (centred0) {
		log(!sandbox.dirty && /already/.test(sandbox.notice), `(e) a frame already centred is left alone`);
		continue;
	}
	// (a)
	const frame = sandbox.rigBoundsRect();
	log(
		near(frame.x + frame.w / 2, 0) && near(frame.y + frame.h / 2, 0) && near(frame.w, frame0.w) && near(frame.h, frame0.h),
		`(a) the frame is centred on the origin at its size (centre ${(frame.x + frame.w / 2).toFixed(2)}, ${(frame.y + frame.h / 2).toFixed(2)})`,
	);
	log(!!sandbox.rawDoc.skeleton.iwLockBounds === lock0, `(a) the frame's lock is kept (${lock0 ? 'locked' : 'auto'})`);
	{
		const saved = clone(sandbox.rawDoc);
		sandbox.ensureRigBounds(); // what a save does to the frame
		const f = sandbox.rigBoundsRect();
		log(
			near(f.x + f.w / 2, 0) && near(f.y + f.h / 2, 0),
			`(a) …and stays centred through a save's re-fit (centre ${(f.x + f.w / 2).toFixed(2)}, ${(f.y + f.h / 2).toFixed(2)})`,
		);
		sandbox.rawDoc = saved;
	}
	// (b)
	log(movedBy(before.setup, extent(sandbox.skeleton), dx, dy), `(b) the setup pose moved by exactly (${dx}, ${dy})`);
	if (animName) {
		poseAt(sandbox.skeleton, sandbox.skeletonData, animName, animTime);
		log(movedBy(before.anim, extent(sandbox.skeleton), dx, dy), `(b) "${animName}" at ${animTime.toFixed(2)}s moved by the same amount`);
	}
	// (c)
	const reloaded = posed(sandbox.rawDoc);
	poseAt(sandbox.skeleton, sandbox.skeletonData, null, 0);
	log(movedBy(extent(sandbox.skeleton), extent(reloaded.sk), 0, 0), '(c) the saved document reloads to the pose on stage');
	log(sandbox.dirty, '(c) the rig is marked unsaved');
	// (d)
	if (bound) {
		const evs = sandbox.rawDoc.animations[bound].events.filter((e) => e.name === 'originSpike');
		const root = sandbox.rawDoc.bones[0].name;
		log(evs[0].fx.bone === root, `(d) a binding with no bone now names the first bone "${root}"`);
		log(evs[0].flipbook.bone !== root && !!evs[0].flipbook.bone, '(d) a bone binding keeps its bone');
		log(!evs[1].fx.bone && evs[1].fx.slot !== undefined, '(d) a slot binding keeps riding its slot');
	}
	// (e)
	const doc1 = JSON.stringify(sandbox.rawDoc);
	sandbox.dirty = false;
	sandbox.centreRigOrigin();
	log(JSON.stringify(sandbox.rawDoc) === doc1 && !sandbox.dirty, '(e) a second press changes nothing');
}

console.log(`\n${pass ? '✅ PASS' : '✗ FAIL'} (${checks} checks)`);
process.exit(pass ? 0 : 1);
