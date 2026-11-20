// Rig controls phase C2 — control shapes (docs/design/rig-controls.md §5.1–5.3, §5.5, §5.8): the
// stage's control layer, pulled out of the SHIPPED view.html and run against the REAL engine-rig
// (SkeletonJson → Skeleton → AnimationState) and the COMMITTED `vendor/rigger-controls.js` (C1's
// schema and renames, the bundle the page loads).
//
// Asserted:
//  - every shape is drawn where its bone is: screen-sized shapes keep their size and turn with the
//    bone, rig-sized ones take its whole world transform, a box stays at its setup place while its
//    bone moves; an arrow's fill covers exactly its outline, one, two or four ways;
//  - hit-testing: an outline within the tolerance picks its bone, a screen handle picks from inside,
//    a ring never from inside, the nearest outline beats an inside, the smallest inside wins, and a
//    shape is picked before a bone;
//  - hidden, locked, helpers, layers, a picker-only display and animator view decide what the stage
//    draws and picks, and 👁 Show hidden brings hidden bones back;
//  - channel locks take parts off the gizmo in Animate (never in Setup) and keys off ◆ Key; limits
//    hold a drag through the shipped `poseBoneByScreen`, which picks the bone up again on the way
//    back; an axis drag moves along that axis only, in the bone's space or the view's;
//  - ⟲ Rest keys the setup pose (engine-rig plays the bone back at its setup), only the channels a
//    control may key;
//  - every edit (shapes, layers, sets, presets) writes a controls.json C1's strict check accepts,
//    that round-trips through JSON and C1's lenient read unchanged, follows renames and deletes,
//    and leaves the irig byte-identical; a sidecar emptied on a rig that had none goes away.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red.
//   node tools/rigger-spike/rig-control-shapes.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics } = RIG;

let checks = 0;
let failed = 0;
const check = (ok, msg) => {
	checks++;
	if (!ok) failed++;
	console.log(`  ${ok ? '✅' : '✗'} ${msg}`);
	return ok;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const ATLAS = 'page.png\nsize:4,4\nfilter:Linear,Linear\n';
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function load(doc) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	return {
		data,
		skel: new Skeleton(data),
		state: new AnimationState(new AnimationStateData(data)),
	};
}
function poseAt(doc, anim, t) {
	const { skel, state } = load(doc);
	skel.setToSetupPose();
	if (anim) {
		state.setAnimation(0, anim, false);
		state.update(t);
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}

// ------------------------------------------------------- C1's code, as the page loads it (committed)
const BUNDLE = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/vendor/rigger-controls.js', import.meta.url),
	'utf8',
);
const RC = (() => {
	const ctx = { structuredClone };
	vm.createContext(ctx);
	vm.runInContext(`${BUNDLE}\n;globalThis.__rc = RiggerControls;`, ctx);
	return ctx.__rc;
})();

// ----------------------------------------------------------------- the shipped Rigger, sandboxed
const VIEW = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url),
	'utf8',
).replace(/\r\n/g, '\n');
const TOP = new Map();
for (const m of VIEW.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g))
	if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = VIEW.indexOf('\n', at + 1);
	const first = VIEW.slice(at, eol);
	let n = 0;
	for (const c of first) {
		if (c === '{' || c === '[') n++;
		else if (c === '}' || c === ']') n--;
	}
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	const end = VIEW.indexOf(kind === 'const' ? '\n};' : '\n}', at);
	return VIEW.slice(at, end + (kind === 'const' ? 3 : 2));
}
const STUBS = new Set([
	'markDirty',
	'showErr',
	'rebuildFromRawDoc',
	'buildInspector',
	'historyStep',
	'renderBoneDetail',
	'refreshAnimCounts',
	'cursorWorld',
	'slotsWithPath',
	// read as `window.RiggerControls.CONSTRAINT_PRESETS` (C1's), not the page's list of the same name
	'CONSTRAINT_PRESETS',
]);
const ENTRY = [
	'boneControlState',
	'bonePickable',
	'boneShown',
	'controlCanKey',
	'keyableChannels',
	'clampLimit',
	'limitBreaches',
	'controlColour',
	'controlShapeUnit',
	'controlShapeWorld',
	'stageControls',
	'controlShapeAt',
	'stageBoneAt',
	'nearestBoneAt',
	'gizmoParts',
	'gizmoPartAt',
	'gizmoGeom',
	'gizmoAxisProject',
	'poseBoneByScreen',
	'keyRestPose',
	'ctlEdit',
	'setControlFields',
	'addControlLayer',
	'setLayerFlag',
	'renameControlLayer',
	'deleteControlLayer',
	'layerMembers',
	'saveSelectionSet',
	'renameSelectionSet',
	'deleteSelectionSet',
	'renameInControls',
	'fitControlsToRig',
	'openStoredControls',
	'buildConstraintPreset',
	'recordPresetControls',
	'mergeImportedControls',
];
/** The shipped functions in a fresh context; `mutate` swaps [from, to] text in the pulled source. */
function sandbox(mutate = []) {
	const pulled = [];
	const seen = new Set();
	for (const q = [...ENTRY]; q.length;) {
		const name = q.shift();
		if (seen.has(name) || STUBS.has(name)) continue;
		if (!TOP.has(name)) throw new Error(`${name} not found in view.html`);
		seen.add(name);
		const src = pull(name);
		pulled.push(src);
		for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
			const t = TOP.get(m[1]);
			if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
		}
	}
	let src = pulled.join('\n');
	for (const [from, to] of mutate) {
		if (!src.includes(from)) throw new Error(`mutant: "${from}" is not in the pulled source`);
		src = src.replace(from, to);
	}
	const ui = {
		RIG,
		window: { RiggerControls: RC },
		rawDoc: null,
		skeletonData: null,
		skeleton: null,
		selected: { skeleton_file: 'hero.irig' },
		selBone: null,
		animMode: false,
		editMode: true,
		controlsDoc: null,
		controlsEtag: null,
		controlsLocked: null,
		animatorView: false,
		showHiddenBones: false,
		gizmoSpace: 'local',
		gizmoAxis: null,
		posingBone: null,
		renderer: { camera: { zoom: 1 } },
		dirty: 0,
		errors: [],
		markDirty() {
			ui.dirty++;
		},
		showErr(m) {
			ui.errors.push(m);
		},
		historyStep: (fn) => fn(),
		cursorWorld: (e) => e,
		slotsWithPath: () => [],
	};
	vm.createContext(ui);
	vm.runInContext(`${src}\n;Object.assign(globalThis, { ${ENTRY.join(', ')} });`, ui, {
		filename: 'view.html#rig-control-shapes',
	});
	return ui;
}
const UI = sandbox();

