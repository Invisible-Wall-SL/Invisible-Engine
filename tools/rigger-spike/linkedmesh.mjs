// Verify linked-mesh authoring headlessly, on the SHIPPED code: every function the linked-mesh
// actions reach is pulled out of view.html (transitively), the rebuild is stubbed with the official
// spine-core 4.2 loader, and each action must leave a rig that LOADS with every linked mesh bound
// to the parent the author meant.
//
// The crux, read off SkeletonJson ("Linked meshes"): the parent is looked up by NAME in the linked
// mesh's OWN slot, in the skin its `skin` names — and an ABSENT `skin` means the DEFAULT skin, not
// the skin the linked mesh sits in. So a parent in any other skin, the active one included, must be
// named: without it the load throws "Parent mesh not found", or — when default holds a same-named
// mesh on that slot — silently binds the linked mesh to THAT one.
//
// A synthetic three-skin rig always runs: ＋ Linked mesh and the source picker from every skin onto
// every source they offer, the source the picker shows, skin rename (default included, with its
// animation keys), and importing a rig that relies on the implicit default. The rig on the command
// line then gets the import, a rename of every skin, and ＋ Linked mesh from a fresh skin on every
// slot with a mesh.
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
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton } = await import(SPINE_CORE);

const clone = (o) => JSON.parse(JSON.stringify(o));
function loadData(obj, atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 2048, height: 2048 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) { p.width = p.width || 2048; p.height = p.height || 2048; try { p.setTexture(stub); } catch { p.texture = stub; } }
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(obj));
}

// ---- pull the SHIPPED linked-mesh actions (and everything they call) out of view.html -------
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
// The UI around an action: the rebuild is where the real tool would throw, so it LOADS the doc.
const STUBS = new Set(['rebuildFromRawDoc', 'markDirty', 'selectSlot', 'renderSlotDetail']);
const ENTRY = ['sourceMeshCandidates', 'addLinkedMesh', 'setLinkedMeshParent', 'renderLinkedMeshEditor', 'renameSkin', 'addSkin', 'prefixRigNames', 'mergeRigInto'];
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
let activeSkin = 'default'; // what the skin picker (#skin) shows
const element = (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); return c; } });
const sandbox = {
	rawDoc: null, skeletonData: null, skeleton: null, selSlot: null, selBone: null, meshCtx: null,
	$: (sel) => (sel === '#skin' ? { value: activeSkin } : null),
	document: { createElement: element, createTextNode: (text) => ({ text }) },
	markDirty() {}, selectSlot() {}, renderSlotDetail() {},
	// Re-read the doc exactly as the tool does — a throw here is the author's error dialog — and
	// restore the skin the picker shows.
	rebuildFromRawDoc() {
		const sd = loadData(sandbox.rawDoc, sandbox.__atlas), sk = new Skeleton(sd);
		const skin = sd.skins.find((s) => s.name === activeSkin) || sd.skins.find((s) => s.name === 'default') || sd.skins[0];
		if (skin) sk.setSkin(skin);
		sk.setToSetupPose();
		Object.assign(sandbox, { skeletonData: sd, skeleton: sk });
	},
	__atlas: '',
};
vm.createContext(sandbox);
vm.runInContext(pulled.join('\n'), sandbox, { filename: 'view.html#linkedmesh' });

// ---- helpers ---------------------------------------------------------------------------------
let pass = true, checks = 0;
const log = (ok, msg) => { checks++; if (!ok) { console.log('  ✗ ' + msg); pass = false; } return ok; };

