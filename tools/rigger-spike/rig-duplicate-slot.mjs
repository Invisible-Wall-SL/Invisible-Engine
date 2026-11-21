// The Rigger's slot duplicate (⧉ on a slot, and the FX auto-author that runs on it) against the clips'
// draw-order keys. A key's offsets name places in the slot list, so a slot put into the middle of it
// shifts every offset that spans its place: the runtime then reads a key with a hole in it (an
// `undefined` slot) and the game's rig player throws on it, or draws the slots in the wrong order.
//
// `duplicateSlotCore` is pulled out of the SHIPPED view.html and run on a rig whose clips have
// draw-order keys (the source moved to the front, another slot moved across it, the bottom slot moved
// to the top, a key back to the setup order, a clip without keys); every clip is then played by the
// REAL engine-rig (SkeletonJson → Skeleton → AnimationState) at every key. Asserted, for a copy put in
// front of its source ("after") and behind it ("before"), on the first, a middle and the last slot:
//  - every key's draw order is the one before the duplicate with the copy beside its source, and every
//    slot is drawn once;
//  - the setup order and the clips without keys are left;
//  - `mirrorRigSide`, which shares the rewrite, is checked by rig-mirror.mjs.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red, and a
// mutant whose text is no longer in the code fails the run.
//   node tools/rigger-spike/rig-duplicate-slot.mjs
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
const ATLAS = 'page.png\nsize:64,64\nfilter:Linear,Linear\npix\nbounds:0,0,8,8\n';
const stub = {
	getImage: () => ({ width: 64, height: 64 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};

/** The draw order (slot names) engine-rig plays for `anim` at `t`; setup when no clip. */
function drawnAt(doc, anim, t) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	const skel = new Skeleton(data);
	skel.setToSetupPose();
	if (anim) {
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, anim, false);
		state.update(t);
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	// What RigView does with each drawn slot first: a hole in the order throws here as it does there.
	return skel.drawOrder.map((s) => s.data.name);
}

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
const ENTRY = ['duplicateSlotCore'];
/** The shipped function in a fresh context; `mutate` swaps [from, to] text in the pulled source. */
function sandbox(mutate = []) {
	const pulled = [];
	const seen = new Set();
	for (const q = [...ENTRY]; q.length;) {
		const name = q.shift();
		if (seen.has(name)) continue;
		if (!TOP.has(name)) throw new Error(`${name} not found in view.html`);
		seen.add(name);
		const src = pull(name);
		pulled.push({ at: TOP.get(name).at, src });
		for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
			const t = TOP.get(m[1]);
			if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1])) q.push(m[1]);
		}
	}
	let src = pulled
		.sort((a, b) => a.at - b.at)
		.map((p) => p.src)
		.join('\n');
	for (const [from, to] of mutate) {
		if (!src.includes(from)) throw new Error(`mutant: "${from}" is not in the pulled source`);
		src = src.replace(from, to);
	}
	const ui = { rawDoc: null };
	vm.createContext(ui);
	vm.runInContext(`${src}\n;globalThis.duplicateSlotCore = duplicateSlotCore;`, ui, {
		filename: 'view.html#rig-duplicate-slot',
	});
	return ui;
}

// ------------------------------------------------------------------------------------- the rig
// Five slots on one bone, a region each. Clips: `walk` keys the source to the front, then a slot from
// below across it, then the bottom slot to the top, then the setup order again; `still` has no keys.
const NAMES = ['back', 'body', 'arm', 'head', 'hat'];
const region = { type: 'region', name: 'pix', width: 8, height: 8 };
const offsetsOf = (order) =>
	NAMES.flatMap((n, i) =>
		order.indexOf(n) !== i ? [{ slot: n, offset: order.indexOf(n) - i }] : [],
	);
const KEYS = [
	{ time: 0, order: ['back', 'body', 'head', 'hat', 'arm'] },
	{ time: 0.25, order: ['body', 'arm', 'head', 'back', 'hat'] },
	{ time: 0.5, order: ['hat', 'back', 'body', 'arm', 'head'] },
	{ time: 0.75, order: ['back', 'arm', 'hat', 'body', 'head'] },
	{ time: 1, order: null },
];
const RIG_DOC = {
	skeleton: { spine: '4.2.43' },
	bones: [{ name: 'root' }],
	slots: NAMES.map((n) => ({ name: n, bone: 'root', attachment: 'pix' })),
	skins: [
		{ name: 'default', attachments: Object.fromEntries(NAMES.map((n) => [n, { pix: region }])) },
	],
	animations: {
		walk: {
			slots: {
				arm: {
					rgba: [
						{ time: 0, color: 'ffffffff' },
						{ time: 1, color: 'ff0000ff' },
					],
				},
			},
			drawOrder: KEYS.map((k) =>
				k.order ? { time: k.time, offsets: offsetsOf(k.order) } : { time: k.time },
			),
		},
		still: { slots: { body: { rgba: [{ time: 0, color: 'ffffffff' }] } } },
	},
};
const SETUP = drawnAt(RIG_DOC, null, 0);
const PLAYED = KEYS.map((k) => drawnAt(RIG_DOC, 'walk', k.time));
check(
	KEYS.every((k, i) => JSON.stringify(PLAYED[i]) === JSON.stringify(k.order || NAMES)),
	'the rig’s own keys play the orders they were written for',
);

