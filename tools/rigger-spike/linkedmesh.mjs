// Verify linked-mesh and skin authoring headlessly, on the SHIPPED code: every function the actions
// reach is pulled out of view.html (transitively), the rebuild runs as shipped but through the
// strict spine-core 4.2 loader, and each action must leave a rig that LOADS with every linked mesh
// bound to the parent the author meant, in the skin on stage — replacing nothing it was not asked to.
//
// The crux, read off SkeletonJson ("Linked meshes"): the parent is looked up by NAME in the linked
// mesh's OWN slot, in the skin its `skin` names — and an ABSENT `skin` means the DEFAULT skin, not
// the skin the linked mesh sits in. So a parent in any other skin, the active one included, must be
// named: without it the load throws "Parent mesh not found", or — when default holds a same-named
// mesh on that slot — silently binds the linked mesh to THAT one.
//
// An edit writes into the skin on stage (`activeSkinName`); the Skin picker in the bottom bar is a
// view of it. The picker is modelled as the browser <select> it is — a value no option carries
// reads back "", and nothing set from code fires `change` — with whatever options the page's
// `renderSkinPicker` writes when the inspector renders. They used to be written only when the rig
// opened, and edits read the picker: in a skin added, renamed or imported since, a new attachment
// replaced the source mesh it was meant to link to, ＋ add image went into the first skin, and every
// rebuild put the default skin back on stage.
//
// A synthetic three-skin rig always runs: ＋ Linked mesh and the source picker from every skin onto
// every source they offer, the source the picker shows, ＋ Linked mesh in an imported skin, skin
// rename (the default skin refused; animation keys follow), importing a rig that relies on the
// implicit default, and a session of skin edits — ＋ Add skin, pick it, ＋ add image, rig text,
// ⎘ Make skin-specific and replace image in it, rename it, delete it, import — with the picker read
// after each. The rig on the command line then gets the import, ＋ Linked mesh in its imported
// skins, a rename of every skin, ＋ Linked mesh from a fresh skin on every slot with a mesh, and ＋ add
// image in a fresh skin on every slot, each placed like the image the slot showed.
//
// ▸ Convert to mesh and ✎ Draw mesh replace the image the stage shows — the skin on stage's if it
// has one of that name, else default's. They used to rewrite the FIRST skin holding the name: with a
// skin on stage that overrides a same-named image, default's became a mesh of the other skin's quad
// and the stage did not change. A synthetic rig of images runs both with each skin on stage (one
// overriding, one holding nothing, and default listed after another skin), and Convert on a text
// element's source locale, whose other locales must follow it in the same skin. The rig on the
// command line gets both on every slot showing an image, from a fresh skin that holds nothing and
// from one that holds its own same-named copy.
//
// The placement fields (x, y, rotation, scaleX, scaleY), the ✥ pivot and replace image edit that
// same image, by the same rule. They used to write the first skin holding the name (replace image
// fell back to it when the skin on stage held none): the image on stage moved, then snapped back at
// the next rebuild. Each runs with each skin on stage, on the same rigs and on copies with a pivot
// on each skin's image: the edit must be written into that image's entry alone, a turn or a scale
// must hold that image's pivot, the pivot panel must read it, and a rebuild must leave the image
// where the edit put it. The rig on the command line gets all three on every slot showing an image,
// from the same two fresh skins.
//   node tools/rigger-spike/linkedmesh.mjs [<skeleton.json> <skeleton.atlas>]
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
const SPINE = await import(SPINE_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = SPINE;

const clone = (o) => JSON.parse(JSON.stringify(o));
// One parsed atlas per atlas text, with stand-in textures: every region resolves, nothing is drawn.
const atlases = new Map();
function atlasOf(atlasText) {
	if (!atlases.has(atlasText)) {
		const atlas = new TextureAtlas(atlasText);
		const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
		for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
		atlases.set(atlasText, atlas);
	}
	return atlases.get(atlasText);
}
const loadData = (obj, atlasText) => new SkeletonJson(new AtlasAttachmentLoader(atlasOf(atlasText))).readSkeletonData(clone(obj));

// ---- pull the SHIPPED actions (and everything they call) out of view.html ---------------------
const html = readFileSync(new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url), 'utf8');
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
// The UI around an action. The loader is the strict one, so an image the atlas lacks throws instead
// of drawing a placeholder; of everything the inspector renders, only the skin picker is read here.
const STUBS = new Set(['makeAttachmentLoader', 'buildInspector', 'selectBone', 'renderBoneDetail', 'refreshArtWarn', 'selectSlot', 'renderSlotDetail', 'markDirty', 'showNotice']);
const ENTRY = ['sourceMeshCandidates', 'addLinkedMesh', 'setLinkedMeshParent', 'renderLinkedMeshEditor', 'addSkin', 'renameSkin', 'deleteSkin', 'setActiveSkin', 'renderSkinPicker', 'attachRegion', 'placeTextAttachments', 'copyMeshToActiveSkin', 'replaceAttachmentImage', 'prefixRigNames', 'mergeRigInto', 'convertRegionToMesh', 'finishDrawMesh', 'applyAttachmentEdit', 'setPivotUV', 'pivotUV', 'pivotEditable'];
const pulled = [], seen = new Set();
for (const q = [...ENTRY]; q.length; ) {
	const name = q.shift();
	if (seen.has(name) || STUBS.has(name)) continue;
	if (!TOP.has(name)) { console.error(`✗ ${name} not found in view.html`); process.exit(2); }
	seen.add(name);
	const src = pull(name);
	pulled.push(src);
	// a function is followed only where it is CALLED — a local named like one is not it
	for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
		const t = TOP.get(m[1]);
		if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
	}
}
// The bottom-bar #skin <select>, as a browser has it: the page writes its options, a lone <select>
// selects its first option whenever none is, a value no option carries reads back "", and nothing
// set from code fires `change` — only a pick does, through the handler `wire()` gives it.
let picking = false, changesFromCode = 0;
const picker = {
	tag: 'select', children: [], index: -1,
	get firstChild() { return this.children[0] ?? null; },
	appendChild(o) { this.children.push(o); if (this.index < 0) this.index = 0; return o; },
	removeChild(o) {
		const i = this.children.indexOf(o);
		this.children.splice(i, 1);
		if (i < this.index) this.index--;
		else if (i === this.index) this.index = -1;
		if (this.index < 0 && this.children.length) this.index = 0;
		return o;
	},
	get options() { return this.children.map((o) => o.value); },
	get value() { return this.index < 0 ? '' : this.children[this.index].value; },
	set value(v) { this.index = this.children.findIndex((o) => o.value === v); },
	onchange(e) { if (!picking) changesFromCode++; sandbox.setActiveSkin(e.target.value); },
	dispatchEvent(e) { if (e.type === 'change') this.onchange({ target: this }); return true; },
};
const element = (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); return c; } });
const sandbox = {
	SPINE, rawDoc: null, skeletonData: null, skeleton: null, animState: null, meshSetupVerts: null, missingArt: [],
	selected: { name: 'rig', atlas_file: 'rig.atlas' }, selSlot: null, selBone: null, meshCtx: null,
	selIk: null, selTc: null, selPath: null, selPc: null, animsDirty: false,
	rigText: { elements: [] }, drawMeshMode: false, drawPoints: [], selDrawPoint: null,
	assetMgr: { require: () => sandbox.__atlas },
	$: (sel) => (sel === '#skin' ? picker : null),
	document: { createElement: element, createTextNode: (text) => ({ text }) },
	confirm: () => true, // the author says yes to whatever an action asks
	alert: (msg) => { throw new Error(msg); }, // an action that refuses says why
	makeAttachmentLoader: (atlas) => new AtlasAttachmentLoader(atlas),
	buildInspector() { sandbox.renderSkinPicker(); },
	selectBone() {}, renderBoneDetail() {}, refreshArtWarn() {}, selectSlot() {}, renderSlotDetail() {}, markDirty() {}, showNotice() {},
	__atlas: null,
};
vm.createContext(sandbox);
vm.runInContext(pulled.join('\n'), sandbox, { filename: 'view.html#linkedmesh' });