function open(doc, atlasText, skin, slot = null) {
	activeSkin = skin;
	Object.assign(sandbox, { rawDoc: clone(doc), __atlas: atlasText, selSlot: slot, selBone: null, meshCtx: null });
	sandbox.rebuildFromRawDoc();
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

// ＋ Linked mesh onto source `c` with `skin` active on `slot`: the rig loads and the new linked
// mesh is bound to exactly that source.
function checkAdd(doc, atlasText, skin, slot, c) {
	open(doc, atlasText, skin, slot);
	const before = new Set(Object.keys(bagOf(sandbox.rawDoc, skin, slot)));
	const what = `"${skin}" active: ＋ Linked mesh onto ${show(key(c.skin, c.slot, c.name))}`;
	const err = act((s) => s.addLinkedMesh(c.name, c.skin, c.def));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return;
	const added = Object.keys(bagOf(sandbox.rawDoc, skin, slot)).filter((n) => !before.has(n));
	if (!log(added.length === 1, `${what} — added [${added}] to "${skin}", expected one attachment`)) return;
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
	open(doc, atlasText, 'default');
	const before = bindings(sandbox.skeletonData);
	const what = `rename skin "${from}" → "${to}"`;
	const err = act((s) => s.renameSkin(from, to));
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return;
	log(sandbox.rawDoc.skins.some((s) => s.name === to) && !sandbox.rawDoc.skins.some((s) => s.name === from), `${what} — the skin was not renamed`);
	sameBindings(what, before, (k) => { const [skin, slot, name] = JSON.parse(k); return key(skin === from ? to : skin, slot, name); });
}

// Import `src` into an empty rig through the shipped merge; returns how many linked meshes it had.
function checkImport(what, src, atlasText) {
	const host = { skeleton: { spine: '4.2.00' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }] };
	const before = bindings(loadData(src, atlasText));
	open(host, atlasText, 'default');
	const err = act((s) => { const imp = clone(src); s.prefixRigNames(imp, 'imp_'); s.mergeRigInto(s.rawDoc, imp, 'root'); s.rebuildFromRawDoc(); });
	if (!log(!err, `${what} — the rig no longer loads: ${err}`)) return before.size;
	sameBindings(what, before, (k) => { const [skin, slot, name] = JSON.parse(k); return key('imp_' + skin, 'imp_' + slot, name); });
	return before.size;
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
		{ name: 'blue', attachments: { body: { plate: quad('plate', 40) } } },
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
log(bindings(loadData(SYNTH, SYNTH_ATLAS)).size === 2, 'the synthetic rig loads with its two linked meshes bound');

// ＋ Linked mesh, from every skin, onto every source it offers
for (const skin of SKINS) {
	open(SYNTH, SYNTH_ATLAS, skin, 'body');
	const offered = sandbox.sourceMeshCandidates();
	const keys = offered.map((c) => key(c.skin, c.slot, c.name));
	log(JSON.stringify(keys) === JSON.stringify(BODY_SOURCES),
		`"${skin}" active: slot body offers [${keys.map(show)}], expected [${BODY_SOURCES.map(show)}] — a parent is only ever found on the linked mesh's own slot`);
	for (const c of offered) checkAdd(SYNTH, SYNTH_ATLAS, skin, 'body', c);
}

// The source picker: a linked mesh in each skin, shown right, then re-pointed at every source
for (const skin of SKINS) {
	const doc = clone(SYNTH);
	bagOf(doc, skin, 'body').pick = { type: 'linkedmesh', parent: 'body', path: 'body' }; // bound to default's body
	open(doc, SYNTH_ATLAS, skin, 'body');
	sandbox.meshCtx = { attName: 'pick' };
	const shown = pickerShows();
	log(shown === 'default›body', `"${skin}" active: the source picker shows ${shown} for a linked mesh bound to default's body`);
	for (const c of sandbox.sourceMeshCandidates()) {
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

// Renaming a skin carries every reference to it, the implicit default included
for (const [from, to] of [['default', 'base'], ['gold', 'golden'], ['blue', 'navy']]) checkRename(SYNTH, SYNTH_ATLAS, from, to);
{
	open(SYNTH, SYNTH_ATLAS, 'default');
	const err = act((s) => { s.renameSkin('default', 'base'); s.renameSkin('base', 'default'); });
	log(!err && canon(sandbox.rawDoc) === canon(SYNTH), `rename skin "default" → "base" → "default" gives back the rig it started from${err ? ' — ' + err : ''}`);
}

// Importing a rig whose linked mesh relies on the implicit default skin
checkImport('import the synthetic rig', SYNTH, SYNTH_ATLAS);

// ---- (2) the rig on the command line ---------------------------------------------------------
const [, , jsonPath, atlasPath] = process.argv;
if (jsonPath && atlasPath) {
	const raw = JSON.parse(readFileSync(jsonPath, 'utf8')), atlasText = readFileSync(atlasPath, 'utf8');
	const linkedIn = bindings(loadData(raw, atlasText)).size;
	console.log(`\n=== linked meshes — ${jsonPath}: ${raw.skins.length} skin(s), ${linkedIn} linked mesh(es) ===`);
	checkImport(`import ${jsonPath.split(/[\\/]/).pop()}`, raw, atlasText);
	for (const sk of raw.skins) checkRename(raw, atlasText, sk.name, sk.name + '_renamed');

	// ＋ Linked mesh from a fresh skin on every slot with a mesh: onto that mesh, onto a same-named
	// copy in the fresh skin, and onto a copy only the fresh skin has
	open(raw, atlasText, 'default');
	const err = act((s) => s.addSkin());
	if (log(!err, `＋ Add skin — the rig no longer loads: ${err}`)) {
		const doc = clone(sandbox.rawDoc), fresh = doc.skins[doc.skins.length - 1].name;
		const meshSlots = [];
		for (const slot of doc.slots || []) {
			// a sequence mesh's frames resolve per frame, never through the `path` a linked mesh copies
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
			open(doc, atlasText, fresh, slot);
			const offered = sandbox.sourceMeshCandidates().filter((c) => !c.def.sequence);
			log(offered.length >= 3 && offered.every((c) => c.slot === slot), `"${fresh}" active: slot ${slot} offers [${offered.map((c) => show(key(c.skin, c.slot, c.name)))}]`);
			for (const c of offered) { checkAdd(doc, atlasText, fresh, slot, c); added++; }
		}
		console.log(`  ＋ Linked mesh from fresh skin "${fresh}": ${added} linked meshes over ${meshSlots.length} slot(s) with a mesh`);
	}
}

console.log(pass ? `\n✅ PASS — ${checks} checks; every linked mesh loads, bound to the mesh the author picked.` : `\n✗ FAIL (${checks} checks)`);
process.exit(pass ? 0 : 1);
