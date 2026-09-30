// Verify linked-mesh and skin authoring headlessly, on the SHIPPED code: every function the actions
// reach is pulled out of view.html (transitively), the rebuild runs as shipped but through the
// strict spine-core 4.2 loader, and each action must leave a rig that LOADS with every linked mesh
// bound to the parent the author meant, in the skin on stage — without replacing anything there.
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
const ENTRY = ['sourceMeshCandidates', 'addLinkedMesh', 'setLinkedMeshParent', 'renderLinkedMeshEditor', 'addSkin', 'renameSkin', 'deleteSkin', 'setActiveSkin', 'renderSkinPicker', 'attachRegion', 'placeTextAttachments', 'copyMeshToActiveSkin', 'replaceAttachmentImage', 'prefixRigNames', 'mergeRigInto'];
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
// ＋ add image of `region` on the selected slot: it lands in the skin on stage, as one new
// attachment, placed like the image the slot showed — as spine-core resolves it, that skin's else
// default's — and that skin stays on stage.
function checkAddImage(what, skin, region) {
	const slot = sandbox.selSlot, had = namesIn(skin, slot), others = otherSkins(skin);
	const si = sandbox.skeletonData.slots.findIndex((s) => s.name === slot);
	const setup = sandbox.skeletonData.slots[si].attachmentName;
	const shown = setup ? sandbox.skeleton.getAttachment(si, setup) : null;
	const err = act((s) => s.attachRegion(region));
	if (!log(!err, `${what}: ＋ add image — the rig no longer loads: ${err}`)) return false;
	const now = namesIn(skin, slot);
	log(now.length === had.length + 1 && now.includes(region), `${what}: ＋ add image left [${now}] on ${slot} in "${skin}", expected [${had}] + ${region}`);
	log(otherSkins(skin) === others, `${what}: ＋ add image changed a skin other than "${skin}"`);
	if (shown instanceof SPINE.RegionAttachment) {
		const def = sandbox.rawDoc.skins.find((s) => s.name === skin).attachments[slot][region];
		const lost = PLACEMENT.filter(([k, d]) => (def[k] ?? d) !== shown[k]).map(([k, d]) => `${k} ${def[k] ?? d} ≠ ${shown[k]}`);
		log(!lost.length, `${what}: ＋ add image on ${slot} did not keep the placement of the ${setup} it showed (${lost.join(', ')})`);
	}
	onStage(`${what}: ＋ add image`, skin);
	return true;
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
	if (checkAddImage(`"${fresh}" on stage`, fresh, 'plate')) {
		const listed = sandbox.slotAttachmentList('body').map((d) => d.skin + '›' + d.name);
		log(listed[0] === fresh + '›plate', `"${fresh}" on stage: the slot lists [${listed}], "${fresh}"'s image first`);
	}
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

	// ＋ add image in a skin added this session and picked in the picker, on every slot in turn
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
}

log(changesFromCode === 0, `the page fired the skin picker's change ${changesFromCode} time(s) from code`);
console.log(pass ? `\n✅ PASS — ${checks} checks; every linked mesh loads bound to the mesh the author picked, every edit lands in the skin on stage, and nothing is replaced.` : `\n✗ FAIL (${checks} checks)`);
process.exit(pass ? 0 : 1);