// --------------------------------------------------------------------------------- a synthetic rig
// y up. A body turned 90°, an arm on it, hand and foot controls, a jaw slider, a helper.
const RIGDOC = () => ({
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'body', parent: 'root', x: 100, y: 50 },
		{ name: 'chest', parent: 'body', y: 60, rotation: 90, length: 40 },
		{ name: 'upper_arm_l', parent: 'chest', x: 30, y: 10, length: 50 },
		{ name: 'lower_arm_l', parent: 'upper_arm_l', x: 50, rotation: 30, length: 40 },
		{ name: 'hand_ik_l', parent: 'root', x: 300, y: 200 },
		{ name: 'hand_ik_r', parent: 'root', x: -300, y: 200 },
		{ name: 'jaw', parent: 'body', x: 0, y: 80 },
		{ name: 'space_chest', parent: 'chest', y: 15 },
		{ name: 'head', parent: 'body', y: 140, length: 30 },
	],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
	ik: [
		{
			name: 'arm_ik_l',
			order: 0,
			bones: ['upper_arm_l', 'lower_arm_l'],
			target: 'hand_ik_l',
			mix: 0,
		},
	],
	animations: {},
});
/** Open `doc` in sandbox `ui` with `controls` as its sidecar (posed by `pose(skel)` when given). */
function openIn(ui, doc, controls, pose) {
	const { data, skel } = load(doc);
	skel.setToSetupPose();
	if (pose) pose(skel);
	skel.updateWorldTransform(Physics.update);
	ui.rawDoc = doc;
	ui.skeletonData = data;
	ui.skeleton = skel;
	ui.controlsDoc = controls === null ? null : { controls: 1, rig: 'hero', ...clone(controls) };
	ui.controlsEtag = null;
	ui.controlsLocked = null;
	ui.animatorView = false;
	ui.showHiddenBones = false;
	ui.animMode = false;
	ui.editMode = true;
	ui.gizmoSpace = 'local';
	ui.gizmoAxis = null;
	return skel;
}
const idx = (ui, name) => ui.skeleton.bones.findIndex((b) => b.data.name === name);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// Each check is a function of a sandbox, so a mutant can be run through the same assertion.
const GUARDS = {};
const guard = (id, fn) => {
	GUARDS[id] = fn;
	return fn(UI, true);
};
const say = (on, ok, msg) => (on ? check(ok, msg) : ok);

