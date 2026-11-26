/**
 * A rig's control layer, `controls.json` (docs/design/rig-controls.md §5.7, C1), offline:
 *   pnpm --filter launcher-api check:rig-controls
 *
 *  1. Its schema refuses what it does not know, in the wrong shape, or inconsistent with itself.
 *  2. Read against its `.irig`: a name the irig lacks is refused on write (`controlsIrigProblems`)
 *     and dropped, as little as possible with it, on read (`fitControls`).
 *  3. Renames in the irig, as the Rigger makes them, follow into it (`renamesBetween`); a delete, an
 *     add, or a rename that also moved the bone does not.
 *  4. The runtime never reads it: the real `exportRigBundle` writes the same keys and bytes for a
 *     bundle with `controls.json` as without, and engine-rig loads the exported skeleton with the
 *     strict irig reader and poses it exactly as the rig alone, every bone, every clip.
 *
 * The routes that read and write it are `check-rigger-writes.ts`'s.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import {
	AnimationState,
	AnimationStateData,
	AtlasAttachmentLoader,
	Physics,
	Skeleton,
	SkeletonJson,
	TextureAtlas,
	readIrig,
} from 'engine-rig';
import {
	CONTROLS_SIDECAR,
	checkedControls,
	controlsDocProblems,
	controlsIrigProblems,
	fitControls,
	fitSlotFolders,
	renameControls,
	renamesBetween,
	type ControlsDoc,
} from '../src/lib/rigControls.ts';
import {
	REGIONS,
	controlsIrig,
	controlsOf,
	deletedBone,
	renamedBone,
	renamedConstraint,
} from './lib/rigControlsFixture.ts';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

type Json = Record<string, unknown>;
/** Set `value` at `path` inside a copy of `doc` (no `value` deletes the field). */
function edited<T>(doc: T, path: (string | number)[], ...value: unknown[]): T {
	const out = structuredClone(doc);
	let node = out as unknown as Json;
	for (const key of path.slice(0, -1)) node = node[key] as Json;
	const last = path[path.length - 1];
	if (value.length) node[last] = value[0];
	else delete node[last];
	return out;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. The schema ───────────────────────────────────────────────────────────────────────────────
const good = controlsOf('hero');
check(
	'schema: the fixture (every field once) is well formed',
	controlsDocProblems(good).length === 0,
	controlsDocProblems(good).join('; '),
);
{
	// A 3D rig's channels (2.5D P3b): a control may key, and limit, its tilt, twist and depth.
	const three = edited(
		edited(good, ['bones', 'upper_arm_l', 'channels'], ['rotate', 'tilt', 'twist', 'depth']),
		['bones', 'upper_arm_l', 'limits'],
		{ tilt: [-60, 60], twist: [-90, 90], depth: [-20, 40] },
	);
	check(
		'schema: a control keys and limits the 3D channels (tilt, twist, depth)',
		controlsDocProblems(three).length === 0,
		controlsDocProblems(three).join('; '),
	);
}
const refuses = (what: string, doc: unknown, why: RegExp) => {
	const p = controlsDocProblems(doc);
	check(
		`schema: refuses ${what}`,
		p.some((x) => why.test(x)),
		p.join('; ') || 'accepted',
	);
};
refuses('no object', [], /^controls\.json must be an object$/);
refuses(
	'an empty slot folder',
	edited(good, ['slotFolders', 'face'], []),
	/slotFolders\.face must list at least 1/,
);
refuses(
	'a slot twice in a folder',
	edited(good, ['slotFolders', 'face'], ['head', 'head']),
	/slotFolders\.face lists a name twice/,
);
refuses(
	'a slot in two folders',
	edited(good, ['slotFolders', 'face'], ['head', 'hand']),
	/slotFolders puts slot "hand" in "arm" and "face"/,
);
refuses('a missing rig', edited(good, ['rig']), /controls\.json\.rig is missing/);
refuses(
	'an unknown field',
	edited(good, ['shapes'], {}),
	/controls\.json\.shapes is not a controls field/,
);
refuses(
	'an unknown bone field',
	edited(good, ['bones', 'look', 'glow'], 1),
	/bones\.look\.glow is not a controls field/,
);
refuses(
	'a newer version',
	edited(good, ['controls'], 2),
	/version 2, newer than this launcher reads/,
);
refuses('another version', edited(good, ['controls'], 0), /controls\.json\.controls must be 1/);
refuses('a mark that is no name', edited(good, ['irig'], 3), /controls\.json\.irig must be a name/);
refuses(
	'an unknown role',
	edited(good, ['bones', 'look', 'role'], 'driver'),
	/role must be 'deform' or 'control' or 'helper'/,
);
refuses(
	'an unknown shape',
	edited(good, ['bones', 'look', 'shape'], 'star'),
	/shape must be 'circle'/,
);
refuses(
	'arrow ways on a square',
	edited(good, ['bones', 'hand_ik_l', 'ways'], 2),
	/hand_ik_l\.ways is only for a arrow/,
);
refuses(
	'three arrow ways',
	edited(good, ['bones', 'look', 'ways'], 3),
	/look\.ways must be 1 or 2 or 4/,
);
refuses(
	'box axes on a ring',
	edited(good, ['bones', 'upper_arm_l', 'axes'], 1),
	/upper_arm_l\.axes is only for a box/,
);
refuses(
	'points on a ring',
	edited(
		good,
		['bones', 'upper_arm_l', 'points'],
		[
			[0, 0],
			[1, 1],
		],
	),
	/points is only for a polyline/,
);
refuses(
	'a polyline without points',
	edited(good, ['bones', 'head', 'points']),
	/head\.points is missing/,
);
refuses(
	'a polyline of one point',
	edited(good, ['bones', 'head', 'points'], [[0, 0]]),
	/points must list at least 2/,
);
refuses(
	'a point that is no pair',
	edited(good, ['bones', 'head', 'points', 1], [1]),
	/points\[1\] must be a pair of numbers/,
);
refuses(
	'a colour that is no #rrggbb',
	edited(good, ['bones', 'hand_ik_l', 'colour'], 'gold'),
	/colour must be a #rrggbb colour/,
);
refuses('a size of 0', edited(good, ['bones', 'hand_ik_l', 'size'], 0), /size must be above 0/);
refuses(
	'a line width below 0',
	edited(good, ['bones', 'upper_arm_l', 'lineWidth'], -1),
	/lineWidth must be above 0/,
);
refuses(
	'a size in pixels by another name',
	edited(good, ['bones', 'upper_arm_l', 'sizeIn'], 'px'),
	/sizeIn must be 'screen' or 'rig'/,
);
refuses(
	'an offset of one number',
	edited(good, ['bones', 'look', 'offset'], [1]),
	/offset must be a pair of numbers/,
);
refuses(
	'a turn that is no number',
	edited(good, ['bones', 'look', 'turn'], '45'),
	/turn must be a number/,
);
refuses(
	'an unknown display',
	edited(good, ['bones', 'look', 'display'], 'hud'),
	/display must be 'stage' or 'picker' or 'both'/,
);
refuses(
	'an unknown channel',
	edited(good, ['bones', 'hand_ik_l', 'channels'], ['move']),
	/channels\[0\] must be 'translate'/,
);
refuses(
	'a channel twice',
	edited(good, ['bones', 'hand_ik_l', 'channels'], ['rotate', 'rotate']),
	/channels lists a channel twice/,
);
refuses(
	'a limit ending before it starts',
	edited(good, ['bones', 'upper_arm_l', 'limits', 'rotate'], [60, -170]),
	/rotate must not end before it starts/,
);
refuses(
	'a limit of one number',
	edited(good, ['bones', 'upper_arm_l', 'limits', 'rotate'], [60]),
	/rotate must be a range \[min, max\]/,
);
refuses(
	'a limit on no channel',
	edited(good, ['bones', 'upper_arm_l', 'limits', 'shear'], [0, 1]),
	/limits\.shear is not a controls field/,
);
refuses(
	'hidden that is no switch',
	edited(good, ['bones', 'space_chest_hand_l', 'hidden'], 1),
	/hidden must be true or false/,
);
refuses(
	'a layer not listed',
	edited(good, ['bones', 'look', 'layer'], 'Fingers'),
	/look\.layer "Fingers" is not one of the layers/,
);
refuses(
	'a layer listed twice',
	edited(good, ['layers', 1, 'name'], 'Body FK'),
	/layers\[1\] names layer "Body FK" twice/,
);
refuses('a layer with no name', edited(good, ['layers', 2], {}), /layers\[2\]\.name is missing/);
refuses(
	'a set listing a bone twice',
	edited(good, ['sets', 'hands'], ['hand_l', 'hand_l']),
	/sets\.hands lists a name twice/,
);
refuses(
	'a set member that is no name',
	edited(good, ['sets', 'hands', 0], ''),
	/sets\.hands\[0\] must be a name/,
);
refuses('a limb with no IK', edited(good, ['limbs', 'arm_l', 'ik']), /limbs\.arm_l\.ik is missing/);
refuses(
	'a limb with no FK bone',
	edited(good, ['limbs', 'arm_l', 'fk'], []),
	/limbs\.arm_l\.fk must list at least 1/,
);
refuses(
	'a space with no constraint',
	edited(good, ['limbs', 'arm_l', 'spaces', 'chest', 'constraint']),
	/spaces\.chest\.constraint is missing/,
);
refuses(
	'an unknown preset',
	edited(good, ['presets', 'head_aim'], 'lookAt'),
	/presets\.head_aim must be 'aim'/,
);
refuses(
	'a bone in two mirror pairs',
	edited(good, ['mirror', 'pairs'], { a: 'b', c: 'a' }),
	/mirror\.pairs pairs bone "a" twice/,
);
refuses(
	'a picker button naming two things',
	edited(good, ['picker', 'items', 0, 'set'], 'hands'),
	/items\[0\] must name one bone, set or limb/,
);
refuses(
	'a picker button naming nothing',
	edited(good, ['picker', 'items', 0, 'bone']),
	/items\[0\] must name one bone, set or limb/,
);
refuses(
	'a picker button off the picker',
	edited(good, ['picker', 'items', 0, 'at'], [1.5, 0]),
	/items\[0\]\.at must be a place \[x, y\] in 0…1/,
);
refuses(
	'a picker button for no set',
	edited(good, ['picker', 'items', 1, 'set'], 'feet'),
	/items\[1\]\.set "feet" is not one of the sets/,
);
refuses(
	'a picker button for no limb',
	edited(good, ['picker', 'items', 2, 'limb'], 'leg_l'),
	/items\[2\]\.limb "leg_l" is not one of the limbs/,
);
check(
	'schema: a self pair (a centred bone) is not a bone paired twice',
	controlsDocProblems(edited(good, ['mirror', 'pairs'], { head: 'head', a: 'b' })).length === 0,
);

// ── 2. Against the irig ─────────────────────────────────────────────────────────────────────────
const irig = controlsIrig();
const problems = (doc: ControlsDoc) => controlsIrigProblems(doc, irig);
check('irig: the fixture fits its rig', problems(good).length === 0, problems(good).join('; '));
const misfits = (what: string, doc: ControlsDoc, why: RegExp) => {
	const p = problems(doc);
	check(
		`irig: refuses ${what}`,
		p.some((x) => why.test(x)),
		p.join('; ') || 'accepted',
	);
};
misfits(
	'a control on a missing bone',
	edited(good, ['bones', 'tail'], { shape: 'circle' }),
	/^bones\.tail names bone "tail", which is not in the rig$/,
);
misfits(
	'a slot folder member the rig lacks',
	edited(good, ['slotFolders', 'arm', 1], 'tail'),
	/^slotFolders\.arm\[1\] names slot "tail", which is not in the rig$/,
);
misfits(
	'a folder whose slots are not together in the draw order',
	edited(good, ['slotFolders'], { arm: ['upper_arm', 'hand'] }),
	/^slotFolders\.arm: its slots are not together in the draw order$/,
);
misfits(
	'the old slot groups (read only)',
	edited(good, ['slotGroups'], { g: ['head'] }),
	/^slotGroups is read only/,
);
{
	const slotFit = fitControls(edited(good, ['slotFolders', 'face', 0], 'hat'), irig);
	check(
		'irig: fitting drops a folder left with no slot, keeping the others whole',
		sameJson(slotFit.doc.slotFolders, { arm: ['upper_arm', 'lower_arm', 'hand'] }) &&
			slotFit.dropped.length === 1,
		JSON.stringify(slotFit),
	);
	const one = fitControls(edited(good, ['slotFolders', 'arm', 0], 'tail'), irig).doc.slotFolders;
	check(
		'irig: fitting drops a missing slot from its folder alone',
		sameJson(one?.arm, ['lower_arm', 'hand']),
		JSON.stringify(one),
	);
}
// ── 2b. Folders kept true over the draw order, and the old groups turned into folders ─────────
{
	const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
	const fit = (f: Record<string, string[]>, o = order, seen?: Set<string>) =>
		fitSlotFolders(f, o, seen);
	check(
		'folders: a true folder is left as it is, listed back to front',
		sameJson(fit({ x: ['d', 'b', 'c'] }), { x: ['b', 'c', 'd'] }),
	);
	check(
		'folders: a slot moved out of a folder’s run leaves it',
		sameJson(fit({ x: ['a', 'b', 'f'] }), { x: ['a', 'b'] }),
		JSON.stringify(fit({ x: ['a', 'b', 'f'] })),
	);
	check(
		'folders: of two equal runs the frontmost stays',
		sameJson(fit({ x: ['b', 'd'] }), { x: ['d'] }),
		JSON.stringify(fit({ x: ['b', 'd'] })),
	);
	check(
		'folders: a slot in two folders stays in the first',
		sameJson(fit({ x: ['b', 'c'], y: ['c', 'd'] }), { x: ['b', 'c'], y: ['d'] }),
	);
	check(
		'folders: one split by another folder keeps its largest run',
		sameJson(fit({ x: ['a', 'b', 'd'], y: ['c'] }), { x: ['a', 'b'], y: ['c'] }),
	);
	const seen = new Set(['a', 'b', 'd', 'e']);
	check(
		'folders: a new slot placed inside a folder’s run joins it',
		sameJson(fit({ x: ['b', 'd'] }, ['a', 'b', 'c', 'd', 'e'], seen), { x: ['b', 'c', 'd'] }),
	);
	check(
		'folders: a new slot next to a run, or an old one inside it, does not join',
		sameJson(fit({ x: ['b', 'd'] }, ['a', 'b', 'c', 'd', 'e', 'n'], new Set([...seen, 'c'])), {
			x: ['d'],
		}) && sameJson(fit({ x: ['d', 'e'] }, ['a', 'b', 'c', 'd', 'e', 'n'], seen), { x: ['d', 'e'] }),
	);
	check('folders: an empty folder goes', sameJson(fit({ x: ['zz'] }), {}));

	// The old loose groups (#1906): together and unshared → a folder; else left out, the order kept.
	const legacy = {
		...good,
		slotFolders: undefined,
		slotGroups: {
			arm: ['hand', 'upper_arm', 'lower_arm'],
			spread: ['torso', 'head'],
			dup: ['head'],
			face: ['lower_arm'],
		},
	} as ControlsDoc;
	delete legacy.slotFolders;
	const migrated = fitControls(legacy, irig);
	check(
		'migration: a group together in the draw order becomes a folder, a shared or spread one does not',
		sameJson(migrated.doc.slotFolders, {
			arm: ['upper_arm', 'lower_arm', 'hand'],
			dup: ['head'],
		}) && migrated.doc.slotGroups === undefined,
		JSON.stringify(migrated.doc.slotFolders),
	);
	check(
		'migration: each group left out is named once',
		sameJson(
			migrated.dropped.filter((d) => d.startsWith('slotGroups.')).map((d) => d.split(' ')[0]),
			['slotGroups.spread', 'slotGroups.face'],
		),
		JSON.stringify(migrated.dropped),
	);
	check(
		'migration: the draw order is never touched, and the result is what a save accepts',
		sameJson(irig.slots, controlsIrig().slots) &&
			checkedControls(migrated.doc, 'hero', irig).problems.length === 0,
		JSON.stringify(checkedControls(migrated.doc, 'hero', irig).problems),
	);
	const clash = fitControls({ ...legacy, slotFolders: { arm: ['torso'] } } as ControlsDoc, irig);
	check(
		'migration: a group named like a folder gets a number',
		Object.hasOwn(clash.doc.slotFolders ?? {}, 'arm 2'),
		JSON.stringify(clash.doc.slotFolders),
	);
}
misfits(
	'a set member the rig lacks',
	edited(good, ['sets', 'hands', 1], 'hand_r'),
	/sets\.hands\[1\] names bone "hand_r"/,
);
misfits(
	'a limb on a missing IK',
	edited(good, ['limbs', 'arm_l', 'ik'], 'leg_ik'),
	/limbs\.arm_l\.ik names ik constraint "leg_ik"/,
);
misfits(
	'a space on a missing transform',
	edited(good, ['limbs', 'arm_l', 'spaces', 'world', 'constraint'], 'gone'),
	/spaces\.world\.constraint names transform constraint "gone"/,
);
misfits(
	'a preset whose constraint is of another kind',
	edited(good, ['presets'], { head_aim: 'orient' }),
	/presets\.head_aim names transform constraint "head_aim"/,
);
misfits(
	'a mirror line the rig lacks',
	edited(good, ['mirror', 'line'], 'spine'),
	/mirror\.line names bone "spine"/,
);
misfits(
	'a picker button on a missing bone',
	edited(good, ['picker', 'items', 0, 'bone'], 'hand_r'),
	/picker\.items\[0\]\.bone names bone "hand_r"/,
);
const twice = edited(edited(good, ['limbs', 'arm_l', 'ik'], 'x'), ['limbs', 'arm_l', 'pole'], 'y');
const bound = checkedControls({ ...good, rig: 'other', irig: 7 }, 'hero', irig);
check(
	"irig: a client's sidecar is bound to the rig it is saved with, its pair mark (the save's) dropped",
	sameJson(bound, { doc: good, problems: [] }),
	JSON.stringify(bound.problems),
);
check(
	'irig: …and refused when it does not fit that rig',
	checkedControls(edited(good, ['mirror', 'line'], 'spine'), 'hero', irig).doc === null,
);
check(
	'irig: every missing name is listed, even in an entry already going',
	problems(twice).length === 2,
	problems(twice).join('; '),
);

// The lenient read: as little as possible goes.
const noPole = deletedBone(irig, 'elbow_pole_l');
const fitPole = fitControls(good, noPole);
check(
	'fit: a deleted pole leaves the limb, its control entry goes, and both are named',
	fitPole.doc.limbs?.arm_l?.pole === undefined &&
		fitPole.doc.limbs?.arm_l?.control === 'hand_ik_l' &&
		!('elbow_pole_l' in (fitPole.doc.bones ?? {})) &&
		fitPole.dropped.length === 2 &&
		fitPole.dropped.every((d) => /"elbow_pole_l"/.test(d)),
	fitPole.dropped.join('; '),
);
const noIk = { ...irig, ik: (irig.ik as Json[]).filter((c) => c.name !== 'arm_ik_l') };
const fitIk = fitControls(good, noIk);
check(
	"fit: a deleted IK takes its limb, its preset and the limb's picker button, and nothing else",
	!('arm_l' in (fitIk.doc.limbs ?? {})) &&
		!('arm_ik_l' in (fitIk.doc.presets ?? {})) &&
		!(fitIk.doc.picker?.items ?? []).some((i) => i.limb === 'arm_l') &&
		(fitIk.doc.picker?.items ?? []).length === 2 &&
		Object.keys(fitIk.doc.bones ?? {}).length === Object.keys(good.bones ?? {}).length,
	JSON.stringify(fitIk.doc.limbs),
);
const noHand = deletedBone(
	{ ...irig, slots: (irig.slots as Json[]).filter((s) => s.bone !== 'hand_l') },
	'hand_l',
);
const fitHand = fitControls(good, noHand);
check(
	'fit: a deleted bone leaves the sets it was in, without it',
	JSON.stringify(fitHand.doc.sets) ===
		JSON.stringify({ hands: ['hand_ik_l'], arm_l: ['upper_arm_l', 'lower_arm_l'] }),
	JSON.stringify(fitHand.doc.sets),
);
const fitFk = fitControls(good, deletedBone(irig, 'lower_arm_l'));
check(
	'fit: an FK bone gone takes the limb',
	!('arm_l' in (fitFk.doc.limbs ?? {})) &&
		fitFk.dropped.some((d) => /limbs\.arm_l\.fk\[1\]/.test(d)),
	fitFk.dropped.join('; '),
);
for (const [what, f] of [
	['pole', fitPole],
	['IK', fitIk],
	['hand', fitHand],
	['FK bone', fitFk],
] as const)
	check(
		`fit: what it keeps (no ${what}) is a well formed sidecar that fits the rig`,
		controlsDocProblems(f.doc).length === 0,
		controlsDocProblems(f.doc).join('; '),
	);
check(
	'fit: a sidecar that fits keeps every field, and the read drops nothing',
	JSON.stringify(fitControls(good, irig)) === JSON.stringify({ doc: good, dropped: [] }),
);

// ── 3. Renames ──────────────────────────────────────────────────────────────────────────────────
const map = (r: ReturnType<typeof renamesBetween>) =>
	Object.fromEntries(
		Object.entries(r)
			.filter(([, m]) => m.size)
			.map(([k, m]) => [k, Object.fromEntries(m)]),
	);

const toCtrl = renamedBone(irig, 'hand_ik_l', 'hand_ctrl_l');
check(
	"rename: the Rigger's bone rename is found",
	sameJson(map(renamesBetween(irig, toCtrl)), { bone: { hand_ik_l: 'hand_ctrl_l' } }),
	JSON.stringify(map(renamesBetween(irig, toCtrl))),
);
const followed = renameControls(good, renamesBetween(irig, toCtrl));
check(
	'rename: it follows into the control, the set, the limb, the mirror pair and the picker',
	sameJson(followed.bones?.hand_ctrl_l, good.bones?.hand_ik_l) &&
		!('hand_ik_l' in (followed.bones ?? {})) &&
		followed.sets?.hands[0] === 'hand_ctrl_l' &&
		followed.limbs?.arm_l?.control === 'hand_ctrl_l' &&
		sameJson(followed.mirror?.pairs, { hand_ctrl_l: 'hand_ctrl_l' }) &&
		followed.picker?.items?.[0].bone === 'hand_ctrl_l' &&
		!JSON.stringify(followed).includes('hand_ik_l'),
	JSON.stringify(followed),
);
check(
	'rename: what it leaves fits the renamed rig',
	controlsIrigProblems(followed, toCtrl).length === 0 && controlsDocProblems(followed).length === 0,
	controlsIrigProblems(followed, toCtrl).join('; '),
);
const both = renamedBone(
	renamedBone(irig, 'space_chest_hand_l', 'sp_chest'),
	'space_world_hand_l',
	'sp_world',
);
check(
	'rename: two neighbours renamed at once are paired in order',
	sameJson(map(renamesBetween(irig, both)), {
		bone: { space_chest_hand_l: 'sp_chest', space_world_hand_l: 'sp_world' },
	}),
	JSON.stringify(map(renamesBetween(irig, both))),
);
const chain = renamedBone(renamedBone(irig, 'upper_arm_l', 'ua_l'), 'lower_arm_l', 'la_l');
check(
	'rename: a parent and its child renamed together (the child hangs from the renamed parent)',
	sameJson(map(renamesBetween(irig, chain)).bone, { upper_arm_l: 'ua_l', lower_arm_l: 'la_l' }),
	JSON.stringify(map(renamesBetween(irig, chain))),
);
check(
	'rename: a constraint acting on a renamed bone is not taken for a renamed constraint',
	!('ik' in map(renamesBetween(irig, chain))),
);
const ikRenamed = renamedConstraint(irig, 'ik', 'arm_ik_l', 'arm_l_ik');
const ikFollowed = renameControls(good, renamesBetween(irig, ikRenamed));
check(
	"rename: a constraint's rename follows into its limb and its preset",
	sameJson(map(renamesBetween(irig, ikRenamed)), { ik: { arm_ik_l: 'arm_l_ik' } }) &&
		ikFollowed.limbs?.arm_l?.ik === 'arm_l_ik' &&
		ikFollowed.presets?.arm_l_ik === 'twoBoneIk' &&
		!('arm_ik_l' in (ikFollowed.presets ?? {})),
	JSON.stringify(map(renamesBetween(irig, ikRenamed))),
);
const moved = renamedBone(irig, 'hand_ik_l', 'hand_ctrl_l') as { bones: Json[] } & Json;
moved.bones.find((b) => b.name === 'hand_ctrl_l')!.parent = 'chest';
check(
	'rename: a rename that also re-parents the bone is no rename (its control is dropped instead)',
	map(renamesBetween(irig, moved)).bone === undefined,
);
const swapped = deletedBone(irig, 'elbow_pole_l') as { bones: Json[] } & Json;
swapped.bones.push({ name: 'knee_pole_l', parent: 'root' });
check(
	'rename: a delete and an add elsewhere are no rename',
	map(renamesBetween(irig, swapped)).bone === undefined,
);
const replaced = structuredClone(irig) as { bones: Json[] } & Json;
replaced.bones[replaced.bones.findIndex((b) => b.name === 'look')] = {
	name: 'aim',
	parent: 'chest',
};
check(
	'rename: a bone replaced in place by one hanging elsewhere is no rename',
	map(renamesBetween(irig, replaced)).bone === undefined,
);
const merged = structuredClone(irig) as { bones: Json[] } & Json;
const at = merged.bones.findIndex((b) => b.name === 'hand_ik_l');
merged.bones.splice(at, 2, { name: 'knee_l', parent: 'root' });
check(
	'rename: two bones going where one came (same parent) is no rename: which one would it be?',
	map(renamesBetween(irig, merged)).bone === undefined,
);
const aimSwapped = structuredClone(irig) as { ik: Json[] } & Json;
aimSwapped.ik[1] = { name: 'eye_aim', order: 3, bones: ['head'], target: 'hand_ik_l' };
check(
	'rename: a constraint replaced in place by one with another target is no rename',
	map(renamesBetween(irig, aimSwapped)).ik === undefined,
);
{
	const slotRenamed = structuredClone(irig) as { slots: Json[] } & Json;
	slotRenamed.slots[3] = { ...slotRenamed.slots[3], name: 'hand_l_art' };
	check(
		'rename: a slot renamed in place follows into its groups',
		sameJson(map(renamesBetween(irig, slotRenamed)), { slot: { hand: 'hand_l_art' } }) &&
			sameJson(renameControls(good, renamesBetween(irig, slotRenamed)).slotFolders?.arm, [
				'upper_arm',
				'lower_arm',
				'hand_l_art',
			]),
		JSON.stringify(map(renamesBetween(irig, slotRenamed))),
	);
	const reboned = structuredClone(slotRenamed);
	reboned.slots[3] = { ...reboned.slots[3], bone: 'head' };
	check(
		'rename: a slot that also moved to another bone is no rename',
		map(renamesBetween(irig, reboned)).slot === undefined,
	);
}
check('rename: an unchanged rig renames nothing', sameJson(map(renamesBetween(irig, irig)), {}));
const stale = edited(good, ['bones', 'hand_ctrl_l'], { shape: 'cross' });
check(
	'rename: a renamed control wins over a stale entry already under its new name',
	renameControls(stale, renamesBetween(irig, toCtrl)).bones?.hand_ctrl_l?.shape === 'square',
);

// ── 4. The runtime never reads it ───────────────────────────────────────────────────────────────
interface Stored {
	body: Uint8Array;
	etag: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
const enc = new TextEncoder();
const dec = new TextDecoder();
let clock = 0;
const put = (key: string, body: Uint8Array) => {
	const etag = `"${createHash('md5').update(body).digest('hex')}"`;
	bucket.set(key, { body, etag, modified: ++clock });
	return etag;
};
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		putObjectText: async (key: string, text: string) => put(key, enc.encode(text)),
		putObjectBytes: async (key: string, body: Uint8Array) => put(key, body),
		getObjectBytes: async (key: string) => {
			const o = bucket.get(key);
			return o ? { body: o.body, contentType: 'image/png', etag: o.etag } : null;
		},
		getObjectText: async (key: string) => {
			const o = bucket.get(key);
			return o ? dec.decode(o.body) : null;
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.body.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => bucket.has(key),
		copyObject: async (src: string, dest: string) => {
			const o = bucket.get(src);
			if (!o) return false;
			put(dest, o.body);
			return true;
		},
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((k) => k.startsWith(prefix))
				.map((key) => ({ key, size: bucket.get(key)!.body.length, lastModified: 0, etag: '' })),
		deleteObject: async (key: string) => void bucket.delete(key),
	},
});
mock.module(server('editorRegions.ts'), {
	namedExports: {
		loadRegionSet: async () => ({ regions: [], pageKey: '', pageWidth: 0, pageHeight: 0 }),
	},
});
const { exportRigBundle } = await import('../src/lib/server/rig.ts');