// ---- helpers ---------------------------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; if (!ok) { console.log('  ✗ ' + msg); pass = false; } return ok; };

// A click on a skin in the skins list.
const activate = (skin) => sandbox.setActiveSkin(skin);
// A pick in the Skin picker, which can only pick a skin it offers. Returns why not, or null.
function pick(skin) {
	if (!picker.options.includes(skin)) return `the picker does not offer "${skin}" — it offers [${picker.options}]`;
	picking = true;
	try { picker.value = skin; picker.onchange({ target: picker }); } finally { picking = false; }
	return null;
}
// Open a rig the way buildSkeleton does — a fresh skeleton shows default, else the first skin — and
// click `skin`, if given.
function open(doc, atlasText, skin = null, slot = null) {
	Object.assign(sandbox, { rawDoc: clone(doc), skeleton: null, __atlas: atlasOf(atlasText), selSlot: slot, selBone: null, meshCtx: null });
	sandbox.rebuildFromRawDoc(null);
	if (skin) activate(skin);
}
// Carry on in the same session from `doc` (an edit made since the rig opened), and click `skin`.
function resume(doc, atlasText, skin, slot = null) {
	Object.assign(sandbox, { rawDoc: clone(doc), __atlas: atlasOf(atlasText), selSlot: slot, selBone: null, meshCtx: null });
	sandbox.rebuildFromRawDoc(null);
	activate(skin);
}
// One action the way a click runs it; the error is what the author would have hit.
function act(fn) {
	try { fn(sandbox); return null; } catch (e) { return String((e && e.message) || e); }
}
// Names can hold `/` (skin folders, attachment paths), so a key is a JSON triple.
const key = (skin, slot, name) => JSON.stringify([skin, slot, name]);
const show = (k) => (k ? JSON.parse(k).join('/') : String(k));
const bagOf = (doc, skin, slot) => { const sk = doc.skins.find((s) => s.name === skin); sk.attachments ||= {}; return (sk.attachments[slot] ||= {}); };
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const HOST = () => ({ skeleton: { spine: '4.2.00' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }] });
const importInto = (src) => (s) => { const imp = clone(src); s.prefixRigNames(imp, 'imp_'); s.mergeRigInto(s.rawDoc, imp, 'root'); s.rebuildFromRawDoc(); };

// Every linked mesh of the LOADED data → the key of the mesh it is bound to.
function bindings(sd) {
	const where = new Map(), out = new Map();
	for (const skin of sd.skins) for (const e of skin.getAttachments()) where.set(e.attachment, key(skin.name, sd.slots[e.slotIndex].name, e.name));
	for (const skin of sd.skins) for (const e of skin.getAttachments()) {
		const parent = e.attachment.getParentMesh ? e.attachment.getParentMesh() : null;
		if (parent) out.set(key(skin.name, sd.slots[e.slotIndex].name, e.name), where.get(parent));
	}
	return out;
}
// After an action that renames skins/slots: every linked mesh still bound to the same mesh.
function sameBindings(what, before, mapKey) {
	const got = bindings(sandbox.skeletonData);
	for (const [child, parent] of before) {
		const c = mapKey(child), p = mapKey(parent);
		log(got.get(c) === p, `${what}: ${show(c)} is bound to ${show(got.get(c))}, expected ${show(p)}`);
	}
	log(got.size === before.size, `${what}: ${got.size} linked meshes load, expected ${before.size}`);
}
// The (non-linked) meshes a linked mesh on `slot` can borrow from, as the tool offers them.
const offeredOn = () => sandbox.sourceMeshCandidates().filter((c) => !c.def.sequence);

// ＋ Linked mesh onto source `c` with `skin` active on `slot`, set up by `session` (open / resume):
// the rig loads, exactly one attachment is added and none replaced, and it is bound to that source.
function checkAdd(session, doc, atlasText, skin, slot, c) {
	session(doc, atlasText, skin, slot);
	const before = clone(bagOf(sandbox.rawDoc, skin, slot));
	const what = `"${skin}" active: ＋ Linked mesh onto ${show(key(c.skin, c.slot, c.name))}`;
	const err = act((s) => s.addLinkedMesh(c.name, c.skin, c.def));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return;
	const after = bagOf(sandbox.rawDoc, skin, slot);
	const added = Object.keys(after).filter((n) => !(n in before));
	const replaced = Object.keys(before).filter((n) => canon(after[n]) !== canon(before[n]));
	if (!log(added.length === 1 && !replaced.length, `${what} — added [${added}] and REPLACED [${replaced}] in "${skin}"`)) return;
	// the loader binds a linked mesh named like the parent it looks up to ITSELF, without a word
	if (!log(key(skin, slot, added[0]) !== key(c.skin, slot, c.name), `${what} — the new linked mesh is its own parent`)) return;
	const got = bindings(sandbox.skeletonData).get(key(skin, slot, added[0]));
	log(got === key(c.skin, slot, c.name), `${what} — bound to ${show(got)}`);
}

// What the linked-mesh editor's source dropdown shows; a value no option carries shows nothing.
function pickerShows() {
	const det = element('div');
	sandbox.renderLinkedMeshEditor(det, null);
	const find = (el) => (el.tag === 'select' ? el : (el.children || []).map(find).find(Boolean));
	const sel = find(det);
	if (!sel) return '(no source picker)';
	return sel.children.some((o) => o.value === sel.value) ? sel.value : `(nothing — "${sel.value}" is not an option)`;
}

function checkRename(doc, atlasText, from, to) {
	open(doc, atlasText);
	const before = bindings(sandbox.skeletonData);
	const at = sandbox.rawDoc.skins.findIndex((s) => s.name === from);
	const what = `rename skin "${from}"`;
	const err = act((s) => s.renameSkin(from, to));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return;
	const now = sandbox.rawDoc.skins[at].name; // renameSkin cleans the name it is given
	if (!log(now !== from, `${what} — the skin kept its name`)) return;
	sameBindings(`${what} → "${now}"`, before, (k) => { const [skin, slot, name] = JSON.parse(k); return key(skin === from ? now : skin, slot, name); });
}
function checkDefaultKeepsItsName(what, doc, atlasText) {
	open(doc, atlasText);
	const before = canon(sandbox.rawDoc);
	const err = act((s) => s.renameSkin('default', 'base'));
	log(!err && canon(sandbox.rawDoc) === before, `${what}: renaming the default skin is refused and changes nothing${err ? ' — ' + err : ''}`);
}