console.log('\n=== shapes are drawn where their bone is ===');
guard('screenShape', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), { bones: { head: { shape: 'square', size: 10 } } });
	let ok = true;
	for (const zoom of [1, 0.25]) {
		const head = skel.findBone('head');
		const w = ui.controlShapeWorld(head, { shape: 'square', size: 10 }, zoom);
		const half = Math.max(...w.loops[0].map(([x]) => Math.abs(x - head.worldX))) / zoom;
		ok &&= say(
			s,
			near(half, 10, 1e-6),
			`a 10 px square is 10 px at zoom ${zoom} (${half.toFixed(4)})`,
		);
	}
	const chest = skel.findBone('chest');
	const w = ui.controlShapeWorld(chest, { shape: 'arrow', size: 10 }, 1);
	const tip = w.loops[0][3];
	ok &&= say(
		s,
		near(tip[0], chest.worldX, 1e-6) && near(tip[1], chest.worldY + 10, 1e-6),
		`a screen arrow points along its bone (the chest, turned 90°): tip at (${tip.map((v) => v.toFixed(2))})`,
	);
	const t = ui.controlShapeWorld(chest, { shape: 'arrow', size: 10, turn: 90 }, 1).loops[0][3];
	ok &&= say(
		s,
		near(t[0], chest.worldX - 10, 1e-6) && near(t[1], chest.worldY, 1e-6),
		`its turn adds to the bone's (+90° points it the other way along x)`,
	);
	return ok;
});
guard('rigShape', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), {}, (k) => {
		k.findBone('chest').scaleX = 2;
	});
	const arm = skel.findBone('upper_arm_l');
	const w = ui.controlShapeWorld(arm, { shape: 'ring', size: 20, sizeIn: 'rig' }, 0.5);
	const p = w.loops[0][0];
	const want = { x: arm.worldX + 20 * arm.a, y: arm.worldY + 20 * arm.c };
	return say(
		s,
		near(p[0], want.x, 1e-6) && near(p[1], want.y, 1e-6) && Math.hypot(arm.a, arm.c) > 1.5,
		`a rig-unit ring takes the bone's whole world transform (its parent scaled ×2): (${p.map((v) => v.toFixed(2))})`,
	);
});
guard('box', (ui, s = false) => {
	const doc = RIGDOC();
	let skel = openIn(ui, doc, {});
	const before = ui.controlShapeWorld(
		skel.findBone('jaw'),
		{ shape: 'box', size: 15, sizeIn: 'rig', axes: 2 },
		1,
	).loops[0];
	skel = openIn(ui, doc, {}, (k) => {
		k.findBone('jaw').y += 12;
		k.findBone('jaw').x -= 7;
	});
	const after = ui.controlShapeWorld(
		skel.findBone('jaw'),
		{ shape: 'box', size: 15, sizeIn: 'rig', axes: 2 },
		1,
	).loops[0];
	const still = before.every(
		(p, i) => near(p[0], after[i][0], 1e-9) && near(p[1], after[i][1], 1e-9),
	);
	const jaw = skel.findBone('jaw');
	const inside =
		jaw.worldX > Math.min(...after.map((p) => p[0])) &&
		jaw.worldX < Math.max(...after.map((p) => p[0]));
	return say(
		s,
		still && inside,
		`a box stays at its setup place while its bone (the dot) moves inside it`,
	);
});
guard('arrows', (ui, s = false) => {
	const area = (l) =>
		Math.abs(
			l.reduce(
				(a, p, i) => a + p[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * p[1],
				0,
			),
		) / 2;
	let ok = true;
	for (const ways of [1, 2, 4]) {
		const u = ui.controlShapeUnit({ shape: 'arrow', ways });
		const outline = area(u.loops[0]);
		const filled = u.fill.reduce((a, f) => a + area(f), 0);
		const tips = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		].filter(([x, y]) => u.loops[0].some((p) => near(p[0], x) && near(p[1], y))).length;
		ok &&= say(
			s,
			near(outline, filled, 1e-9) && tips === ways,
			`a ${ways}-way arrow: ${ways} tip${ways > 1 ? 's' : ''}, its fill covers its outline (${filled.toFixed(3)} = ${outline.toFixed(3)})`,
		);
	}
	return ok;
});

console.log('\n=== hit-testing picks the bone of the shape under the cursor ===');
guard('hit', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), {
		bones: {
			hand_ik_l: { role: 'control', shape: 'circle', size: 12 },
			upper_arm_l: { shape: 'ring', size: 30 },
			hand_ik_r: { role: 'control', shape: 'square', size: 10, sizeIn: 'rig', filled: true },
		},
	});
	const z = 1,
		tol = 7;
	const h = skel.findBone('hand_ik_l'),
		a = skel.findBone('upper_arm_l'),
		r = skel.findBone('hand_ik_r');
	let ok = true;
	ok &&= say(
		s,
		ui.controlShapeAt(h.worldX + 12, h.worldY, tol, z) === idx(ui, 'hand_ik_l'),
		'on a circle’s outline: its bone',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(h.worldX + 3, h.worldY + 2, tol, z) === idx(ui, 'hand_ik_l'),
		'inside a screen handle: its bone',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(h.worldX + 12 + tol + 1, h.worldY, tol, z) === -1,
		'just past the tolerance: nothing',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(
			a.worldX + (33 * a.a) / Math.hypot(a.a, a.c),
			a.worldY + (33 * a.c) / Math.hypot(a.a, a.c),
			tol,
			z,
		) === idx(ui, 'upper_arm_l'),
		'3 px outside a ring round the arm: the arm',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(a.worldX + 4, a.worldY - 4, tol, z) !== idx(ui, 'upper_arm_l'),
		'inside the ring (the arm’s art): not the ring',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(r.worldX + 2, r.worldY - 1, 0.5, z) === idx(ui, 'hand_ik_r'),
		'inside a filled rig-unit square: its bone',
	);
	return ok;
});
guard('hitOrder', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), {
		bones: {
			hand_ik_l: { role: 'control', shape: 'square', size: 40, filled: true },
			body: { role: 'control', shape: 'circle', size: 8, offset: [200, 150] },
		},
	});
	// the body (100, 50), before the hand in bone order, draws its circle offset onto (300, 200): inside
	// hand_ik_l's big filled square, which is drawn over it
	const h = skel.findBone('hand_ik_l');
	const jawAt = { x: skel.findBone('body').worldX + 200, y: skel.findBone('body').worldY + 150 };
	let ok = true;
	ok &&= say(
		s,
		near(jawAt.x, h.worldX, 1e-4) && near(jawAt.y, h.worldY, 1e-4),
		'the body’s circle is offset into the hand’s square',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(jawAt.x + 2, jawAt.y + 1, 1, 1) === idx(ui, 'body'),
		'two insides: the smaller shape wins, though drawn under',
	);
	ok &&= say(
		s,
		ui.controlShapeAt(h.worldX + 39, h.worldY + 20, 7, 1) === idx(ui, 'hand_ik_l'),
		'near the square’s outline: the square',
	);
	// a shape before a bone: the jaw's circle drawn on top of the head bone's origin
	openIn(ui, RIGDOC(), {
		bones: { jaw: { role: 'control', shape: 'circle', size: 8, offset: [0, 60] } },
	});
	const head = ui.skeleton.findBone('head');
	ok &&= say(
		s,
		ui.stageBoneAt({ x: head.worldX + 8, y: head.worldY }) === idx(ui, 'jaw'),
		'a control’s shape is picked before the bone under it',
	);
	ok &&= say(
		s,
		ui.stageBoneAt({ x: head.worldX + 20, y: head.worldY - 3 }) === idx(ui, 'head'),
		'away from any shape: the nearest bone',
	);
	return ok;
});