/** Duplicate `src` as `name` with the shipped core; every clip's draw order played at every key. */
function duplicate(ui, src, name, position) {
	const doc = clone(RIG_DOC);
	ui.rawDoc = doc;
	ui.duplicateSlotCore(src, name, position);
	const at = (anim, t) => {
		try {
			return drawnAt(doc, anim, t);
		} catch (e) {
			return `threw: ${String(e.message).slice(0, 70)}`;
		}
	};
	return {
		doc,
		setup: at(null, 0),
		walk: KEYS.map((k) => at('walk', k.time)),
		still: at('still', 0.5),
	};
}
const beside = (order, src, name, position) =>
	order.flatMap((n) => (n !== src ? [n] : position === 'before' ? [name, n] : [n, name]));
const CASES = [
	['arm', 'after'],
	['arm', 'before'],
	['back', 'after'],
	['back', 'before'],
	['hat', 'after'],
	['hat', 'before'],
];
const said = new Set();
const say = (msg) => {
	if (said.has(msg)) return;
	said.add(msg);
	console.log(`      ${msg}`);
};
const GUARDS = {
	/** Every key's order is the old one with the copy beside its source, each slot drawn once. */
	keys(ui, loud) {
		return CASES.map(([src, position]) => {
			const name = `${src}_fx`;
			const got = duplicate(ui, src, name, position);
			return KEYS.map((k, i) => {
				const want = beside(PLAYED[i], src, name, position);
				const ok = JSON.stringify(got.walk[i]) === JSON.stringify(want);
				if (!ok && loud)
					say(
						`⧉ ${src} (${position}) at ${k.time}: drawn ${JSON.stringify(got.walk[i])}, want ${JSON.stringify(want)}`,
					);
				return ok;
			}).every(Boolean);
		}).every(Boolean);
	},
	/** The setup order has the copy beside its source; a clip without keys plays the setup order. */
	setup(ui) {
		return CASES.every(([src, position]) => {
			const name = `${src}_fx`;
			const got = duplicate(ui, src, name, position);
			const want = beside(SETUP, src, name, position);
			return (
				JSON.stringify(got.setup) === JSON.stringify(want) &&
				JSON.stringify(got.still) === JSON.stringify(want) &&
				!got.doc.animations.still.drawOrder &&
				!('offsets' in got.doc.animations.walk.drawOrder[4])
			);
		});
	},
};

console.log('\nDuplicate a slot under draw-order keys (engine-rig plays every clip at every key)');
check(
	GUARDS.keys(sandbox(), true),
	'every key: the order it had, with the copy beside its source, in front ("after") or behind ("before"), on the bottom, a middle and the top slot',
);
check(
	GUARDS.setup(sandbox()),
	'the setup order has the copy beside its source; a clip without keys and a key back to the setup are left so',
);

console.log('\nMutations, each must fail');
const MUTANTS = [
	[
		'keys',
		'draw-order keys left as they were',
		[
			'    fr.offsets = faceOrderOffsets(newNames, place(order));',
			'    if (false) fr.offsets = faceOrderOffsets(newNames, place(order));',
		],
	],
	[
		'keys',
		'the copy left out of the keys',
		['position === "before" ? [newName, n] : [n, newName]', '[n]'],
	],
	[
		'keys',
		'the copy on the wrong side in the keys',
		[
			'position === "before" ? [newName, n] : [n, newName]',
			'position === "before" ? [n, newName] : [newName, n]',
		],
	],
	[
		'keys',
		'the orders read after the slot went in',
		['  insert();\n  const newNames', '  const newNames'],
	],
	[
		'setup',
		'the copy on the wrong side in the list',
		['position === "before" ? idx : idx + 1', 'position === "before" ? idx + 1 : idx'],
	],
];
for (const [id, what, swap] of MUTANTS) {
	let red;
	let threw = '';
	try {
		red = !GUARDS[id](sandbox([swap]));
	} catch (e) {
		red = !String(e.message).startsWith('mutant:');
		threw = ` (threw: ${String(e.message).slice(0, 60)})`;
	}
	check(red, `${id} ✗ under "${what}"${threw}`);
}

console.log(`\n${failed === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - failed}/${checks} checks`);
process.exit(failed === 0 ? 0 : 1);