// Import `src` into an empty rig through the shipped merge: every linked mesh keeps its parent.
function checkImport(what, src, atlasText) {
	const before = bindings(loadData(src, atlasText));
	open(HOST(), atlasText, 'default');
	const err = act(importInto(src));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return;
	sameBindings(what, before, (k) => { const [skin, slot, name] = JSON.parse(k); return key('imp_' + skin, 'imp_' + slot, name); });
}
// Then ＋ Linked mesh in every imported skin on every imported slot with a mesh — skins the rig did
// not open with. Returns how many were added.
function checkAddAfterImport(what, src, atlasText) {
	open(HOST(), atlasText, 'default');
	const err = act(importInto(src));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return 0;
	const merged = clone(sandbox.rawDoc);
	let added = 0;
	for (const skin of merged.skins.filter((s) => s.name.startsWith('imp_'))) for (const slot of merged.slots.map((s) => s.name)) {
		resume(merged, atlasText, skin.name, slot);
		for (const c of offeredOn()) { checkAdd(resume, merged, atlasText, skin.name, slot, c); added++; }
	}
	return added;
}

// The skin session: what the picker offers and shows, and what is on stage.
const offers = (what, want) =>
	log(JSON.stringify(picker.options) === JSON.stringify(want), `${what}: the picker offers [${picker.options}], expected [${want}]`);
function onStage(what, want) {
	const got = sandbox.skeleton.skin && sandbox.skeleton.skin.name;
	log(got === want && picker.value === want, `${what}: "${got}" is on stage and the picker shows "${picker.value}", expected "${want}"`);
}
const namesIn = (skin, slot) => Object.keys(sandbox.rawDoc.skins.find((s) => s.name === skin)?.attachments?.[slot] ?? {});
const otherSkins = (skin) => canon(sandbox.rawDoc.skins.filter((s) => s.name !== skin));
const PLACEMENT = [['x', 0], ['y', 0], ['rotation', 0], ['scaleX', 1], ['scaleY', 1]];
// What each skin draws on `slot` in the setup pose — the attachment's name, its art and where — as a
// fresh skeleton of the loaded data shows it with that skin set.
function drawnBySkin(slot) {
	const sd = sandbox.skeletonData, si = sd.slots.findIndex((s) => s.name === slot), sk = new SPINE.Skeleton(sd);
	return Object.fromEntries(sd.skins.map((skin) => {
		sk.setSkin(skin);
		sk.setSlotsToSetupPose();
		const a = sk.slots[si].attachment;
		return [skin.name, a ? JSON.stringify([a.name, a.path, ...PLACEMENT.map(([k]) => a[k])]) : null];
	}));
}
// ＋ add image of `region` on the selected slot: it lands in the skin on stage, placed like the image
// the slot showed — as spine-core resolves it, that skin's else default's — the stage draws it, and
// that skin stays on stage. In default it is a new attachment under the region's name and the
// slot's setup attachment. In any other skin it is that skin's override of the setup name (a slot
// without one gets a name no skin holds there), and every other skin draws exactly what it drew.
function checkAddImage(what, skin, region) {
	const slot = sandbox.selSlot, had = namesIn(skin, slot), others = otherSkins(skin);
	const si = sandbox.skeletonData.slots.findIndex((s) => s.name === slot);
	const setup = sandbox.skeletonData.slots[si].attachmentName;
	const shown = setup ? sandbox.skeleton.getAttachment(si, setup) : null;
	const drew = drawnBySkin(slot);
	const err = act((s) => s.attachRegion(region));
	if (!log(!err, `${what}: ＋ add image — the rig no longer loads: ${err}`)) return false;
	const setupNow = sandbox.skeletonData.slots[si].attachmentName;
	const name = skin === 'default' ? region : setup || setupNow;
	log(setupNow === name, `${what}: ＋ add image left the setup attachment of ${slot} "${setupNow}", expected "${name}"`);
	const now = namesIn(skin, slot), want = had.includes(name) ? had : [...had, name];
	log(now.join() === want.join(), `${what}: ＋ add image left [${now}] on ${slot} in "${skin}", expected [${want}]`);
	log(otherSkins(skin) === others, `${what}: ＋ add image changed a skin other than "${skin}"`);
	const drawn = sandbox.skeleton.slots[si].attachment;
	log(drawn && drawn.path === region, `${what}: ＋ add image — the stage draws ${drawn && drawn.path} on ${slot}, expected ${region}`);
	if (skin !== 'default') {
		const after = drawnBySkin(slot);
		const moved = Object.keys(drew).filter((k) => k !== skin && after[k] !== drew[k]);
		log(!moved.length, `${what}: ＋ add image changed what ${moved.map((k) => `"${k}" draws on ${slot} (${drew[k]} → ${after[k]})`).join(', ')}`);
	}
	if (shown instanceof SPINE.RegionAttachment) {
		const def = sandbox.rawDoc.skins.find((s) => s.name === skin).attachments[slot][name] ?? {};
		const lost = PLACEMENT.filter(([k, d]) => (def[k] ?? d) !== shown[k]).map(([k, d]) => `${k} ${def[k] ?? d} ≠ ${shown[k]}`);
		log(!lost.length, `${what}: ＋ add image on ${slot} did not keep the placement of the ${setup} it showed (${lost.join(', ')})`);
	}
	onStage(`${what}: ＋ add image`, skin);
	return true;
}