console.log('\n=== hidden, locked, helpers, layers, animator view ===');
guard('visibility', (ui, s = false) => {
	const doc = RIGDOC();
	const ctl = {
		bones: {
			hand_ik_l: { role: 'control', shape: 'circle', layer: 'Body IK' },
			hand_ik_r: { role: 'control', shape: 'circle', locked: true },
			head: { hidden: true },
			space_chest: { role: 'helper' },
			jaw: { role: 'control', shape: 'box', display: 'picker' },
		},
		layers: [{ name: 'Body IK', visible: true, locked: false }],
	};
	const skel = openIn(ui, doc, ctl);
	const at = (n) => skel.findBone(n);
	const pickBone = (n) => ui.nearestBoneAt(at(n).worldX, at(n).worldY, 1);
	const pickShape = (n) => ui.controlShapeAt(at(n).worldX + 12, at(n).worldY, 3, 1);
	const drawn = () =>
		ui
			.stageControls(1, false)
			.map((c) => c.name)
			.sort()
			.join();
	let ok = true;
	ok &&= say(
		s,
		pickBone('head') === -1 && pickBone('chest') === idx(ui, 'chest'),
		'a hidden bone is not picked; a plain one is',
	);
	ok &&= say(s, pickBone('space_chest') === -1, 'a helper is hidden by default');
	ok &&= say(
		s,
		pickShape('hand_ik_r') === -1 && drawn().includes('hand_ik_r'),
		'a locked control is drawn, never picked',
	);
	ok &&= say(
		s,
		!drawn().includes('jaw') && pickBone('jaw') === idx(ui, 'jaw'),
		'a picker-only control has no shape on the stage',
	);
	ui.showHiddenBones = true;
	ok &&= say(
		s,
		pickBone('head') === idx(ui, 'head') && pickBone('space_chest') === idx(ui, 'space_chest'),
		'👁 Show hidden: hidden bones and helpers are picked again',
	);
	ui.showHiddenBones = false;
	ui.controlsDoc.layers[0].visible = false;
	ok &&= say(
		s,
		pickShape('hand_ik_l') === -1 && !drawn().includes('hand_ik_l'),
		'a hidden layer hides its bones',
	);
	ui.controlsDoc.layers[0].visible = true;
	ui.controlsDoc.layers[0].locked = true;
	ok &&= say(
		s,
		pickShape('hand_ik_l') === -1 && drawn().includes('hand_ik_l'),
		'a locked layer: drawn, not picked',
	);
	ui.controlsDoc.layers[0].locked = false;
	ui.animatorView = true;
	ok &&= say(
		s,
		pickBone('chest') === -1 && pickShape('hand_ik_l') === idx(ui, 'hand_ik_l'),
		'animator view: only controls are picked',
	);
	ui.controlsDoc.bones.chest = { shape: 'ring', size: 20 };
	ok &&= say(
		s,
		pickBone('chest') === idx(ui, 'chest'),
		'animator view: a deform bone with a shape is an FK control',
	);
	return ok;
});

