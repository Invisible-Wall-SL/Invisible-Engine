// The Rigger's slot duplicate (⧉ on a slot, and the FX auto-author that runs on it) and slot reorder
// (↑ / ↓ in the slot list) against the clips' draw-order keys. A key's offsets name places in the slot
// list, so a slot put into the middle of it, or two slots swapped, shifts every offset that spans those
// places: the runtime then reads a key with a hole in it (an `undefined` slot) and the game's rig
// player throws on it, or draws the slots in the wrong order.
//
// `duplicateSlotCore` is pulled out of the SHIPPED view.html and run on a rig whose clips have
// draw-order keys (the source moved to the front, another slot moved across it, the bottom slot moved
// to the top, a key back to the setup order, a clip without keys); every clip is then played by the
// REAL engine-rig (SkeletonJson → Skeleton → AnimationState) at every key. Asserted, for a copy put in
// front of its source ("after") and behind it ("before"), on the first, a middle and the last slot:
//  - every key's draw order is the one before the duplicate with the copy beside its source, and every
//    slot is drawn once;
//  - the setup order and the clips without keys are left;
//  - `moveSlot` (↑ / ↓) on the bottom, a middle and the top slot changes the setup order only: every
//    key draws the order it was keyed with, and a key back to the setup (no offsets) and a clip without
//    keys draw the new setup order;
//  - `mirrorRigSide`, which shares the rewrite, is checked by rig-mirror.mjs.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red, and a
// mutant whose text is no longer in the code fails the run.
//   node tools/rigger-spike/rig-duplicate-slot.mjs
import { RIG_CORE } from './rig.mjs';
import { viewSandbox } from './view-sandbox.mjs';

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
	// SkeletonJson walks a key's offsets in slot order: one out of order makes it grow an array toward
	// 2^32 before it throws "Invalid array length" (minutes, and gigabytes). Refused here as it would end.
	const index = new Map(doc.slots.map((s, i) => [s.name, i]));
	for (const a of Object.values(doc.animations || {}))
		for (const k of a.drawOrder || [])
			(k.offsets || []).forEach((o, i, all) => {
				if (i > 0 && index.get(o.slot) <= index.get(all[i - 1].slot))
					throw new Error('Invalid array length (a draw-order key’s offsets out of slot order)');
			});
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
const ENTRY = ['duplicateSlotCore', 'moveSlot'];
/** The shipped function in a fresh context; `mutate` swaps [from, to] text in the pulled source. */
const sandbox = (mutate = []) =>
	viewSandbox({
		entry: ENTRY,
		globals: { rawDoc: null, selSlot: null, selBone: null, skeletonData: null },
		stubs: ['rebuildFromRawDoc', 'markDirty'],
		mutate,
		label: 'rig-duplicate-slot',
	});

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
/** ↑ / ↓ the slot at `z` with the shipped `moveSlot`; every clip played as above. */
function move(ui, z, dir) {
	const doc = clone(RIG_DOC);
	ui.rawDoc = doc;
	ui.moveSlot(z, dir);
	const at = (anim, t) => {
		try {
			return drawnAt(doc, anim, t);
		} catch (e) {
			return `threw: ${String(e.message).slice(0, 70)}`;
		}
	};
	return { setup: at(null, 0), walk: KEYS.map((k) => at('walk', k.time)), still: at('still', 0.5) };
}
const swapped = (z, dir) => {
	const o = [...SETUP];
	[o[z], o[z + dir]] = [o[z + dir], o[z]];
	return o;
};
const MOVES = [
	[0, 1],
	[2, 1],
	[2, -1],
	[4, -1],
];
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
	/** ↑ / ↓ changes the setup order only: each key draws what it was keyed with. */
	move(ui, loud) {
		return MOVES.map(([z, dir]) => {
			const got = move(ui, z, dir);
			const setup = swapped(z, dir);
			const keyed = KEYS.map((k, i) => {
				const want = k.order ? PLAYED[i] : setup;
				const ok = JSON.stringify(got.walk[i]) === JSON.stringify(want);
				if (!ok && loud)
					say(
						`${dir < 0 ? '↑' : '↓'} ${SETUP[z]} at ${k.time}: drawn ${JSON.stringify(got.walk[i])}, want ${JSON.stringify(want)}`,
					);
				return ok;
			});
			return (
				keyed.every(Boolean) &&
				JSON.stringify(got.setup) === JSON.stringify(setup) &&
				JSON.stringify(got.still) === JSON.stringify(setup)
			);
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

console.log('\nMove a slot (↑ / ↓) under draw-order keys');
check(
	GUARDS.move(sandbox(), true),
	'the setup order swaps; every key draws the order it was keyed with; a key back to the setup and a clip without keys draw the new setup',
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
		['  change();\n  const newNames', '  const newNames'],
	],
	[
		'setup',
		'the copy on the wrong side in the list',
		['position === "before" ? idx : idx + 1', 'position === "before" ? idx + 1 : idx'],
	],
	[
		'move',
		'the keys left as they were under a move',
		[
			'changeSlotsKeepingDrawOrder(rawDoc, () => { const tmp = rawDoc.slots[z]; rawDoc.slots[z] = rawDoc.slots[j]; rawDoc.slots[j] = tmp; });',
			'const tmp = rawDoc.slots[z]; rawDoc.slots[z] = rawDoc.slots[j]; rawDoc.slots[j] = tmp;',
		],
	],
	[
		'move',
		'a key back to the setup given the old order',
		[
			'if (Array.isArray(fr.offsets) && fr.offsets.length) ordered.push({ fr, order: drawOrderOfOffsets(fr.offsets, oldNames)',
			'ordered.push({ fr, order: (!(fr.offsets && fr.offsets.length) ? oldNames.map((n, i) => i) : drawOrderOfOffsets(fr.offsets, oldNames))',
		],
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