// A rig as an edit can change it: each attachment's raw entry, by key, and the rest.
const snapshot = (doc) => ({
	entries: new Map(doc.skins.flatMap((sk) => Object.entries(sk.attachments || {}).flatMap(([slot, bag]) => Object.entries(bag).map(([n, d]) => [key(sk.name, slot, n), JSON.stringify(d)])))),
	rest: JSON.stringify({ ...doc, skins: doc.skins.map((sk) => ({ ...sk, attachments: null })) }),
});
// The key of every attachment whose entry differs between two snapshots, and REST if the rest does.
const REST = 'the rest of the rig';
function changedBetween(a, b) {
	const out = [...new Set([...a.entries.keys(), ...b.entries.keys()])].filter((k) => a.entries.get(k) !== b.entries.get(k));
	if (a.rest !== b.rest) out.push(REST);
	return out.sort();
}
const showChange = (k) => (k === REST ? k : show(k));
// Where a world point sits in a quad of corners BL, UL, UR, BR: s along UL→UR, t along UL→BL.
function quadParams(q, x, y) {
	const ux = q[4] - q[2], uy = q[5] - q[3], vx = q[0] - q[2], vy = q[1] - q[3], dx = x - q[2], dy = y - q[3];
	const det = ux * vy - vx * uy;
	return { s: (dx * vy - vx * dy) / det, t: (ux * dy - dx * uy) / det };
}
const worst = (a, b) => (a.length === b.length ? Math.max(0, ...Array.from(a, (v, i) => Math.abs(v - b[i]))) : Infinity);
// ▸ Convert to mesh (`convert`) or ✎ Draw mesh (`draw`, clicking the image's corners and centre) on
// the selected slot, with the skin on stage it was opened with. The image the stage shows is
// `holder`'s — the skin on stage's if it has one of that name, else default's — and that entry alone
// (with `linked`, a text element's other locales in the same skin) must be rewritten, into a mesh of
// the same art that the stage then shows with the same skin on it: the vertices where the image was
// (or was clicked), and at each of them the texel the image drew there. Returns whether that texture
// mapping was checked, which is only on an untrimmed image.
function checkToMesh(what, action, holder, linked = []) {
	const skin = sandbox.skeleton.skin.name, slot = sandbox.selSlot;
	const si = sandbox.skeletonData.slots.findIndex((s) => s.name === slot);
	const name = sandbox.skeletonData.slots[si].attachmentName;
	const shown = sandbox.skeleton.getAttachment(si, name);
	const label = action === 'convert' ? '▸ Convert to mesh' : '✎ Draw mesh';
	if (!log(shown instanceof SPINE.RegionAttachment, `${what}: the stage shows ${shown && shown.constructor.name} on ${slot}, not an image`)) return false;
	const quad = new Array(8).fill(0);
	shown.computeWorldVertices(sandbox.skeleton.slots[si], quad, 0, 2);
	const clicked = [...quad, (quad[0] + quad[4]) / 2, (quad[1] + quad[5]) / 2];
	const before = snapshot(sandbox.rawDoc);
	const err = act((s) => {
		if (action === 'convert') return s.convertRegionToMesh();
		s.drawMeshMode = true;
		s.drawPoints = Array.from({ length: clicked.length / 2 }, (_, i) => ({ x: clicked[i * 2], y: clicked[i * 2 + 1] }));
		s.finishDrawMesh();
	});
	if (!log(!err, `${what}: ${label} on ${slot} — the rig no longer loads: ${err}`)) return false;
	const changed = changedBetween(before, snapshot(sandbox.rawDoc)), expected = [name, ...linked].map((n) => key(holder, slot, n)).sort();
	log(JSON.stringify(changed) === JSON.stringify(expected), `${what}: ${label} on ${slot} rewrote [${changed.map(showChange).join(', ')}], expected [${expected.map(show).join(', ')}]`);
	onStage(`${what}: ${label} on ${slot}`, skin);
	const now = sandbox.skeleton.getAttachment(si, name);
	if (!log(now instanceof SPINE.MeshAttachment, `${what}: after ${label} the stage shows ${now && now.constructor.name} on ${slot}, expected the new mesh`)) return false;
	log(now.path === shown.path, `${what}: after ${label} the stage's mesh on ${slot} shows ${now.path}, expected ${shown.path}`);
	// a drawn mesh has never taken the image's tint; a converted one does
	if (action === 'convert') log(worst([now.color.r, now.color.g, now.color.b, now.color.a], [shown.color.r, shown.color.g, shown.color.b, shown.color.a]) < 1e-6, `${what}: after ${label} the stage's mesh on ${slot} lost the image's tint`);
	const at = new Array(now.worldVerticesLength).fill(0);
	now.computeWorldVertices(sandbox.skeleton.slots[si], 0, now.worldVerticesLength, at, 0, 2);
	const r = shown.region, trimmed = r.offsetX !== 0 || r.offsetY !== 0 || r.width !== r.originalWidth || r.height !== r.originalHeight;
	if (action === 'draw') log(worst(at, clicked) < 1e-3, `${what}: after ${label} the stage's mesh on ${slot} is ${worst(at, clicked).toFixed(4)} off where it was clicked`);
	// A trimmed image's mesh spans the whole untrimmed image over the ink's quad (an open item), so its
	// texels are not the image's, and a fix may move its vertices.
	if (trimmed) return false;
	if (action === 'convert') log(worst(at, quad) < 1e-3, `${what}: after ${label} the stage's mesh on ${slot} is ${worst(at, quad).toFixed(4)} off the image's corners`);
	const uv = shown.uvs, texels = [];
	for (let i = 0; i < at.length; i += 2) {
		const { s, t } = quadParams(quad, at[i], at[i + 1]);
		texels.push(uv[2] + s * (uv[4] - uv[2]) + t * (uv[0] - uv[2]), uv[3] + s * (uv[5] - uv[3]) + t * (uv[1] - uv[3]));
	}
	log(worst(now.uvs, texels) < 1e-5, `${what}: after ${label} the stage's mesh on ${slot} samples texels up to ${worst(now.uvs, texels)} off the image's`);
	return true;
}