console.log('\n=== locks and limits: the gizmo, ◆ Key and a drag ===');
guard('locks', (ui, s = false) => {
	openIn(ui, RIGDOC(), {
		bones: {
			upper_arm_l: { shape: 'ring' },
			hand_ik_l: { role: 'control', shape: 'square', channels: ['translate'] },
		},
	});
	const parts = (n) =>
		ui
			.gizmoParts(idx(ui, n))
			.map((p) => p.id)
			.join();
	let ok = true;
	ui.animMode = true;
	ui.editMode = false;
	ok &&= say(
		s,
		parts('upper_arm_l') === 'rotate',
		`Animate, a ring: the gizmo keeps the ring only (${parts('upper_arm_l')})`,
	);
	ok &&= say(
		s,
		parts('hand_ik_l') === 'move,x,y',
		`Animate, translate only: move and its axes, no ring (${parts('hand_ik_l')})`,
	);
	ok &&= say(s, parts('chest') === 'move,x,y,rotate', 'Animate, no control: every part');
	const keys = (n) =>
		Object.keys(
			ui.keyableChannels(n, { rotate: true, translate: true, scale: true, shear: true }),
		).join();
	ok &&= say(
		s,
		keys('hand_ik_l') === 'translate' &&
			keys('upper_arm_l') === 'rotate' &&
			keys('chest') === 'rotate,translate,scale,shear',
		'◆ Key keys only what a control may key (shear never, once it lists)',
	);
	ui.animMode = false;
	ui.editMode = true;
	ok &&= say(
		s,
		parts('upper_arm_l') === 'move,x,y,rotate',
		'Setup: locks do not apply (the rigger places the bone)',
	);
	return ok;
});
guard('limits', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), {
		bones: { hand_ik_l: { role: 'control', limits: { x: [250, 320], rotate: [-30, 60] } } },
	});
	ui.animMode = true;
	const b = skel.findBone('hand_ik_l');
	ui.posingBone = { bone: b, rotation: b.rotation, x: b.x, y: b.y, scaleX: 1, scaleY: 1 };
	ui.poseBoneByScreen(100, 0, 1); // +100 world x
	const held = ui.posingBone.x;
	ui.poseBoneByScreen(-60, 0, 1); // back to 340, still past the limit
	const still = ui.posingBone.x;
	ui.poseBoneByScreen(-50, 0, 1); // to 290, inside it
	const back = ui.posingBone.x;
	let ok = true;
	ok &&= say(
		s,
		held === 320 && still === 320 && near(back, 290),
		`a drag is held at x 320 and picked up again on the way back (${held}, ${still}, ${back})`,
	);
	ok &&= say(
		s,
		ui.clampLimit('hand_ik_l', 'rotate', 95) === 60 &&
			ui.clampLimit('hand_ik_l', 'rotate', -95) === -30 &&
			ui.clampLimit('chest', 'rotate', 500) === 500,
		'rotation is held to its limit; a bone without one is not',
	);
	b.x = 400;
	ok &&= say(
		s,
		ui
			.limitBreaches('hand_ik_l', b)
			.map((x) => x.field)
			.join() === 'x',
		'a pose outside a limit is reported (the panel warns)',
	);
	return ok;
});
guard('axes', (ui, s = false) => {
	const skel = openIn(ui, RIGDOC(), {});
	const chest = skel.findBone('chest'); // turned 90°: its x axis is the world's y
	ui.gizmoSpace = 'local';
	const p = ui.gizmoParts(idx(ui, 'chest'));
	const x = p.find((q) => q.id === 'x');
	const along = ui.gizmoAxisProject(x.dir, 0, 10);
	const across = ui.gizmoAxisProject(x.dir, 10, 0);
	let ok = true;
	ok &&= say(
		s,
		near(along.wy, 10) && near(along.wx, 0) && near(across.wx, 0) && near(across.wy, 0),
		'local: the x arrow of a bone turned 90° moves along world y only',
	);
	ui.gizmoSpace = 'view';
	const v = ui.gizmoParts(idx(ui, 'chest')).find((q) => q.id === 'x');
	ok &&= say(s, near(v.dir[0], 1) && near(v.dir[1], 0), 'view: the x arrow is the stage’s x');
	const G = ui.gizmoGeom(),
		c = { x: chest.worldX, y: chest.worldY };
	const hit = (dx, dy) =>
		(
			ui.gizmoPartAt(ui.gizmoParts(idx(ui, 'chest')), c, { x: c.x + dx, y: c.y + dy }, G) || {
				id: null,
			}
		).id;
	ok &&= say(
		s,
		hit(0, 0) === 'move' &&
			hit(35, 0) === 'x' &&
			hit(0, 35) === 'y' &&
			hit(0, -58) === 'rotate' &&
			hit(30, 30) === null,
		'the gizmo’s parts are hit where they are drawn',
	);
	return ok;
});

console.log('\n=== ⟲ Rest keys the setup pose ===');
guard('rest', (ui, s = false) => {
	const doc = RIGDOC();
	openIn(ui, doc, { bones: { upper_arm_l: { shape: 'ring' } } });
	doc.animations.wave = {
		bones: {
			upper_arm_l: { rotate: [{ time: 0, value: 40 }], translate: [{ time: 0, x: 5, y: 5 }] },
			chest: { rotate: [{ time: 0, value: -25 }], scale: [{ time: 0, x: 1.4, y: 0.8 }] },
		},
	};
	ui.keyRestPose(doc.animations.wave, ['upper_arm_l', 'chest'], 0.5);
	const setup = poseAt(doc, null, 0),
		posed = poseAt(doc, 'wave', 0.5);
	const at = (k, n) => [
		k.findBone(n).worldX,
		k.findBone(n).worldY,
		k.findBone(n).getWorldRotationX(),
	];
	const same = (n) => at(setup, n).every((v, i) => near(v, at(posed, n)[i], 1e-4));
	const armT = doc.animations.wave.bones.upper_arm_l.translate;
	let ok = true;
	ok &&= say(s, same('chest'), 'the chest plays back at its setup pose at the rest key');
	ok &&= say(
		s,
		near(posed.findBone('upper_arm_l').rotation, setup.findBone('upper_arm_l').rotation, 1e-4),
		'the ring keys its rotation back to rest',
	);
	ok &&= say(s, armT.length === 1 && armT[0].time === 0, 'a ring’s locked translate is not keyed');
	return ok;
});