const ROOT = 'acme/p1';
const BUNDLE = `${ROOT}/spines/C`;
const DEPLOY = `${ROOT}/deploy/`;
const ATLAS = [
	'C.png',
	'size:1024,64',
	'filter:Linear,Linear',
	...REGIONS.flatMap((n, i) => [n, `bounds:${i * 64},0,64,64`]),
	'',
].join('\n');
const irigText = JSON.stringify(irig);
const seedBundle = (withControls: boolean) => {
	bucket.clear();
	put(`${BUNDLE}/C.irig`, enc.encode(irigText));
	put(`${BUNDLE}/C.atlas`, enc.encode(ATLAS));
	put(`${BUNDLE}/C.png`, enc.encode('png'));
	if (withControls)
		put(
			`${BUNDLE}/${CONTROLS_SIDECAR}`,
			enc.encode(JSON.stringify({ ...controlsOf('C'), irig: 'x' })),
		);
};
const exported = async (withControls: boolean) => {
	seedBundle(withControls);
	const res = await exportRigBundle({
		clientKey: 'acme',
		projectKey: 'p1',
		assetKey: `${BUNDLE}/`,
		deployPrefix: DEPLOY,
		subtree: 'editor-art',
		stem: 'C',
		skeletonIndex: [
			{
				name: 'C',
				folder: 'C',
				skeleton_file: 'C.irig',
				atlas_file: 'C.atlas',
				format: 'json' as const,
				runtime: '4.2',
				dir_b64: '',
			},
		],
	});
	const deployed = [...bucket.entries()]
		.filter(([k]) => k.startsWith(DEPLOY))
		.map(([k, o]) => [k, dec.decode(o.body)] as const)
		.sort();
	return { res, deployed };
};
const plain = await exported(false);
const withControls = await exported(true);
check(
	'export: the rig exports',
	plain.res !== null && plain.deployed.some(([k]) => k.endsWith('/C.json')),
	JSON.stringify(plain.deployed.map(([k]) => k)),
);
check(
	'export: a bundle with controls.json writes the same keys and bytes as without it',
	sameJson(withControls.deployed, plain.deployed) && sameJson(withControls.res, plain.res),
	JSON.stringify(withControls.deployed.map(([k]) => k)),
);
const skeletonText = withControls.deployed.find(([k]) => k.endsWith('/C.json'))![1];
check(
	'export: the shipped skeleton is the .irig, byte for byte, with nothing of the sidecar in it',
	skeletonText === irigText && !/"(controls|shape|layers|limbs|picker)"\s*:/.test(skeletonText),
);
let strict = '';
try {
	readIrig(skeletonText);
} catch (e) {
	strict = (e as Error).message;
}
check('parity: the shipped skeleton is read by the strict irig reader', strict === '', strict);