// The image the stage shows on `slot`: its runtime attachment, its world corners BL, UL, UR, BR, and
// its bone.
function stageImage(slot) {
	const si = sandbox.skeletonData.slots.findIndex((s) => s.name === slot);
	const name = sandbox.skeletonData.slots[si].attachmentName;
	const att = name ? sandbox.skeleton.getAttachment(si, name) : null;
	const quad = new Array(8).fill(0);
	if (att instanceof SPINE.RegionAttachment) att.computeWorldVertices(sandbox.skeleton.slots[si], quad, 0, 2);
	return { name, att, quad, bone: sandbox.skeleton.slots[si].bone };
}
// Where a point of the image (u across, v down, 0..1 of the UNTRIMMED image, which is what a pivot
// names) sits in the world, read off the quad spine-core draws — which covers the trimmed ink only.
function imagePoint({ att, quad }, [u, v]) {
	const r = att.region, s = (u * r.originalWidth - r.offsetX) / r.width, t = ((1 - v) * r.originalHeight - r.offsetY) / r.height;
	return [quad[0] + s * (quad[6] - quad[0]) + t * (quad[2] - quad[0]), quad[1] + s * (quad[7] - quad[1]) + t * (quad[3] - quad[1])];
}
// A held pivot is kept by rounding x and y to 0.01 in the bone's space: at most this far in the world.
const rounding = (bone) => 0.006 * (Math.hypot(bone.a, bone.c) + Math.hypot(bone.b, bone.d)) + 1e-9;
const entryOf = (skin, slot, name) => sandbox.rawDoc.skins.find((s) => s.name === skin)?.attachments?.[slot]?.[name];
const pivotOf = (def) => (Array.isArray(def?.pivot) ? def.pivot : [0.5, 0.5]);
// A copy of `doc` with a pivot on the image each slot shows, in each skin of `pivots` ([skin, [u, v]]).
function withPivots(doc, pivots) {
	const out = clone(doc);
	for (const slot of out.slots) for (const [skin, uv] of pivots) {
		const def = slot.attachment && out.skins.find((s) => s.name === skin)?.attachments?.[slot.name]?.[slot.attachment];
		if (def && (def.type ?? 'region') === 'region') def.pivot = uv;
	}
	return out;
}
// The placement fields on the image the stage shows on the selected slot, in turn. `holder` is the
// skin that image belongs to: each edit is written into its entry alone and shows on stage at once, a
// turn or a scale holds the pivot that entry names where it was, and after a rebuild the same skin is
// on stage showing the image where the edits left it.
const PLACE = [['x', (v) => v + 7], ['y', (v) => v - 5], ['rotation', (v) => v + 25], ['scaleX', (v) => v + 0.5], ['scaleY', (v) => v + 0.25]];
function checkPlace(what, holder) {
	const skin = sandbox.skeleton.skin.name, slot = sandbox.selSlot;
	let img = stageImage(slot);
	if (!log(img.att instanceof SPINE.RegionAttachment, `${what}: the stage shows ${img.att && img.att.constructor.name} on ${slot}, not an image`)) return;
	const want = [key(holder, slot, img.name)];
	let before = snapshot(sandbox.rawDoc);
	for (const [field, next] of PLACE) {
		// a move carries the pivot along; a turn or a scale holds it
		const v = next(img.att[field]), holds = field !== 'x' && field !== 'y';
		const uv = pivotOf(entryOf(holder, slot, img.name)), pivot = holds && imagePoint(img, uv);
		const label = `${what}: ${field} ${v} on ${slot}`;
		const err = act((s) => s.applyAttachmentEdit(field, String(v)));
		if (!log(!err, `${label} threw: ${err}`)) return;
		const after = snapshot(sandbox.rawDoc), changed = changedBetween(before, after);
		before = after;
		log(JSON.stringify(changed) === JSON.stringify(want), `${label} wrote [${changed.map(showChange).join(', ')}], expected [${want.map(show)}]`);
		img = stageImage(slot);
		log(img.att[field] === v, `${label}: the stage's image has ${field} ${img.att[field]}`);
		if (holds) {
			const off = worst(imagePoint(img, uv), pivot);
			log(off <= rounding(img.bone), `${label} moved the image's pivot [${uv}] by ${off}`);
		}
	}
	sandbox.rebuildFromRawDoc(null);
	onStage(`${what}: the placement fields on ${slot}, then a rebuild`, skin);
	const drift = worst(stageImage(slot).quad, img.quad);
	log(drift < 1e-9, `${what}: after a rebuild the image on ${slot} is ${drift} off where the placement fields left it`);
}
// ✥ A pivot chosen on the image the stage shows, which belongs to `holder`: the panel shows the pivot
// that entry names, the choice is written into it alone, the point chosen takes the old pivot's
// place, the panel then shows the choice, and after a rebuild the same skin is on stage showing the
// image where the choice moved it.
const PIVOT_TO = [0, 1];
function checkPivot(what, holder) {
	const skin = sandbox.skeleton.skin.name, slot = sandbox.selSlot, img = stageImage(slot);
	if (!log(img.att instanceof SPINE.RegionAttachment, `${what}: the stage shows ${img.att && img.att.constructor.name} on ${slot}, not an image`)) return;
	const want = [key(holder, slot, img.name)], label = `${what}: pivot [${PIVOT_TO}] on ${slot}`;
	const panel = () => JSON.stringify(sandbox.pivotUV(sandbox.pivotEditable()));
	const was = pivotOf(entryOf(holder, slot, img.name)), pivot = imagePoint(img, was), before = snapshot(sandbox.rawDoc);
	log(panel() === JSON.stringify(was), `${what}: the pivot panel shows ${panel()} on ${slot}, expected ${holder}'s [${was}]`);
	const err = act((s) => s.setPivotUV(...PIVOT_TO));
	if (!log(!err, `${label} threw: ${err}`)) return;
	const changed = changedBetween(before, snapshot(sandbox.rawDoc));
	log(JSON.stringify(changed) === JSON.stringify(want), `${label} wrote [${changed.map(showChange).join(', ')}], expected [${want.map(show)}]`);
	const moved = stageImage(slot), off = worst(imagePoint(moved, PIVOT_TO), pivot);
	log(off <= rounding(moved.bone), `${label}: the point chosen is ${off} off the pivot it replaced`);
	log(panel() === JSON.stringify(PIVOT_TO), `${label}: the pivot panel then shows ${panel()}`);
	sandbox.rebuildFromRawDoc(null);
	onStage(`${label}, then a rebuild`, skin);
	const drift = worst(stageImage(slot).quad, moved.quad);
	log(drift < 1e-9 && panel() === JSON.stringify(PIVOT_TO), `${label}: after a rebuild the image is ${drift} off where the choice moved it, and the pivot panel shows ${panel()}`);
}
// replace image (keep mesh) on the image the stage shows, which belongs to `holder`: that entry alone
// is re-pointed, at a region none of the slot's same-named images draws, and the same skin stays on
// stage showing it.
function checkReplace(what, holder) {
	const skin = sandbox.skeleton.skin.name, slot = sandbox.selSlot, { name } = stageImage(slot);
	const drawn = new Set(sandbox.rawDoc.skins.map((s) => s.attachments?.[slot]?.[name]).filter(Boolean).map((d) => d.path ?? name));
	const region = sandbox.__atlas.regions.find((r) => !drawn.has(r.name))?.name;
	if (!log(name && region, `${what}: nothing on ${slot} to replace, or no region to replace it with`)) return;
	const want = [key(holder, slot, name)], label = `${what}: replace image on ${slot} with ${region}`, before = snapshot(sandbox.rawDoc);
	const err = act((s) => s.replaceAttachmentImage(name, region));
	if (!log(!err, `${label} — the rig no longer loads: ${err}`)) return;
	const changed = changedBetween(before, snapshot(sandbox.rawDoc));
	log(JSON.stringify(changed) === JSON.stringify(want), `${label} re-pointed [${changed.map(showChange).join(', ')}], expected [${want.map(show)}]`);
	onStage(label, skin);
	const now = stageImage(slot).att;
	log(now && now.path === region, `${label}: the stage then shows ${now && now.path} there`);
}

// ---- (1) the synthetic rig ---------------------------------------------------------------------
const SYNTH_ATLAS = 'synth.png\nsize:64,64\nfilter:Linear,Linear\nbody\nbounds:0,0,16,16\ngold_body\nbounds:16,0,16,16\ntrim\nbounds:32,0,16,16\nplate\nbounds:48,0,16,16\narm\nbounds:0,16,16,16\n';
const quad = (path, w) => ({ type: 'mesh', path, width: w, height: w, hull: 4, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], vertices: [0, 0, w, 0, w, w, 0, w] });
const SYNTH = {
	skeleton: { spine: '4.2.00' },
	bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 30 }],
	slots: [{ name: 'body', bone: 'root', attachment: 'body' }, { name: 'arm', bone: 'arm', attachment: 'arm' }],
	skins: [
		{
			name: 'default', attachments: {
				body: { body: quad('body', 10), body_link: { type: 'linkedmesh', parent: 'body', path: 'body' } },
				arm: { arm: quad('arm', 50) },
			},
		},
		// `body` is named like default's, so a dropped `skin` silently binds default's instead;
		// `trim` is only here, so a dropped `skin` throws
		{
			name: 'gold', attachments: {
				body: { body: quad('gold_body', 20), trim: quad('trim', 30), trim_link: { type: 'linkedmesh', parent: 'trim', skin: 'gold', path: 'trim' } },
			},
		},
		// a linked mesh can also be written as a `mesh` with a `parent` — the loader treats it the same
		{ name: 'blue', attachments: { body: { plate: quad('plate', 40), plate_link: { type: 'mesh', parent: 'plate', skin: 'blue', path: 'plate' } } } },
	],
	animations: {
		shine: {
			attachments: {
				default: { body: { body: { deform: [{ time: 0 }, { time: 1, vertices: [1, 1] }] } } },
				gold: { body: { trim: { deform: [{ time: 0 }, { time: 1, vertices: [2, 2] }] } } },
			},
		},
	},
};
const SKINS = ['default', 'gold', 'blue'];
const BODY_SOURCES = [key('default', 'body', 'body'), key('gold', 'body', 'body'), key('gold', 'body', 'trim'), key('blue', 'body', 'plate')];