console.log('\n=== the sidecar: what the panels write is a controls.json C1 accepts ===');
guard('sidecar', (ui, s = false) => {
	const doc = RIGDOC();
	openIn(ui, doc, null);
	const irig = JSON.stringify(doc);
	let ok = true;
	ui.setControlFields('hand_ik_l', {
		role: 'control',
		shape: 'arrow',
		ways: 4,
		colour: '#12ab34',
		size: 9,
	});
	ui.setControlFields('hand_ik_l', { shape: 'square' }); // `ways` goes with the arrow
	ui.setControlFields('upper_arm_l', { shape: 'polyline' });
	ui.setControlFields('upper_arm_l', { limits: { rotate: [-170, 60] }, channels: ['rotate'] });
	ui.setControlFields('space_chest', { role: 'helper' });
	ui.addControlLayer('Body IK', ['hand_ik_l', 'hand_ik_r']);
	ui.addControlLayer('Helpers', ['space_chest']);
	ui.setLayerFlag('Helpers', 'locked', true);
	ui.saveSelectionSet('hands', ['hand_ik_l', 'hand_ik_r']);
	ui.renameControlLayer('Body IK', 'Arms IK');
	ui.renameSelectionSet('hands', 'both hands');
	const c = ui.controlsDoc;
	const checked = RC.checkedControls(clone(c), 'hero', doc);
	ok &&= say(
		s,
		checked.problems.length === 0,
		`C1's strict check accepts it${checked.problems.length ? ': ' + checked.problems.join('; ') : ''}`,
	);
	ok &&= say(
		s,
		!('ways' in c.bones.hand_ik_l) && c.bones.upper_arm_l.points.length === 2,
		'a field of another shape goes with it; a polyline gets points',
	);
	ok &&= say(
		s,
		c.bones.hand_ik_r.layer === 'Arms IK' &&
			c.layers[0].name === 'Arms IK' &&
			c.sets['both hands'].length === 2,
		'a layer and a set rename with their members',
	);
	const round = RC.fitControls(JSON.parse(JSON.stringify(c)), doc);
	ok &&= say(
		s,
		JSON.stringify(round.doc) === JSON.stringify(c) && round.dropped.length === 0,
		'it round-trips through JSON and C1’s lenient read unchanged',
	);
	ok &&= say(
		s,
		JSON.stringify(doc) === irig,
		'the irig is byte-identical after every control edit',
	);
	// a rename and a delete in the irig follow into it
	doc.bones.find((b) => b.name === 'hand_ik_r').name = 'hand_ctl_r';
	ui.renameInControls('bone', 'hand_ik_r', 'hand_ctl_r');
	doc.bones = doc.bones.filter((b) => b.name !== 'space_chest');
	ui.fitControlsToRig();
	ok &&= say(
		s,
		ui.controlsDoc.sets['both hands'].includes('hand_ctl_r') &&
			ui.controlsDoc.bones.hand_ctl_r &&
			!ui.controlsDoc.bones.space_chest,
		'a bone rename follows into it; a deleted bone leaves it',
	);
	ok &&= say(
		s,
		RC.checkedControls(clone(ui.controlsDoc), 'hero', doc).problems.length === 0,
		'and it still fits the irig',
	);
	ui.deleteControlLayer('Helpers');
	ui.deleteSelectionSet('both hands');
	ok &&= say(
		s,
		!ui.controlsDoc.sets && ui.controlsDoc.layers.length === 1,
		'deleting a set or a layer tidies the doc',
	);
	return ok;
});
guard('emptied', (ui, s = false) => {
	openIn(ui, RIGDOC(), null);
	ui.setControlFields('head', { hidden: true });
	const made = !!ui.controlsDoc;
	ui.setControlFields('head', { hidden: undefined });
	let ok = say(
		s,
		made && ui.controlsDoc === null,
		'a sidecar emptied on a rig that had none goes again (a save sends none)',
	);
	openIn(ui, RIGDOC(), { bones: { head: { hidden: true } } });
	ui.controlsEtag = '"e1"';
	ui.setControlFields('head', { hidden: undefined });
	ok &&= say(
		s,
		ui.controlsDoc !== null && !ui.controlsDoc.bones,
		'one stored before is kept, empty, so the save clears it',
	);
	ui.controlsLocked = 'torn';
	ui.errors.length = 0;
	ok &&= say(
		s,
		ui.setControlFields('head', { hidden: true }) === false && ui.errors.length === 1,
		'a sidecar that cannot be read is not edited, and says why',
	);
	return ok;
});
guard('open', (ui, s = false) => {
	let ok = true;
	ui.openStoredControls({ etag: '"a"', doc: { controls: 1, rig: 'hero' }, dropped: ['x'] }, true);
	ok &&= say(
		s,
		ui.controlsEtag === '"a"' && ui.controlsDoc && !ui.controlsLocked,
		'a stored sidecar opens editable, with its ETag',
	);
	ui.openStoredControls({ etag: '"b"', problems: ['bad'] }, true);
	ok &&= say(
		s,
		ui.controlsDoc === null && /cannot be read/.test(ui.controlsLocked),
		'an unreadable one is locked, not replaced',
	);
	ui.openStoredControls({ etag: '"c"', doc: { controls: 1, rig: 'hero' }, torn: true }, true);
	ok &&= say(s, /another version/.test(ui.controlsLocked), 'a torn one is locked');
	ui.openStoredControls(null, false);
	ok &&= say(
		s,
		ui.controlsEtag === null && /did not load/.test(ui.controlsLocked),
		'without the bundle nothing is edited (the server keeps the stored one)',
	);
	ui.openStoredControls(null, true);
	ok &&= say(
		s,
		ui.controlsEtag === null && ui.controlsDoc === null && !ui.controlsLocked,
		'a rig with none opens with none, editable',
	);
	return ok;
});
guard('presets', (ui, s = false) => {
	const doc = RIGDOC();
	openIn(ui, doc, null);
	const before = new Set(doc.bones.map((b) => b.name));
	const res = ui.buildConstraintPreset('twoBoneIk', 'lower_arm_l', null);
	ui.recordPresetControls(
		'twoBoneIk',
		res,
		doc.bones.map((b) => b.name).filter((n) => !before.has(n)),
	);
	const made = Object.keys(ui.controlsDoc.bones);
	const c = ui.controlsDoc.bones[made[0]];
	let ok = true;
	ok &&= say(
		s,
		made.length === 1 &&
			c.role === 'control' &&
			c.shape === 'square' &&
			(ui.controlsDoc.presets || {})[res.name] === 'twoBoneIk',
		`＋ Two-bone IK's new control is a square control, the IK records its preset (${made[0]})`,
	);
	ok &&= say(
		s,
		RC.checkedControls(clone(ui.controlsDoc), 'hero', doc).problems.length === 0,
		'and C1’s strict check accepts it',
	);
	return ok;
});