const atlas = new TextureAtlas(ATLAS);
atlas.setTextures(() => ({
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
}));
/** Every bone's world transform, every 1/50 s of `clip`, as engine-rig plays it in a game. */
const played = (text: string, clip: string) => {
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(text),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, clip, false);
	const frames: number[][] = [];
	let now = 0;
	for (let i = 0; i <= 50; i++) {
		const t = i / 50;
		state.update(t - now);
		now = t;
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		frames.push(skel.bones.flatMap((b) => [b.a, b.b, b.c, b.d, b.worldX, b.worldY]));
	}
	return frames;
};
for (const clip of ['wave', 'reach']) {
	const alone = played(irigText, clip);
	const shipped = played(skeletonText, clip);
	check(
		`parity: engine-rig poses "${clip}" from the shipped skeleton exactly as the rig alone`,
		sameJson(shipped, alone),
	);
	check(
		`parity: …and "${clip}" moves (the comparison is not of two still poses)`,
		!sameJson(alone[0], alone[alone.length - 1]),
	);
}
{
	// The IK the control layer drives runs in the shipped rig: after the step the hand reaches its control.
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(skeletonText),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, 'reach', false);
	state.update(0.8);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	const hand = skel.findBone('hand_l')!;
	const target = skel.findBone('hand_ik_l')!;
	const reach = Math.hypot(hand.worldX - target.worldX, hand.worldY - target.worldY);
	check(
		'parity: the IK the controls drive runs in the shipped rig (the hand reaches its control)',
		reach < 1e-3,
		`${reach.toFixed(4)} units off`,
	);
}

console.log(
	`\n${failures ? `${failures} of ${checks} rig-controls checks FAILED` : `all ${checks} rig-controls checks pass`}`,
);
process.exit(failures ? 1 : 0);