console.log('\n=== linked meshes — synthetic rig (skins default · gold · blue; a same-named and a skin-only mesh on one slot) ===');
log(bindings(loadData(SYNTH, SYNTH_ATLAS)).size === 3, 'the synthetic rig loads with its three linked meshes bound');

// ＋ Linked mesh, from every skin, onto every source it offers
for (const skin of SKINS) {
	open(SYNTH, SYNTH_ATLAS, skin, 'body');
	const keys = sandbox.sourceMeshCandidates().map((c) => key(c.skin, c.slot, c.name));
	log(JSON.stringify(keys) === JSON.stringify(BODY_SOURCES),
		`"${skin}" active: slot body offers [${keys.map(show)}], expected [${BODY_SOURCES.map(show)}] — a parent is only ever found on the linked mesh's own slot`);
	for (const c of offeredOn()) checkAdd(open, SYNTH, SYNTH_ATLAS, skin, 'body', c);
}

// The source picker: a linked mesh in each skin, shown right, then re-pointed at every source
for (const skin of SKINS) {
	const doc = clone(SYNTH);
	bagOf(doc, skin, 'body').pick = { type: 'linkedmesh', parent: 'body', path: 'body' }; // bound to default's body
	open(doc, SYNTH_ATLAS, skin, 'body');
	sandbox.meshCtx = { attName: 'pick' };
	const shown = pickerShows();
	log(shown === 'default›body', `"${skin}" active: the source picker shows ${shown} for a linked mesh bound to default's body`);
	for (const c of offeredOn()) {
		open(doc, SYNTH_ATLAS, skin, 'body');
		sandbox.meshCtx = { attName: 'pick' };
		const what = `"${skin}" active: source picker → ${show(key(c.skin, c.slot, c.name))}`;
		const err = act((s) => s.setLinkedMeshParent(c.name, c.skin, c.def));
		if (!log(!err, `${what} — the rig no longer loads: ${err}`)) continue;
		const got = bindings(sandbox.skeletonData).get(key(skin, 'body', 'pick'));
		log(got === key(c.skin, 'body', c.name), `${what} — bound to ${show(got)}`);
		const now = pickerShows();
		log(now === c.skin + '›' + c.name, `${what} — the picker then shows ${now}`);
	}
}

// ＋ Linked mesh in the skins an import brought in
const importedAdds = checkAddAfterImport('＋ Linked mesh in an imported skin', SYNTH, SYNTH_ATLAS);
log(importedAdds === 15, `＋ Linked mesh ran on ${importedAdds} source(s) across the imported skins, expected 15`);

// Renaming: the default skin keeps its name; any other takes every reference to it along
checkDefaultKeepsItsName('the synthetic rig', SYNTH, SYNTH_ATLAS);
for (const [from, to] of [['gold', 'golden'], ['blue', 'navy']]) checkRename(SYNTH, SYNTH_ATLAS, from, to);
{
	open(SYNTH, SYNTH_ATLAS, 'default');
	const err = act((s) => { s.renameSkin('gold', 'golden'); s.renameSkin('golden', 'gold'); });
	log(!err && canon(sandbox.rawDoc) === canon(SYNTH), `rename skin "gold" → "golden" → "gold" gives back the rig it started from${err ? ' — ' + err : ''}`);
}
{
	// a rig that lost its default skin gets it back: its references go implicit again
	const lost = clone(SYNTH);
	lost.skins[0].name = 'base';
	lost.skins[0].attachments.body.body_link.skin = 'base';
	lost.animations.shine.attachments = { base: lost.animations.shine.attachments.default, gold: lost.animations.shine.attachments.gold };
	checkRename(lost, SYNTH_ATLAS, 'base', 'default');
	log(canon(sandbox.rawDoc) === canon(SYNTH), 'rename skin "base" → "default" on a rig without one leaves exactly the rig with a default skin');
}

// Importing a rig whose linked mesh relies on the implicit default skin
checkImport('import the synthetic rig', SYNTH, SYNTH_ATLAS);