guard('import', (ui, s = false) => {
	const doc = RIGDOC();
	openIn(ui, doc, { layers: [{ name: 'Body IK', visible: false }] });
	const lib = RIGDOC();
	const p = (n) => (n ? 'lib_' + n : n);
	// what the import's merge did to the irig: every name of the library rig prefixed
	for (const b of lib.bones)
		doc.bones.push({ ...b, name: p(b.name), parent: p(b.parent) || 'root' });
	for (const c of lib.ik)
		doc.ik.push({ ...c, name: p(c.name), bones: c.bones.map(p), target: p(c.target), order: 1 });
	const libCtl = {
		controls: 1,
		rig: 'lib',
		bones: { hand_ik_l: { role: 'control', shape: 'square', layer: 'Body IK' } },
		layers: [{ name: 'Body IK', visible: true, locked: false }],
		sets: { hands: ['hand_ik_l', 'hand_ik_r'] },
		presets: { arm_ik_l: 'twoBoneIk' },
	};
	ui.mergeImportedControls(libCtl, lib, 'lib_');
	const c = ui.controlsDoc;
	let ok = true;
	ok &&= say(
		s,
		c.bones.lib_hand_ik_l && c.bones.lib_hand_ik_l.shape === 'square' && !c.bones.hand_ik_l,
		'an imported rig’s controls join under the import’s prefix',
	);
	ok &&= say(
		s,
		c.sets.lib_hands.join() === 'lib_hand_ik_l,lib_hand_ik_r' &&
			c.presets.lib_arm_ik_l === 'twoBoneIk',
		'its sets and presets too',
	);
	ok &&= say(
		s,
		c.layers.length === 1 && c.layers[0].visible === false,
		'a layer already here keeps its switches',
	);
	ok &&= say(
		s,
		RC.checkedControls(clone(c), 'hero', doc).problems.length === 0,
		'and the result fits the merged irig',
	);
	return ok;
});