// A session of skin edits: the picker offers every skin the rig has after each one and shows the
// skin on stage, and every edit lands in that skin — which the rebuild after it keeps on stage.
console.log('\n=== skins — synthetic rig: ＋ Add skin · pick · ＋ add image · rig text · replace image · rename · delete · import ===');
{
	open(SYNTH, SYNTH_ATLAS, null, 'body');
	offers('open', SKINS);
	onStage('open', 'default');
	let err = act((s) => s.addSkin());
	const fresh = sandbox.rawDoc.skins.at(-1).name;
	if (log(!err, `＋ Add skin — the rig no longer loads: ${err}`)) {
		offers('＋ Add skin', [...SKINS, fresh]);
		onStage('＋ Add skin', 'default');
	}
	err = pick(fresh);
	log(!err, `pick "${fresh}" — ${err}`);
	onStage(`pick "${fresh}"`, fresh);
	// on arm, which default draws as a mesh: body is left for ⎘ Make skin-specific below
	sandbox.selSlot = 'arm';
	if (checkAddImage(`"${fresh}" on stage`, fresh, 'plate')) {
		const listed = sandbox.slotAttachmentList('arm').map((d) => d.skin + '›' + d.name);
		log(listed[0] === fresh + '›arm', `"${fresh}" on stage: the slot lists [${listed}], "${fresh}"'s image first`);
	}
	sandbox.selSlot = 'body';
	// The rig-text placement follows the same rule. (The tool places text right after a bake reloads
	// the rig, so with default on stage — this checks the rule, not that flow.) Two synthetic regions
	// stand in for two locales' art.
	let others = otherSkins(fresh);
	err = act((s) => s.placeTextAttachments({ id: 'title', sourceLocale: 'en', slot: 'text_title' }, [{ locale: 'en', region: 'trim' }, { locale: 'de', region: 'arm' }]));
	if (log(!err, `"${fresh}" on stage: rig text — the rig no longer loads: ${err}`)) {
		log(namesIn(fresh, 'text_title').join() === 'title@en,title@de', `"${fresh}" on stage: rig text left [${namesIn(fresh, 'text_title')}] in "${fresh}", expected [title@en,title@de]`);
		log(otherSkins(fresh) === others, `"${fresh}" on stage: rig text changed a skin other than "${fresh}"`);
		onStage(`"${fresh}" on stage: rig text`, fresh);
	}
	// ⎘ Make skin-specific copies default's mesh into the skin on stage, and replace image (keep mesh)
	// then re-points that copy — not default's
	sandbox.meshCtx = { attName: 'body' };
	err = act((s) => s.copyMeshToActiveSkin());
	if (log(!err && namesIn(fresh, 'body').includes('body'), `"${fresh}" on stage: ⎘ Make skin-specific left [${namesIn(fresh, 'body')}] on body${err ? ' — ' + err : ''}`)) {
		others = otherSkins(fresh);
		err = act((s) => s.replaceAttachmentImage('body', 'gold_body'));
		if (log(!err, `"${fresh}" on stage: replace image — the rig no longer loads: ${err}`)) {
			const path = sandbox.rawDoc.skins.find((s) => s.name === fresh).attachments.body.body.path;
			log(path === 'gold_body', `"${fresh}" on stage: replace image re-pointed "${fresh}"'s body at ${path}, expected gold_body`);
			log(otherSkins(fresh) === others, `"${fresh}" on stage: replace image changed a skin other than "${fresh}"`);
			onStage(`"${fresh}" on stage: replace image`, fresh);
		}
	}
	sandbox.meshCtx = null;
	const held = namesIn(fresh, 'body');
	err = act((s) => s.renameSkin(fresh, 'jade'));
	if (log(!err, `rename "${fresh}" → "jade" — the rig no longer loads: ${err}`)) {
		offers(`rename "${fresh}" → "jade"`, [...SKINS, 'jade']);
		onStage(`rename "${fresh}" → "jade"`, 'jade');
		log(namesIn('jade', 'body').join() === held.join(), `rename "${fresh}" → "jade": body holds [${namesIn('jade', 'body')}] in "jade", expected [${held}]`);
	}
	err = act((s) => s.deleteSkin('jade'));
	if (log(!err, `delete "jade" — the rig no longer loads: ${err}`)) {
		offers('delete "jade"', SKINS);
		onStage('delete "jade"', 'default');
		log(pick('jade') !== null, 'delete "jade": the picker still offers it');
	}
	// a game that sets no skin draws default, so it cannot be deleted while other skins exist
	const kept = canon(sandbox.rawDoc);
	err = act((s) => s.deleteSkin('default'));
	log(/default skin can't be deleted/.test(err ?? '') && canon(sandbox.rawDoc) === kept, `delete "default" is refused, says why and changes nothing — ${err}`);
	offers('delete "default"', SKINS);
	err = act(importInto(SYNTH));
	if (log(!err, `import — the rig no longer loads: ${err}`)) {
		offers('import', [...SKINS, ...SKINS.map((k) => 'imp_' + k)]);
		onStage('import', 'default');
		err = pick('imp_gold');
		log(!err, `pick "imp_gold" — ${err}`);
		sandbox.selSlot = 'imp_arm';
		checkAddImage('"imp_gold" on stage', 'imp_gold', 'plate');
	}
}

// ▸ Convert to mesh and ✎ Draw mesh rewrite the image the stage shows, in the skin it belongs to
console.log('\n=== mesh from an image — synthetic rig (skins default · gold, overriding its images · blue, holding none) ===');
const IMAGE_ATLAS = 'images.png\nsize:64,64\nfilter:Linear,Linear\nbody\nbounds:0,0,10,10\ngold_body\nbounds:16,0,30,30\ntitle_en\nbounds:0,32,24,8\ntitle_de\nbounds:0,48,32,8\n';
const IMAGES = {
	skeleton: { spine: '4.2.00' },
	bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 30, rotation: 20 }],
	slots: [{ name: 'body', bone: 'arm', attachment: 'body' }, { name: 'caption', bone: 'root', attachment: 'title@en' }],
	skins: [
		{
			name: 'default', attachments: {
				body: { body: { width: 10, height: 10 } },
				caption: { 'title@en': { path: 'title_en', width: 24, height: 8, y: 20 }, 'title@de': { path: 'title_de', width: 32, height: 8, y: 20 } },
			},
		},
		// default's names: `body` with other art, placement and tint, the text placed elsewhere
		{
			name: 'gold', attachments: {
				body: { body: { path: 'gold_body', width: 30, height: 30, x: 4, rotation: 15, color: 'ffcc00ff' } },
				caption: { 'title@en': { path: 'title_en', width: 24, height: 8, y: 40, scaleX: 2 }, 'title@de': { path: 'title_de', width: 32, height: 8, y: 40, scaleX: 2 } },
			},
		},
		{ name: 'blue', attachments: {} },
	],
};
// the rule goes by name: listed after gold, default still holds what the stage shows
const IMAGES_DEFAULT_SECOND = { ...IMAGES, skins: [IMAGES.skins[1], IMAGES.skins[0], IMAGES.skins[2]] };
// [rig, the skin on stage, the skin whose image the stage shows]: each skin on stage, in both orders
const ON_STAGE = [IMAGES, IMAGES_DEFAULT_SECOND].flatMap((doc) => ['default', 'gold', 'blue'].map((skin) => [doc, skin, skin === 'gold' ? 'gold' : 'default']));
const onStageIn = (doc, skin) => `"${skin}" on stage${doc === IMAGES ? '' : ', default listed second'}`;
for (const action of ['convert', 'draw']) for (const [doc, skin, holder] of ON_STAGE) {
	open(doc, IMAGE_ATLAS, skin, 'body');
	checkToMesh(onStageIn(doc, skin), action, holder);
}
// a text element's source locale takes its other locales along, as linked meshes in the same skin
sandbox.rigText.elements = [{ id: 'title', sourceLocale: 'en', slot: 'caption' }];
for (const [doc, skin, holder] of ON_STAGE) {
	open(doc, IMAGE_ATLAS, skin, 'caption');
	const what = `${onStageIn(doc, skin)}, text "title"`;
	checkToMesh(what, 'convert', holder, ['title@de']);
	const got = bindings(sandbox.skeletonData).get(key(holder, 'caption', 'title@de'));
	log(got === key(holder, 'caption', 'title@en'), `${what}: ${holder}'s title@de follows ${show(got)}, expected ${holder}'s title@en`);
}
sandbox.rigText.elements = [];
// ＋ add image is placed like the image the slot shows, which `rawDocAttEntry` resolves by the same rule
open(IMAGES, IMAGE_ATLAS, 'gold', 'body');
checkAddImage('"gold" on stage, overriding body', 'gold', 'gold_body');
open(IMAGES_DEFAULT_SECOND, IMAGE_ATLAS, 'blue', 'body');
checkAddImage('"blue" on stage, default listed second', 'blue', 'gold_body');

// The placement fields, the ✥ pivot and replace image edit the image the stage shows, in its skin
console.log('\n=== the image on stage — synthetic rig: placement fields · ✥ pivot · replace image ===');
// each rig again with a different pivot on each skin's image, so a pivot read from the wrong one shows
const PIVOTS = [['default', [1, 0]], ['gold', [1, 1]]];
for (const [doc, skin, holder] of ON_STAGE) for (const rig of [doc, withPivots(doc, PIVOTS)]) {
	for (const check of [checkPlace, checkPivot, checkReplace]) {
		open(rig, IMAGE_ATLAS, skin, 'body');
		check(onStageIn(doc, skin) + (rig === doc ? '' : ', pivoted'), holder);
	}
}

// ---- (2) the rig on the command line ---------------------------------------------------------
const [, , jsonPath, atlasPath] = process.argv;
if (jsonPath && atlasPath) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8')), atlasText = readFileSync(atlasPath, 'utf8');
	const name = jsonPath.split(/[\\/]/).pop();
	console.log(`\n=== linked meshes — ${jsonPath}: ${raw.skins.length} skin(s), ${bindings(loadData(raw, atlasText)).size} linked mesh(es) ===`);
	checkImport(`import ${name}`, raw, atlasText);
	const imported = checkAddAfterImport(`＋ Linked mesh in ${name}'s imported skins`, raw, atlasText);
	console.log(`  ＋ Linked mesh in the imported skins: ${imported} linked meshes`);
	for (const sk of raw.skins) {
		if (sk.name === 'default') checkDefaultKeepsItsName(name, raw, atlasText);
		else checkRename(raw, atlasText, sk.name, sk.name + '_renamed');
	}

	// ＋ Linked mesh from a skin added this session, on every slot with a mesh: onto that mesh, onto
	// a same-named copy in the new skin, and onto a copy only the new skin has
	open(raw, atlasText, 'default');
	const err = act((s) => s.addSkin());
	if (log(!err, `＋ Add skin — the rig no longer loads: ${err}`)) {
		const doc = clone(sandbox.rawDoc), fresh = doc.skins[doc.skins.length - 1].name;
		const meshSlots = [];
		for (const slot of doc.slots || []) {
			// a sequence mesh's frames resolve per frame, never through the `path` a linked mesh
			// copies (open item: ＋ Linked mesh onto one shows placeholder art)
			const src = doc.skins.flatMap((s) => Object.entries((s.attachments || {})[slot.name] || {}))
				.find(([, d]) => d && d.type === 'mesh' && !d.parent && !d.sequence);
			if (!src) continue;
			const copy = { ...clone(src[1]), path: src[1].path || src[0] }; // the image, not the new name
			Object.assign(bagOf(doc, fresh, slot.name), { [src[0]]: copy, [src[0] + '_' + fresh]: clone(copy) });
			meshSlots.push(slot.name);
		}
		const setupErr = act(() => loadData(doc, atlasText));
		if (!log(!setupErr, `the rig with copies in "${fresh}" does not load: ${setupErr}`)) meshSlots.length = 0;
		let added = 0;
		for (const slot of meshSlots) {
			resume(doc, atlasText, fresh, slot);
			const offered = offeredOn();
			log(offered.length >= 3 && offered.every((c) => c.slot === slot), `"${fresh}" active: slot ${slot} offers [${offered.map((c) => show(key(c.skin, c.slot, c.name)))}]`);
			for (const c of offered) { checkAdd(resume, doc, atlasText, fresh, slot, c); added++; }
		}
		console.log(`  ＋ Linked mesh from new skin "${fresh}": ${added} linked meshes over ${meshSlots.length} slot(s) with a mesh`);
	}

	// ＋ add image in default, then in a skin added this session and picked in the picker, on every
	// slot in turn
	open(raw, atlasText, 'default');
	{
		const region = atlasOf(atlasText).regions[0].name;
		let added = 0;
		for (const slot of raw.slots.map((s) => s.name)) {
			sandbox.selSlot = slot;
			if (!checkAddImage(`"default" on stage, slot ${slot}`, 'default', region)) break;
			added++;
		}
		console.log(`  ＋ add image in "default": ${added} of ${raw.slots.length} slot(s)`);
	}
	open(raw, atlasText, 'default');
	const addErr = act((s) => s.addSkin()) || pick(sandbox.rawDoc.skins.at(-1).name);
	if (log(!addErr, `＋ Add skin, then pick it — ${addErr}`)) {
		const fresh = sandbox.rawDoc.skins.at(-1).name, region = atlasOf(atlasText).regions[0].name;
		let added = 0;
		for (const slot of raw.slots.map((s) => s.name)) {
			sandbox.selSlot = slot;
			if (!checkAddImage(`"${fresh}" on stage, slot ${slot}`, fresh, region)) break;
			added++;
		}
		console.log(`  ＋ add image in new skin "${fresh}": ${added} of ${raw.slots.length} slot(s)`);
	}

	// ▸ Convert to mesh and ✎ Draw mesh on every slot showing an image, from a skin added this session:
	// holding nothing, so the stage shows default's image, and holding a same-named copy of it placed
	// elsewhere, which the stage shows instead
	open(raw, atlasText, 'default');
	const meshErr = act((s) => s.addSkin());
	if (log(!meshErr, `＋ Add skin — the rig no longer loads: ${meshErr}`)) {
		const bare = clone(sandbox.rawDoc), fresh = bare.skins.at(-1).name, own = clone(bare), slots = [];
		const base = bare.skins.find((s) => s.name === 'default');
		for (const slot of bare.slots || []) {
			const def = slot.attachment && base?.attachments?.[slot.name]?.[slot.attachment];
			// a sequence image is a run of regions, not one image
			if (!def || (def.type ?? 'region') !== 'region' || def.sequence) continue;
			bagOf(own, fresh, slot.name)[slot.attachment] = { ...clone(def), x: (def.x ?? 0) + 7, rotation: (def.rotation ?? 0) + 30 };
			slots.push(slot.name);
		}
		const sessions = [[bare, 'default', 'holding nothing'], [own, fresh, 'holding its own']];
		let mapped = 0;
		for (const [doc, holder, what] of sessions) for (const action of ['convert', 'draw']) {
			// one session per skin and action, over every slot in turn
			open(doc, atlasText, fresh);
			for (const slot of slots) {
				sandbox.selSlot = slot;
				if (checkToMesh(`"${fresh}" on stage, ${what}`, action, holder)) mapped++;
			}
		}
		console.log(`  ▸ Convert / ✎ Draw mesh from new skin "${fresh}": ${slots.length} slot(s) showing an image, in both skins; texels checked on ${mapped} of ${slots.length * 4} (the rest are trimmed)`);
		// then the placement fields, the ✥ pivot and replace image on those images, each skin's with a
		// pivot of its own — one session per skin, over every slot in turn
		for (const [doc, holder, what] of sessions) {
			open(withPivots(doc, [['default', [1, 0]], [fresh, [1, 1]]]), atlasText, fresh);
			for (const slot of slots) {
				sandbox.selSlot = slot;
				for (const check of [checkPlace, checkPivot, checkReplace]) check(`"${fresh}" on stage, ${what}`, holder);
			}
		}
		console.log(`  placement fields · ✥ pivot · replace image from new skin "${fresh}": ${slots.length} slot(s) showing an image, in both skins`);
	}
}

log(changesFromCode === 0, `the page fired the skin picker's change ${changesFromCode} time(s) from code`);
console.log(pass ? `\n✅ PASS — ${checks} checks; every linked mesh loads bound to the mesh the author picked, every new attachment lands in the skin on stage, every image edited or rewritten is the one the stage shows, and nothing else changes.` : `\n✗ FAIL (${checks} checks)`);
process.exit(pass ? 0 : 1);