// -------------------------------------------------------------------- mutants: each must turn red
console.log('\n=== mutants of the shipped code: each must fail its check ===');
const MUTANTS = [
	[
		'screenShape',
		'a screen size not scaled by the zoom',
		['k = (c.size || CTL_SIZE) * (screen ? zoom : 1)', 'k = (c.size || CTL_SIZE)'],
	],
	[
		'screenShape',
		'the shape not turned with its bone',
		[
			'H = { a: Math.cos(r), b: -Math.sin(r) * sgn, c: Math.sin(r), d: Math.cos(r) * sgn, x: H.x, y: H.y };',
			'H = { a: 1, b: 0, c: 0, d: 1, x: H.x, y: H.y };',
		],
	],
	[
		'rigShape',
		'a rig-unit shape without the bone’s scale',
		['if (screen){\n    const r', 'if (true){\n    const r'],
	],
	['box', 'a box that moves with its bone', ['if (c.shape === "box"){', 'if (false){']],
	[
		'arrows',
		'a 1-way arrow without its tail',
		['if (ways === 1) loop.push([-1, w], [-1, -w]);', ''],
	],
	[
		'hit',
		'a ring picked from inside',
		['s.c.shape !== "ring" && s.c.shape !== "box" &&', 's.c.shape !== "box" &&'],
	],
	['hit', 'no tolerance', ['if (d <= tol && d <= bestD)', 'if (d <= 0 && d <= bestD)']],
	[
		'hitOrder',
		'the larger inside wins',
		['if (Math.abs(area) <= inArea)', 'if (Math.abs(area) >= -1)'],
	],
	[
		'hitOrder',
		'bones before shapes',
		['return s >= 0 ? s : nearestBone(e);', 'const n = nearestBone(e); return n >= 0 ? n : s;'],
	],
	[
		'visibility',
		'helpers shown by default',
		[
			'(c.hidden !== undefined ? c.hidden : c.role === "helper")',
			'(c.hidden !== undefined ? c.hidden : false)',
		],
	],
	[
		'visibility',
		'a locked bone picked',
		[
			'const bonePickable = (st) => boneShown(st) && !st.locked;',
			'const bonePickable = (st) => boneShown(st);',
		],
	],
	['visibility', 'layers ignored', ['|| !!(layer && layer.visible === false)', '']],
	['visibility', 'animator view shows every bone', ['&& (!animatorView || st.isControl)', '']],
	[
		'visibility',
		'a picker-only control on the stage',
		['(c.display || "stage") !== "picker"', 'true'],
	],
	['locks', 'channel locks ignored', ['return !list || list.includes(ch);', 'return true;']],
	[
		'locks',
		'a ring keys everything',
		['c.channels || (c.shape === "ring" ? ["rotate"] : null)', 'c.channels || null'],
	],
	[
		'locks',
		'locks applied in Setup too',
		[
			'const can = (ch) => !animMode || controlCanKey(b.data.name, ch);',
			'const can = (ch) => controlCanKey(b.data.name, ch);',
		],
	],
	['limits', 'limits ignored', ['return l ? Math.min(l[1], Math.max(l[0], v)) : v;', 'return v;']],
	[
		'limits',
		'the drag not picked up on the way back',
		['posingBone.rx = (posingBone.rx ?? posingBone.x) + lx;', 'posingBone.rx = posingBone.x + lx;'],
	],
	['axes', 'an axis drag moves freely', ['if (!dir) return { wx, wy };', 'return { wx, wy };']],
	[
		'axes',
		'local axes are the view’s',
		['if (space === "view" || !bone) return', 'if (true) return'],
	],
	[
		'rest',
		'rest keyed as the setup value',
		['upsertKey(cb.rotate, time, { value: 0 });', 'upsertKey(cb.rotate, time, { value: 10 });'],
	],
	[
		'rest',
		'rest keys locked channels',
		[
			'const ch = keyableChannels(n, { rotate: true, translate: true, scale: true, shear: true })',
			'const ch = { rotate: true, translate: true, scale: true, shear: true }',
		],
	],
	['sidecar', 'a field of another shape kept', ['if (c.shape !== "arrow") delete c.ways;', '']],
	[
		'sidecar',
		'a layer rename leaves its members',
		['for (const c of Object.values(doc.bones || {})) if (c.layer === from) c.layer = to;', ''],
	],
	['sidecar', 'a rename not followed', ['renames[kind].set(from, to);', '']],
	[
		'sidecar',
		'empty maps and lists kept',
		['if (v && (Array.isArray(v)', 'if (false && (Array.isArray(v)'],
	],
	[
		'emptied',
		'an emptied sidecar kept',
		['&& controlsEtag == null ? null : doc', '&& false ? null : doc'],
	],
	['emptied', 'a locked sidecar edited', ['if (controlsLocked){', 'if (false){']],
	[
		'open',
		'an unreadable sidecar editable',
		['else if (stored.problems) controlsLocked =', 'else if (stored.problems) void'],
	],
	[
		'import',
		'imported controls not renamed',
		['const doc = window.RiggerControls.renameControls(ctl, renames);', 'const doc = ctl;'],
	],
	[
		'presets',
		'presets not recorded',
		['if (known){ doc.presets = doc.presets || {}; doc.presets[res.name] = id; }', ''],
	],
];
for (const [id, what, swap] of MUTANTS) {
	let red;
	let threw = '';
	try {
		red = !GUARDS[id](sandbox([swap]));
	} catch (e) {
		red = true;
		threw = ` (threw: ${String(e.message).slice(0, 60)})`;
	}
	check(red, `${id} ✗ under "${what}"${threw}`);
}

console.log(`\n${failed === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - failed}/${checks} checks`);
process.exit(failed === 0 ? 0 : 1);
